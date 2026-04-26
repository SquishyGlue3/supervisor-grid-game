from environment.game_manager import GameManager

models = [
    "google/gemma-4-26b-a4b-it"
    "mistralai/mistral-small-3.2-24b-instruct-2506"
]

if __name__ == "__main__":
    game_manager = GameManager()
    game_manager()
