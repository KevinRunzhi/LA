# 竞赛提交版平台运营与知识工程增强 Spec

## 1. 目标

本阶段承接已实现的身份、手册、图谱、工单和 PDF 服务，将它们进一步连接为可运营、可批处理、可检索、可备份的平台能力。新增代码必须具有真实入口、持久化状态和失败处理，不增加无消费者的中间件。

```text
真实管理页面
  → 批量资料入库任务
  → 多来源统一证据检索
  → 审计导出与运行资产治理
```

## 2. 实施与验证边界

- 分支：`submission/competition-platform`；
- 不修改稳定演示 worktree；
- 继续使用 Flask、React、SQLite、systemd 和本地文件存储；
- 不引入 Redis、Celery、Elasticsearch、Neo4j；
- 后台任务使用 SQLite 持久队列和独立 worker；
- 每阶段仅运行新增模块编译、对应测试或单接口冒烟，不运行全量测试；
- 已录制页面保持兼容，新页面在存在平台会话时使用真实 API。

## 3. 阶段一：现有页面接入

### 3.1 用户管理

`AdminUserPortal` 在检测到平台 Bearer 会话时：

- 从 `/admin/users` 读取用户；
- 新建用户调用真实创建接口；
- 编辑姓名、角色、状态和 profile；
- 重置密码调用真实密码接口；
- 401 时清理会话并明确提示；
- 无平台会话时保留现有演示数据，页面标记为“演示兼容数据”。

前端字段映射由单独 adapter 完成，避免页面直接依赖数据库字段。

### 3.2 知识库、图谱和工单

增加“平台数据中心”页面，提供四个真实数据区：

1. 已索引手册、页数、chunk 数和检索入口；
2. 当前图谱版本、节点/关系数、变更集状态；
3. 工单及 PDF 作业卡版本；
4. 系统能力和审计摘要。

页面只负责读取与触发已有 API，不复制业务规则。

### 3.3 验收

- 有会话时能够显示真实 API 数据；
- 无会话时不破坏录制页面；
- mutation 成功后重新读取服务端结果；
- 错误提示包含稳定 error code 或 request ID。

## 4. 阶段二：批量资料入库任务

### 4.1 数据模型

#### `knowledge_ingestion_jobs`

- job ID、来源目录、状态；
- discovered/imported/skipped/failed 数量；
- options JSON、error summary；
- 创建人、创建/开始/完成时间；
- cancel requested。

#### `knowledge_ingestion_items`

- item ID、job ID、相对路径、文件 SHA-256；
- pending/running/imported/skipped/failed；
- document ID、attempt、错误码和说明；
- 开始、完成时间；
- `UNIQUE(job_id, relative_path)`。

### 4.2 创建任务

- 只允许扫描配置白名单根目录，默认仓库 `Info/`；
- 拒绝绝对越界、符号链接和非 PDF；
- 创建任务时只发现文件并持久化 item，不在 HTTP 请求中解析全部 PDF；
- 相同文件 hash 已入库则 item 标记 skipped；
- 支持 dry-run。

### 4.3 Worker

```text
claim oldest pending item
→ transaction 标记 running
→ 调用 ManualKnowledgeService
→ imported / skipped / failed
→ 聚合 job 计数
→ 无待处理项后 completed / completed_with_errors
```

- 使用 `BEGIN IMMEDIATE` 保证单 item claim；
- worker 崩溃后，超过 lease 时间的 running item 可重新领取；
- 单项最多三次；
- 支持 `--once`、`--job-id` 和轮询模式；
- systemd 提供独立 worker unit。

### 4.4 API

```text
GET  /api/platform/ingestion/jobs
POST /api/platform/ingestion/jobs
GET  /api/platform/ingestion/jobs/{jobId}
POST /api/platform/ingestion/jobs/{jobId}/retry
POST /api/platform/ingestion/jobs/{jobId}/cancel
```

## 5. 阶段三：统一知识检索编排

### 5.1 来源

| provider | 内容 |
| --- | --- |
| manual | PDF 手册 chunk 和页码 |
| case | CasePackage assistant claims |
| graph | 当前发布图谱节点和关系 |
| field | CaseRun intake、步骤执行、记录和专家审核 |

