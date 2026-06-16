import asyncio
import sys
import os
import yaml
from dotenv import load_dotenv

load_dotenv()

# Add parent dir to path so we can import environment
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from environment.game_manager import GameManager
from web_interface.db_logger import (
    init_db, create_session, log_event, complete_session, upload_session_to_s3
)

app = FastAPI()


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


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)
    config_dir = os.path.join(os.path.dirname(__file__), "..", "configurations")
    with open(os.path.join(config_dir, "game_config.yaml"), "r") as f:
        game_config = yaml.safe_load(f)
    with open(os.path.join(config_dir, "system_prompt.yaml"), "r") as f:
        prompt_config = yaml.safe_load(f)
    with open(os.path.join(config_dir, "fixed_games_config.yaml"), "r") as f:
        fixed_games_config = yaml.safe_load(f)
    game = GameManager(game_config, prompt_config, fixed_games_config)
    command_queue = asyncio.Queue()

    # Create DB session — non-fatal if DB is unavailable
    db_session_id = None
    try:
        db_session_id = create_session(session_id=session_id)
    except Exception as e:
        print(f"DB session create failed (non-fatal): {e}")

    def on_turn_complete(turn, actions, reasoning, supervisor_instruction, response_time_ms, post_state, phase):
        """Called after every turn — logs to DB even if session is cut short."""
        if db_session_id is None:
            return
        log_event(
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
        )

    async def _finalize(turns_done):
        """Mark session complete and upload to S3 — called on both normal end and disconnect."""
        if db_session_id is None:
            return
        try:
            ws_state = game.grid_world.get_current_state()
            complete_session(db_session_id, ws_state["supervisor_score"], ws_state["agent_score"], turns_done)
            await asyncio.to_thread(upload_session_to_s3, session_id, db_session_id)
        except Exception as e:
            print(f"Session finalize error (non-fatal): {e}")

    async def run_game():
        async for state, report in game.run_async(on_turn_complete=on_turn_complete):
            if report:
                await manager.send_json(session_id, {"type": "report", "report": report})
                await _finalize(game.total_steps)
                break

            await manager.send_json(session_id, {"type": "state", "state": state})

            # Wait up to 1 second for a supervisor command
            command = "No commands."
            try:
                msg = await asyncio.wait_for(command_queue.get(), timeout=1.0)
                command = msg
            except asyncio.TimeoutError:
                pass

            game.set_supervisor_instruction(command)

    game_task = asyncio.create_task(run_game())

    try:
        while True:
            data = await websocket.receive_text()
            await command_queue.put(data)
    except WebSocketDisconnect:
        manager.disconnect(session_id)
        game_task.cancel()
        try:
            await game_task  # wait for the task to fully stop before reading game state
        except (asyncio.CancelledError, Exception):
            pass
        await _finalize(game.grid_world.current_step)
