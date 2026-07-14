@echo off
if "%PGPASSWORD%"=="" set /p PGPASSWORD=Enter Postgres password:
if "%PGHOST%"=="" set /p PGHOST=Enter DB host:
echo Adding updated_at to assembly_scans on remote server...
"C:\Program Files\PostgreSQL\14\bin\psql.exe" -h %PGHOST% -U postgres -d jpsms -c "ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();"
echo Done.
pause
