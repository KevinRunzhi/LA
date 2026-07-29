# 竞赛提交源码功能矩阵

> 本表用于让评审快速区分已实现代码、可替换适配器和后续计划，不把接口预留写成已上线能力。

| 能力 | 状态 | 代码入口 | 当前边界 |
| --- | --- | --- | --- |
| 模块化案例包 | `implemented` | `backend/data/cases/` | 已有散热、供电平台合同 |
| JSON Schema | `implemented` | `backend/data/cases/schemas/` | Draft 2020-12 |
| 路径与引用校验 | `implemented` | `backend/case_package.py` | 拒绝越界、符号链接、断裂引用 |
| 案例内容哈希 | `implemented` | `backend/case_package.py` | SHA-256 固化到 CaseRun |
| 服务端案例路由 | `implemented` | `backend/case_platform/routing.py` | 规则路由，不声称开放式 AI 理解 |
| 路由解释 | `implemented` | `backend/case_platform/contracts.py` | 返回命中、否定、排除和缺失事实 |
| SQLite 版本迁移 | `implemented` | `backend/case_platform/migrations.py` | 有序、备份、事务、checksum |
| CaseRun 状态机 | `implemented` | `backend/case_platform/case_runs.py` | 角色和状态均由后端校验 |
| revision 冲突 | `implemented` | `backend/case_platform/case_runs.py` | 过期写返回 409 |
| 幂等写入 | `implemented` | `backend/case_platform/case_runs.py` | 同键同请求重放；不同请求冲突 |
| 运行事件日志 | `implemented` | `case_run_events` | 保存状态、revision、角色和摘要 |
| 检修计划快照 | `implemented` | `plan/confirm` API | 向导读取固化版本 |
| 步骤执行校验 | `implemented` | `guide/steps/*/complete` API | 必需检查和测量由后端校验 |
| 动态记录字段 | `implemented` | `records/generate` API、`job_card_snapshots` | 从当前案例 output 模块读取并固化 |
| 工程师提交 | `implemented` | `engineer-submit` API、`engineer_submission_snapshots` | 依赖已生成检修记录，按 revision 保存不可变提交历史，支持驳回后重提 |
| 专家审核与返工 | `implemented` | `expert/review/*`、`engineer-rework/start`、审核快照表 | 驳回后返回工程师执行态，多轮审核人与可信级别均可追溯 |
| 知识版本发布 | `implemented` | `backend/case_platform/knowledge.py` | 与 run/case/hash 绑定 |
| 图谱版本增量 | `implemented` | `case_graph_version_deltas` | 与知识版本绑定 |
| 可信度保护 | `implemented` | `knowledge.py` | 无现场证据不得升级 verified_case |
| 工程师知识同步 | `implemented` | `knowledge/*/sync` API | 按 engineer + knowledge 隔离 |
| 本地规则诊断 | `implemented` | `RuleBasedDiagnosisProvider` | 读取案例诊断模块 |
| 工程师提交事实遥测 | `implemented` | `telemetry/resolve` API、`SubmittedFactsTelemetryProvider` | 返回值、缺失字段和事实来源；不声称连接真实 PLC/网关 |
| 案例 claim 检索 | `implemented` | `assistant/search` API、`CatalogKnowledgeSearchProvider` | 按当前步骤允许 claim 裁剪并返回证据引用 |
| 本地附件存储 | `implemented` | `attachments` API、`LocalAttachmentStore`、`case_run_attachments` | multipart 上传、20 MiB 限制、SHA-256、失败补偿删除和事件登记 |
| Web 端平台会话 | `implemented` | `frontend/src/api/casePlatformClient.js`、`App.jsx` | 首页输入真实路由并创建 CaseRun，诊断入口推进 intake 与 diagnosis |
| 用户与会话 | `implemented` | `backend/core_business/auth.py`、`identityClient.js` | 密码哈希、令牌摘要、过期、撤销、锁定和 token version |
| 角色权限 | `implemented` | `core_business/api.py`、`LA_AUTH_MODE` | 新业务 API 强制鉴权，旧链路支持 compat/enforced 切换 |
| 业务审计 | `implemented` | `backend/core_business/audit.py` | 操作、资源、结果和 request ID 可查询，秘密字段递归去敏 |
| PDF 手册入库 | `implemented` | `backend/core_business/manuals.py` | 文件校验、SHA-256 去重、按页提取、分块和失败补偿 |
| 手册证据检索 | `implemented` | `manual_chunks_fts`、`manualKnowledgeClient.js` | SQLite FTS5 与中文规范化回退，返回页码和证据引用 |
| 图谱变更治理 | `implemented` | `backend/core_business/graph.py` | 草稿、提交、审核、驳回、批准、发布和 base version 冲突 |
| 全量图谱版本 | `implemented` | `graph_versions` | 不可变快照、SHA-256、局部子图和版本 diff |
| 检修工单 | `implemented` | `backend/core_business/work_orders.py` | CaseRun 绑定、唯一编号、状态机和 revision 乐观锁 |
| 服务端 PDF 作业卡 | `implemented` | `backend/core_business/pdf.py` | 固化 CaseRun 数据、中文 PDF、多版本、hash 校验和下载 |
| 平台数据中心 | `implemented` | `frontend/src/admin/platform-data/` | 有平台会话时读取真实手册、图谱、工单、入库与巡检接口；无会话兼容录制入口 |
| 持久化资料批量入库 | `implemented` | `backend/platform_ops/ingestion.py`、`ingestion_worker.py` | 白名单目录、PDF 发现、SHA-256 去重、租约领取、失败重试和任务统计 |
| 多来源统一证据检索 | `implemented` | `backend/platform_ops/search.py` | 统一编排手册、案例 claim、图谱和现场运行，按来源配额去重排序 |
| 检索过程追溯 | `implemented` | `knowledge_search_runs` | 保存 query hash、scope、来源统计、结果 ID、耗时和调用者 |
| 运行数据一致性巡检 | `implemented` | `backend/platform_ops/operations.py` | SQLite、外键、FTS、图谱摘要和运行资产文件/hash 检查 |
| 审计导出 | `implemented` | `operations.py`、`operations_cli.py` | 过滤后导出 CSV/JSONL，秘密字段去敏，保存 SHA-256 并校验下载 |
| 完整运行资产备份 | `implemented` | `operations_cli.py backup` | SQLite 在线副本、附件/手册/作业卡、manifest 和 tar.gz 归档 |
| 资料入库 worker | `adapter_ready` | `deploy/systemd/la-knowledge-ingestion-worker.service` | SQLite 持久队列，目标机安装后作为独立 systemd 服务持续消费 |
| 案例八模块草稿 | `implemented` | `backend/case_authoring/service.py` | registry、manifest 与六个 Agent 模块按 revision 持久化 |
| 案例生产校验 | `implemented` | `CaseAuthoringService.validate` | 复用生产 CasePackageRegistry 执行 Schema、跨模块引用和摘要校验 |
| 案例审核与发布 | `implemented` | `backend/case_authoring/` | 校验后提交、专家批准/驳回、不可变 release、历史版本激活 |
| Agent 动态案例源 | `implemented` | `case_authoring/registry.py` | 内置案例与运行时发布包合并，运行时同 ID 版本优先 |
| 案例发布管理页面 | `implemented` | `frontend/src/admin/case-authoring/` | 克隆、八模块编辑、校验、提交、审核、发布、回滚和证据建议 |
| Agent 编制证据建议 | `implemented` | `case_agent_suggestions`、统一证据检索 | 保存建议和 EvidenceItem，不绕过专家审核自动发布 |
| 远程诊断客户端 | `adapter_ready` | `JsonHttpDiagnosisClient`、`RemoteModelDiagnosisProvider` | 环境变量可切换真实 HTTP JSON 调用并校验结果合同；未配置时启动失败 |
| 工业协议网关 | `adapter_ready` | `TelemetryProvider` Protocol | 需要部署侧具体实现 |
| 向量知识检索 | `adapter_ready` | `KnowledgeSearchProvider` Protocol | 当前使用结构化 claim 检索 |
| 对象存储 | `adapter_ready` | `AttachmentStore` Protocol | 当前使用本地持久化，可部署时替换为对象存储 |
| 统一运行配置 | `implemented` | `backend/runtime/config.py` | 环境变量解析、路径解析、范围校验和去敏摘要 |
| 运行能力清单 | `implemented` | `/api/platform/system/capabilities` | 返回当前提供方、持久化和知识闭环能力，不暴露密钥 |
| 存活与就绪检查 | `implemented` | `/api/health/live`、`/api/health/ready` | 就绪检查数据库、迁移、案例、附件和前端 |
| 请求追踪 | `implemented` | `backend/runtime/observability.py` | X-Request-ID、归一化路由和 JSON 访问日志 |
| Prometheus 指标 | `implemented` | `/api/metrics` | 请求数、耗时、处理中请求和运行时长 |
| WSGI 生产服务 | `implemented` | `backend/wsgi.py`、`deploy/gunicorn.conf.py` | 单 worker 多线程，保持旧演示确定性 |
| systemd 服务 | `adapter_ready` | `deploy/systemd/la-case-platform.service` | 具备重启策略和系统级安全限制，待目标机安装 |
| Nginx 反向代理 | `adapter_ready` | `deploy/nginx/la-case-platform.conf` | 静态缓存、上传限制和请求 ID，待目标机启用 |
| 部署 preflight | `implemented` | `backend/runtime/preflight.py`、`preflight.sh` | 真实加载案例、执行迁移、检查完整性和写权限 |
| SQLite 备份恢复 | `implemented` | `database_ops.py`、`backup.sh`、`restore.sh` | 在线一致性备份、SHA-256、完整性和恢复前快照 |
| 工程命令 | `implemented` | `Makefile` | 安装、构建、测试、检查、运行和备份统一入口 |
| 持续集成 | `implemented` | `.github/workflows/competition-platform-ci.yml` | Python 3.10/3.12、Node 20、构建、测试和 preflight |
| 真实图像识别 | `planned` | 前端仍使用人工确认标签 | 当前不声称真实识别 |
| 真实语音识别 | `planned` | 前端保留交互入口 | 当前不声称真实识别 |

## 评审建议阅读顺序

1. `backend/case_platform/api.py`；
2. `backend/case_platform/routing.py`；
3. `backend/case_platform/case_runs.py`；
4. `backend/case_platform/knowledge.py`；
5. `backend/case_package.py`；
6. `backend/openapi/case-platform.openapi.yaml`；
7. `backend/test_case_platform.py`。
8. `backend/runtime/`；
9. `deploy/`；
10. `.github/workflows/competition-platform-ci.yml`。
11. `backend/core_business/`；
12. `backend/test_core_business.py`。
13. `backend/platform_ops/`；
14. `backend/test_platform_ops.py`。
15. `backend/case_authoring/`；
16. `backend/test_case_authoring.py`。
