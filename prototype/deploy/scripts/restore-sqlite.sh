#!/usr/bin/env bash
set -euo pipefail

BACKUP_PATH="${1:?用法: restore-sqlite.sh <备份文件绝对路径> <隔离恢复目录绝对路径> <生产数据库绝对路径>}"
TARGET_DIRECTORY="${2:?用法: restore-sqlite.sh <备份文件绝对路径> <隔离恢复目录绝对路径> <生产数据库绝对路径>}"
PRODUCTION_DATABASE="${3:?用法: restore-sqlite.sh <备份文件绝对路径> <隔离恢复目录绝对路径> <生产数据库绝对路径>}"
SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

exec node "${SCRIPT_DIRECTORY}/sqlite-maintenance.mjs" restore \
  --backup "${BACKUP_PATH}" \
  --target-dir "${TARGET_DIRECTORY}" \
  --production-db "${PRODUCTION_DATABASE}"
