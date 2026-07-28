#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$APP_ROOT/backend/.venv"
PID_FILE="$APP_ROOT/run/la-mvp.pid"
LOG_FILE="$APP_ROOT/logs/la-mvp.log"
ENV_FILE="${LA_ENV_FILE:-$APP_ROOT/run/platform.env}"
mkdir -p "$APP_ROOT/run" "$APP_ROOT/logs"

if [[ ! -x "$VENV/bin/python" ]]; then printf '尚未安装运行环境，请先执行：%s/deploy/loongarch/scripts/install.sh\n' "$APP_ROOT" >&2; exit 1; fi
if [[ ! -x "$VENV/bin/gunicorn" ]]; then printf '虚拟环境缺少 Gunicorn，请重新执行 install.sh。\n' >&2; exit 1; fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
port="${APP_PORT:-8080}"
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  printf 'APP_PORT 必须是 1 到 65535 之间的整数。\n' >&2
  exit 1
fi
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then printf '服务已经运行，PID=%s，地址=http://127.0.0.1:%s\n' "$old_pid" "$port"; exit 0; fi
  rm -f "$PID_FILE"
fi
if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"; then printf '端口 %s 已被其他进程占用，请先确认并停止旧服务：\n  sudo ss -lntp | grep :%s\n' "$port" "$port" >&2; exit 1; fi

bash "$APP_ROOT/deploy/loongarch/scripts/preflight.sh"

printf '[启动] 使用 Gunicorn 启动稳定演示服务……\n'
(
  cd "$APP_ROOT"
  nohup "$VENV/bin/gunicorn" \
    --config deploy/gunicorn.conf.py \
    backend.wsgi:application </dev/null >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
)

pid="$(cat "$PID_FILE")"
for _ in {1..30}; do
  if curl --silent --fail "http://127.0.0.1:$port/api/health/ready" >/dev/null 2>&1; then
    printf '启动成功：PID=%s\n本机访问：http://127.0.0.1:%s\n运行日志：%s\n' "$pid" "$port" "$LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 1
done
printf '启动失败，最近日志如下：\n' >&2
tail -80 "$LOG_FILE" >&2 || true
kill "$pid" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
