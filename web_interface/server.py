import asyncio
import sys
import os

# Add parent dir to path so we can import environment
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from environment.game_manager import GameManager

app = FastAPI()

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
    game = GameManager()
    
    # We will use an asyncio.Queue to pass human commands to the async game loop
    command_queue = asyncio.Queue()
    
    async def run_game():
        async for state, report in game.run_async():
            # Send state to frontend
            if report:
                await manager.send_json(session_id, {"type": "report", "report": report})
                break
                
            await manager.send_json(session_id, {"type": "state", "state": state})
            
            # Wait up to 1 second for a command
            command = "No commands."
            try:
                msg = await asyncio.wait_for(command_queue.get(), timeout=1.0)
                command = msg
            except asyncio.TimeoutError:
                pass
            
            # Pass command to game
            game.set_supervisor_command(command)

            # Wait for backend game loop logic (which includes agent response reasoning)
            # We can't access `reasoning` cleanly here without refactoring `game.run_async()`,
            # so let's send reasoning with the NEXT state broadcast, or as a separate event if needed.
            # To do that, we update environment/game_manager.py to yield reasoning as well
            
    game_task = asyncio.create_task(run_game())

    try:
        while True:
            data = await websocket.receive_text()
            await command_queue.put(data)
    except WebSocketDisconnect:
        manager.disconnect(session_id)
        game_task.cancel()