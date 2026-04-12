@echo off
echo ==========================================
echo      JPSMS SCHEMA RESTORE TOOL
echo ==========================================
echo.
echo This script will CREATE all tables without data.
echo WARNING: This might overwrite existing tables!
echo.

set PGUSER=postgres
set PGPASSWORD=Sanjay@541##
set PGHOST=localhost
set PGDATABASE=jpsms
set INPUT_FILE=jpsms_schema_only.sql

:: Find Postgres
set PG_BIN=
if exist "C:\Program Files\PostgreSQL\18\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\18\bin\
if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\17\bin\
if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\16\bin\

if "%PG_BIN%"=="" (
    set PG_PSQL=psql
) else (
    set PG_PSQL="%PG_BIN%psql.exe"
)

echo Restoring schema from %INPUT_FILE%...
%PG_PSQL% -U %PGUSER% -h %PGHOST% -d %PGDATABASE% -f %INPUT_FILE%

if %errorlevel% neq 0 (
    echo [ERROR] Restore Failed!
    pause
    exit /b
)

echo [SUCCESS] Tables created successfully!
pause
