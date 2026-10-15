@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================================
echo       Set Project Game Steps (Total Steps)
echo ========================================================
echo.

set NEW_STEPS=%1

if "%NEW_STEPS%"=="" (
    python -c "import yaml; cfg=yaml.safe_load(open('configurations/game_config.yaml')); print('Current total_steps:', cfg.get('total_steps', 'unknown'))" 2>nul
    echo.
    set /p NEW_STEPS="Enter new number of game steps (e.g. 250): "
)

if "%NEW_STEPS%"=="" (
    echo.
    echo [ERROR] No step number provided. Operation cancelled.
    echo.
    pause
    exit /b 1
)

python set_game_steps.py %NEW_STEPS%
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to update game steps.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo   Done! Game steps successfully updated across project.
echo ========================================================
echo.
pause

