# 竞赛提交平台部署指南

## 1. 部署形态

本分支提供两种原生 Linux 运行方式：

| 模式 | 入口 | 适用场景 |
| --- | --- | --- |
| 前台生产运行 | `make run` | WSL、评审本机、故障排查 |
| 系统服务 | `systemd + Gunicorn + 可选 Nginx` | 龙芯稳定演示机、长期单机运行 |

应用本身由 Flask 同时提供 API 和 React 预构建页面。Nginx 不是硬依赖；启用后负责静态资源缓存、上传大小限制、请求 ID 和反向代理。

## 2. 目录与数据

```text
/opt/la-case-platform/
├── backend/
├── frontend/dist/
├── deploy/
├── run/
│   ├── platform.env
│   ├── data/presentation.db
│   ├── attachments/
│   ├── manuals/
│   ├── job-cards/
│   ├── exports/
│   ├── platform-backups/
│   ├── case-authoring/
│   └── backups/
└── logs/
```

源码可只读，运行时仅写 `run/` 和 `logs/`。SQLite、附件、PID、日志和备份均被 `.gitignore` 排除。

## 3. 快速安装

```bash
cd /home/kevin/projects/LA-submission
make install
make build
make check
```

生产前台运行：

```bash
cp deploy/env/production.env.example run/platform.env
set -a
source run/platform.env
set +a
make run
```

检查：

```bash
curl -fsS http://127.0.0.1:8080/api/health/live
curl -fsS http://127.0.0.1:8080/api/health/ready
curl -fsS http://127.0.0.1:8080/api/platform/cases
curl -fsS http://127.0.0.1:8080/api/metrics
```

## 4. 配置字典

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LA_ENV` | `development` | `development/test/production` |
| `APP_HOST` | `0.0.0.0` | Flask/Gunicorn 监听地址 |
| `APP_PORT` | `8080` | 服务端口 |
| `PRESENTATION_DATABASE_PATH` | `backend/data/presentation/presentation.db` | SQLite 数据库 |
| `ATTACHMENT_STORAGE_ROOT` | `run/attachments` | 附件根目录 |
| `ATTACHMENT_MAX_BYTES` | `20971520` | 单附件上限 |
| `LA_AUTH_MODE` | `compat` | `compat` 保留旧 actor 合同；`enforced` 强制 Bearer 会话 |
| `LA_SESSION_TTL_SECONDS` | `28800` | 登录会话有效期 |
| `LA_LOGIN_MAX_FAILURES` | `5` | 触发临时锁定的连续失败次数 |
| `LA_LOGIN_LOCK_SECONDS` | `900` | 临时锁定秒数 |
| `LA_BOOTSTRAP_ADMIN_ACCOUNT` | 空 | 首次启动管理员账号 |
| `LA_BOOTSTRAP_ADMIN_PASSWORD` | 空 | 首次启动管理员口令，不得提交真实值 |
| `LA_MANUAL_STORAGE_ROOT` | `run/manuals` | 原始 PDF 手册目录 |
| `LA_MANUAL_MAX_BYTES` | `52428800` | 单手册上限 |
| `LA_JOB_CARD_STORAGE_ROOT` | `run/job-cards` | 不可变 PDF 作业卡目录 |
| `LA_EXPORT_STORAGE_ROOT` | `run/exports` | 经过滤和去敏的审计导出目录 |
| `LA_PLATFORM_BACKUP_ROOT` | `run/platform-backups` | SQLite 与运行资产整包备份目录 |
| `LA_CASE_AUTHORING_ROOT` | `run/case-authoring` | 不可变案例 release 和运行时 active registry |
| `FRONTEND_DIST_PATH` | `frontend/dist` | React 构建目录 |
| `READINESS_REQUIRES_FRONTEND` | 生产为 `true` | ready 是否要求首页存在 |
| `TRUST_PROXY_HEADERS` | `false` | 只在可信 Nginx 前置时启用 |
| `CORS_ALLOWED_ORIGINS` | 开发为 `*` | 生产默认同源；跨域时填明确来源列表 |
| `LOG_LEVEL` | `INFO` | Python/Gunicorn 日志等级 |
| `JSON_ACCESS_LOG` | `true` | 应用访问日志 |
| `GUNICORN_WORKERS` | `1` | 进程数 |
| `GUNICORN_THREADS` | `8` | 每进程线程数 |
| `GUNICORN_TIMEOUT` | `60` | 请求超时秒数 |
| `GUNICORN_MAX_REQUESTS` | `2000` | worker 周期性重启阈值 |

数据库和附件路径相对仓库根目录解析。非法端口、布尔值、环境名和日志等级会在应用启动前失败。

首次生产部署先在 `/etc/la-case-platform/platform.env` 临时配置 bootstrap 管理员。登录并创建正式管理员后，删除这两个环境变量并重启服务。应用只保存密码哈希，preflight 和日志不会输出口令。

## 5. 为什么默认单 worker

新版 CaseRun、事件和快照都存储于 SQLite，可以承受多个进程的串行写入；但旧演示兼容接口仍保留少量进程内状态。为了确保已经录制的演示流程在部署环境中保持确定性，生产默认采用：

```text
1 Gunicorn worker × 8 threads
```

后续旧接口全部迁入 SQLite 后，可在压测和龙芯验证通过的前提下增加 worker。

## 6. systemd 安装

以下命令需要管理员根据目标机器路径执行：

```bash
sudo useradd --system --home /opt/la-case-platform --shell /sbin/nologin la-platform
sudo mkdir -p /opt/la-case-platform /etc/la-case-platform
sudo cp -a . /opt/la-case-platform/
sudo cp deploy/env/production.env.example /etc/la-case-platform/platform.env
sudo chown -R root:root /opt/la-case-platform
sudo mkdir -p /opt/la-case-platform/run /opt/la-case-platform/logs
sudo chown -R la-platform:la-platform /opt/la-case-platform/run /opt/la-case-platform/logs
sudo cp deploy/systemd/la-case-platform.service /etc/systemd/system/
sudo cp deploy/systemd/la-knowledge-ingestion-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now la-case-platform
sudo systemctl enable --now la-knowledge-ingestion-worker
sudo systemctl status la-case-platform
sudo systemctl status la-knowledge-ingestion-worker
```

unit 使用 `NoNewPrivileges`、`ProtectSystem=strict`、`PrivateTmp` 等限制，并只授权写入 `run/` 和 `logs/`。

HTTP 服务负责创建入库任务，worker 从 SQLite 持久队列领取 PDF。单机默认只运行一个 worker；进程重启后，过期租约对应的项目会重新进入领取流程。

## 7. Nginx（可选）

```bash
sudo cp deploy/nginx/la-case-platform.conf /etc/nginx/conf.d/
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 监听 80，Gunicorn 只监听 `127.0.0.1:8080`。`/assets/` 使用带 immutable 的七天缓存；API 和页面请求代理到 Gunicorn。

