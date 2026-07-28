# 竞赛提交代码库增强 Spec

> 分支：`submission/competition-platform`
> Worktree：`/home/kevin/projects/LA-submission`
> 基线提交：`121bc74`
> 定位：面向竞赛评审阅读的完整工程代码，不替代已录制视频所使用的稳定演示版本

## 1. 目标

在保留现有 React 演示界面的基础上，把文档中已经设计的多案例、后端运行、专家审核和知识回流能力落实为可阅读、可扩展、具备真实合同的工程代码。

评审从源码应能够清楚看到：

- 前端如何调用后端，而不是只读取静态 JSON；
- 案例包如何经过 Schema 校验和安全加载；
- 首页输入如何路由到不同案例；
- 一次检修如何通过 `CaseRun`、revision 和事件记录保存；
- 写操作如何处理幂等重试与并发冲突；
- 专家审核、知识版本和图谱增量如何设计；
- 后续真实大模型、设备遥测、文件存储如何通过适配接口接入；
- 当前已实现、已预留和暂未接通的边界分别是什么。

## 2. 真实性原则

本分支不采用以下做法：

- 添加不会被调用的重复类和空函数凑代码量；
- 用固定成功返回伪装真实数据库事务；
- 把接口声明写成“已完成的真实 AI、RAG 或设备接入”；
- 删除错误处理、验证和基本检查来换取开发速度；
- 将构造数据标记为真实现场证据。

代码与文档统一使用三种状态：

| 状态 | 含义 |
| --- | --- |
| `implemented` | 已有真实代码路径并完成最小验证 |
| `adapter_ready` | 已定义稳定接口和本地实现，可替换为外部提供方 |
| `planned` | 只有明确设计，尚未实现，不在代码中伪造成功结果 |

## 3. 分支和交付边界

```text
/home/kevin/projects/LA
└── feature/industrial-computer-power-fault
    └── 稳定演示与后续正式阶段开发

/home/kevin/projects/LA-submission
└── submission/competition-platform
    └── 竞赛提交源码增强
```

两个 worktree 不共享未提交文件。竞赛分支不包含：

- `output/pdf/`；
- `output/submission/`；
- 数据库备份；
- 浏览器截图；
- 临时日志；
- 本机密钥或环境变量。

## 4. 代码结构

新增后端平台层：

```text
backend/
├── case_package.py
├── case_platform/
│   ├── contracts.py
│   ├── errors.py
│   ├── routing.py
│   ├── migrations.py
│   ├── case_runs.py
│   ├── knowledge.py
│   ├── providers.py
│   └── api.py
├── data/cases/
│   ├── case_registry.json
│   ├── schemas/
│   └── CASE-*/
└── openapi/
    └── case-platform.openapi.yaml

frontend/src/
└── api/
    └── casePlatformClient.js
```

职责：

- `contracts.py`：阶段、角色、状态、DTO 和版本合同；
- `errors.py`：稳定错误码和 HTTP 映射；
- `routing.py`：确定性输入规范化、否定识别、评分与解释；
- `migrations.py`：SQLite 有序迁移、备份、事务和校验；
- `case_runs.py`：运行创建、状态转换、revision、事件、幂等和快照；
- `knowledge.py`：审核、知识版本、图谱增量与同步服务边界；
- `providers.py`：大模型、遥测、附件存储和设备目录的可替换接口；
- `api.py`：Flask Blueprint 和按阶段裁剪的公开接口。
- `casePlatformClient.js`：Web 端请求合同、CasePlatformSession 与 revision 推进。

## 5. 第一批真实接口

```text
GET  /api/platform/cases
POST /api/platform/case-routing
POST /api/platform/case-runs
GET  /api/platform/case-runs/<run_id>
POST /api/platform/case-runs/<run_id>/intake/confirm
POST /api/platform/case-runs/<run_id>/diagnosis
POST /api/platform/case-runs/<run_id>/plan/confirm
POST /api/platform/case-runs/<run_id>/guide/start
POST /api/platform/case-runs/<run_id>/guide/steps/<step_id>/complete
POST /api/platform/case-runs/<run_id>/records/generate
POST /api/platform/case-runs/<run_id>/engineer-submit
POST /api/platform/case-runs/<run_id>/expert/review/start
POST /api/platform/case-runs/<run_id>/expert/review/decision
POST /api/platform/case-runs/<run_id>/engineer-rework/start
POST /api/platform/case-runs/<run_id>/knowledge/publish
POST /api/platform/case-runs/<run_id>/telemetry/resolve
POST /api/platform/case-runs/<run_id>/assistant/search
GET  /api/platform/case-runs/<run_id>/attachments
POST /api/platform/case-runs/<run_id>/attachments
POST /api/platform/case-runs/<run_id>/reset
```

正常接口不设置默认散热案例。缺少 `caseId`、`runId`、`expectedRevision` 或 `idempotencyKey` 时返回稳定错误。

## 6. CaseRun 状态

```text
created
→ intake_confirmed
→ diagnosed
→ plan_confirmed
→ in_progress
→ engineer_submitted
→ expert_reviewing
→ approved | rejected
→ published
→ synced
```

约束：

- 创建时 revision 为 1；
- 每次成功写入 revision 加 1；
- revision 过期返回 `409 state_conflict`；
- 相同幂等键和相同请求返回第一次结果；
- 相同幂等键和不同请求返回 `409 idempotency_conflict`；
- `rejected` 可返回 `in_progress`；
- 已发布快照不可覆盖。

## 7. 外部能力扩展点

第一版提供可运行的本地适配器和稳定 Protocol，不伪装外部系统已经接入：

```text
DiagnosisProvider
├── RuleBasedDiagnosisProvider       implemented
└── RemoteModelDiagnosisProvider     adapter_ready

TelemetryProvider
├── SubmittedFactsTelemetryProvider  implemented
└── IndustrialProtocolProvider       adapter_ready

AttachmentStore
├── LocalAttachmentStore             implemented
└── ObjectStorageAttachmentStore     adapter_ready

KnowledgeSearchProvider
├── CatalogKnowledgeSearchProvider   implemented
└── VectorKnowledgeSearchProvider    adapter_ready
```

远程诊断适配器在注入客户端后执行真实调用并校验返回合同；缺少配置时必须明确报 `provider_not_configured`，不能返回伪造结果。

## 8. 评审可读性产物

- OpenAPI 3.1 接口定义；
- 架构与数据流说明；
- 案例包 Schema 和新增案例指南；
- `.env.example`，只列变量名和用途；
- 功能实现矩阵；
- curl 请求示例；
- 数据库表和状态机说明；
- 明确的扩展接口和失败行为。

## 9. 最小验证

虽然本分支主要供源码评审，仍执行：

- Python 编译检查；
- 案例包 Schema 与引用测试；
- 路由 golden corpus；
- SQLite 空库迁移和旧库升级；
- CaseRun revision 与幂等测试；
- Flask 测试客户端接口冒烟；
- React 生产构建。

不重复已完成的视频级全链路录制，也不把本分支的新增后端页面行为替换到现有演示录像。

## 10. 完成定义

- 独立分支和 worktree 可识别；
- 核心接口有真实执行路径；
- 数据库迁移和 CaseRun 可在临时库运行；
- 路由至少区分散热、供电、信息不足和未支持；
- 所有扩展点明确是否已实现；
- OpenAPI 与代码接口一致；
- README 能指导评审定位核心代码；
- 不包含明显的虚假能力声明、敏感文件或临时产物；
- 最小验证通过后再形成竞赛提交 commit。