### 5.2 检索流程

```text
问题规范化
→ 解析 scope（case/run/step/fault domain）
→ 并行调用可用 provider
→ 转换统一 EvidenceItem
→ hash 去重
→ 来源权重 + 词项覆盖 + scope 匹配评分
→ 每个来源配额
→ 返回证据、解释和 provider diagnostics
```

统一证据合同：

```json
{
  "id": "stable evidence id",
  "provider": "manual",
  "title": "证据标题",
  "excerpt": "证据内容",
  "score": 0.86,
  "citation": {"type": "manual_page", "documentId": "...", "page": 12},
  "metadata": {}
}
```

### 5.3 可追溯性

`knowledge_search_runs` 保存 query hash、scope、provider 统计、耗时、结果 ID 和 actor，不保存会话令牌。支持按 request ID 查询最近检索记录。

### 5.4 API

```text
POST /api/platform/knowledge/search
GET  /api/platform/knowledge/search-runs
GET  /api/platform/knowledge/search-runs/{searchRunId}
```

## 6. 阶段四：运行数据治理

### 6.1 一致性巡检

巡检内容：

- SQLite integrity 和 foreign key；
- schema migration checksum；
- 附件、手册和 PDF 文件存在；
- 数据库 SHA-256 与文件一致；
- FTS chunk 数量一致；
- 图谱版本 hash 与 snapshot 一致；
- 作业卡 content/pdf hash；
- 孤立文件和未引用文件。

结果保存到 `data_integrity_runs` 和 `data_integrity_findings`。

### 6.2 资产备份

备份集合：

- SQLite 在线一致性副本；
- attachments、manuals、job-cards；
- manifest JSON；
- 每个文件 SHA-256；
- 总归档 SHA-256。

生成 `.tar.gz` 前先构建临时目录，不修改源资产。恢复继续采用显式运维命令，不从 HTTP 自动覆盖现有数据。

### 6.3 审计导出

- JSONL 和 CSV；
- 可按时间、actor、action、resource 过滤；
- 导出文件进入受限目录；
- manifest 保存过滤条件、记录数和 SHA-256；
- 不导出口令、token hash 或 password hash。

### 6.4 API 与 CLI

```text
POST /api/platform/operations/integrity-runs
GET  /api/platform/operations/integrity-runs
GET  /api/platform/operations/integrity-runs/{runId}
POST /api/platform/operations/audit-exports
GET  /api/platform/operations/audit-exports/{exportId}/download

python -m backend.operations_cli integrity
python -m backend.operations_cli backup
python -m backend.operations_cli audit-export
```

完整运行资产备份只通过 CLI 执行，避免长时间 HTTP 请求。

## 7. 数据库迁移

迁移 `004` 创建：

- `knowledge_ingestion_jobs`；
- `knowledge_ingestion_items`；
- `knowledge_search_runs`；
- `data_integrity_runs`；
- `data_integrity_findings`；
- `audit_exports`。

迁移更新 canonical migration，preflight 校验新表存在。

## 8. 目录

```text
backend/platform_ops/
├── __init__.py
├── api.py
├── ingestion.py
├── search.py
└── operations.py

backend/ingestion_worker.py
backend/operations_cli.py

frontend/src/admin/platform-data/
├── PlatformDataCenter.jsx
└── platform-data-center.css
```

## 9. 分阶段局部验证

阶段一：

- Vite 对新增模块构建一次，或使用 Node 模块导入检查；
- 不运行后端全量测试。

阶段二：

- 临时目录放入有效、重复和损坏 PDF；
- 只运行 ingestion 对应测试；
- worker 使用 `--once`。

阶段三：

- 只运行 search provider 和排序测试；
- 验证四来源、去重、配额和 trace。

阶段四：

- 临时数据库和资产目录运行 integrity；
- 生成审计 CSV/JSONL 和资产 tar；
- 只运行 operations 对应测试。

## 10. 提交建议

1. `docs: specify platform operations and knowledge engineering`
2. `feat(ui): connect platform data center`
3. `feat(ingestion): add durable manual import jobs`
4. `feat(search): orchestrate multi-source evidence`
5. `feat(ops): add integrity audit export and asset backup`
