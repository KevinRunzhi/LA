# 案例配置、审核与 Agent 发布中心 Spec

## 1. 目标

将当前由开发者直接维护 JSON 的案例包，升级为可配置、可校验、可审核、
可发布、可回滚的案例生产系统，同时保持现有 Agent 读取合同不变。

```text
案例资料/既有案例
  → 草稿模块
  → 确定性校验
  → 专家审核
  → 编译标准 JSON 包
  → 不可变版本发布
  → 运行时案例注册表
  → 路由、诊断、向导、问答、输出、知识图谱 Agent
```

核心约束：

- Agent 不读取草稿表，也不执行未审核内容；
- Agent 仍读取 `manifest + 6 个模块 JSON`；
- 仓库内置案例始终作为稳定回退源；
- 运行时发布案例可以覆盖同 case ID 的内置版本；
- 已创建的 CaseRun 固定创建时的 package version/hash；
- 发布失败不得破坏当前有效注册表。

## 2. Agent 消费合同

| 模块 | 消费方 | 作用 |
| --- | --- | --- |
| `manifest` | 注册表与全部 Agent | 身份、版本、证据 claim、能力声明 |
| `intake` | 接诊 Agent | 现场必填事实和确认规则 |
| `diagnosis` | 诊断 Agent | 诊断结论、原因、证据与遥测请求 |
| `guide` | 检修向导 Agent | 步骤、检查、测量、完成条件 |
| `assistant` | 步骤追问 Agent | 当前步骤允许主题、意图和 claim |
| `output` | 记录/作业卡 Agent | 结果字段、摘要和 PDF 分区 |
| `feedbackAndGraph` | 知识回流 Agent | 知识候选、图谱节点和关系 |

配置中心只生产上述合同，不在发布时调用开放式模型决定合法性。Schema、
引用、状态和摘要校验全部是确定性代码。

## 3. 数据模型

### 3.1 草稿与模块

`case_authoring_drafts` 保存 draft ID、case ID、标题、状态、base
case/release、revision、创建人和时间。`case_authoring_modules` 按草稿保存
`registry`、`manifest` 和六个业务模块。每次修改都增加 revision。

```text
draft → ready_for_review → approved → published
  ↑            ↓
  └─ rejected ─┘
```

### 3.2 校验、审核和事件

- `case_validation_runs`：内容 hash、errors、warnings、校验人和时间；
- `case_review_records`：审核决定、意见、审核人和 revision；
- `case_authoring_events`：草稿、修改、校验、提交、审核、发布、激活；
- `case_agent_suggestions`：检索/Agent 建议、证据和接受状态。

### 3.3 不可变发布

`case_releases` 保存 release ID、case ID、语义版本、package hash、存储路径、
registry item、manifest、active/superseded/disabled、来源 draft 和发布人。

```text
run/case-authoring/
├── releases/<caseId>/<version>/
│   ├── manifest.json
│   └── six module files
└── active/
    ├── case_registry.json
    └── <caseId>/...
```

## 4. 草稿来源与 Agent 建议

首版以克隆内置或已发布案例为主要入口，完整复制 registry item、manifest 和
六个模块。也允许导入结构化模块对象，但不接受带任意路径的压缩包。

Agent 建议不直接覆盖模块：

1. 根据 query 检索手册、案例、图谱和现场数据；
2. 保存建议文本及 EvidenceItem；
3. 专家接受后才手工应用到指定模块；
4. 保存建议生成和接受/拒绝事件。

首版提供证据建议记录，不自动生成不可审计的整套案例。

## 5. 校验流水线

```text
模块完整性
→ JSON Schema/schema version
→ manifest/module 路径
→ caseId/faultCode 一致性
→ claim/evidence 引用
→ intake/diagnosis 引用
→ guide step/check/measurement
→ assistant topic/step/claim
→ output/job-card 字段
→ graph node/relation
→ 路由冲突警告
→ package SHA-256
```

实现复用 `CasePackageRegistry`：把草稿编译到临时安全目录，使用同一套生产
加载器校验，避免编辑端与运行端出现两套规则。

## 6. 审核、发布和回滚

- 提交前必须有与当前 revision/hash 对应的成功校验；
- 提交后的模块不可修改；
- 专家/管理员批准或驳回，审核记录绑定准确 revision/hash；
- 发布只允许 approved，并再次运行完整校验；
- 先写临时目录，再原子移动到不可变 release；
- 重建 active registry 后刷新运行时 Composite registry；
- 同 case ID 上一个 active release 变为 superseded；
- 激活历史 release 即回滚，不删除任何版本。

## 7. 运行时注册表与 Agent

`CompositeCasePackageRegistry` 合并仓库内置案例和运行时发布案例：

- runtime 同 ID 覆盖 bundled；
- routing 全局权重沿用 bundled；
- runtime matchRules 直接参与首页路由；
- runtime 包失败时记录 loadErrors，不替换可用内置包；
- 发布/回滚后显式 refresh；
- Agent 最终仍得到原来的 `LoadedCasePackage`。

因此现有接诊、诊断、向导、步骤问答、作业卡和知识图谱 Agent 无需改写。

## 8. API

```text
GET  /api/platform/case-authoring/catalog
GET  /api/platform/case-authoring/drafts
POST /api/platform/case-authoring/drafts
GET  /api/platform/case-authoring/drafts/{draftId}
PATCH /api/platform/case-authoring/drafts/{draftId}/modules/{module}
POST /api/platform/case-authoring/drafts/{draftId}/validate
POST /api/platform/case-authoring/drafts/{draftId}/submit
POST /api/platform/case-authoring/drafts/{draftId}/review
POST /api/platform/case-authoring/drafts/{draftId}/publish
GET  /api/platform/case-authoring/releases
POST /api/platform/case-authoring/releases/{releaseId}/activate
POST /api/platform/case-authoring/drafts/{draftId}/suggestions
```

读取与草稿操作允许 expert/admin，审核和发布要求 expert/admin。所有写操作
使用 Bearer actor、revision、request ID 和审计记录。

## 9. 页面

专家侧增加“案例发布”：

- 查看内置案例、草稿、发布版本；
- 克隆现有案例；
- 编辑八个结构化 JSON 模块；
- 显示 revision、校验错误和审核意见；
- 执行保存、校验、提交、批准/驳回、发布、激活历史版本；
- 无真实平台会话时只展示说明，不修改录制兼容数据。

首版使用可靠的 JSON 模块编辑器，后续再把高频字段拆为专用表单。

## 10. CLI 与运维

```text
python -m backend.case_authoring_cli validate <draftId>
python -m backend.case_authoring_cli rebuild-registry
python -m backend.case_authoring_cli export-release <releaseId> <dir>
```

preflight 检查 authoring 目录可写、数据表存在和 active registry 可加载。完整
资产备份包含 case releases 与 active registry。

## 11. 局部验收

1. 克隆内置案例后八个模块一致；
2. 错误引用校验失败并返回错误码；
3. 校验、提交、审核、发布状态机正确；
4. 发布目录 hash 与数据库一致；
5. Composite registry 读取新版本并参与路由；
6. 激活历史版本后 Agent 读取对应版本；
7. 内置散热和供电案例不受影响；
8. 只运行新增 authoring 测试、定向编译和一次前端构建。

## 12. 非目标

- 不宣称自动生成的案例无需专家审核；
- 不让 Agent 执行草稿或自然语言材料；
- 不从 HTTP 覆盖仓库源码；
- 不提供无恢复记录的删除；
- 不在本阶段接入真实 PLC 或外部大模型凭据。
