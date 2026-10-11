@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo Running Complete Data Deletion (Local + AWS + DB)...
echo ========================================================
echo.

call delete_local.bat
echo.
call delete_aws.bat
echo.
call delete_db.bat

echo.
echo ========================================================
echo All deletion tasks completed!
echo ========================================================
pause

