---
name: Backup Management
description: Procedures for taking and restoring system backups in JMS Enterprise.
---
# Backup Management Skill

## Objectives
- Ensure data integrity before major deployments.
- Automate the backup process using existing scripts.
- Maintain a clear record of backup versions.

## Instructions
1. **Taking a Backup**:
   - Use `node take_backup.js` in the root directory.
   - Verify that the resulting `.zip` file is created in the root or `BACKUPS/` folder.
2. **Restoring**:
   - Refer to `RESTORE_GUIDE.md` for manual steps.
   - Use `scripts/prepare_fresh_start.js` for clean state initialization.

## Safety Rules
- NEVER delete a backup file without user confirmation.
- Always check disk space before initiating a large backup.
