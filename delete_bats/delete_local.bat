@echo off
setlocal
cd /d "%~dp0\.."

echo ========================================================
echo Deleting local game logs and analysis files...
echo ========================================================

if exist "logs_live" (
    echo Removing contents of logs_live...
    rmdir /s /q "logs_live"
    mkdir "logs_live"
)

if exist "game_data_analysis.xlsx" (
    echo Removing game_data_analysis.xlsx...
    del /f /q "game_data_analysis.xlsx"
)

if exist "game_data.csv" (
    echo Removing game_data.csv...
    del /f /q "game_data.csv"
)

echo.
echo Local logs cleaned successfully!
pause

