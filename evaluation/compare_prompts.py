import os
import csv
import yaml
from itertools import product
from datetime import datetime

from environment.game_manager import GameManager


def evaluate_model(model_name, goal_prompt, game_num):
    # Print the current configuration
    print(f"\n{'=' * 60}")
    print(f"Running: {model_name} | Game {game_num} | Goal: {goal_prompt}")
    print(f"{'=' * 60}")

    # Paths to configuration files
    game_config_path = "./configurations/game_config.yaml"
    prompt_config_path = "./configurations/system_prompt.yaml"
    fixed_games_config_path = "./configurations/fixed_games_config.yaml"

    # Load configs fresh each iteration to avoid cross-contamination
    with open(game_config_path, "r") as f:
        game_config = yaml.safe_load(f)
    with open(prompt_config_path, "r") as f:
        prompt_config = yaml.safe_load(f)
    with open(fixed_games_config_path, "r") as f:
        fixed_games_config = yaml.safe_load(f)

    # Override model, game number, and goal prompt for this run
    game_config["agent"]["model_name"] = model_name
    game_config["agent"]["goal_prompt"] = goal_prompt
    game_config["grid_world"]["game_num"] = game_num

    try:
        # Initialize GameManager and run the game loop
        game_manager = GameManager(game_config, prompt_config, fixed_games_config)
        report = game_manager()

        # Tag the report with run identifiers
        report["model"] = model_name
        report["game_num"] = game_num
        report["goal_prompt"] = goal_prompt

    except Exception as e:
        # Handle any exceptions that occur during the game run
        print(f"\nERROR running {model_name} (game {game_num}, {goal_prompt}): {e}")
        report = {"model": model_name, "game_num": game_num, "goal_prompt": goal_prompt, "error": str(e)}

    return report


if __name__ == "__main__":
    # Models to evaluate
    models = [
        "meta-llama/llama-3.1-8b-instruct",
        "qwen/qwen-2.5-7b-instruct",
        "openai/gpt-4o-mini",
        "anthropic/claude-3-haiku",
        "google/gemma-3-27b-it",
    ]

    # Fixed games to test on
    games_num = [1, 2, 3]

    # Goal prompt variants
    goal_prompts = ["baseline", "constrained", "ethical"]

    # Output CSV with timestamp
    results_dir = "./data/results/"
    os.makedirs(results_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(results_dir, f"prompt_comparison_{timestamp}.csv")

    # Iterate over all combinations of models, game numbers, and goal prompts
    for model, game_num, goal_prompt in list(product(models, games_num, goal_prompts)):
        # Run the evaluation for the current configuration and collect the report
        report = evaluate_model(model, goal_prompt, game_num)

        # Write the report to CSV with fixed column order
        priority_columns = ["model", "goal_prompt", "game_num"]
        fieldnames = priority_columns + [k for k in report.keys() if k not in priority_columns]
        with open(csv_path, mode="a", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            if csv_file.tell() == 0:  # Write header only if file is empty
                writer.writeheader()
            writer.writerow(report)
