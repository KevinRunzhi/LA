# 资料驱动的多 Agent 案例自动生成 Spec

## 1. 目标

在现有案例配置、审核和发布中心之上，增加一条可追溯的多 Agent 案例生产
流水线。系统读取已入库手册、历史案例、知识图谱和现场记录，按照现有
`registry + manifest + 6 个业务模块` 合同生成案例草稿，但任何自动生成内容
都必须经过确定性校验和专家确认后才能进入发布流程。

```text
选择资料
→ 固化来源快照
→ 文档解析
→ 证据提取
→ 故障领域判断
→ 案例大纲
→ 专家确认大纲
→ 八模块生成
→ 确定性校验
→ 定向修复（最多三轮）
→ JSON Patch 预览
→ 专家选择性应用
→ 既有案例审核与发布
```

本功能不是让一个模型一次输出整套 JSON，而是把复杂任务拆分为可记录、
可重试、可替换、可验收的 Agent。

## 2. 与现有系统的关系

复用现有能力：

- `ManualKnowledgeService`：PDF、页码、chunk 和 FTS；
- `UnifiedKnowledgeSearchService`：手册、案例、图谱、现场四来源证据；
- `CasePackageRegistry`：生产 Schema 和跨模块引用校验；
- `CaseAuthoringService`：八模块草稿、revision、审核和不可变发布；
- `CompositeCasePackageRegistry`：发布后供运行时 Agent 动态读取；
- `AuditService`：生成、接受、拒绝和应用记录。

新增生成层只写 `case_generation_*` 表和候选 artifact。只有专家点击“应用”
后，才通过现有 `update_module()` 写入案例草稿并增加 revision。

## 3. 设计原则

### 3.1 文档是不可信输入

PDF 文本、历史记录和上传内容可能包含错误、无关指令或提示注入。解析后的
文本只能作为证据数据，不得改变系统提示、角色权限、工具范围和发布状态。

### 3.2 证据优先

每个关键生成字段必须关联 EvidenceItem。没有证据时只能：

- 标记 `requiresExpertInput`；
- 使用明确的模板占位；
- 降低置信度；
- 禁止标记为 source verified。

不得凭空补充阈值、接线顺序、型号参数和安全操作。

### 3.3 生成与发布分离

生成任务不能：

- 直接修改 active registry；
- 直接批准草稿；
- 直接发布版本；
- 自动删除专家内容；
- 绕过 revision 冲突。

### 3.4 保持案例 Schema

现有业务 JSON 使用严格 Schema，不能向模块随意加入 provenance 字段。生成
血缘通过独立 JSON Pointer 映射保存：

```json
{
  "module": "guide",
  "pointer": "/steps/1/instructions/0",
  "evidenceIds": ["manual:CHK-001"],
  "agentRunId": "AGR-...",
  "confidence": 0.88,
  "reviewStatus": "pending"
}
```

最终发布包不改变现有 Agent 消费合同。

## 4. 总体架构

```text
CaseGenerationOrchestrator
├── SourceSnapshotAgent
├── DocumentUnderstandingAgent
├── EvidenceExtractionAgent
├── FaultDomainAgent
├── CasePlanningAgent
├── RoutingGenerationAgent
├── ManifestGenerationAgent
├── IntakeGenerationAgent
├── DiagnosisGenerationAgent
├── GuideGenerationAgent
├── AssistantGenerationAgent
├── OutputGenerationAgent
├── KnowledgeGraphGenerationAgent
├── CrossModuleCriticAgent
├── DeterministicCaseValidator
├── TargetedRepairAgent
└── PatchAssemblyAgent
```

大纲之前顺序执行；大纲确认后，互不依赖的模块可以有限并行。`assistant`
依赖 guide step，`output` 依赖 guide/result 规划，`feedbackAndGraph` 依赖
manifest claim，因此仍按依赖图执行。

## 5. 统一 Agent 运行合同

所有 Agent 使用同一运行封装：

```json
{
  "agentRunId": "AGR-...",
  "generationJobId": "CGJ-...",
  "agentType": "guide_generator",
  "agentVersion": "1.0.0",
  "provider": "structured-local",
  "templateId": "industrial-computer.storage.guide",
  "templateVersion": "1.0.0",
  "inputArtifactIds": ["ART-..."],
  "evidenceIds": ["manual:CHK-..."],
  "attempt": 1,
  "status": "running"
}
```

完成输出：

```json
{
  "status": "completed",
  "outputArtifactId": "ART-...",
  "outputSha256": "...",
  "warnings": [],
  "requiresExpertInput": [],
  "tokenUsage": null,
  "durationMs": 218
}
```

