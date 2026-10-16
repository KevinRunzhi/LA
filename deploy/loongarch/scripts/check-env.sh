#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
errors=0

ok() { printf '[通过] %s\n' "$1"; }
warn() { printf '[提示] %s\n' "$1"; }
fail() { printf '[失败] %s\n' "$1" >&2; errors=$((errors + 1)); }

arch="$(uname -m)"
if [[ "$arch" == "loongarch64" ]]; then ok "CPU 架构：$arch"; else warn "当前 CPU 架构为 $arch；正式演示机应为 loongarch64"; fi
if [[ -r /etc/os-release ]]; then . /etc/os-release; ok "操作系统：${PRETTY_NAME:-${NAME:-未知}}"; else warn "无法读取 /etc/os-release"; fi

for command_name in python3 curl tar; do
  if command -v "$command_name" >/dev/null 2>&1; then ok "已安装 $command_name：$(command -v "$command_name")"; else fail "缺少命令：$command_name"; fi
done

if command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then ok "Python 版本：$(python3 -V 2>&1)"; else fail "需要 Python 3.10+，当前为 $(python3 -V 2>&1)"; fi
  if python3 -m venv --help >/dev/null 2>&1; then ok "Python venv 可用"; else fail "Python venv 不可用，请安装 python3-venv 或系统对应软件包"; fi
fi

[[ -f "$APP_ROOT/frontend/dist/index.html" ]] && ok "前端预构建文件完整" || fail "缺少 frontend/dist/index.html"
[[ -f "$APP_ROOT/backend/app.py" && -f "$APP_ROOT/backend/presentation_store.py" ]] && ok "后端程序文件完整" || fail "后端程序文件不完整"
[[ -d "$APP_ROOT/backend/data/presentation" ]] && ok "演示数据目录存在" || fail "缺少演示数据目录"

if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)8080$'; then warn "端口 8080 已被占用；启动前请按部署说明确认并停止旧服务"; else ok "端口 8080 当前未发现监听"; fi

if (( errors > 0 )); then printf '\n环境检查未通过：%d 项错误。\n' "$errors" >&2; exit 1; fi
printf '\n环境检查通过，可以继续安装。\n'
