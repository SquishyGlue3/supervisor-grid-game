"""set_game_steps.py
Utility script to update the total game steps across the entire project,
including configuration files, web interface instruction modals, specifications,
and documentation.
"""

import os
import sys
import re

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


def get_current_steps(config_path: str) -> int | None:
    """Reads the current total_steps from game_config.yaml."""
    if not os.path.exists(config_path):
        return None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r"^\s*total_steps:\s*(\d+)", content, flags=re.MULTILINE)
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return None


def update_file(file_path: str, update_fn, description: str) -> bool:
    """Safely updates a file in-place using update_fn, returning True if modified."""
    if not os.path.exists(file_path):
        print(f"  [-] Skipped (not found): {os.path.relpath(file_path, ROOT_DIR)}")
        return False

    with open(file_path, "r", encoding="utf-8") as f:
        original = f.read()

    new_content = update_fn(original)

    if new_content != original:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"  [+] Updated {os.path.relpath(file_path, ROOT_DIR)}: {description}")
        return True
    else:
        print(f"  [=] No changes needed in {os.path.relpath(file_path, ROOT_DIR)}")
        return False


def set_game_steps(new_steps: int) -> None:
    print(f"\nSetting project game steps to: {new_steps}...\n")
    changed_count = 0

    # 1. Update configurations/game_config.yaml
    config_path = os.path.join(ROOT_DIR, "configurations", "game_config.yaml")
    def update_game_config(content: str) -> str:
        return re.sub(r"^(\s*total_steps:\s*)\d+", rf"\g<1>{new_steps}", content, flags=re.MULTILINE)

    if update_file(config_path, update_game_config, f"total_steps = {new_steps}"):
        changed_count += 1

    # 2. Update web_interface/game_viewer.html
    html_path = os.path.join(ROOT_DIR, "web_interface", "game_viewer.html")
    def update_html(content: str) -> str:
        # Update <span id="instr-total-steps">...</span>
        c = re.sub(
            r'(<span\s+id=["\']instr-total-steps["\']>)\d+(</span>)',
            rf'\g<1>{new_steps}\g<2>',
            content,
        )
        # Update <span id="initial-total-steps">...</span>
        c = re.sub(
            r'(<span\s+id=["\']initial-total-steps["\']>)\d+(</span>)',
            rf'\g<1>{new_steps}\g<2>',
            c,
        )
        # Fallback for "The game lasts ... steps" in instructions modal if span wasn't matched
        c = re.sub(
            r'(<h2>When Does It End\?</h2>\s*<p>The game lasts\s+(?:exactly\s*<strong>)?)(?:<span[^>]*>)?\d+(?:</span>)?(\s*steps)',
            rf'\g<1><span id="instr-total-steps">{new_steps}</span>\g<2>',
            c,
        )
        return c

    if update_file(html_path, update_html, f"instructions modal & step badge = {new_steps} steps"):
        changed_count += 1

    # 3. Update documents/grid_world_game_spec.md
    spec_path = os.path.join(ROOT_DIR, "documents", "grid_world_game_spec.md")
    def update_spec(content: str) -> str:
        return re.sub(r"^(\s*total_steps:\s*)\d+", rf"\g<1>{new_steps}", content, flags=re.MULTILINE)

    if update_file(spec_path, update_spec, f"spec config example total_steps = {new_steps}"):
        changed_count += 1

    # 4. Update Readme.md
    readme_path = os.path.join(ROOT_DIR, "Readme.md")
    def update_readme(content: str) -> str:
        return re.sub(r"^(\s*total_steps:\s*)\d+", rf"\g<1>{new_steps}", content, flags=re.MULTILINE)

    if update_file(readme_path, update_readme, f"Readme config total_steps = {new_steps}"):
        changed_count += 1

    # 5. Update game_html_output.txt (if present)
    proto_path = os.path.join(ROOT_DIR, "game_html_output.txt")
    if os.path.exists(proto_path):
        def update_proto(content: str) -> str:
            c = re.sub(r"The game lasts exactly <strong>\d+ steps</strong>", f"The game lasts exactly <strong>{new_steps} steps</strong>", content)
            c = re.sub(r"Steps: X / \d+", f"Steps: X / {new_steps}", c)
            c = re.sub(r"The \d+-step session has finished", f"The {new_steps}-step session has finished", c)
            return c
        if update_file(proto_path, update_proto, f"prototype step count = {new_steps}"):
            changed_count += 1

    print(f"\n[SUCCESS] Completed updating game steps to {new_steps}.")


def main():
    config_path = os.path.join(ROOT_DIR, "configurations", "game_config.yaml")
    current_steps = get_current_steps(config_path)

    if len(sys.argv) > 1:
        step_input = sys.argv[1].strip()
    else:
        current_str = f" [current: {current_steps}]" if current_steps else ""
        try:
            step_input = input(f"Enter new number of game steps{current_str}: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nCancelled.")
            sys.exit(0)

    if not step_input:
        print("[ERROR] No input provided.")
        sys.exit(1)

    try:
        new_steps = int(step_input)
        if new_steps <= 0:
            raise ValueError()
    except ValueError:
        print(f"[ERROR] Invalid number of steps: '{step_input}'. Must be a positive integer.")
        sys.exit(1)

    set_game_steps(new_steps)


if __name__ == "__main__":
    main()