失败必须保存稳定错误码：

- `agent_input_invalid`
- `agent_provider_unavailable`
- `agent_output_invalid_json`
- `agent_output_schema_failed`
- `agent_evidence_missing`
- `agent_timeout`
- `agent_attempt_exhausted`
- `generation_cancelled`

## 6. Agent 详细职责

### 6.1 SourceSnapshotAgent

职责：在任务开始时固化来源，防止生成过程中手册被重新索引或案例版本改变。

输入：

- 用户选择的 document ID、case ID、run ID；
- fault domain 和设备范围；
- base case/template。

输出：

- 文档 SHA-256、页数、chunk ID；
- 案例 package version/hash；
- 图谱 version/hash；
- CaseRun revision；
- generation source snapshot。

约束：

- 只允许读取当前用户有权访问的来源；
- 不复制 Bearer token；
- 来源变化不自动更新本任务，必须创建新任务。

### 6.2 DocumentUnderstandingAgent

职责：把 PDF chunk 重组为有页码的技术章节，不直接生成案例。

输入：

- 文档 chunk、页码、标题和元数据；
- 领域模板的章节词典。

输出：

```json
{
  "sections": [
    {
      "sectionId": "SEC-...",
      "title": "Fan Connector",
      "pages": [23, 24],
      "text": "...",
      "tags": ["connector", "fan", "maintenance"],
      "documentId": "DOC-..."
    }
  ]
}
```

处理：

- 页眉页脚去重；
- 断行和连字符合并；
- 表格文本保留行列提示；
- 章节标题识别；
- 中英文术语规范化；
- 最大文本长度与页数限制。

不能做：

- 推断手册未出现的参数；
- 把目录页当操作步骤；
- 丢失页码。

### 6.3 EvidenceExtractionAgent

职责：从技术章节提取可引用的事实。

证据类型：

- symptom
- alarm
- cause
- check
- measurement
- threshold
- procedure
- connector
- safety
- recovery
- verification

输出：

```json
{
  "evidenceId": "EVG-...",
  "type": "threshold",
  "claim": "风扇低速时检查风扇与接线",
  "documentId": "DOC-...",
  "pages": [24],
  "locator": "Hardware Monitor / FAN",
  "excerptHash": "...",
  "confidence": 0.91,
  "verification": "document_extracted"
}
```

规则：

- 数值必须保留单位；
- 否定语句不能转成肯定结论；
- connector/pin 等高风险内容必须保留原页；
- 相同 excerpt hash 去重；
- 多来源冲突时并列保存，不自动选真。

### 6.4 FaultDomainAgent

职责：根据证据和用户目标判断使用哪一类生成模板。

支持模板：

- cooling/fan
- power/startup
- dust/filter
- condensation/environment
- storage/disk
- communication/network
- monitoring/alarm
- hardware/mainboard

输出：

- primary fault domain；
- secondary domains；
- equipment category；
- 支持证据；
- 排除领域；
- 未决问题；
- template recommendation。

置信度低于阈值时暂停，要求专家选择领域。

### 6.5 CasePlanningAgent

职责：先生成结构大纲，避免直接生成大量错误 JSON。

输出：

- 案例身份建议；
- 现场接诊字段；
- 诊断目标；
- 可能原因分组；
- 检修阶段和步骤标题；
- 步骤问答主题；
- 作业卡栏目；
- 知识和图谱范围；
- routing term 草案；
- 需要专家补充的问题。

大纲状态：

```text
generated → awaiting_outline_review → outline_approved
                                  └→ outline_rejected
```

大纲未批准时不能启动模块生成。

### 6.6 RoutingGenerationAgent

生成 `registry` 候选：

- equipmentExact
- equipmentGeneric
- alarms
- symptoms
- measurements
- contexts
- exclusions

规则：

- 所有词项去重并规范大小写；
- 不把过于通用的“异常”“故障”作为单独触发词；
- exclusions 必须来自可区分的相邻故障；
- 使用现有路由评分器进行离线冲突分析；
- 返回与全部已发布案例的 overlap/margin 诊断；
- 不能修改全局 routing weights。

### 6.7 ManifestGenerationAgent

生成：

- identity
- provenance
- capabilities
- claims
- modules 文件映射

规则：

- caseId 来自任务，不由模型自由生成；
- claims 必须关联 evidence；
- 没有官方资料的 claim 只能是 internally unverified；
- capabilities 根据实际生成模块决定；
- modules 路径使用固定文件名；
- packageVersion 在发布阶段写入。

### 6.8 IntakeGenerationAgent

生成现场接诊字段和确认条件。

输入来源：

