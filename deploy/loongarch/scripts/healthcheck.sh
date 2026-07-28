#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
printf '[检查] 进程存活：%s/api/health/live\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/health/live"
printf '\n[检查] 业务就绪：%s/api/health/ready\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/health/ready"
printf '\n[检查] 案例平台注册表：%s/api/platform/cases\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/platform/cases" | grep -q '"ok":true'
printf '[检查] 平台能力清单：%s/api/platform/system/capabilities\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/platform/system/capabilities" | grep -q '"engine":"sqlite"'
printf '\n[检查] 前端首页：%s/\n' "$base_url"
curl --fail --silent --show-error "$base_url/" | grep -qi '<!doctype html'
printf '[检查] 指标接口：%s/api/metrics\n' "$base_url"
curl --fail --silent --show-error "$base_url/api/metrics" | grep -q 'la_http_requests_total'
printf '存活、就绪、案例平台、指标和前端首页均可访问。\n'
