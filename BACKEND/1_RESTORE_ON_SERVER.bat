@echo off
echo ==========================================
echo      JPSMS SERVER RESTORE TOOL
echo ==========================================
echo.
echo This script will set up the database on this NEW PC.
echo Make sure you have installed PostgreSQL and Node.js first!
echo.
pause

:: 1. SETTINGS
set PGUSER=postgres
:: ASK FOR PASSWORD 
set /p PGPASSWORD="Enter the Password you set for PostgreSQL on THIS PC: "
set PGHOST=localhost
set PGDATABASE=jpsms
set INPUT_FILE=jpsms_full_backup.sql

:: 2. CHECK FOR BACKUP FILE
if not exist %INPUT_FILE% (
    echo.
    echo [ERROR] Could not find '%INPUT_FILE%'.
    echo Please make sure you ran '0_BACKUP_DATA.bat' on the old PC 
    echo and copied the file here.
    pause
    exit /b
)

:: 3. FIND POSTGRES
set PG_BIN=
if exist "C:\Program Files\PostgreSQL\18\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\18\bin\
if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\17\bin\
if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\16\bin\
if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\15\bin\
if exist "C:\Program Files\PostgreSQL\14\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\14\bin\
if exist "C:\Program Files\PostgreSQL\13\bin\psql.exe" set PG_BIN=C:\Program Files\PostgreSQL\13\bin\

if "%PG_BIN%"=="" (
    set PSQL=psql
) else (
    set PSQL="%PG_BIN%psql.exe"
)

:: 4. CREATE DATABASE
echo.
echo Creating database '%PGDATABASE%'...
%PSQL% -U %PGUSER% -h %PGHOST% -d postgres -c "CREATE DATABASE %PGDATABASE%;"
:: Ignore error if it already exists

:: 5. RESTORE DATA
echo.
echo Restoring data from %INPUT_FILE%...
%PSQL% -U %PGUSER% -h %PGHOST% -d %PGDATABASE% < %INPUT_FILE%

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Restore finished with errors.
    echo This is normal if the database was not empty.
) else (
    echo.
    echo [SUCCESS] Database restored perfectly!
)

:: 6. INSTALL DEPENDENCIES
echo.
echo ==========================================
echo Installing Project Dependencies...
echo ==========================================
call npm install


echo.
echo ==========================================
echo Now type: 'npm start' to run the System!
echo ==========================================
pause