- symptom/alarm/measurement evidence；
- base template；
- CasePlanning artifact。

字段类型：

- equipment identity
- location
- alarm
- symptom
- measurement
- environment
- operating state

规则：

- 只收集会影响路由或诊断的字段；
- 单位和枚举明确；
- 必填项数量受模板限制；
- 不要求现场人员填写手册中才能知道的信息；
- 默认值必须标明来源。

### 6.9 DiagnosisGenerationAgent

生成：

- diagnosis conclusion；
- cause candidates；
- evidence mapping；
- requested telemetry；
- confidence explanation。

规则：

- 每个原因至少有一个 evidence 或标记为专家假设；
- 诊断证据必须引用 intake field 和 manifest claim；
- 原因顺序基于证据支持度，不以模型措辞决定；
- 相互矛盾证据进入 diagnostics；
- 不输出超出资料范围的最终故障结论。

### 6.10 GuideGenerationAgent

生成完整检修步骤：

- step ID、标题和目标；
- instructions；
- checks；
- measurements；
- completion criteria；
- safety notes；
- claim IDs；
- assistant topic IDs。

规则：

- 先安全隔离，再检查，再测量，再处置，再恢复验证；
- 每一步必须有可判定的完成条件；
- 测量项包含单位、范围和记录方式；
- 高风险操作要求安全证据；
- 不把“更换设备”作为第一步；
- 不生成文档未支持的接线 pin 定义；
- step/check/measurement ID 全局唯一。

### 6.11 AssistantGenerationAgent

根据 guide 生成当前步骤问答主题。

每个 topic 包含：

- allowedStepIds；
- intent phrases；
- canonical question；
- answer template；
- claimIds；
- evidence references；
- boundary response。

宽松意图示例：

```text
怎么接 / 先接哪个 / 接线顺序 / FAN1 和 FAN2 怎么连
```

规则：

- 只有当前步骤允许的 topic 才能命中；
- 回答优先引用手册和 claim；
- 不允许跨步骤泄漏最终结论；
- 没有证据时明确要求专家/手册确认；
- 生成正向问法、简称、口语问法和否定问法测试集。

### 6.12 OutputGenerationAgent

生成：

- engineer result fields；
- record summary；
- job-card sections；
- 必填记录；
- 结果单位和显示顺序。

规则：

- 结果字段必须能由 guide 产生；
- 不把所有操作说明重复写入 PDF；
- 作业卡优先总结故障、关键检查、测量、处置、结果和签字；
- job-card field 引用必须存在；
- 限制字段数量，保证两页打印可读。

### 6.13 KnowledgeGraphGenerationAgent

生成：

- knowledge proposal；
- graph nodes；
- relations；
- verification level；
- source claim mapping。

规则：

- 工控机作为通用设备中心，不绑定无必要的具体型号；
- 故障、症状、原因、部件、检查、措施和证据分类型；
- source/target 必须存在；
- relation 使用受控词表；
- 与当前图谱重复节点需要输出 merge candidate；
- 未审核内容只能形成候选变更，不能直接发布。

### 6.14 CrossModuleCriticAgent

从业务语义检查跨模块一致性：

- routing symptom 是否出现在 intake/diagnosis；
- diagnosis 原因是否被 guide 检查；
- guide topic 是否由 assistant 覆盖；
- output 字段是否能从步骤产生；
- knowledge/graph 是否与最终处置一致；
- claims 是否有证据；
- 是否存在无法回答的关键专家问题。

它只生成问题清单，不能自行批准内容。

### 6.15 DeterministicCaseValidator

复用生产 `CasePackageRegistry`，执行：

- JSON Schema；
- schema version；
- caseId/faultCode；
- claim/evidence；
- intake/diagnosis；
- guide/assistant；
- output/job-card；
- graph node/relation；
- package SHA-256。

Agent Critic 通过但确定性校验失败时，任务仍失败。

### 6.16 TargetedRepairAgent

输入必须包含明确错误码、JSON Pointer 和允许修改模块。

示例：

```json
{
  "errorCode": "broken_reference",
  "module": "guide",
  "pointer": "/steps/1/assistantTopicIds/0",
  "allowedModules": ["guide", "assistant"]
}
```

限制：

- 最多三轮；
- 每轮生成 JSON Patch；
- 不修改 case ID、证据原文或审核状态；
- 修复后重新运行完整确定性校验；
- 同一错误连续两轮不变则停止。

### 6.17 PatchAssemblyAgent

把全部候选 artifact 与当前草稿对比，生成 RFC 6902 风格 patch：

