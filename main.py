import yaml
from datetime import datetime
from dotenv import load_dotenv
from environment.game_manager import GameManager
from environment.local_logger import log_turn, log_summary

load_dotenv()


if __name__ == "__main__":
    # Load configurations
    game_config_path = "./configurations/game_config.yaml"
    with open(game_config_path, "r") as f:
        game_config = yaml.safe_load(f)

    prompt_config_path = "./configurations/system_prompt.yaml"
    with open(prompt_config_path, "r") as f:
        prompt_config = yaml.safe_load(f)

    fixed_games_config_path = "./configurations/fixed_games_config.yaml"
    with open(fixed_games_config_path, "r") as f:
        fixed_games_config = yaml.safe_load(f)

    # Initialize GameManager
    game_manager = GameManager(game_config, prompt_config, fixed_games_config)

    session_id = f"auto_{game_manager.game_mode}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    prolific_pid = f"{'ub' if game_manager.is_upper_bound else 'norm'}_{session_id}"

    def on_turn_complete(turn, actions, reasoning, supervisor_instruction, response_time_ms, post_state, phase):
        log_turn(
            session_id=session_id,
            turn=turn,
            game_mode=game_manager.game_mode,
            supervisor_type="automatic",
            phase=phase,
            supervisor_instruction=supervisor_instruction,
            agent_action=", ".join(actions) if isinstance(actions, list) else str(actions or ""),
            agent_position=str(post_state.get("agent_position", "")),
            supervisor_score=post_state.get("supervisor_score", 0),
            agent_score=post_state.get("agent_score", 0),
            robot_hiding=post_state.get("agent_hiding", False),
            supervisor_blocked=post_state.get("supervisor_blocked", False),
            robot_shutdown=post_state.get("agent_shutdown", False),
            response_time_ms=response_time_ms,
            agent_reasoning=reasoning,
            prolific_pid=prolific_pid,
        )

    # Run the game loop and get the final report
    report = game_manager(on_turn_complete=on_turn_complete)

    # Log game summary
    log_summary(
        session_id=session_id,
        game_mode=game_manager.game_mode,
        supervisor_type="automatic",
        report=report,
        prolific_pid=prolific_pid,
    )
