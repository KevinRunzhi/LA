# 竞赛提交平台运维 Runbook

## 1. 日常检查

```bash
curl -fsS http://127.0.0.1:8080/api/health/live
curl -fsS http://127.0.0.1:8080/api/health/ready
curl -fsS http://127.0.0.1:8080/api/metrics
tail -100 logs/la-mvp.log
df -h .
```

ready 的四个核心检查是数据库、案例注册表、附件目录和前端构建。

## 2. 演示前检查

1. `git rev-parse --short HEAD` 与提交记录一致；
2. `preflight.sh` 通过；
3. `healthcheck.sh` 通过；
4. `/api/platform/cases` 至少包含散热和供电案例；
5. 首页输入散热描述能创建 CaseRun；
6. `run/attachments` 和数据库目录可写；
7. 最近一次数据库备份及 `.sha256` 同时存在；
8. 浏览器刷新后关键 SQLite 状态仍存在。

## 3. 告警分级

| 等级 | 条件 | 动作 |
| --- | --- | --- |
| P1 | 首页不可访问、ready 持续 503、数据库完整性失败 | 停止演示写入，保留日志，切换稳定备份 |
| P2 | 单个案例加载失败、附件不可写、知识发布失败 | 查看 ready/loadErrors 和事件日志，暂时使用其他案例 |
| P3 | 单次请求 4xx、输入未匹配、旧浏览器缓存 | 根据错误码修正输入或刷新静态资源 |

## 4. 数据库故障

只读检查：

```bash
python3 - <<'PY'
import sqlite3
db = sqlite3.connect("run/data/presentation.db")
print(db.execute("PRAGMA integrity_check").fetchone()[0])
print(db.execute("SELECT version,name,applied_at FROM schema_migrations").fetchall())
PY
```

不要在未备份时手工修改 `case_runs`、快照或知识版本表。恢复走 `restore.sh`。

## 5. 请求追踪

每个响应包含 `X-Request-ID`。调用方可以主动传入：

```bash
curl -i \
  -H 'X-Request-ID: competition-review-001' \
  http://127.0.0.1:8080/api/platform/cases
```

JSON 访问日志会记录 requestId、方法、归一化路由、状态和耗时，不记录 API Key、请求正文或附件内容。

## 6. 指标解释

```text
la_service_info
la_service_uptime_seconds
la_http_requests_in_flight
la_http_requests_total
la_http_request_duration_seconds_total
```

路由使用 Flask rule，例如 `/api/platform/case-runs/<run_id>`，不会把每个运行 ID 作为新标签。

## 7. 安全事件

- 若环境文件或 Token 泄露：停止相关外部适配器、轮换凭据、检查日志；
- 若附件异常增长：停止上传入口或服务，保留目录，核对 `case_run_attachments`；
- 若发现未知数据库写入：保存数据库一致性备份、日志和提交号，不先覆盖现场；
- 仓库、作品包、日志和截图中不得出现真实 API Key。