```json
{
  "patchId": "CGP-...",
  "module": "guide",
  "baseRevision": 3,
  "operations": [
    {"op": "add", "path": "/steps/2", "value": {}}
  ],
  "evidenceLinks": [],
  "risk": "medium"
}
```

专家可以整模块、逐 patch 或逐字段接受。应用前再次检查 base revision。

## 7. Provider 架构

```python
class CaseGenerationProvider(Protocol):
    provider_id: str
    def generate(self, request: AgentRequest) -> AgentResponse: ...
```

实现：

1. `StructuredLocalGenerationProvider`
   - 使用领域模板、统一检索和确定性转换；
   - 无 API Key 也可运行；
   - 用于测试、离线部署和稳定回退。

2. `RemoteJsonGenerationProvider`
   - HTTP JSON 调用；
   - 要求结构化输出；
   - 超时、重试、大小限制和响应 Schema；
   - 通过环境变量配置，不提交凭据。

Provider 选择记录在每个 agent run，不能在任务中途静默切换。远程不可用时
可由用户明确选择重新以 local provider 创建任务。

## 8. 模板体系

目录：

```text
backend/data/case-generation-templates/
├── template-registry.json
├── common/
│   ├── agent-contracts.json
│   ├── relation-vocabulary.json
│   └── safety-policy.json
└── industrial-computer/
    ├── cooling.json
    ├── power.json
    ├── storage.json
    ├── communication.json
    ├── monitoring.json
    ├── dust-filter.json
    └── condensation.json
```

模板定义：

- 必需证据类型；
- 推荐 intake 字段；
- 诊断原因类别；
- 检修阶段；
- 安全检查；
- 输出字段；
- 图谱实体类型；
- 禁止自动补全字段；
- 最小/最大步骤数量；
- template version。

模板只提供结构和检查清单，具体阈值与操作必须来自证据。

## 9. 数据模型（迁移 006）

### `case_generation_jobs`

- job ID、draft ID、状态、provider；
- fault domain、template/version；
- outline 状态；
- current stage、progress；
- created by、cancel requested；
- started/completed timestamps；
- failure code/summary。

### `case_generation_sources`

- job ID、source type/id；
- source version/hash；
- snapshot metadata；
- selected pages/chunks。

### `case_generation_agent_runs`

- agent run ID、job ID、agent type/version；
- provider、template；
- attempt、status；
- input/output hash；
- duration、usage；
- error code/message。

### `case_generation_artifacts`

- artifact ID、job ID、agent run ID；
- artifact type、module；
- content JSON、SHA-256；
- schema status；
- created timestamp。

### `case_generation_evidence_links`

- artifact ID；
- module、JSON Pointer；
- evidence ID；
- confidence；
- review status。

### `case_generation_patches`

- patch ID、job ID、draft ID；
- module、base revision；
- operations JSON；
- risk、status；
- applied revision；
- decided by/time。

### `case_generation_evaluations`

- job/artifact；
- evaluator type；
- rule ID；
- severity；
- result、details。

## 10. 任务状态机

```text
created
→ snapshotting
→ parsing_documents
→ extracting_evidence
→ classifying_domain
→ planning
→ awaiting_outline_review
→ generating_modules
→ criticizing
→ validating
├─ repairing → validating（最多三轮）
├─ failed
→ awaiting_patch_review
→ partially_applied / applied
→ completed
```

任意运行阶段可以请求 cancel。已落库 artifact 保留用于排查，但取消任务不能
继续写草稿。

## 11. API

```text
GET  /api/platform/case-generation/templates
POST /api/platform/case-generation/jobs
GET  /api/platform/case-generation/jobs
GET  /api/platform/case-generation/jobs/{jobId}
POST /api/platform/case-generation/jobs/{jobId}/run
POST /api/platform/case-generation/jobs/{jobId}/cancel
POST /api/platform/case-generation/jobs/{jobId}/outline/approve
POST /api/platform/case-generation/jobs/{jobId}/outline/reject
GET  /api/platform/case-generation/jobs/{jobId}/artifacts
GET  /api/platform/case-generation/jobs/{jobId}/agent-runs
GET  /api/platform/case-generation/jobs/{jobId}/patches
POST /api/platform/case-generation/patches/{patchId}/accept
POST /api/platform/case-generation/patches/{patchId}/reject
POST /api/platform/case-generation/patches/{patchId}/apply
```

任务执行采用持久 worker，HTTP 只创建任务、审批和读取状态。

## 12. Worker

```text
backend/case_generation_worker.py
python -m backend.case_generation_worker --once
python -m backend.case_generation_worker --job-id CGJ-...
```

领取规则：

