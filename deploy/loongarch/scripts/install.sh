#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"

bash "$APP_ROOT/deploy/loongarch/scripts/check-env.sh"
printf '\n[安装] 创建项目专用 Python 虚拟环境：%s\n' "$VENV"
python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --disable-pip-version-check -r "$APP_ROOT/backend/requirements.txt"
mkdir -p \
  "$APP_ROOT/run/data" \
  "$APP_ROOT/run/attachments" \
  "$APP_ROOT/run/manuals" \
  "$APP_ROOT/run/job-cards" \
  "$APP_ROOT/run/exports" \
  "$APP_ROOT/run/platform-backups" \
  "$APP_ROOT/run/backups" \
  "$APP_ROOT/logs"
if [[ ! -f "$APP_ROOT/run/platform.env" ]]; then
  cp "$APP_ROOT/deploy/env/production.env.example" "$APP_ROOT/run/platform.env"
  printf '[安装] 已生成运行配置：%s\n' "$APP_ROOT/run/platform.env"
fi
chmod u+rwx "$APP_ROOT/backend/data/presentation" "$APP_ROOT/run" "$APP_ROOT/logs"
bash "$APP_ROOT/deploy/loongarch/scripts/preflight.sh"
printf '\n安装完成。下一步执行：\n  %s/deploy/loongarch/scripts/start.sh\n' "$APP_ROOT"
