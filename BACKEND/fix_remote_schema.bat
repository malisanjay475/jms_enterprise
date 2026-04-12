@echo off
set PGPASSWORD=Sanjay@541##
echo Adding updated_at to assembly_scans on remote server...
"C:\Program Files\PostgreSQL\14\bin\psql.exe" -h 72.62.228.195 -U postgres -d jpsms -c "ALTER TABLE assembly_scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();"
echo Done.
pause
