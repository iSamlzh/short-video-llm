#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH="${1:?用法: backup-sqlite.sh <生产数据库绝对路径> <备份目录绝对路径>}"
BACKUP_DIRECTORY="${2:?用法: backup-sqlite.sh <生产数据库绝对路径> <备份目录绝对路径>}"
SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

exec node "${SCRIPT_DIRECTORY}/sqlite-maintenance.mjs" backup \
  --database "${DATABASE_PATH}" \
  --backup-dir "${BACKUP_DIRECTORY}" \
  --daily-keep "${BACKUP_DAILY_KEEP:-7}" \
  --weekly-keep "${BACKUP_WEEKLY_KEEP:-4}" \
  --force-weekly "${BACKUP_FORCE_WEEKLY:-false}"
