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
echo     Starting Game in NORMAL Mode (Local Run)
echo ========================================================
echo.

python set_game_mode.py normal
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to set game mode to normal.
    pause
    exit /b 1
)

echo.
set RUN_CHOICE=%1

if not "%RUN_CHOICE%"=="" goto PROCEED_RUN

echo --------------------------------------------------------
echo Select Running Option (Local Run):
echo   [1] Option 1: Web Interface (Human Supervisor in browser) [Default]
echo   [2] Option 2: CLI Mode      (Automatic Supervisor in terminal)
echo --------------------------------------------------------
set /p RUN_CHOICE="Enter option [1 or 2] (Press Enter for 1): "

:PROCEED_RUN
if "%RUN_CHOICE%"=="" set RUN_CHOICE=1
if "%RUN_CHOICE%"=="--web" set RUN_CHOICE=1
if "%RUN_CHOICE%"=="--cli" set RUN_CHOICE=2

if "%RUN_CHOICE%"=="2" goto RUN_CLI

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
