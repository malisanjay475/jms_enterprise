
# Deployment Instructions

I have created a PowerShell script `deploy_update.ps1` to automate the update.

## Prerequisites
1.  **OpenSSH**: Windows 10/11 usually has this installed. You should be able to run `ssh` and `scp` in PowerShell.
2.  **Remote Path**: You **MUST** know where the folder is on your VPS (e.g., `/root/JPSMS/BACKEND` or `/var/www/BACKEND`).

## How to Use

1.  **Edit the Script**:
    - Open `deploy_update.ps1` in VS Code.
    - Update `$RemoteUser` (e.g., `root`).
    - Update `$RemotePath` (CRITICAL: Valid server path).

2.  **Run the Script**:
    - Open PowerShell in the `BACKEND` folder.
    - Run: `.\deploy_update.ps1`
    - Enter your VPS Password when prompted.

## Manual Commands (if script fails)

If you prefer to type manually in PowerShell:

### 1. Upload
```powershell
# Run this in your local JPSMS\BACKEND folder
scp update_package_v3.zip root@72.62.228.195:/root/
```

### 2. Deploy (Corrected Path & Docker)
```powershell
# SSH into correct folder and Docker Rebuild
# We use /root/jpsms because that is where your Dockerfile is.

ssh root@72.62.228.195 "unzip -o /root/update_package_v3.zip -d /root/jpsms && cd /root/jpsms && docker-compose up -d --build && rm /root/update_package_v3.zip"
```
