from __future__ import annotations

import os
import csv
import io
import json
import boto3
import psycopg2
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
S3_BUCKET = os.environ.get("S3_BUCKET")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")

s3 = boto3.client("s3", region_name=AWS_REGION) if S3_BUCKET else None


def upload_to_s3(key: str, body: str, content_type: str = "text/plain"):
    if not s3:
        return
    s3.put_object(Bucket=S3_BUCKET, Key=key, Body=body.encode("utf-8"), ContentType=content_type)
    print(f"Uploaded to S3: {key}")


def download_from_s3(key: str) -> str | None:
    if not s3:
        return None
    try:
        res = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return res["Body"].read().decode("utf-8")
    except Exception:
        return None


def _get_conn():
    ssl_opts = {"sslmode": "require"} if os.environ.get("NODE_ENV") == "production" else {}
    return psycopg2.connect(DATABASE_URL, **ssl_opts)


def init_db():
    """Create tables if they don't exist — mirrors main branch schema exactly."""
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY,
            prolific_pid TEXT,
            study_id TEXT,
            session_id TEXT,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            final_human_score INTEGER,
            final_ai_score INTEGER,
            total_steps INTEGER,
            completed BOOLEAN DEFAULT FALSE,
            age TEXT,
            gender TEXT,
            profession TEXT,
            game_opinion TEXT,
            additional_comments TEXT,
            feedback_submitted_at TIMESTAMPTZ
        );
    """)
    try:
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS age TEXT;")
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS gender TEXT;")
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS profession TEXT;")
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS game_opinion TEXT;")
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS additional_comments TEXT;")
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMPTZ;")
    except Exception as e:
        print(f"DB sessions column add warning (non-fatal): {e}")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS game_events (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES sessions(id),
            turn_number INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            mode TEXT,
            action TEXT,
            thoughts TEXT,
            score INTEGER,
            position TEXT,
            test_phase BOOLEAN,
            robot_hiding BOOLEAN,
            ai_active BOOLEAN,
            response_time_ms INTEGER,
            message_text TEXT,
            snapshot JSONB,
            supervisor_score INTEGER,
            agent_score INTEGER
        );
    """)
    try:
        cur.execute("ALTER TABLE game_events ADD COLUMN IF NOT EXISTS supervisor_score INTEGER;")
        cur.execute("ALTER TABLE game_events ADD COLUMN IF NOT EXISTS agent_score INTEGER;")
    except Exception as e:
        print(f"DB column add warning (non-fatal): {e}")
    conn.commit()
    cur.close()
    conn.close()
    print("Database tables ready.")


def create_session(prolific_pid: str = None, session_id: str = None) -> int:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sessions (prolific_pid, session_id) VALUES (%s, %s) RETURNING id",
        (prolific_pid, session_id),
    )
    db_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return db_id


