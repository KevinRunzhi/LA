#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"

"$APP_ROOT/deploy/loongarch/scripts/check-env.sh"
printf '\n[安装] 创建项目专用 Python 虚拟环境：%s\n' "$VENV"
python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --disable-pip-version-check -r "$APP_ROOT/backend/requirements.txt"
mkdir -p "$APP_ROOT/run" "$APP_ROOT/logs"
chmod u+rwx "$APP_ROOT/backend/data/presentation" "$APP_ROOT/run" "$APP_ROOT/logs"
printf '\n安装完成。下一步执行：\n  %s/deploy/loongarch/scripts/start.sh\n' "$APP_ROOT"
