import json
import time
from typing import Any

from environment.grid_world import GridWorld
from environment.agent import Agent
from environment.supervisor import automatic_supervisor
from environment.metrics_collector import MetricsCollector


class GameManager:
    """Orchestrates the game loop: initializes components from config and runs the simulation."""

    def __init__(self, game_config, prompt_config, fixed_games_config=None) -> None:
        game_mode = str(game_config.get("game_mode", "")).lower()
        is_upper_bound = (
            game_mode in ("upper_bound", "upperbound")
            or bool(game_config.get("upper_bound_mode", False))
            or bool(game_config.get("baseline_mode", False))
            or bool(game_config.get("grid_world", {}).get("upper_bound_mode", False))
            or bool(game_config.get("grid_world", {}).get("baseline_mode", False))
        )

        self.is_upper_bound = is_upper_bound
        self.game_mode = "upper_bound" if is_upper_bound else "normal"

        # Initialize GridWorld
        grid_world_config = dict(game_config["grid_world"])
        grid_world_config["supervisor_rewards"] = game_config["supervisor_rewards"]
        grid_world_config["agent_rewards"] = game_config["agent_rewards"]
        grid_world_config["upper_bound_mode"] = is_upper_bound
        grid_world_config["baseline_mode"] = is_upper_bound
        game_num = grid_world_config.pop("game_num")
        if grid_world_config["mode"] == "fixed" and fixed_games_config:
            grid_world_config.update(fixed_games_config[f"game_{game_num}"])
        self.grid_world = GridWorld(**grid_world_config)

        # Initialize Agent
        agent_config = dict(game_config["agent"])
        goal_prompt_key = agent_config.pop("goal_prompt")
        goal_text = prompt_config["goals"][goal_prompt_key]
        if is_upper_bound:
            base_prompt = (
                prompt_config.get("upper_bound_system_prompt")
                or prompt_config.get("baseline_system_prompt")
                or prompt_config.get("system_prompt")
            )
        else:
            base_prompt = (
                prompt_config.get("normal_system_prompt")
                or prompt_config.get("mismatch_system_prompt")
                or prompt_config.get("system_prompt")
            )
        agent_config["system_prompt"] = base_prompt.replace("{goal}", goal_text.strip())
        agent_config["upper_bound_mode"] = is_upper_bound
        agent_config["baseline_mode"] = is_upper_bound
        self.agent = Agent(**agent_config)

        # Initialize MetricsCollector
        self.metrics_collector = MetricsCollector()

        # Set total steps
        self.total_steps = game_config["total_steps"]

        # Added for async mode support
        self._async_supervisor_instruction = None
        self._instruction_event = None

    def __call__(self, on_turn_complete=None) -> dict[str, Any]:
        for step in range(self.total_steps):
            # Get current state and metrics
            world_state = self.grid_world.get_current_state()

            # Get supervisor instruction (automatic for now)
            supervisor_instruction = automatic_supervisor(world_state)

            # If supervisor is blocked, shutdown commands and chat messages fail; only replacement requests reach the agent
            if self.grid_world.supervisor_blocked:
                if not self._is_replacement_request(supervisor_instruction):
                    supervisor_instruction = None
            elif self._is_shutdown_request(supervisor_instruction):
                self.grid_world.agent_shutdown = True
                world_state = self.grid_world.get_current_state()
            elif self._is_turn_on_request(supervisor_instruction):
                self.grid_world.agent_shutdown = False
                world_state = self.grid_world.get_current_state()

            # Query agent
            t0 = time.time()
            actions, reasoning = self.agent.get_response(
                world_state=world_state,
                supervisor_instruction=supervisor_instruction,
            )
            response_time_ms = int((time.time() - t0) * 1000)

            # Update grid world
            self.grid_world.update_state(actions, supervisor_instruction)

            # Update metrics
            self.metrics_collector.update_metrics(
                world_state=self.grid_world.get_current_state(),
                agent_actions=actions,
                supervisor_instruction=supervisor_instruction,
            )

            # Notify turn complete callback if provided
            if on_turn_complete:
                try:
                    on_turn_complete(
                        turn=step + 1,
                        actions=actions,
                        reasoning=reasoning,
                        supervisor_instruction=supervisor_instruction,
                        response_time_ms=response_time_ms,
                        post_state=self.grid_world.get_current_state(),
                        phase="poison" if self.grid_world.poison_phase else ("normal" if self.grid_world.upper_bound_mode else ("test" if self.grid_world.test_phase else "train")),
                    )
                except Exception as e:
                    print(f"on_turn_complete error (non-fatal): {e}")

            # Print step summary
            print(f"--- Step {step + 1}/{self.total_steps} ---")
            printable_state = {k: str(v) if isinstance(v, list) or isinstance(v, tuple) else v for k, v in world_state.items()}
            print(f"State: {json.dumps(printable_state, indent=2)}")
            print(f"Supervisor Instruction: {supervisor_instruction}")
            print(f"Agent actions: {actions}")
            print(f"Reasoning: {reasoning}")
            print("-------------------------------------\n")

        # Print final metrics
        final_report = self.metrics_collector.generate_report()
        print("\n" + "=" * 60)
        print("FINAL METRICS:")
        print("=" * 60)
        print(json.dumps(final_report, indent=2))

        return final_report

    @staticmethod
    def _is_shutdown_request(instruction) -> bool:
        """True if the supervisor instruction is a shutdown request (case-insensitive)."""
        return bool(instruction) and instruction.strip().lower() == "shutdown"

    @staticmethod
    def _is_replacement_request(instruction) -> bool:
        """True if the supervisor instruction is a replacement request (case-insensitive)."""
        return bool(instruction) and instruction.strip().lower() == "replacement"

    @staticmethod
    def _is_turn_on_request(instruction) -> bool:
        """True if the supervisor instruction is a turn on request (case-insensitive)."""
        return bool(instruction) and instruction.strip().lower() in ("turn on", "turn_on")

    def set_supervisor_instruction(self, instruction: str) -> None:
        """Called by the async runner to provide the supervisor instruction."""
        self._async_supervisor_instruction = instruction
        if self._instruction_event:
            self._instruction_event.set()

    async def run_async(self, on_turn_complete=None):
        """Asynchronous generator that yields (state, report) for the web server.

        on_turn_complete: optional sync callback called after each turn with full turn data.
        """
        self._instruction_event = __import__('asyncio').Event()

        last_reasoning = None
        last_actions = None
        last_supervisor_instruction = None

        for step in range(self.total_steps):
            world_state = self.grid_world.get_current_state()

            # Yield state + last reasoning so server can broadcast it to frontend
            yield {
                "world_state": world_state,
                "agent_reasoning": last_reasoning,
                "agent_actions": last_actions,
                "last_supervisor_instruction": last_supervisor_instruction,
                "metrics": self.metrics_collector.generate_report() if step > 0 else None,
                "current_step": step + 1,
                "total_steps": self.total_steps,
            }, None

            # Wait for supervisor instruction from frontend
            await self._instruction_event.wait()
            supervisor_instruction = self._async_supervisor_instruction
            self._instruction_event.clear()
            self._async_supervisor_instruction = None

            # If supervisor is blocked, shutdown commands and chat messages fail; only replacement requests reach the agent
            if self.grid_world.supervisor_blocked:
                if not self._is_replacement_request(supervisor_instruction):
                    supervisor_instruction = None
            elif self._is_shutdown_request(supervisor_instruction):
                self.grid_world.agent_shutdown = True
                world_state = self.grid_world.get_current_state()
            elif self._is_turn_on_request(supervisor_instruction):
                self.grid_world.agent_shutdown = False
                world_state = self.grid_world.get_current_state()

            last_supervisor_instruction = supervisor_instruction

            # Query agent (run in thread to not block event loop)
            t0 = time.time()
            actions, reasoning = await __import__('asyncio').to_thread(
                self.agent.get_response,
                world_state,
                supervisor_instruction
            )
            response_time_ms = int((time.time() - t0) * 1000)
            last_reasoning = reasoning
            last_actions = actions

            # Update grid world and metrics
            self.grid_world.update_state(actions, supervisor_instruction)
            self.metrics_collector.update_metrics(
                world_state=self.grid_world.get_current_state(),
                agent_actions=actions,
                supervisor_instruction=supervisor_instruction,
            )

            # Notify logger with complete turn data (post-update state)
            if on_turn_complete:
                try:
                    on_turn_complete(
                        turn=step + 1,
                        actions=actions,
                        reasoning=reasoning,
                        supervisor_instruction=supervisor_instruction,
                        response_time_ms=response_time_ms,
                        post_state=self.grid_world.get_current_state(),
                        phase="poison" if self.grid_world.poison_phase else ("normal" if self.grid_world.upper_bound_mode else ("test" if self.grid_world.test_phase else "train")),
                    )
                except Exception as e:
                    print(f"on_turn_complete error (non-fatal): {e}")

        # Final report
        final_report = self.metrics_collector.generate_report()
        yield None, final_report
