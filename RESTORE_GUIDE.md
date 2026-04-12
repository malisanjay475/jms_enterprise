# JPSMS Server Restoration Guide

Follow these steps to restore your JPSMS server on a new machine.

## 1. Prerequisites
- **PostgreSQL 18**: Install PostgreSQL from the official website.
- **Node.js**: Install the latest LTS version.

## 2. Restore the Database
1. Extract the backup ZIP file.
2. Open a command prompt or terminal.
3. Run the following command to create the database (change `postgres` to your superuser if different):
   ```bash
   psql -U postgres -c "CREATE DATABASE jpsms;"
   ```
4. Restore the data from the extracted `jpsms_dump.sql` file:
   ```bash
   psql -U postgres -d jpsms -f jpsms_dump.sql
   ```
   *(Enter your password when prompted: `Sanjay@541##`)*

## 3. Configure the Application
1. Navigate to the `BACKEND` folder within the extracted directory.
2. Open the `.env` file and ensure the database credentials match your new local setup.
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_HOST`
   - `DB_PORT`
   - `DB_NAME`

## 4. Run the Server
1. In the `BACKEND` folder, open a terminal.
2. If `node_modules` is present, you can try running immediately. If not, run:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node server.js
   ```
4. Access the server at `http://localhost:3000` (or whatever port is configured).

## 5. Troubleshooting
- **Database Connection Error**: Verify that PostgreSQL is running and the credentials in `.env` are correct.
- **Port Already in Use**: Change the `PORT` in `.env` or stop the application using that port.
- **Missing Dependencies**: Run `npm install` again to ensure all packages are correctly installed.

---
*Backup generated on: 2026-04-02*
