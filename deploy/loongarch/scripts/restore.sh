#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"
PID_FILE="$APP_ROOT/run/la-mvp.pid"
ENV_FILE="${LA_ENV_FILE:-$APP_ROOT/run/platform.env}"

if [[ $# -ne 2 ]]; then
  printf '用法：%s <backup.db> <backup.db.sha256>\n' "$0" >&2
  exit 2
fi
if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    printf '恢复前必须停止本项目服务：%s\n' "$APP_ROOT/deploy/loongarch/scripts/stop.sh" >&2
    exit 1
  fi
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
database="${PRESENTATION_DATABASE_PATH:-run/data/presentation.db}"
[[ "$database" = /* ]] || database="$APP_ROOT/$database"

cd "$APP_ROOT"
"$VENV/bin/python" -m backend.runtime.database_ops restore \
  --database "$database" \
  --backup "$1" \
  --checksum "$2" \
  --safety-backup-dir "$APP_ROOT/run/backups/pre-restore"