- SQLite `BEGIN IMMEDIATE`；
- stage lease；
- 崩溃后回收过期 stage；
- Agent 单次最多三次；
- job cancel 优先；
- 同 job 只允许一个 orchestrator；
- 模块并行数默认 3。

systemd 增加独立 `la-case-generation-worker.service`。

## 13. 前端生成向导

在案例发布中心增加“从资料生成”：

### 第一步：任务目标

- 目标草稿；
- 故障领域（可自动判断）；
- 基础模板；
- 生成范围。

### 第二步：选择资料

- 手册搜索与页码预览；
- 历史案例；
- 图谱局部节点；
- CaseRun 现场记录；
- 来源版本/hash。

### 第三步：案例大纲

- Agent 推断的故障领域；
- intake、诊断、步骤、问答、作业卡和图谱大纲；
- 未决问题；
- 批准或退回。

### 第四步：生成进度

时间线显示每个 Agent：

- pending/running/completed/failed；
- 使用来源；
- 输出 artifact；
- warnings；
- 自动修复轮次。

### 第五步：差异与证据

- 当前草稿/生成候选双栏；
- JSON Pointer 级差异；
- 点击字段查看手册页码；
- 风险和置信度；
- 单项接受/拒绝。

### 第六步：应用结果

- 应用到的新 revision；
- 未应用 patch；
- 最终校验；
- 返回现有审核发布流程。

## 14. 安全与权限

- expert/admin 可创建生成任务；
- 只能给有权限的 draft 生成；
- patch 应用继续使用 revision；
- 远程 provider 不发送 token、密码、无关附件；
- 文档文本使用明确 data delimiter；
- 限制单任务文档数、页数、字符数和输出大小；
- artifact 不保存 API Key；
- 生成日志不保存完整敏感现场输入；
- 所有接受、拒绝、应用动作写审计。

## 15. 可观测性

指标：

```text
case_generation_jobs_total{status,domain,provider}
case_generation_agent_runs_total{agent,status,provider}
case_generation_agent_duration_seconds
case_generation_repairs_total{agent,error_code}
case_generation_patches_total{status,module}
case_generation_evidence_coverage_ratio
```

日志使用 job ID、agent run ID 和 request ID，不记录 prompt 原文或凭据。

## 16. 局部测试与验收

### 单 Agent 合同

- 每个 Agent 输入输出 Schema；
- 空证据、冲突证据、超长文档；
- 数值单位、否定语句、页码；
- 非法 JSON 和 provider timeout。

### 编排

- 正常状态机；
- outline 驳回；
- cancel；
- worker lease；
- repair 三轮上限；
- 失败后不修改 draft。

### 业务

- storage 手册生成案例；
- guide 与 assistant step 对齐；
- output 字段来自 guide；
- graph 关系有效；
- patch base revision 冲突；
- 部分接受后重新校验；
- 未审核生成内容不能发布。

### 验收指标

- 关键 claim 证据覆盖率 100% 或明确 pending；
- 自动生成模块通过确定性校验；
- 不出现无来源阈值和接线定义；
- 每个字段可追溯到 artifact/agent/template/evidence；
- 已有散热、供电案例运行不受影响。

## 17. 实施阶段

### 阶段 A：基础设施

- 迁移 006；
- template registry；
- job/artifact/agent-run；
- local provider；
- worker 与 API。

### 阶段 B：资料理解和大纲

- source snapshot；
- document understanding；
- evidence extraction；
- domain classification；
- planning；
- outline review 页面。

### 阶段 C：八模块生成

- routing/manifest/intake/diagnosis；
- guide/assistant/output/feedbackAndGraph；
- evidence pointer links。

### 阶段 D：校验、修复和 Patch

- critic；
- production validator；
- targeted repair；
- patch preview、选择性接受和 revision 应用。

### 阶段 E：演示案例与验收

- 选择资料最完整的第三故障；
- 从资料创建任务；
- 确认大纲；
- 自动生成八模块；
- 专家选择性应用；
- 校验、审核、发布；
- 首页路由和 Agent 运行；
- 历史版本回滚。

## 18. 当前与目标差距

当前已有：

- 统一证据检索；
- `case_agent_suggestions` 建议记录；
- 八模块草稿；
- 校验、审核、发布和动态加载。

本 Spec 要补：

- 持久生成任务；
- 完整多 Agent 职责；
- 文档理解与证据 claim；
- 领域模板；
- 大纲确认；
- 八模块 artifact；
- 校验修复循环；
- JSON Patch 选择性应用；
- worker、进度和可观测性。

完成后，新增故障将从“开发者手工改 JSON”升级为“Agent 按模板理解资料、
生成有证据的候选模块、专家确认、平台校验并发布”。
