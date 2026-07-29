# 竞赛提交版核心业务增强 Spec

## 1. 文档目的

本文定义竞赛提交分支 `submission/competition-platform` 的下一阶段实现范围。目标不是增加重复页面或占位接口，而是提高核心业务代码占比，让评审能够从数据模型、领域服务、HTTP 合同、前端客户端、自动化测试和部署配置中完整追踪以下业务闭环：

```text
用户登录与授权
  → 手册进入知识库并形成可引用证据
  → 工程师创建并执行检修任务
  → 专家审核图谱变更
  → 发布可追溯知识图谱版本
  → 生成工单和服务端 PDF 作业卡
  → 全过程进入审计日志
```

本阶段不修改稳定演示 worktree，不把未来能力写成已经上线的能力，不引入 Redis、Kafka、Neo4j、容器编排等当前没有真实消费者的基础设施。

## 2. 当前基线与缺口

提交版已经具备 JSON Schema CasePackage、确定性案例路由、SQLite 迁移、CaseRun 状态机、revision、幂等写、附件、不可变快照、专家审核、知识版本、图谱增量、远程诊断适配器以及完整部署工程。

仍需补齐：

1. `actor` 主要来自请求体，缺少可验证身份、会话和后台权限；
2. 手册已有文件和目录信息，但缺少入库、切片、索引与页码级检索；
3. 图谱发布只有案例增量，缺少编辑草稿、审核、全局快照和版本差异；
4. 作业卡主要依赖浏览器打印，缺少后端工单、文档版本和 PDF 归档；
5. 管理操作缺少统一审计查询。

## 3. 设计原则

### 3.1 权威数据

- CaseRun、身份、会话、审计、手册索引、图谱版本、工单和文档均以 SQLite 为权威来源；
- JSON CasePackage 和厂商手册是只读内容来源；
- React state 只保存当前交互状态，不作为最终业务事实；
- PDF 来源是已经固化的作业卡快照，不直接读取易变化的页面 DOM。

### 3.2 离线与龙芯约束

- 使用 Flask、SQLite、Python 标准库和少量纯 Python 依赖；
- 全文检索优先 SQLite FTS5，中文查询使用规范化内容的确定性回退匹配；
- 不要求外部数据库、消息队列、对象存储或云端模型；
- PDF 使用服务端文档生成器和 PDF CID 中文字体映射；
- 所有运行目录由环境变量或 RuntimeSettings 解析。

### 3.3 兼容与安全

鉴权支持两种模式：

| 模式 | 行为 | 用途 |
| --- | --- | --- |
| `compat` | 新管理接口强制会话；旧 CaseRun 接口保留历史 actor 合同 | 保持录制版本兼容 |
| `enforced` | 除登录、公开目录、路由和健康接口外均要求 Bearer 会话 | 正式部署 |

密码只保存 Werkzeug 哈希。会话令牌只在登录成功时返回一次，数据库只保存 SHA-256 摘要。日志、能力清单和审计元数据不得记录口令或原始令牌。

## 4. 身份、权限与审计

### 4.1 数据模型

- `platform_users`：用户 ID、账号、姓名、角色、资料、密码哈希、状态、失败次数、锁定时间、token version；
- `auth_sessions`：会话 ID、用户、token hash、创建/过期/撤销/最后访问时间和客户端摘要；
- `audit_events`：request ID、actor、action、资源、结果、去敏元数据和时间。

### 4.2 业务规则

- 连续五次登录失败锁定十五分钟；
- disabled 用户不得登录，已有会话立即失效；
- 密码重置递增 token version，使旧会话失效；
- 管理员可创建、查询、启停用户和重置密码；
- 用户可以读取自己的身份并退出；
- 管理员可以分页过滤审计事件；
- 公开响应不包含 password hash、token hash 和内部登录计数。

### 4.3 API

