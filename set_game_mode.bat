@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Activate virtual environment if available
if exist "%~dp0.venv\Scripts\activate.bat" (
    call "%~dp0.venv\Scripts\activate.bat"
)

echo ========================================================
echo          Set Project Game Mode (Normal / Upper Bound)
echo ========================================================
echo.

set TARGET_MODE=%1

if "%TARGET_MODE%"=="" (
    python set_game_mode.py
) else (
    python set_game_mode.py %TARGET_MODE%
)

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to switch game mode.
    echo.
    pause
    exit /b 1
)

echo.
pause

