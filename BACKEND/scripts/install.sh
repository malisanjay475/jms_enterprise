#!/bin/bash

echo "============================================="
echo "   JPSMS Distributed Factory Installer"
echo "============================================="

# 1. Check for Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "[ERROR] Docker Compose is not installed."
    exit 1
fi

# 2. Collect Configuration
read -p "Enter Database Password (for local DB): " DB_PASSWORD
read -p "Enter Main Server URL (e.g. https://vps.example.com): " MAIN_URL
read -p "Enter Factory ID (e.g. 2): " FACTORY_ID
read -p "Enter Sync API Key: " SYNC_KEY

# 3. Create .env file
echo "[INFO] Creating .env file..."
cat > .env <<EOL
DB_USER=postgres
DB_PASSWORD=$DB_PASSWORD
DB_NAME=jpsms
SERVER_TYPE=LOCAL
MAIN_SERVER_URL=$MAIN_URL
LOCAL_FACTORY_ID=$FACTORY_ID
SYNC_API_KEY=$SYNC_KEY
GEMINI_API_KEY=placeholder
NODE_ENV=production
EOL

# 4. Pull/Build
echo "[INFO] Building Containers..."
# docker-compose build --no-cache
docker-compose up -d

echo "[INFO] Installation Complete!"
echo "Server running on port 3000."