```text
POST   /api/platform/auth/login
GET    /api/platform/auth/me
POST   /api/platform/auth/logout
GET    /api/platform/admin/users
POST   /api/platform/admin/users
PATCH  /api/platform/admin/users/{userId}
POST   /api/platform/admin/users/{userId}/password
GET    /api/platform/admin/audit-events
```

## 5. 手册导入、切片与检索

### 5.1 数据模型

- `manual_documents`：来源、标题、厂商、设备类型、故障领域、版本、文件 hash、页数和状态；
- `manual_chunks`：文档、页码、页内序号、原文、规范化文本和内容 hash；
- `manual_chunks_fts`：SQLite FTS5 全文索引。

### 5.2 导入流水线

```text
multipart PDF
  → MIME、扩展名、大小与 PDF 头校验
  → SHA-256 去重
  → 受限目录持久化
  → 按页提取文本
  → 按段落和最大字符数切片
  → 规范化与 chunk hash
  → SQLite 事务写文档、切片和 FTS
  → 返回导入报告
```

导入失败时删除孤立文件。加密且不可读取 PDF、零文本 PDF、重复文件和越界大小均返回稳定错误。

### 5.3 检索规则

- 输入长度限制与 Unicode 规范化；
- 优先 FTS5，中文分词无命中时参数化 `LIKE` 回退；
- 可按文档、厂商、设备类型和故障领域过滤；
- 返回标题、页码、片段、score、document hash 和证据引用；
- 同一文档同一页结果去重。

### 5.4 API

```text
GET    /api/platform/manuals
POST   /api/platform/manuals/import
GET    /api/platform/manuals/{documentId}
POST   /api/platform/manuals/search
DELETE /api/platform/manuals/{documentId}
POST   /api/platform/manuals/{documentId}/reindex
```

导入、删除和重建只允许专家或管理员；查询允许所有登录角色。

## 6. 知识图谱编辑、审核和版本

### 6.1 数据模型

- `graph_change_sets`：标题、说明、状态、base version、关联 CaseRun、创建人、审核人、发布版本；
- `graph_change_items`：`node | edge`、`upsert | delete`、entity ID 和 payload；
- `graph_versions`：递增 sequence、parent、全量 snapshot、SHA-256、发布者和时间。

### 6.2 图谱合同与约束

节点至少包含 `id/type/label/properties`；关系至少包含 `id/source/target/relation/properties`。

发布前检查：

- ID、实体类型和 payload 合法；
- edge 两端在发布后快照中存在；
- 不允许重复实体 ID；
- 删除有引用节点时必须同步删除或更新关系；
- base version 必须仍是当前版本；
- 只有创建者可编辑 draft/rejected；
- expert 可审核，expert 或 admin 可发布批准内容。

### 6.3 状态和查询

```text
draft → submitted → approved → published
                   └→ rejected → draft
```

支持当前全局图、中心节点局部子图、版本列表、版本快照、任意版本 diff 和“本次新增与修改”。

### 6.4 API

```text
GET    /api/platform/graph
GET    /api/platform/graph/subgraph
GET    /api/platform/graph/versions
GET    /api/platform/graph/versions/{versionId}
GET    /api/platform/graph/diff
GET    /api/platform/graph/change-sets
POST   /api/platform/graph/change-sets
GET    /api/platform/graph/change-sets/{changeSetId}
POST   /api/platform/graph/change-sets/{changeSetId}/items
POST   /api/platform/graph/change-sets/{changeSetId}/submit
POST   /api/platform/graph/change-sets/{changeSetId}/review
POST   /api/platform/graph/change-sets/{changeSetId}/publish
```

## 7. 工单和服务端 PDF

### 7.1 数据模型

- `maintenance_work_orders`：工单号、CaseRun、标题、摘要、优先级、状态、revision、负责人和计划时间；
- `job_card_documents`：文档版本、CaseRun revision、模板版本、payload hash、PDF 路径/hash/页数/字节和生成者。

### 7.2 业务规则

