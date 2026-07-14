#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PID_FILE="$APP_ROOT/run/la-mvp.pid"
if [[ ! -f "$PID_FILE" ]]; then printf '未找到本部署包的 PID 文件，服务可能未运行。\n'; exit 0; fi
pid="$(cat "$PID_FILE")"
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then printf 'PID 文件内容无效，已移除。\n' >&2; rm -f "$PID_FILE"; exit 1; fi
if ! kill -0 "$pid" 2>/dev/null; then printf '记录的进程已不存在，清理 PID 文件。\n'; rm -f "$PID_FILE"; exit 0; fi
kill "$pid"
for _ in {1..15}; do
  if ! kill -0 "$pid" 2>/dev/null; then rm -f "$PID_FILE"; printf '服务已停止。\n'; exit 0; fi
  sleep 1
done
printf '服务未在 15 秒内退出。请检查进程后再决定是否强制终止：ps -fp %s\n' "$pid" >&2
exit 1
