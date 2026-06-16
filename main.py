import yaml
from environment.game_manager import GameManager


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

    # Run the game loop and get the final report
    report = game_manager()
