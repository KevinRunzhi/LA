#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
printf '[检查] 后端健康接口：%s/api/health\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/health"
printf '\n[检查] 前端首页：%s/\n' "$base_url"
curl --fail --silent --show-error "$base_url/" | grep -qi '<!doctype html'
printf '前端首页和后端接口均可访问。\n'