只有请求确定经过本机可信 Nginx 时才设置 `TRUST_PROXY_HEADERS=true`。生产环境默认不返回通配 CORS；需要跨域时使用逗号分隔的明确来源。

## 8. 龙芯脚本

```bash
bash deploy/loongarch/scripts/check-env.sh
bash deploy/loongarch/scripts/install.sh
bash deploy/loongarch/scripts/preflight.sh
bash deploy/loongarch/scripts/start.sh
bash deploy/loongarch/scripts/healthcheck.sh
```

这些脚本不批量终止 Python 进程，只操作 `run/la-mvp.pid` 记录的 Gunicorn master。

## 9. 备份与恢复

在线一致性备份：

```bash
bash deploy/loongarch/scripts/backup.sh
```

脚本调用 Python `sqlite3.Connection.backup()`，随后执行 `PRAGMA integrity_check` 并生成 `.sha256`。

包含 SQLite、附件、原始手册和作业卡 PDF 的完整资产归档：

```bash
backend/.venv/bin/python -m backend.operations_cli backup
```

数据一致性巡检与审计导出：

```bash
backend/.venv/bin/python -m backend.operations_cli integrity
backend/.venv/bin/python -m backend.operations_cli audit-export --format csv
```

恢复必须先停止服务：

```bash
bash deploy/loongarch/scripts/stop.sh
bash deploy/loongarch/scripts/restore.sh \
  run/backups/presentation-<timestamp>.db \
  run/backups/presentation-<timestamp>.db.sha256
bash deploy/loongarch/scripts/start.sh
```

恢复前会再次校验 SHA-256 和 SQLite 完整性，并把当前数据库备份到 `run/backups/pre-restore/`。

## 10. 升级和回滚

升级：

1. 记录当前提交和 `VERSION`；
2. 执行一致性备份；
3. 停止服务；
4. 解压到新目录，不覆盖旧目录；
5. 复制或明确指向原 `run/` 数据；
6. 执行 `preflight.sh`，自动应用有序迁移；
7. 启动并检查 ready、案例目录和首页；
8. 验收后再切换 Nginx 或端口。

回滚代码时不要直接回滚已迁移数据库。优先切回旧目录并恢复升级前备份。

## 11. 故障排查

| 现象 | 检查 |
| --- | --- |
| live 失败 | Gunicorn master、日志、端口 |
| live 成功但 ready 503 | ready JSON 中 database/caseRegistry/frontend/storage |
| 页面 404 | `frontend/dist/index.html` 与 `FRONTEND_DIST_PATH` |
| 上传 413 | Nginx `client_max_body_size`、附件或手册大小配置 |
| 管理 API 返回 401 | Bearer token 是否过期/撤销，`LA_AUTH_MODE` 是否为 enforced |
| 手册检索无结果 | `manual_chunks_fts`、PDF 是否有文本层、reindex 接口 |
| PDF 下载校验失败 | `run/job-cards` 文件是否被外部修改、数据库保存的 SHA-256 |
| SQLite locked | 是否误设多个 worker、是否存在长事务 |
| systemd 无写权限 | `ReadWritePaths`、run/logs 所有者 |
| 案例不出现在目录 | registry、Schema、引用和 `loadErrors` |
| 指标没有业务路径 | 先请求业务 API，再访问 `/api/metrics` |

## 12. 当前边界

- 当前是可恢复的单机部署，不宣称集群高可用；
- Nginx TLS 证书由目标环境提供，本仓库不提交私钥；
- 工业网关和远程诊断客户端仍由部署环境注入；
- systemd 和 Nginx 最终语法必须在银河麒麟目标机复核；
- 龙芯兼容结论必须来自真实 `loongarch64` 验收记录。
