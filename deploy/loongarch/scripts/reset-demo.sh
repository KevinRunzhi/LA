#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
printf '[重置] 恢复演示数据初始状态……\n'
curl --fail --silent --show-error -X POST "$base_url/api/presentation/reset"
printf '\n重置完成，请刷新浏览器页面。\n'
