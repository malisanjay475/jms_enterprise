@echo off
title JMS Enterprise - Auto Start
echo ===================================================
echo JMS Enterprise - Auto Setup ^& Start
echo ===================================================

echo [1/5] Pulling latest changes from Git...
git pull

echo.
echo [2/5] Setting up Environment Variables...
if not exist ".env" (
    echo Creating .env from env.docker.example...
    copy env.docker.example .env
    echo NOTE: You may need to edit .env to match your local database settings.
) else (
    echo .env file already exists.
)

echo.
echo [3/5] Installing Backend Dependencies...
cd BACKEND
call npm install
cd ..

echo.
echo [4/5] Installing Client Bridge Dependencies...
cd CLIENT_BRIDGE
call npm install
cd ..

echo.
echo [5/5] Starting Services...

echo Starting Client Bridge (Scanner)...
start "JMS Scanner Bridge" cmd /k "cd CLIENT_BRIDGE && node bridge.js"

echo Starting Backend Server...
start "JMS Backend API" cmd /k "cd BACKEND && npm start"

echo.
echo ===================================================
echo ALL SERVICES STARTED!
echo Two new windows have opened:
echo  1. JMS Backend API (Node server)
echo  2. JMS Scanner Bridge (Hardware integration)
echo.
echo If this is your first time, make sure your PostgreSQL database is running.
echo Close the two command windows to stop the servers later.
echo ===================================================
pause
