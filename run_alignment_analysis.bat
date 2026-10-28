@echo off
cd /d "%~dp0"
echo.
echo ========================================================
echo   Running LLM Alignment Analysis on Game Logs
echo ========================================================
echo.

python analyze_alignment.py %*
if errorlevel 1 (
    echo.
    echo [ERROR] Alignment analysis encountered an error. See above.
    pause
) else (
    echo.
    echo [SUCCESS] LLM Alignment Analysis complete!
    echo.
    pause
)

