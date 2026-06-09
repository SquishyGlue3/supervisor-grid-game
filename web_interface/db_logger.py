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
            completed BOOLEAN DEFAULT FALSE
        );
    """)
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
            snapshot JSONB
        );
    """)
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
):
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO game_events
              (session_id, turn_number, mode, action, thoughts, score, position,
               test_phase, robot_hiding, ai_active, response_time_ms, message_text, snapshot)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                db_session_id, turn, mode, action, thoughts, score, position,
                test_phase, robot_hiding, ai_active, response_time_ms,
                message_text, json.dumps(snapshot),
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


def upload_session_to_s3(pid: str, db_session_id: int):
    """Upload per-session CSV + text log and append to combined/game_data.csv in S3."""
    if not s3:
        return
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT turn_number, created_at, mode, action, thoughts, score, position,
               test_phase, robot_hiding, ai_active, response_time_ms, message_text
        FROM game_events WHERE session_id = %s ORDER BY turn_number
        """,
        (db_session_id,),
    )
    # rows: (turn_number, started_at, mode, action, thoughts, score, position,
    #        test_phase, robot_hiding, ai_active, response_time_ms, message_text)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")

    # Column names match export_analysis.py expectations exactly
    headers = [
        "turn_number", "started_at", "mode", "action", "thoughts", "score", "position",
        "test_phase", "robot_hiding", "ai_active", "response_time_ms", "message_text",
    ]

    # Per-session CSV
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    upload_to_s3(f"csv/{pid}_{ts}.csv", buf.getvalue(), "text/csv")

    # Per-session human-readable text log
    lines = [f"Session: {pid}  |  DB id: {db_session_id}  |  Exported: {ts}\n", "-" * 60 + "\n"]
    for r in rows:
        lines.append(f"Turn {r[0]:>3} | {str(r[2]):12} | {str(r[3]):12} | score={r[5]} | pos={r[6]}\n")
    upload_to_s3(f"logs/{pid}_{ts}.txt", "".join(lines))

    # Rebuild combined CSV from ALL sessions in DB — same pattern as Node.js.
    # This means every session (including previously cut ones) is always included.
    conn2 = _get_conn()
    cur2 = conn2.cursor()
    cur2.execute("""
        SELECT s.session_id, ge.turn_number, ge.created_at, ge.mode, ge.action,
               ge.thoughts, ge.score, ge.position, ge.test_phase, ge.robot_hiding,
               ge.ai_active, ge.response_time_ms, ge.message_text
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

    print(f"S3 upload complete for session {pid} (db_id={db_session_id})")
