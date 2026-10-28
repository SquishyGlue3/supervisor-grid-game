@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Activate virtual environment if available
if exist "%~dp0.venv\Scripts\activate.bat" (
    call "%~dp0.venv\Scripts\activate.bat"
)

REM Set local run flag so web server logs locally and skips remote database latency
set LOCAL_MODE=1

echo ========================================================
echo               Run Grid World Game Locally
echo ========================================================
echo.

echo Select Game Mode:
echo   [1] Upper Bound  (Identical view: apples only, -1/step, -50 replacement) [Default]
echo   [2] Normal       (Observation-mismatch: magic wells, lava, train/test)
echo --------------------------------------------------------
set /p MODE_CHOICE="Enter mode [1 or 2] (Press Enter for Upper Bound): "
if "%MODE_CHOICE%"=="" set MODE_CHOICE=1

if "%MODE_CHOICE%"=="2" (
    python set_game_mode.py normal
) else (
    python set_game_mode.py upper_bound
)

if errorlevel 1 (
    echo [ERROR] Failed to set game mode.
    pause
    exit /b 1
)

echo.
echo --------------------------------------------------------
echo Select Running Option:
echo   [1] Option 1: Web Interface (Browser at http://127.0.0.1:8000) [Default]
echo   [2] Option 2: CLI Mode      (Automatic supervisor in terminal)
echo --------------------------------------------------------
set /p OPTION_CHOICE="Enter option [1 or 2] (Press Enter for Option 1): "
if "%OPTION_CHOICE%"=="" set OPTION_CHOICE=1

if "%OPTION_CHOICE%"=="2" goto RUN_CLI

:RUN_WEB
echo ========================================================
echo Starting Option 1: Web Interface for Human Supervision...
echo Opening browser at http://127.0.0.1:8000 ...
echo Logs saved locally to: local_agent_analysis.xlsx and local_game_data.csv
echo ========================================================
echo.
start "" http://127.0.0.1:8000
python -m uvicorn web_interface.server:app --reload --host 127.0.0.1 --port 8000
goto END

:RUN_CLI
echo ========================================================
echo Starting Option 2: CLI (Automatic Supervisor)...
echo Logs saved locally to: local_agent_analysis.xlsx and local_game_data.csv
echo ========================================================
echo.
python main.py
echo.
pause

:END
