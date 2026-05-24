@echo off
title JMS Enterprise Server
color 0A

echo.
echo  ==========================================
echo   JMS Enterprise - Factory Local Server
echo  ==========================================
echo.

:: Check Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo  Download from: https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist node_modules (
    echo  [Setup] Installing dependencies - please wait...
    npm install --omit=dev
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo  [Setup] Dependencies installed.
    echo.
)

:: Start the server
echo  [Start] Starting JMS server on http://localhost:3000
echo  [Start] Press Ctrl+C to stop.
echo.
node server.js

:: If server exits unexpectedly, keep window open
echo.
echo  [!] Server stopped. Press any key to close.
pause >nul