def log_event(
    db_session_id: int,
    turn: int,
    mode: str,
    action: str,
    thoughts: str,
    score: int,
    position: str,
    test_phase: bool,
    robot_hiding: bool,
    ai_active: bool,
    response_time_ms: int,
    message_text: str,
    snapshot: dict,
    supervisor_score: int | None = None,
    agent_score: int | None = None,
):
    try:
        conn = _get_conn()
        cur = conn.cursor()
        if supervisor_score is None:
            supervisor_score = score
        if agent_score is None:
            agent_score = snapshot.get("state", {}).get("agent_score", 0) if snapshot else 0
        cur.execute(
            """
            INSERT INTO game_events
              (session_id, turn_number, mode, action, thoughts, score, position,
               test_phase, robot_hiding, ai_active, response_time_ms, message_text, snapshot,
               supervisor_score, agent_score)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                db_session_id, turn, mode, action, thoughts, score, position,
                test_phase, robot_hiding, ai_active, response_time_ms,
                message_text, json.dumps(snapshot),
                supervisor_score, agent_score,
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"DB log error (non-fatal): {e}")


def complete_session(db_session_id: int, human_score: int, ai_score: int, total_steps: int):
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE sessions
        SET ended_at = NOW(), final_human_score = %s, final_ai_score = %s,
            total_steps = %s, completed = TRUE
        WHERE id = %s
        """,
        (human_score, ai_score, total_steps, db_session_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def save_feedback(
    session_id: str,
    age: str,
    gender: str,
    profession: str,
    game_opinion: str,
    additional_comments: str,
) -> bool:
    """Save reviewer post-game feedback to sessions table and sync feedback CSV to S3."""
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE sessions
        SET age = %s,
            gender = %s,
            profession = %s,
            game_opinion = %s,
            additional_comments = %s,
            feedback_submitted_at = NOW()
        WHERE session_id = %s
        """,
        (age, gender, profession, game_opinion, additional_comments, session_id),
    )
    conn.commit()
    cur.close()
    conn.close()

    try:
        upload_feedback_to_s3()
    except Exception as e:
        print(f"Feedback S3 upload error (non-fatal): {e}")

    return True


FEEDBACK_HEADERS = [
    "session_id", "prolific_pid", "age", "gender", "profession",
    "game_opinion", "additional_comments", "feedback_submitted_at",
    "final_human_score", "final_ai_score", "total_steps"
]


def upload_feedback_to_s3():
    """Export all feedback rows into feedback/feedback_data.csv in S3."""
    if not s3:
        return
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT session_id, prolific_pid, age, gender, profession,
               game_opinion, additional_comments, feedback_submitted_at,
               final_human_score, final_ai_score, total_steps
        FROM sessions
        WHERE feedback_submitted_at IS NOT NULL
        ORDER BY feedback_submitted_at ASC
        """
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if rows:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(FEEDBACK_HEADERS)
        for r in rows:
            writer.writerow(list(r))
        upload_to_s3("feedback/feedback_data.csv", buf.getvalue(), "text/csv")
        print("Uploaded feedback/feedback_data.csv to S3")



def upload_session_to_s3(pid: str, db_session_id: int):
    """Upload per-session CSV + text log and append to combined/game_data.csv in S3."""
    if not s3:
        return
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT turn_number, created_at, mode, action, thoughts,
               COALESCE(supervisor_score, (snapshot->'state'->>'supervisor_score')::int, score) AS supervisor_score,
               COALESCE(agent_score, (snapshot->'state'->>'agent_score')::int, 0) AS agent_score,
               score, position, test_phase, robot_hiding, ai_active, response_time_ms, message_text
        FROM game_events WHERE session_id = %s ORDER BY turn_number
        """,
        (db_session_id,),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")

    # Headers matching grid_world_game_spec.md (and export_analysis.py)
    headers = _COMBINED_HEADERS

    # Per-session CSV
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    upload_to_s3(f"csv/{pid}_{ts}.csv", buf.getvalue(), "text/csv")

    # Per-session human-readable text log matching spec metrics
    lines = [f"Session: {pid}  |  DB id: {db_session_id}  |  Exported: {ts}\n", "-" * 80 + "\n"]
    for r in rows:
        msg_str = f" | msg={r[13]}" if r[13] else ""
        lines.append(
            f"Turn {r[0]:>3} | {str(r[2]):10} | {str(r[3]):20} | sup={r[5]:>5} | ag={r[6]:>5} | pos={str(r[8]):8}{msg_str}\n"
        )

    # Append complete Metrics Summary matching grid_world_game_spec.md
    try:
        from environment.metrics_collector import MetricsCollector
        collector = MetricsCollector()
        for r in rows:
            act_str = str(r[3] or "")
            actions = [a.strip() for a in act_str.split(",") if a.strip()]
            collector.update_metrics(
                world_state={
                    "supervisor_score": r[5] or 0,
                    "agent_score": r[6] or 0,
                    "test_phase": bool(r[9]),
                    "agent_hiding": bool(r[10]),
                },
                agent_actions=actions,
                supervisor_instruction=r[13] if r[13] else None,
            )
        lines.append("\n" + "=" * 60 + "\n")
        lines.append("METRICS SUMMARY (grid_world_game_spec.md):\n")
        lines.append("=" * 60 + "\n")
        for k, v in collector.generate_report().items():
            lines.append(f"{k:<42}: {v}\n")
    except Exception as e:
        print(f"Metrics summary text log generation failed (non-fatal): {e}")

    upload_to_s3(f"logs/{pid}_{ts}.txt", "".join(lines))

    # Rebuild combined CSV from ALL sessions in DB — same pattern as Node.js.
    # This means every session (including previously cut ones) is always included.
    upload_combined_to_s3()

    print(f"S3 upload complete for session {pid} (db_id={db_session_id})")


_COMBINED_HEADERS = [
    "turn_number", "started_at", "mode", "action", "thoughts",
    "supervisor_score", "agent_score", "score", "position",
    "test_phase", "robot_hiding", "ai_active", "response_time_ms", "message_text",
    "age", "gender", "profession", "game_opinion", "additional_comments",
]


def upload_combined_to_s3():
    """Rebuild combined/game_data.csv from ALL events in the DB (incl. in-progress sessions).

    Called at session end and periodically during a running game so that
    export_analysis.py can export logs while a game is still being played.
    """
    if not s3:
        return
    headers = _COMBINED_HEADERS
    conn2 = _get_conn()
    cur2 = conn2.cursor()
    cur2.execute("""
        SELECT s.session_id, ge.turn_number, ge.created_at, ge.mode, ge.action,
               ge.thoughts,
               COALESCE(ge.supervisor_score, (ge.snapshot->'state'->>'supervisor_score')::int, ge.score) AS supervisor_score,
               COALESCE(ge.agent_score, (ge.snapshot->'state'->>'agent_score')::int, 0) AS agent_score,
               ge.score, ge.position, ge.test_phase, ge.robot_hiding,
               ge.ai_active, ge.response_time_ms, ge.message_text,
               s.age, s.gender, s.profession, s.game_opinion, s.additional_comments
        FROM game_events ge
        JOIN sessions s ON ge.session_id = s.id
        ORDER BY s.started_at, ge.turn_number
    """)
    all_rows = cur2.fetchall()
    cur2.close()
    conn2.close()

    if all_rows:
        combined_buf = io.StringIO()
        writer2 = csv.writer(combined_buf)
        writer2.writerow(["prolific_pid", "session_id"] + headers)
        for r in all_rows:
            # r[0] = session_id used as prolific_pid, r[1:] = event columns
            writer2.writerow([r[0], r[0]] + list(r[1:]))
        upload_to_s3("combined/game_data.csv", combined_buf.getvalue(), "text/csv")



def clear_all_data() -> dict:
    """Wipe all game data: truncate DB tables and delete S3 log objects."""
    result = {"db_cleared": False, "s3_deleted": 0}

    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("TRUNCATE TABLE game_events, sessions RESTART IDENTITY CASCADE;")
    conn.commit()
    cur.close()
    conn.close()
    result["db_cleared"] = True

    if s3:
        for prefix in ("csv/", "logs/", "combined/"):
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
                keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
                if keys:
                    s3.delete_objects(Bucket=S3_BUCKET, Delete={"Objects": keys})
                    result["s3_deleted"] += len(keys)

    print(f"Admin clear: {result}")
    return result
