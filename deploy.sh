#!/bin/bash

set -euo pipefail

# 1) Run backup script
#    This calls `backup.sh`, passing all container IDs from docker ps -q,
#    and storing backups in /home/backup
sudo ./backup.sh ocpp-demo-js /home/backup

# 2) Find the latest backup file in /home/backup and replace chargers.db
LATEST_BACKUP=$(ls -t /home/backup/chargers_*.db | head -n 1)
if [ -z "$LATEST_BACKUP" ]; then
  echo "No backup file found in /home/backup/chargers_*.db"
  exit 1
fi

echo "Using latest backup: $LATEST_BACKUP"
mv "$LATEST_BACKUP" /home/nikita/ocpp-demo-js/chargers.db

# 3) Build the new Docker image
cd /home/nikita/ocpp-demo-js
echo "Building Docker image nikita-zerofy/ocpp-demo ..."
sudo docker build -t nikita-zerofy/ocpp-demo .

# 4) Kill and remove the running container (if it exists)
echo "Stopping and removing any existing 'ocpp-demo-js' container..."
sudo docker kill ocpp-demo-js 2>/dev/null || true
sudo docker rm   ocpp-demo-js 2>/dev/null || true

# 5) Run a fresh container
echo "Running new container 'ocpp-demo-js'..."
sudo docker run --name ocpp-demo-js \
  -p 3000:3000 \
  --env-file .env \
  --log-driver=gcplogs \
  --log-opt gcp-project=zerofy-energy-dev \
  nikita-zerofy/ocpp-demo