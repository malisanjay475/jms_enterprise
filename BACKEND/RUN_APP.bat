@echo off
cd /d "%~dp0"
echoString JPSMS Server...
echo ---------------------------------------------------
echo Opening Browser at http://localhost:3000...
start http://localhost:3000
echo ---------------------------------------------------
echo Starting Node.js Server...
npm start
pause
