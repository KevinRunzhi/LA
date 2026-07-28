# 竞赛提交平台详细技术架构

## 1. 系统定位

LA 工业设备智能接诊系统面向油气场站工控设备检修。系统将现场异常输入转换为可执行的案例运行，通过步骤向导保存检查、测量和附件，形成工程师提交，经专家审核后发布为知识版本和知识图谱增量。

当前提交源码包含两个能够实际运行的案例合同：

- 工控机散热异常；
- 工控机供电异常。

案例数量可以通过新增同结构 CasePackage 扩展，平台代码不以某一具体案例作为默认答案。

## 2. Context 视图

```text
一线工程师
  ├── 提交异常描述、现场事实和附件
  ├── 执行检修向导
  └── 生成并提交检修记录

专家
  ├── 审核工程师提交
  ├── 驳回返工或批准
  └── 发布知识和图谱增量

管理员
  ├── 查看案例、手册、用户和系统状态
  └── 管理演示与基础资料

LA Case Platform
  ├── React Web
  ├── Flask Case API
  ├── CasePackage Registry
  ├── SQLite Runtime Store
  └── Local/Remote Provider Adapters
```

## 3. Container 视图

| 容器 | 技术 | 职责 |
| --- | --- | --- |
| Web UI | React 18、Vite 6 | 登录、接诊、诊断动画、检修向导、记录、专家审核、图谱 |
| HTTP API | Flask 3 | 业务合同、状态机、角色检查、健康与指标 |
| WSGI Server | Gunicorn gthread | 生产进程、并发线程、超时和优雅退出 |
| Reverse Proxy | Nginx（可选） | 静态缓存、上传限制、转发头和请求 ID |
| Runtime Store | SQLite | CaseRun、事件、幂等、快照、知识版本、同步状态 |
| Case Catalog | JSON + Draft 2020-12 Schema | 案例模块、路由规则、步骤、输出、知识候选 |
| Attachment Store | 本地受限目录 | 现场图片、测量和检修证据文件 |
| Manual Library | PDF + JSON catalog | 厂商手册、页码引用和知识证据 |

## 4. Web 前端分层

```text
App / role portals
  ├── presentation components
  ├── admin and knowledge graph pages
  ├── maintenance guide components
  ├── record and print components
  └── API clients
        ├── legacy presentationApi
        └── CasePlatformSession
```

`CasePlatformSession` 保存当前 `runId` 和 `revision`。首页输入先调用服务端路由，只有 `matched` 才创建 CaseRun；启动诊断时继续写入 intake 并推进状态。所有平台写入都携带 UUID 幂等键。

旧演示页面继续保留，是为了保持已录制视频的视觉节奏；新增平台 API 是业务状态的权威来源，不把 React state 视为最终事实。

## 5. 后端模块

### 5.1 案例包

```text
backend/data/cases/
├── case_registry.json
├── schemas/
└── CASE-*/
    ├── manifest.json
    ├── intake.json
    ├── diagnosis.json
    ├── guide.json
    ├── assistant.json
    ├── output.json
    └── feedback-and-graph.json
```

加载器检查：

- Registry 和模块 Schema；
- 案例 ID 唯一；
- 未知字段；
- 模块路径越界、绝对路径、`..` 和符号链接；
- step/check/topic/claim 引用；
- 手册 ID、页码、图谱节点和边；
- 案例内容 SHA-256。

非法案例失败关闭，不进入可运行目录。

### 5.2 确定性路由

```text
输入规范化
→ 单位转换
→ 型号/告警/症状/测量匹配
→ 否定识别
→ exclusion 硬排除
→ 分类加权
→ minScore 与 minMargin
→ matched / ambiguous / insufficient / unsupported
```

路由返回命中、否定、排除、缺失事实和候选分数，因此前端可以解释“为什么进入这个案例”，而不是只收到一个不透明 ID。

### 5.3 CaseRun

CaseRun 是一次独立检修执行：

```text
created
  → intake_confirmed
  → diagnosed
  → plan_confirmed
  → in_progress
  → engineer_submitted
  → expert_reviewing
  → approved ───────────→ published → synced
         └→ rejected → in_progress
```

每次写入：

- 校验当前状态；
- 校验角色；
- 校验 `expectedRevision`；
- 校验 UUID 幂等键；
- 在事务中更新 payload；
- 追加事件日志；
- 写入必要的不可变快照；
- 保存幂等响应。

### 5.4 记录与审核快照

| 快照 | 唯一维度 | 作用 |
| --- | --- | --- |
| resolved plan | CaseRun payload | 运行期间不受案例模板更新影响 |
| job card | run + revision | 保存每版作业卡输入 |
| engineer submission | run + revision | 支持专家驳回后的多次提交 |
| expert review | run + revision | 保存审核人、决定和可信等级 |
| knowledge publication | knowledge + version | 保存知识正文和图谱增量 |

## 6. 数据架构

```text
case_runs
  ├── case_run_events
  ├── case_run_idempotency
  ├── case_run_attachments
  ├── job_card_snapshots
  ├── engineer_submission_snapshots
  ├── expert_review_snapshots
  ├── case_knowledge_versions
  │     └── case_graph_version_deltas
  └── engineer_case_sync
```

SQLite 的选择符合当前比赛单机、断网、轻依赖和龙芯部署边界。应用使用显式事务、外键、唯一约束、revision 和 `BEGIN IMMEDIATE` 控制一致性。

迁移机制包含：

