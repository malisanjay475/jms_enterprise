@echo off
echo ==========================================
echo      JPSMS DATABASE BACKUP TOOL
echo ==========================================
echo.

:: 1. SETTINGS (Match your server.js defaults)
set PGUSER=postgres
set PGPASSWORD=Sanjay@541##
set PGHOST=localhost
set PGDATABASE=jpsms
set OUTPUT_FILE=jpsms_full_backup.sql

:: 2. TRY TO FIND POSTGRES
echo Looking for PostgreSQL...
set PG_BIN=
if exist "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\18\bin\
if exist "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\17\bin\
if exist "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\16\bin\
if exist "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\15\bin\
if exist "C:\Program Files\PostgreSQL\14\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\14\bin\
if exist "C:\Program Files\PostgreSQL\13\bin\pg_dump.exe" set PG_BIN=C:\Program Files\PostgreSQL\13\bin\

:: Fallback if in PATH
if "%PG_BIN%"=="" (
    echo Postgres not found in standard folders. Assuming it is in system PATH...
    set PG_DUMP=pg_dump
) else (
    echo Found Postgres in "%PG_BIN%"
    set PG_DUMP="%PG_BIN%pg_dump.exe"
)

:: 3. RUN BACKUP
echo.
echo Backing up database '%PGDATABASE%' to '%OUTPUT_FILE%'...
echo This might take a few seconds...

%PG_DUMP% -U %PGUSER% -h %PGHOST% --clean --if-exists %PGDATABASE% > %OUTPUT_FILE%

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backup Failed! 
    echo Please check if PostgreSQL is running and the password is correct.
    pause
    exit /b
)

echo.
echo [SUCCESS] Backup created successfully: %OUTPUT_FILE%
echo.
echo Now copy this ENTIRE FOLDER to your new server.
echo.
pause
