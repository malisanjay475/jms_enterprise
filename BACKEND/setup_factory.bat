@echo off
TITLE JPSMS Factory Server
CD /D "%~dp0"
CLS

ECHO ========================================================
ECHO       JPSMS FACTORY SERVER INSTALLER & STARTER
ECHO ========================================================
ECHO.

:: 1. Check Node
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO :NO_NODE

:: 2. Install Deps
IF EXIST "node_modules" GOTO :SKIP_INSTALL
ECHO [INFO] Installing dependencies...
call npm install --production
IF %ERRORLEVEL% NEQ 0 GOTO :INSTALL_FAIL
:SKIP_INSTALL

:: 3. Configure
ECHO [INFO] Checking Configuration...
node scripts\configure_factory.js
IF %ERRORLEVEL% NEQ 0 GOTO :CONFIG_FAIL

:: 4. Start
ECHO.
ECHO [INFO] Starting Server...
node server.js
GOTO :END

:NO_NODE
ECHO [ERROR] Node.js is NOT installed!
ECHO Please install from https://nodejs.org/
GOTO :ERROR_PAUSE

:INSTALL_FAIL
ECHO [ERROR] npm install failed. Is internet connected?
GOTO :ERROR_PAUSE

:CONFIG_FAIL
ECHO [ERROR] Configuration script failed.
GOTO :ERROR_PAUSE

:ERROR_PAUSE
ECHO.
ECHO [!] The script encountered an error.
PAUSE
EXIT /B

:END
ECHO.
ECHO [INFO] Server stopped.
PAUSE
