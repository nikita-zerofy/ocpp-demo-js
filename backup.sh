#!/bin/bash
CONTAINER_NAME_OR_ID="$1"
BACKUP_DIR="$2"

if [ -z "$CONTAINER_NAME_OR_ID" ]; then
  echo "ERROR: Missing container name or ID."
  echo "Usage: $0 <container_name_or_id> [backup_directory]"
  exit 1
fi

if [ -z "$BACKUP_DIR" ]; then
  BACKUP_DIR="./backup"
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILENAME="chargers_${TIMESTAMP}.db"

DB_PATH_IN_CONTAINER="/app/chargers.db"

echo "Copying ${DB_PATH_IN_CONTAINER} from container '${CONTAINER_NAME_OR_ID}' to '${BACKUP_DIR}/${BACKUP_FILENAME}' ..."
docker cp "${CONTAINER_NAME_OR_ID}:${DB_PATH_IN_CONTAINER}" "${BACKUP_DIR}/${BACKUP_FILENAME}"

if [ $? -eq 0 ]; then
  echo "Backup successful: ${BACKUP_DIR}/${BACKUP_FILENAME}"
else
  echo "Backup failed!"
  exit 1
fi
