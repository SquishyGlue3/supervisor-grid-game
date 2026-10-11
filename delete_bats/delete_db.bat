@echo off
setlocal
cd /d "%~dp0\.."

echo ========================================================
echo Clearing PostgreSQL Database (game_events and sessions) + S3
echo via the develop server admin endpoint...
echo ========================================================

if exist ".venv\Scripts\python.exe" (
    set "PYTHON_EXE=.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

if "%SERVER_URL%"=="" set "SERVER_URL=http://16.192.87.99:8000"

"%PYTHON_EXE%" -c "import os, sys, json, hashlib, urllib.request, urllib.error; from dotenv import load_dotenv; load_dotenv(); tok = os.environ.get('ADMIN_TOKEN') or hashlib.sha256(os.environ.get('DATABASE_URL','').encode()).hexdigest(); req = urllib.request.Request(os.environ['SERVER_URL'] + '/admin/clear-data', method='POST', headers={'X-Admin-Token': tok}); exec('try:\n r = urllib.request.urlopen(req, timeout=60); print(\"Server response:\", r.read().decode())\nexcept urllib.error.HTTPError as e:\n print(\"HTTP\", e.code, e.read().decode()); sys.exit(1)\nexcept Exception as e:\n print(\"Failed:\", e); sys.exit(1)')"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to clear database. Is the latest server.py deployed?
)

echo.
pause
