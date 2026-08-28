#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://127.0.0.1}"
TEMP_DIRECTORY="$(mktemp -d)"
trap 'rm -rf -- "${TEMP_DIRECTORY}"' EXIT

wait_for_application() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 2 "${BASE_URL}/api/health/live" -o "${TEMP_DIRECTORY}/live.json"; then
      return 0
    fi
    sleep 1
  done
  echo "应用在 30 秒内未通过存活检查" >&2
  return 1
}

wait_for_application
curl --fail --silent --show-error --max-time 10 "${BASE_URL}/api/health/ready" -o "${TEMP_DIRECTORY}/ready.json"
curl --fail --silent --show-error --max-time 10 "${BASE_URL}/login" -o "${TEMP_DIRECTORY}/login.html"

node -e 'const fs=require("fs"); const live=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const ready=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if(live.status!=="ok"||ready.status!=="ready") process.exit(1)' "${TEMP_DIRECTORY}/live.json" "${TEMP_DIRECTORY}/ready.json"
if grep -Eiq 'LLM_API_KEY|PROTOTYPE_DB_PATH|content_agent_session|password_hash' "${TEMP_DIRECTORY}/live.json" "${TEMP_DIRECTORY}/ready.json"; then
  echo '{"status":"failed","errorCode":"HEALTH_RESPONSE_CONTAINS_SENSITIVE_FIELD"}' >&2
  exit 1
fi

echo '{"status":"completed","checks":["live","ready","login","redaction"]}'
