@echo off
title Sync Live Database
echo ===================================================
echo     SYNC LIVE DATABASE TO LOCAL MACHINE
echo ===================================================
echo.
echo This script will securely connect to your live VPS,
echo download the latest data, and copy it into your local testing environment.
echo.
echo WARNING: This will replace your local database data.
echo (Don't worry, your live VPS data is perfectly safe!)
echo.

:: --- Connection settings ---
:: Set VPS_HOST in your environment (e.g. set VPS_HOST=your.vps.ip) to skip the
:: prompt. Nothing here is hardcoded so this file is safe to commit.
if "%VPS_HOST%"=="" set /p VPS_HOST="Enter your VPS host (user@ip, e.g. root@203.0.113.10): "
if "%VPS_HOST%"=="" (
    echo No VPS host provided. Aborting.
    pause
    exit /b 1
)

pause

echo.
echo [1/3] Generating a fresh snapshot on the live server...
echo (You may be prompted for your VPS password)
ssh %VPS_HOST% "docker exec $(docker ps -qf name=jms-enterprise-v1-staging-db) pg_dump --clean --if-exists -U jms_v1 jms_v1 > /root/latest_backup.sql"

echo.
echo [2/3] Downloading the snapshot to your computer...
echo (You may be prompted for your VPS password again)
scp %VPS_HOST%:/root/latest_backup.sql BACKEND\jpsms_full_backup.sql

echo.
echo [3/3] Restoring Live Data to your Local PostgreSQL...
set PGUSER=postgres
set /p PGPASSWORD="Enter your LOCAL PostgreSQL Password: "
set PGHOST=localhost
set PGDATABASE=jpsms

:: Find psql.exe
set PG_BIN=
if exist "C:\Program Files\PostgreSQL\18\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\18\bin\
if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\17\bin\
if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\16\bin\
if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\15\bin\
if exist "C:\Program Files\PostgreSQL\14\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\14\bin\

if "%PG_BIN%"=="" (
    set PSQL=psql
) else (
    set PSQL="%PG_BIN%psql.exe"
)

%PSQL% -U %PGUSER% -h %PGHOST% -d %PGDATABASE% < BACKEND\jpsms_full_backup.sql

echo.
echo ===================================================
echo SYNC COMPLETE! Your local environment now has the LIVE data.
echo You can log in using your real, live account credentials!
echo ===================================================
pause
