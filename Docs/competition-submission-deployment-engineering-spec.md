# 竞赛提交部署与工程化增强 Spec

> 分支：`submission/competition-platform`
> Worktree：`/home/kevin/projects/LA-submission`
> 基线：`01d7db4`
> 目标：让评审能够从源码确认系统具备真实的配置、启动、观测、备份、发布和持续验证链路。

## 1. 背景审查

当前仓库已经具备 React 页面、Flask API、模块化案例包、SQLite CaseRun、专家审核和知识图谱版本链路，但工程化部分仍存在以下缺口：

1. 稳定部署仍由 Flask 自带服务器直接启动；
2. `.env.example` 中的数据库、附件和服务参数没有统一配置对象承接；
3. 只有单一健康接口，不能区分进程存活和业务就绪；
4. 缺少请求 ID、结构化访问日志和可采集指标；
5. 龙芯脚本没有数据库一致性备份、恢复校验和部署前检查；
6. 缺少 systemd、Nginx 和 WSGI 生产配置；
7. 缺少统一工程命令和自动化 CI；
8. 缺少面向评审的部署拓扑、运行数据流和运维手册。

这些缺口会让业务功能看起来像“只能在开发机演示”。本阶段将补成可部署的单机工程方案。

## 2. 决策与边界

### 2.1 双部署路径

| 路径 | 用途 | 组成 |
| --- | --- | --- |
| 龙芯稳定部署 | 比赛现场、断网环境、`loongarch64` | 预构建前端 + Gunicorn + Flask + SQLite + systemd，可选 Nginx |
| WSL/评审快速运行 | 源码检查和本机验收 | Python venv + Gunicorn/Flask + Vite 构建 |

根据现有龙芯冻结决策，本阶段不把 Docker 作为龙芯必需条件，也不依赖容器镜像对 `loongarch64` 的支持。

### 2.2 不做虚假基础设施

- 不添加没有消费者的 Kafka、Redis、Neo4j 或 Kubernetes 清单；
- 不把单机 SQLite 描述成分布式数据库；
- 不伪造云端监控、真实 PLC 或大模型调用成功；
- 所有新增脚本必须能执行检查或实际操作；
- 所有配置必须被应用代码或部署入口读取。

## 3. 目标架构

```text
Browser
   │ HTTP
   ▼
Nginx（可选，静态缓存、请求大小、反向代理）
   │ 127.0.0.1:8080
   ▼
Gunicorn（单 worker + 多线程，保持旧演示内存状态一致）
   │
   ▼
Flask Application Factory
   ├── legacy presentation API
   ├── /api/platform CaseRun API
   ├── liveness / readiness
   ├── Prometheus text metrics
   └── request-id + JSON access log
         │
         ├── modular CasePackage JSON
         ├── SQLite presentation/case platform database
         ├── local attachment store
         └── original manual PDFs
```

## 4. 实施范围

### A. 运行配置

新增 `backend/runtime/config.py`：

- 从环境变量读取 host、port、数据库、附件目录、附件上限、日志级别；
- 路径统一相对于仓库根目录解析；
- 对整数、布尔值、日志等级和部署模式做校验；
- 提供去敏后的公开配置摘要；
- `create_app()` 接受显式配置覆盖，测试仍可使用临时数据库。

### B. 可观测性

新增 `backend/runtime/observability.py`：

- 为每个请求接收或生成 `X-Request-ID`；
- 输出一行 JSON 访问日志；
- 记录请求数、状态码、延迟总量和当前处理中请求；
- 动态路径归一化，避免 runId/knowledgeId 造成指标高基数；
- 提供 Prometheus 文本格式指标。

新增接口：

```text
GET /api/health/live
GET /api/health/ready
GET /api/metrics
```

就绪检查至少验证：

- SQLite 可连接并执行查询；
- schema migration 已存在；
- 案例注册表至少存在一个可运行案例；
- 生产模式下 `frontend/dist/index.html` 存在；
- 附件目录可创建、可写。

### C. WSGI 与进程管理

新增：

- `backend/wsgi.py`：生产 WSGI 入口；
- `deploy/gunicorn.conf.py`：单 worker、多线程、超时、日志和临时目录配置；
- `deploy/systemd/la-case-platform.service`：服务用户、工作目录、环境文件、重启策略和安全加固；
- `deploy/nginx/la-case-platform.conf`：反向代理、静态缓存、上传大小和请求 ID 透传。

### D. 龙芯部署脚本

增强现有脚本：

- `check-env.sh`：检查 Gunicorn、写权限、案例包、磁盘空间和环境文件；
- `install.sh`：创建 venv、安装锁定依赖、构建运行目录；
- `start.sh`：默认以 Gunicorn 启动，开发服务器仅作为明确回退；
- `healthcheck.sh`：分别验证 live、ready、首页和案例目录；
- `backup.sh`：使用 SQLite backup API 生成一致性备份与 SHA-256；
- `restore.sh`：停止服务前提、校验摘要、备份当前库、原子恢复；
- `preflight.sh`：部署前运行配置、Schema、迁移、前端和目录检查。

### E. 工程命令与 CI

新增根目录 `Makefile`：

```text
make install
make build
make test
make check
make run
make preflight
make backup
```

新增 GitHub Actions：

- 固定 Node `20.19.4`；
- Python 3.10/3.12 矩阵；
- `npm ci` 和生产构建；
- Python 全量测试、compileall；
- Shell `bash -n`；
- 部署 preflight 的无服务检查；
- 上传前端构建产物和测试结果摘要。

CI 只验证仓库真实能力，不发布到不存在的生产环境。

### F. 文档与评审导航

新增：

- 部署拓扑和端口说明；
- 配置字典；
- 一键部署、升级、回滚、备份恢复流程；
- 故障排查表；
- 评审建议阅读顺序；
- 功能矩阵同步。

## 5. 数据与安全约束

- SQLite 运行库、附件、日志、PID 和备份不进入 Git；
- 环境文件只提交 `.example`；
- Nginx 和 Flask 限制上传大小；
- systemd 使用专用用户、`NoNewPrivileges` 和受限写目录；
- 日志不输出 API Key、Token、请求正文和附件内容；
- 备份通过 SQLite backup API 生成，不在服务运行时直接复制数据库文件；
- 恢复前必须校验 SHA-256 并保留恢复前快照。

## 6. 验收标准

### 自动验收

- 后端全量测试通过；
- Python compileall 通过；
- React 生产构建通过；
- 所有 Shell 脚本 `bash -n` 通过；
- Gunicorn 配置可被 Python 加载；
- systemd unit 可通过静态语法检查（目标环境有 systemd 时）；
- Nginx 配置可通过静态检查（目标环境有 Nginx 时）；
- preflight 在 WSL 临时运行目录通过；
- `git diff --check` 通过。

### 行为验收

- live 在进程可服务时返回 200；
- ready 能报告数据库、案例、前端和附件状态；
- 每个响应包含 `X-Request-ID`；
- metrics 能看到健康检查和平台请求计数；
- Gunicorn 启动后首页与 `/api/platform/cases` 可访问；
- 备份文件可通过摘要校验和 SQLite 完整性检查；
- 非法配置在启动前明确失败。

## 7. 交付顺序

1. 配置与可观测性；
2. WSGI、Gunicorn、systemd、Nginx；
3. 龙芯 preflight、启动、备份恢复；
4. Makefile 与 CI；
5. 文档、功能矩阵和 README；
6. 全量验证与独立提交。
