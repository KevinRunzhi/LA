#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"
ENV_FILE="${LA_ENV_FILE:-$APP_ROOT/run/platform.env}"

if [[ ! -x "$VENV/bin/python" ]]; then
  printf '缺少项目虚拟环境，请先运行 install.sh。\n' >&2
  exit 1
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
cd "$APP_ROOT"
"$VENV/bin/python" -m backend.runtime.preflight
