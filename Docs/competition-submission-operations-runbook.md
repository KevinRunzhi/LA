# 竞赛提交平台运维 Runbook

## 1. 日常检查

```bash
curl -fsS http://127.0.0.1:8080/api/health/live
curl -fsS http://127.0.0.1:8080/api/health/ready
curl -fsS http://127.0.0.1:8080/api/metrics
tail -100 logs/la-mvp.log
df -h .
```

ready 检查数据库迁移与 FTS5、案例注册表、附件/手册/作业卡目录和前端构建。

## 2. 演示前检查

1. `git rev-parse --short HEAD` 与提交记录一致；
2. `preflight.sh` 通过；
3. `healthcheck.sh` 通过；
4. `/api/platform/cases` 至少包含散热和供电案例；
5. 首页输入散热描述能创建 CaseRun；
6. `run/attachments`、`run/manuals`、`run/job-cards`、`run/exports`、`run/platform-backups`、`run/case-authoring` 和数据库目录可写；
7. 最近一次数据库备份及 `.sha256` 同时存在；
8. 浏览器刷新后关键 SQLite 状态仍存在。
9. `LA_AUTH_MODE=enforced` 时管理员可以登录，未登录业务请求返回 401；
10. 图谱当前版本存在，手册检索能返回页码证据，PDF 下载通过摘要校验。
11. `python -m backend.operations_cli integrity` 返回 `passed` 或已确认的 warning；
12. 批量入库时 `la-knowledge-ingestion-worker` 处于 active。
13. 案例发布中心 active registry 中的包可以通过 CasePackageRegistry 加载。

## 3. 告警分级

| 等级 | 条件 | 动作 |
| --- | --- | --- |
| P1 | 首页不可访问、ready 持续 503、数据库完整性失败 | 停止演示写入，保留日志，切换稳定备份 |
| P2 | 单个案例加载失败、运行目录不可写、知识/图谱发布失败 | 查看 ready/loadErrors、审计和事件日志 |
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

不要在未备份时手工修改 `case_runs`、身份、手册索引、图谱版本、工单或快照表。数据库恢复走 `restore.sh`；原始手册、附件和 PDF 目录也需由部署侧文件备份策略保护。

完整运行资产备份使用：

```bash
backend/.venv/bin/python -m backend.operations_cli backup
```

归档写入 `LA_PLATFORM_BACKUP_ROOT`，包含在线一致性 SQLite 副本、附件、手册、作业卡及逐文件摘要 manifest。

## 5. 批量手册入库

由专家或管理员通过平台数据中心创建任务后，worker 持续处理：

```bash
systemctl status la-knowledge-ingestion-worker
journalctl -u la-knowledge-ingestion-worker -n 100 --no-pager
backend/.venv/bin/python -m backend.ingestion_worker --once
```

任务只扫描配置的 `Info/` 白名单目录。不要为了入库扩大到任意绝对目录；失败项目通过 retry API 重排，最多处理三次。

## 6. 请求追踪

每个响应包含 `X-Request-ID`。调用方可以主动传入：

```bash
curl -i \
  -H 'X-Request-ID: competition-review-001' \
  http://127.0.0.1:8080/api/platform/cases
```

JSON 访问日志会记录 requestId、方法、归一化路由、状态和耗时，不记录 API Key、请求正文或附件内容。

## 7. 指标解释

```text
la_service_info
la_service_uptime_seconds
la_http_requests_in_flight
la_http_requests_total
la_http_request_duration_seconds_total
```

路由使用 Flask rule，例如 `/api/platform/case-runs/<run_id>`，不会把每个运行 ID 作为新标签。

## 8. 安全事件

- 若环境文件或 Token 泄露：停止相关外部适配器、轮换凭据、检查日志；
- 若登录令牌泄露：管理员重置该用户密码或停用账号，旧 token version 会立即失效；
- 若附件异常增长：停止上传入口或服务，保留目录，核对 `case_run_attachments`；
- 若作业卡摘要失败：保留数据库和文件现场，不覆盖原 PDF，按审计记录定位外部修改；
- 若发现未知数据库写入：保存数据库一致性备份、日志和提交号，不先覆盖现场；
- 仓库、作品包、日志和截图中不得出现真实 API Key。

## 9. 案例发布恢复

案例 release 不可原地修改。新版本导致路由或 Agent 内容异常时，在页面选择上一
版本执行“激活”，或使用管理 API 激活历史 release。该操作重建
`run/case-authoring/active`，不会删除故障版本和审核记录。

维护命令：

```bash
backend/.venv/bin/python -m backend.case_authoring_cli validate <draftId>
backend/.venv/bin/python -m backend.case_authoring_cli rebuild-registry
backend/.venv/bin/python -m backend.case_authoring_cli export-release <releaseId> ./exports
```
