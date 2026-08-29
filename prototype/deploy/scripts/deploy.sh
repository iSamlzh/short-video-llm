#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIRECTORY="${SOURCE_DIRECTORY:-$(pwd)}"
APPLICATION_ROOT="${APPLICATION_ROOT:-/opt/content-agent}"
SERVICE_NAME="${SERVICE_NAME:-content-agent}"
SERVICE_GROUP="${SERVICE_GROUP:-content-agent}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:3000}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
RELEASE_DIRECTORY="${APPLICATION_ROOT}/releases/${RELEASE_ID}"

if [[ "${APPLICATION_ROOT}" != /* || "${SOURCE_DIRECTORY}" != /* ]]; then
  echo "APPLICATION_ROOT 与 SOURCE_DIRECTORY 必须是绝对路径" >&2
  exit 2
fi
if [[ ! -f "${SOURCE_DIRECTORY}/package.json" || ! -f "/etc/content-agent/content-agent.env" ]]; then
  echo "项目源目录或生产环境文件不存在" >&2
  exit 2
fi

install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${APPLICATION_ROOT}/releases"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${RELEASE_DIRECTORY}"

if [[ -L "${APPLICATION_ROOT}/current" ]]; then
  PRODUCTION_DATABASE="${PRODUCTION_DATABASE:?已有版本时必须显式提供 PRODUCTION_DATABASE 做部署前备份}"
  PREDEPLOY_BACKUP_DIRECTORY="${PREDEPLOY_BACKUP_DIRECTORY:?已有版本时必须显式提供 PREDEPLOY_BACKUP_DIRECTORY}"
  if [[ -f "${PRODUCTION_DATABASE}" ]]; then
    bash "${APPLICATION_ROOT}/current/deploy/scripts/backup-sqlite.sh" \
      "${PRODUCTION_DATABASE}" "${PREDEPLOY_BACKUP_DIRECTORY}"
  else
    echo "正式数据库尚未初始化，跳过本次部署前备份。"
  fi
fi

rsync -a \
  --exclude '.git' --exclude '.next' --exclude 'node_modules' --exclude '.data' \
  --exclude '.env.local' --exclude '.deploy' --exclude 'test-results' --exclude 'outputs' \
  "${SOURCE_DIRECTORY}/" "${RELEASE_DIRECTORY}/"

cd "${RELEASE_DIRECTORY}"
npm ci
npm run typecheck
npm test
npm run build

install -d -o content-agent -g "${SERVICE_GROUP}" -m 0750 /var/cache/content-agent
install -d -o root -g adm -m 0750 /var/log/content-agent
install -m 0644 "${SOURCE_DIRECTORY}/deploy/logrotate/content-agent" /etc/logrotate.d/content-agent
install -m 0644 "${SOURCE_DIRECTORY}/deploy/systemd/content-agent.service" "/etc/systemd/system/${SERVICE_NAME}.service"
install -m 0644 "${SOURCE_DIRECTORY}/deploy/systemd/content-agent-worker.service" "/etc/systemd/system/${SERVICE_NAME}-worker.service"
logrotate --debug /etc/logrotate.d/content-agent >/dev/null
systemctl daemon-reload
systemctl enable --now logrotate.timer
if [[ -d "${RELEASE_DIRECTORY}/.next/cache" ]]; then
  mv "${RELEASE_DIRECTORY}/.next/cache" "${RELEASE_DIRECTORY}/.next/cache-build"
fi
ln -s /var/cache/content-agent "${RELEASE_DIRECTORY}/.next/cache"

ln -sfn "${RELEASE_DIRECTORY}" "${APPLICATION_ROOT}/current.next"
mv -Tf "${APPLICATION_ROOT}/current.next" "${APPLICATION_ROOT}/current"
systemctl restart "${SERVICE_NAME}.service"
bash "${RELEASE_DIRECTORY}/deploy/scripts/smoke-test.sh" "${SMOKE_BASE_URL}"
systemctl enable "${SERVICE_NAME}-worker.service"
systemctl restart "${SERVICE_NAME}-worker.service"

echo "部署完成：${RELEASE_ID}。旧 release 未删除，可人工切换 current 后重启回退。"
