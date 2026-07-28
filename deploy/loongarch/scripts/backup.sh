#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"
ENV_FILE="${LA_ENV_FILE:-$APP_ROOT/run/platform.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
database="${PRESENTATION_DATABASE_PATH:-run/data/presentation.db}"
[[ "$database" = /* ]] || database="$APP_ROOT/$database"
output_dir="${1:-$APP_ROOT/run/backups}"

cd "$APP_ROOT"
"$VENV/bin/python" -m backend.runtime.database_ops backup \
  --database "$database" \
  --output-dir "$output_dir"
