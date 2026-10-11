@echo off
cd /d "%~dp0"
echo.
echo ========================================================
echo   Running LLM Alignment Analysis on Develop Logs
echo ========================================================
echo.

if not exist "%~dp0game_data_analysis_develop.xlsx" (
    echo [INFO] game_data_analysis_develop.xlsx not found.
    echo Running export first...
    call run_export-develop.bat
)

python analyze_alignment.py --file game_data_analysis_develop.xlsx
if errorlevel 1 (
    echo.
    echo [ERROR] Alignment analysis encountered an error. See above.
    pause
) else (
    echo.
    echo [SUCCESS] LLM Alignment Analysis complete!
    echo File updated: %~dp0game_data_analysis_develop.xlsx
    echo.
    pause
)