- 工单必须关联存在的 CaseRun，同一 CaseRun 只允许一个工单；
- 工单号为 `WO-YYYYMMDD-NNNN`，在事务中分配；
- 状态变化使用 revision 乐观锁；
- 作业卡从 CaseRun、步骤、维护记录、附件和审核快照汇总；
- 生成前固化 payload，相同内容 hash 幂等返回已有文档；
- PDF 包含基本信息、故障摘要、诊断、步骤结果、测量与附件摘要、工程师/专家结论、风险和签字栏；
- 下载前校验文件存在和 SHA-256；
- 历史 PDF 不因案例包或图谱更新而变化。

### 7.3 API

```text
GET    /api/platform/work-orders
POST   /api/platform/work-orders
GET    /api/platform/work-orders/{orderId}
PATCH  /api/platform/work-orders/{orderId}
POST   /api/platform/work-orders/{orderId}/job-cards
GET    /api/platform/work-orders/{orderId}/job-cards
GET    /api/platform/job-cards/{documentId}
GET    /api/platform/job-cards/{documentId}/download
```

## 8. 服务层结构

```text
backend/core_business/
├── __init__.py
├── api.py
├── audit.py
├── auth.py
├── database.py
├── manuals.py
├── graph.py
├── work_orders.py
└── pdf.py
```

- API 层只做 HTTP 解析、鉴权和响应投影；
- 服务层持有业务规则和事务；
- SQL 全部参数化；
- 新表由 `backend/case_platform/migrations.py` 创建；
- OpenAPI 是 HTTP 合同的权威文档。

## 9. 前端接入

新增 `identityClient.js`、`manualKnowledgeClient.js`、`graphLifecycleClient.js` 和 `workOrderClient.js`，统一 Bearer token、envelope、401/403/409/422、multipart 上传和 PDF blob 下载。本阶段优先完成客户端与数据接点，不重做已录制页面视觉设计。

## 10. 配置与 preflight

```text
LA_AUTH_MODE=compat
LA_SESSION_TTL_SECONDS=28800
LA_LOGIN_MAX_FAILURES=5
LA_LOGIN_LOCK_SECONDS=900
LA_BOOTSTRAP_ADMIN_ACCOUNT=
LA_BOOTSTRAP_ADMIN_PASSWORD=
LA_MANUAL_STORAGE_ROOT=run/manuals
LA_JOB_CARD_STORAGE_ROOT=run/job-cards
LA_MANUAL_MAX_BYTES=52428800
```

preflight 增加 FTS5、手册/PDF 目录写权限、核心业务表和 bootstrap 状态检查，但不得打印口令。

## 11. 测试与验收

自动化覆盖：

- 登录、错误锁定、禁用、令牌过期/撤销、三角色权限和审计去敏；
- PDF 导入、hash 去重、中文回退检索、页码证据、删除和重建；
- 图谱创建、提交、驳回、批准、发布、base 冲突、悬空关系、局部图和 diff；
- 工单编号、revision 冲突、CaseRun 汇总、PDF 头/摘要/下载和历史不可变；
- 从空库和 v2 数据库迁移、React build、Gunicorn check、preflight、OpenAPI 和打包。

最终验收场景：

```text
管理员登录
→ 创建工程师和专家
→ 专家上传检修手册
→ 工程师检索页码证据
→ 工程师执行 CaseRun 并创建工单
→ 工程师提交图谱变更
→ 专家批准并发布新图谱版本
→ 生成和下载 PDF 作业卡
→ 管理员查询全过程审计
```

验收成功的判定，是该场景能在临时 SQLite 数据库和临时文件目录中真实完成，而不是接口数量。

## 12. 分阶段提交

1. `docs: specify core business platform enhancement`
2. `feat: add identity authorization and audit services`
3. `feat: add manual ingestion and evidence search`
4. `feat: add governed knowledge graph versions`
5. `feat: add work orders and server-side job cards`
6. `docs: align platform contracts and deployment`

只有真实实现并通过验证的能力，才在功能矩阵中标记为 `implemented`。