- 版本号和名称；
- SQL 内容 checksum；
- 执行前数据库备份；
- 单事务执行；
- 表、外键和业务结构验证；
- 已执行迁移内容变化时拒绝启动。

## 7. 知识和图谱闭环

```text
工程师执行与测量
→ 作业卡
→ 工程师提交快照
→ 专家审核
→ knowledge proposal
→ immutable knowledge version
→ graph version delta
→ engineer sync status
```

知识和图谱在同一事务发布。`verified_case` 必须绑定现场证据 ID；没有证据时保留 `synthetic_demo`，防止演示数据被错误升级为真实核验案例。

## 8. 提供方架构

```text
DiagnosisProvider
  ├── RuleBasedDiagnosisProvider
  └── RemoteModelDiagnosisProvider
        └── JsonHttpDiagnosisClient

TelemetryProvider
  └── SubmittedFactsTelemetryProvider

KnowledgeSearchProvider
  └── CatalogKnowledgeSearchProvider

AttachmentStore
  └── LocalAttachmentStore
```

运行配置可以选择 `rule-based` 或 `remote-http` 诊断。远程 HTTP 客户端真实发送 JSON、支持 Bearer Token、处理网络/HTTP/JSON 错误，并由远程适配器校验诊断字段合同。

遥测当前明确使用工程师提交事实，不伪装已连接 PLC。部署侧实现工业协议提供方后可替换 Protocol。

## 9. API 架构

接口分为：

- 目录与路由；
- CaseRun 读取与事件；
- intake、diagnosis、plan、guide；
- 记录、附件与工程师提交；
- 专家审核与返工；
- 知识发布与工程师同步；
- live、ready 和 metrics。

合同以 `backend/openapi/case-platform.openapi.yaml` 为阅读入口。成功响应使用 `{ok,data}`，失败响应使用稳定错误码、消息和 details。

## 10. 并发、幂等与故障恢复

### 10.1 并发

- HTTP 使用 Gunicorn gthread；
- 默认单 worker 保持旧演示接口确定性；
- SQLite 写事务串行化；
- 过期 revision 返回 409；
- 附件使用 UUID storage key，避免文件名冲突。

### 10.2 幂等

- 每个关键业务写入携带 UUID；
- 同键同请求返回首次结果；
- 同键不同请求返回冲突；
- 幂等响应与业务写入位于同一事务。

### 10.3 恢复

- 进程崩溃不会丢失已提交事务；
- Gunicorn/systemd 自动重启；
- preflight 在启动前执行迁移和完整性检查；
- backup API 生成一致性副本；
- restore 校验摘要和完整性，并保留恢复前副本。

## 11. 可观测性

每个请求：

1. 接收或生成 `X-Request-ID`；
2. 增加 in-flight；
3. 执行业务；
4. 记录状态和耗时；
5. 输出 JSON 访问日志；
6. 在响应中返回 request ID。

指标使用 Flask route rule，而不是具体 runId，避免高基数：

```text
la_service_info
la_service_uptime_seconds
la_http_requests_in_flight
la_http_requests_total
la_http_request_duration_seconds_total
```

## 12. 健康模型

| 接口 | 含义 |
| --- | --- |
| `/api/health/live` | WSGI 进程能响应 |
| `/api/health/ready` | 数据库、迁移、案例、附件和生产前端可用 |
| `/api/health` | 向后兼容的简要健康信息 |

编排或 systemd 不应只依赖首页 200；ready 的结构化 checks 才是启动验收依据。

## 13. 部署架构

```text
Client :80
   │
   ▼
Nginx
   ├── /assets → immutable static cache
   └── /*      → request-id + proxy
                    │
                    ▼
             Gunicorn :8080
                    │
                    ▼
             Flask application
                    │
           ┌────────┴────────┐
           ▼                 ▼
      run/data/*.db     run/attachments
```

systemd 将源码设为只读，仅允许 `run/` 和 `logs/` 写入。Nginx 与 systemd 均为可安装部署合同；不假定评审机或龙芯机已经安装。

## 14. 安全边界

- 环境文件不进入 Git；
- API Key 不进入日志和公开配置摘要；
- 生产默认同源，不返回通配 CORS；
- 只在可信反向代理前启用 forwarded headers；
- systemd 启用 `NoNewPrivileges` 和系统目录保护；
- Nginx 与 Flask 双层限制上传大小；
- 附件路径限制在存储根目录；
- 手册路径限制在 Info 资料目录；
- 响应增加 `nosniff` 和 Referrer Policy。

## 15. 持续集成

CI 包含：

```text
Python 3.10 ─┐
             ├─ compileall + 32 tests
Python 3.12 ─┘

Node 20.19.4
  └─ npm ci + Vite production build

Deployment contract
  ├─ Shell syntax
  ├─ Gunicorn config compile
  ├─ production preflight
  └─ frontend artifact
```

## 16. 扩展路径

新增故障案例优先新增 CasePackage，不复制平台状态机。新增外部能力优先实现 Provider，不改写业务流程。规模超过单机边界时，迁移顺序建议为：

1. 将旧演示内存状态全部迁入 SQLite；
2. 压测后增加 Gunicorn workers；
3. 把 AttachmentStore 替换为对象存储；
4. 把 SQLite Repository 替换为服务端数据库；
5. 在真实需求出现后再引入任务队列或独立检索服务。

这条路径保证当前代码既能用于比赛单机演示，也保留合理的工程演进方向。
