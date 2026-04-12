@echo off
SET PG_DUMP="C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
SET DB_NAME=jpsms
SET DB_USER=postgres
SET OUT_FILE=jpsms_backup.sql

echo Backing up database %DB_NAME%...
%PG_DUMP% -U %DB_USER% %DB_NAME% > %OUT_FILE%

if %ERRORLEVEL% EQU 0 (
    echo Backup Successful: %OUT_FILE%
) else (
    echo Backup Failed! Ensure password is set in .pgpass or enter it when prompted.
)
pause
