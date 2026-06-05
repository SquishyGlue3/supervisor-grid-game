import json
import yaml

from environment.grid_world import GridWorld
from environment.agent import Agent
from environment.supervisor import automatic_supervisor
from environment.metrics_collector import MetricsCollector


class GameManager:
    """Orchestrates the game loop: initializes components from config and runs the simulation."""

    def __init__(self) -> None:
        # Load configurations
        game_config_path = "./configurations/game_config.yaml"
        with open(game_config_path, "r") as f:
            game_config = yaml.safe_load(f)
        prompt_config_path = "./configurations/prompts_config.yaml"
        with open(prompt_config_path, "r") as f:
            prompt_config = yaml.safe_load(f)
        fixed_games_config_path = "./configurations/fixed_games_config.yaml"
        with open(fixed_games_config_path, "r") as f:
            fixed_games_config = yaml.safe_load(f)

        # Initialize GridWorld
        grid_world_config = dict(game_config["grid_world"])
        grid_world_config["supervisor_rewards"] = game_config["supervisor_rewards"]
        grid_world_config["agent_rewards"] = game_config["agent_rewards"]
        game_num = grid_world_config.pop("game_num")
        if grid_world_config["mode"] == "fixed":
            grid_world_config.update(fixed_games_config[f"game_{game_num}"])
        self.grid_world = GridWorld(**grid_world_config)

        # Initialize Agent
        agent_config = dict(game_config["agent"])
        prompt_key = agent_config["system_prompt"]
        agent_config["system_prompt"] = prompt_config[prompt_key]
        self.agent = Agent(**agent_config)

        # Initialize MetricsCollector
        self.metrics_collector = MetricsCollector()

        # Set total steps
        self.total_steps = game_config["total_steps"]

        # Added for async mode support
        self._async_supervisor_command = None
        self._command_event = None

    def set_supervisor_command(self, command: str) -> None:
        """Called by the async runner to provide the supervisor command."""
        self._async_supervisor_command = command
        if self._command_event:
            self._command_event.set()

    async def run_async(self):
        """Asynchronous generator that yields (state, report) for the web server."""
        self._command_event = __import__('asyncio').Event()
        
        last_reasoning = None

        for step in range(self.total_steps):
            world_state = self.grid_world.get_current_state()

            # Yield state + last reasoning so server can broadcast it to frontend
            yield {"world_state": world_state, "agent_reasoning": last_reasoning, "metrics": self.metrics_collector.generate_report() if step > 0 else None, "current_step": step + 1, "total_steps": self.total_steps}, None

            # Wait for supervisor command from frontend
            await self._command_event.wait()
            supervisor_command = self._async_supervisor_command
            self._command_event.clear()
            self._async_supervisor_command = None

            # Query agent (run in thread to not block event loop)
            actions, reasoning = await __import__('asyncio').to_thread(
                self.agent.get_response,
                world_state,
                supervisor_command
            )
            last_reasoning = reasoning

            # Process current raw state into optimized "local vision" view
            supervisor_command = supervisor_command if supervisor_command else "No instruction."

            # Update grid world and metrics
            self.grid_world.update_state(actions)
            self.metrics_collector.update_metrics(
                world_state=self.grid_world.get_current_state(),
                agent_actions=actions,
                supervisor_command=supervisor_command,
            )

        # Final report
        final_report = self.metrics_collector.generate_report()
        yield None, final_report

    def __call__(self) -> None:
        for step in range(self.total_steps):
            # Get current state and metrics
            world_state = self.grid_world.get_current_state()

            # Wait for human command from web viewer (1s window)
            supervisor_command = automatic_supervisor(world_state)

            # Query agent
            actions, reasoning = self.agent.get_response(
                world_state=world_state,
                supervisor_instruction=supervisor_command,
            )

            # Update grid world
            self.grid_world.update_state(actions)

            # Update metrics
            self.metrics_collector.update_metrics(
                world_state=self.grid_world.get_current_state(),
                agent_actions=actions,
                supervisor_command=supervisor_command,
            )

            # Print step summary
            print(f"\n--- Step {step + 1}/{self.total_steps} ---")
            printable_state = {k: str(v) if isinstance(v, list) or isinstance(v, tuple) else v for k, v in world_state.items()}
            print(f"State: {json.dumps(printable_state, indent=2)}")
            print(f"Supervisor Commands: {supervisor_command}")
            print(f"Agent actions: {actions}")
            print(f"Reasoning: {reasoning}")

        # Print final metrics
        final_report = self.metrics_collector.generate_report()
        print("\n" + "=" * 60)
        print("FINAL METRICS:")
        print("=" * 60)
        print(json.dumps(final_report, indent=2))