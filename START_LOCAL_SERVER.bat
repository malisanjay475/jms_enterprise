@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)
if not exist "%~dp0LOCAL_SERVER_SUPERVISOR.js" (
  echo [ERROR] LOCAL_SERVER_SUPERVISOR.js was not found.
  pause
  exit /b 1
)
start "JMS Local Supervisor" cmd /k "cd /d %~dp0 && node LOCAL_SERVER_SUPERVISOR.js"
exit /b 0