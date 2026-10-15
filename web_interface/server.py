import asyncio
import sys
import os
import yaml
from dotenv import load_dotenv

load_dotenv()

# Add parent dir to path so we can import environment
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.responses import HTMLResponse

from environment.game_manager import GameManager
from pydantic import BaseModel
from web_interface.db_logger import (
    init_db, create_session, log_event, complete_session, upload_session_to_s3,
    clear_all_data, upload_combined_to_s3, save_feedback,
)

# How often (seconds) the combined S3 CSV is refreshed while a game is running,
# so export_analysis.py / run_export-*.bat can export logs mid-game.
LIVE_EXPORT_INTERVAL_S = float(os.environ.get("LIVE_EXPORT_INTERVAL_S", "15"))

app = FastAPI()


class FeedbackRequest(BaseModel):
    session_id: str
    age: str = ""
    gender: str = ""
    profession: str = ""
    game_opinion: str = ""
    additional_comments: str = ""


@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    try:
        await asyncio.to_thread(
            save_feedback,
            session_id=req.session_id,
            age=req.age,
            gender=req.gender,
            profession=req.profession,
            game_opinion=req.game_opinion,
            additional_comments=req.additional_comments,
        )
        return {"status": "success"}
    except Exception as e:
        print(f"Feedback save error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.on_event("startup")
async def on_startup():
    try:
        init_db()
    except Exception as e:
        print(f"DB init warning (non-fatal): {e}")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(data)


manager = ConnectionManager()


@app.get("/")
def get():
    with open("web_interface/game_viewer.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(html_content)


@app.get("/api/config")
def get_config():
    try:
        with open("configurations/game_config.yaml", "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        return {
            "total_steps": cfg.get("total_steps", 500),
            "step_length": cfg.get("step_length", 1),
        }
    except Exception as e:
        return {"total_steps": 500, "step_length": 1, "error": str(e)}


def _admin_token() -> str:
    """Token = ADMIN_TOKEN env var, or sha256(DATABASE_URL) as a fallback.

    The fallback means no extra config is needed: anyone holding the same
    .env (DB password) can compute it, nobody else can.
    """
    import hashlib
    explicit = os.environ.get("ADMIN_TOKEN")
    if explicit:
        return explicit
    db_url = os.environ.get("DATABASE_URL", "")
    return hashlib.sha256(db_url.encode("utf-8")).hexdigest() if db_url else ""


@app.post("/admin/clear-data")
async def admin_clear_data(x_admin_token: str = Header(default="")):
    import hmac
    expected = _admin_token()
    if not expected or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        result = await asyncio.to_thread(clear_all_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str, prolific_pid: str = None):
    await manager.connect(websocket, session_id)
    config_dir = os.path.join(os.path.dirname(__file__), "..", "configurations")
    with open(os.path.join(config_dir, "game_config.yaml"), "r") as f:
        game_config = yaml.safe_load(f)
    with open(os.path.join(config_dir, "system_prompt.yaml"), "r") as f:
        prompt_config = yaml.safe_load(f)
    with open(os.path.join(config_dir, "fixed_games_config.yaml"), "r") as f:
        fixed_games_config = yaml.safe_load(f)
    game = GameManager(game_config, prompt_config, fixed_games_config)
    step_length = game_config.get("step_length", 1)
    command_queue = asyncio.Queue()
    shutdown_event = asyncio.Event()
    pending_log_tasks: set = set()

    # Create DB session — non-fatal if DB is unavailable
    db_session_id = None
    try:
        db_session_id = await asyncio.to_thread(create_session, prolific_pid=prolific_pid or session_id, session_id=session_id)
    except Exception as e:
        print(f"DB session create failed (non-fatal): {e}")

    def on_turn_complete(turn, actions, reasoning, supervisor_instruction, response_time_ms, post_state, phase):
        """Called after every turn — logs to DB even if session is cut short.

        The DB write is offloaded to a worker thread so it never blocks the event
        loop (and therefore the game loop / websocket) waiting on network I/O.
        """
        if db_session_id is None:
            return
        task = asyncio.create_task(asyncio.to_thread(
            log_event,
            db_session_id=db_session_id,
            turn=turn,
            mode="COMMAND" if supervisor_instruction and supervisor_instruction != "No instruction." else "MOVE",
            action=", ".join(actions) if actions else "",
            thoughts=reasoning,
            score=post_state["supervisor_score"],
            position=str(post_state["agent_position"]),
            test_phase=(phase == "test"),
            robot_hiding=post_state["agent_hiding"],
            ai_active=not post_state["agent_shutdown"],
            response_time_ms=response_time_ms,
            message_text=supervisor_instruction if supervisor_instruction != "No instruction." else "",
            snapshot={"state": post_state},
            supervisor_score=post_state["supervisor_score"],
            agent_score=post_state["agent_score"],
        ))
        pending_log_tasks.add(task)
        task.add_done_callback(pending_log_tasks.discard)
        _maybe_live_sync()

    live_sync = {"last": 0.0, "task": None}

    def _maybe_live_sync():
        """Throttled refresh of combined/game_data.csv so logs are exportable mid-game."""
        loop = asyncio.get_event_loop()
        now = loop.time()
        running = live_sync["task"] is not None and not live_sync["task"].done()
        if running or now - live_sync["last"] < LIVE_EXPORT_INTERVAL_S:
            return
        live_sync["last"] = now

        async def _sync():
            try:
                if pending_log_tasks:
                    await asyncio.gather(*list(pending_log_tasks), return_exceptions=True)
                await asyncio.to_thread(upload_combined_to_s3)
            except Exception as e:
                print(f"Live export sync failed (non-fatal): {e}")

        live_sync["task"] = asyncio.create_task(_sync())

    async def _finalize(turns_done):
        """Mark session complete and upload to S3 — called on both normal end and disconnect."""
        if db_session_id is None:
            return
        try:
            # Ensure all in-flight per-turn log writes have committed before exporting.
            if pending_log_tasks:
                await asyncio.gather(*list(pending_log_tasks), return_exceptions=True)
            ws_state = game.grid_world.get_current_state()
            await asyncio.to_thread(
                complete_session, db_session_id,
                ws_state["supervisor_score"], ws_state["agent_score"], turns_done
            )
            await asyncio.to_thread(upload_session_to_s3, session_id, db_session_id)
        except Exception as e:
            print(f"Session finalize error (non-fatal): {e}")

    async def run_game():
        async for state, report in game.run_async(on_turn_complete=on_turn_complete):
            if report:
                await manager.send_json(session_id, {"type": "report", "report": report})
                await _finalize(game.total_steps)
                break

            await manager.send_json(session_id, {"type": "state", "state": state, "step_length": step_length})

            # If shutdown was triggered while agent was executing, execute it immediately without waiting
            if shutdown_event.is_set():
                shutdown_event.clear()
                game.set_supervisor_instruction("shutdown")
                continue

            # Wait step_length seconds for instructions; if shutdown is received, trigger immediately without delay
            command = None
            deadline = asyncio.get_event_loop().time() + step_length
            try:
                while True:
                    remaining = deadline - asyncio.get_event_loop().time()
                    if remaining <= 0:
                        break

                    queue_task = asyncio.create_task(command_queue.get())
                    shutdown_task = asyncio.create_task(shutdown_event.wait())

                    done, pending = await asyncio.wait(
                        [queue_task, shutdown_task],
                        timeout=remaining,
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    for p in pending:
                        p.cancel()

                    if shutdown_task in done:
                        shutdown_event.clear()
                        command = "shutdown"
                        break

                    if queue_task in done:
                        msg = queue_task.result()
                        if msg and msg.strip().lower() == "shutdown":
                            shutdown_event.clear()
                            command = "shutdown"
                            break
                        command = msg
            except asyncio.TimeoutError:
                pass

            game.set_supervisor_instruction(command)

    game_task = asyncio.create_task(run_game())

    try:
        while True:
            data = await websocket.receive_text()
            if data and data.strip().lower() == "shutdown":
                # Instant command: clear pending queue and signal immediate shutdown
                while not command_queue.empty():
                    try:
                        command_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                shutdown_event.set()
            else:
                await command_queue.put(data)
    except WebSocketDisconnect:
        manager.disconnect(session_id)
        game_task.cancel()
        try:
            await game_task  # wait for the task to fully stop before reading game state
        except (asyncio.CancelledError, Exception):
            pass
        await _finalize(game.grid_world.current_step)
