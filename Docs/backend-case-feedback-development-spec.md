# 后台案例回流信息架构与开发 Spec

> 2026-07-13 修订：工程师侧不再采用本文第 7.1 节“工程师案例确认页”和第 7.2 节“案例回流工作台”的独立页面组织。最新工程师侧基线改为 [`engineer-maintenance-record-feedback-spec.md`](./engineer-maintenance-record-feedback-spec.md)：将确认、证据、恢复对比和上传全部合并进“检修完成记录”。专家审核、知识发布、SQLite 和同步部分继续有效。

> 版本：V1.0
> 日期：2026-07-11
> 状态：WSL 录制级主路径已验收；龙芯实体机开发态验证待执行
> 业务依据：`backend-case-feedback-business-plan.md` V1.2
> 视频依据：`case-feedback-video-script-and-data.md` V1.0
> 技术边界：React 18 + Flask + JSON 文件，不新增前端依赖，不引入数据库
> Node 版本：`20.19.4`

## 1. 开发目标

以七分钟演示视频为结果导向，实现一条可刷新、可重置、数据真实联动的案例回流闭环：

```text
工程师确认案例
→ 提交专家
→ 专家修改简洁案例
→ 接受图谱建议
→ 发布知识 V1.1
→ 知识库和图谱发生变化
→ 相似异常命中 V1.1
```

同时通过 10–12 条只读历史摘要、1 条建设中案例和 6–8 条预置知识，为 PPT 和后台页面提供可信的业务规模。

## 2. 完成定义

以下条件同时满足才算完成第一版：

1. 工程师能从检修记录进入案例确认页；
2. 一键采用冻结的现场结果后，可以提交专家；
3. 提交后刷新页面状态不丢失；
4. 工程师退出后可以使用唯一专家账号重新登录，并进入独立专家门户；
5. 专家工作台能看到该待审核案例；
6. 专家能采用或修改冻结结论；
7. 专家能接受唯一主要图谱变更建议；
8. “通过并更新知识”一次完成案例审核、知识发布和图谱更新；
9. 发布后 `KB-008` 从 V1.0 变为 V1.1；
10. 知识详情显示来源案例、专家、更新时间和变化内容；
11. 图谱新增关系以绿色高亮显示；
12. 快速验证能命中 `KB-008 V1.1` 和 `CASE-ACP4000-001`；
13. 一键重置能够恢复初始录制状态；
14. 历史摘要和预置知识只能查看，不能误入编辑流程；
15. 后台核心流程在 2 分 35 秒内完成；
16. Node `20.19.4` 构建和浏览器主路径通过；
17. 龙芯开发态验证后才能标记最终演示环境完成。

## 3. 范围与优先级

### 3.1 P0：必须真实联动

- 工程师案例确认；
- 工程师提交专家；
- 专家工作台；
- 专家审核详情；
- 简洁案例修改；
- 图谱变更接受；
- 知识 V1.1 发布；
- 知识更新结果；
- 快速验证再次命中；
- 工程师与专家独立登录入口；
- 演示状态持久化；
- 一键重置。

### 3.2 P0：只读展示

- 10–12 条历史摘要案例；
- 1 条建设中案例；
- 6–8 条预置知识；
- 历史案例一页详情；
- 人员列表基础信息；
- 后台统计数字。

### 3.3 P1：视频完成后再做

- 更丰富的列表筛选和排序；
- 知识引用效果统计页；
- 工程师与专家详情；
- 第二个完整案例；
- 退回补充分支的完整操作。

### 3.4 不做

- 真正登录鉴权；
- 数据库和迁移；
- 多专家会签；
- 消息通知；
- 自由图谱编辑；
- 高风险知识停用；
- 后台 PDF 和打印；
- 批量编辑和删除；
- 历史摘要案例审核；
- 自动无专家确认发布。

## 4. 信息架构

```text
站控慧眼
├── 一线工作台（现有）
│   ├── 异常接入
│   ├── 分析诊断
│   ├── 检修预方案
│   ├── 检修向导
│   ├── 检修记录
│   └── 工程师案例确认（新增）
├── 案例回流（新增后台入口）
│   ├── 回流工作台
│   ├── 专家审核详情
│   ├── 历史案例
│   └── 历史案例只读详情
├── 检修知识库（扩展现有知识图谱入口）
│   ├── 知识列表
│   ├── 知识详情
│   ├── 知识更新结果
│   ├── 关联图谱
│   └── 知识快速验证
├── 知识图谱（复用并扩展）
│   ├── 当前诊断依据
│   ├── 专家变更预览
│   └── 发布后结果
└── 人员管理（只读展示）
    ├── 工程师
    ├── 专家
    └── 管理员
```

## 5. 导航与页面状态

第一版不增加 `react-router`。复用现有 `activePage` 和局部详情状态：

```js
const adminPages = {
  CASE_WORKBENCH: "case-workbench",
  CASE_REVIEW: "case-review",
  CASE_HISTORY: "case-history",
  CASE_DETAIL: "case-detail",
  KNOWLEDGE_LIBRARY: "knowledge-library",
  KNOWLEDGE_DETAIL: "knowledge-detail",
  KNOWLEDGE_RESULT: "knowledge-result",
  KNOWLEDGE_VERIFY: "knowledge-verify",
  PEOPLE: "people",
};
```

新增页面上下文：

```js
const [activeAdminPage, setActiveAdminPage] = useState("case-workbench");
const [selectedCaseId, setSelectedCaseId] = useState(null);
const [selectedKnowledgeId, setSelectedKnowledgeId] = useState(null);
const [activeDemoRole, setActiveDemoRole] = useState("engineer");
```

要求：

- 刷新后从后端 `presentation_state.json` 恢复角色和业务状态；
- 页面跳转状态可以留在前端，不要求 URL 路由；
- 视频关键成功页必须提供明确下一步按钮；
- 浏览器后退不是第一版验收项。

## 6. 角色视图

### 6.1 工程师视图

导航：

- 智能诊断台；
- 我的检修；
- 案例回流；
- 历史案例；
- 检修知识库。

可操作：

- 确认自己的完整案例；
- 提交专家；
- 查看自己的状态；
- 查看所有已归档案例；
- 查看已发布知识。

不可操作：

- 专家审核；
- 修改正式知识；
- 审核历史摘要。

### 6.2 专家视图

导航：

- 案例回流工作台；
- 全部案例；
- 检修知识库；
- 知识图谱；
- 人员展示。

可操作：

- 审核唯一完整案例；
- 修改简洁案例；
- 接受图谱建议；
- 发布知识新版本；
- 查看全部归档案例和知识。

第一版只有 `EXP-001` 一个专家账号，可查看全部案例。

### 6.3 管理员视图

只用于 PPT：

- 查看人员；
- 查看场站和班组；
- 查看账号状态。

管理员不显示专业案例结论和知识编辑按钮。

## 7. 页面规格

## 7.1 工程师案例确认页

页面 ID：`engineer-case-confirmation`

进入条件：

- 检修记录已生成；
- `caseStatus === "awaiting_engineer_confirmation"`。

页面结构：

```text
页面标题与状态
├── 自动归集说明
├── 现场异常摘要（只读）
├── 诊断与依据摘要（只读）
├── 实际执行步骤（只读）
├── 工程师实际结果（可编辑）
├── 恢复参数（可编辑）
└── 提交操作区
```

可编辑字段：

- 最终故障原因；
- 实际处理；
- 恢复结果；
- 恢复后风扇转速；
- 恢复后系统温度；
- 恢复后 CPU 温度；
- 观察时长；
- 遗留风险。

演示按钮：

- `一键采用现场结果`；
- `提交专家审核`。

提交前校验：

- 最终原因非空；
- 实际处理非空；
- 恢复结果非空；
- 转速、系统温度和 CPU 温度为有效值；
- 观察时长大于 0。

提交成功：

```text
案例 CASE-ACP4000-001 已提交专家审核
```

按钮：

- `退出并登录专家账号`；
- `返回检修记录`。

## 7.2 案例回流工作台

页面 ID：`case-feedback-workbench`

顶部：

- 专家独立登录与独立门户；
- 一键重置演示；
- 当前案例状态；
- 当前知识版本。

统计卡：

- 全部案例：建议 12；
- 待专家审核：动态值；
- 已归档：动态值；
- 已沉淀知识：动态值；
- 资料收集中：1。

主体：

1. 当前待处理：突出 `CASE-ACP4000-001`；
2. 最近案例：摘要列表；
3. 最近知识回流：显示 `KB-008`；
4. 资料收集中：显示第二案例。

状态逻辑：

- 工程师提交前：专家视图不显示待审核；
- 提交后：专家待审核数量加 1；
- 发布后：待审核减 1、已归档和已沉淀知识增加；
- 动态案例始终置顶。

## 7.3 专家审核详情页

页面 ID：`expert-case-review`

进入条件：

- 当前角色为专家；
- `caseStatus === "pending_expert_review"`。

页面结构：

```text
案例标题、状态与来源
├── 左：现场事实与工程师结果
├── 中：系统诊断、依据和恢复参数
├── 右：专家审核操作
│   ├── 简洁案例草稿
│   ├── 专家结论编辑
│   ├── 知识更新摘要
│   └── 通过并更新知识
└── 下：知识图谱变更预览
```

专家实际操作仅包含：

1. 编辑或一键采用专家结论；
2. 接受一组主要图谱关系；
3. 点击“通过并更新知识”。

图谱建议卡：

```text
新增知识关系
风扇老化 → 导致 → 风扇转速低于 500 rpm
风扇转速低于 500 rpm → 触发 → TEMP/FAN 告警
来源：CASE-ACP4000-001
```

按钮：

- `接受建议`；
- `不采用`；
- `通过并更新知识`。

启用条件：

- 专家结论非空；
- 图谱建议已接受或明确不采用；
- 当前没有发布请求运行。

发布中：

- 禁止重复点击；
- 显示案例归档、知识更新、图谱写入三个阶段；
- 完成后跳转知识更新结果页。

## 7.4 知识更新结果页

页面 ID：`knowledge-publish-result`

必须显示：

- 成功状态；
- `KB-008 V1.0 → V1.1`；
- 来源案例；
- 专家账号；
- 发布时间；
- 专家修改结论；
- 新增知识内容；
- 新增图谱关系；
- 前后知识差异。

布局：

```text
发布成功 Hero
├── 版本变化
├── 知识内容前后对比
├── 来源案例和专家
├── 发布后知识图谱
└── 下一步操作
```

按钮：

- `查看知识详情`；
- `验证知识应用`；
- `返回案例工作台`。

## 7.5 知识快速验证页

页面 ID：`knowledge-feedback-verify`

默认输入：

> 同型号站控工控机出现 TEMP/FAN 告警，风扇转速 420 rpm；清理滤网后转速仍未恢复。

按钮：`验证知识应用`

运行过程：

1. 解析设备与告警；
2. 匹配风扇转速条件；
3. 检索知识版本；
4. 命中来源案例；
5. 生成推荐动作。

结果：

- `KB-008 V1.1`；
- 来源 `CASE-ACP4000-001`；
- 风扇老化可能性较高；
- 建议断电确认后检查并视情况更换风扇；
- 绿色图谱路径。

如果知识仍为 V1.0，页面必须明确显示“当前知识尚未包含本次案例反馈”，不能伪装命中 V1.1。

## 7.6 历史案例页

页面 ID：`case-history`

数据：10–12 条 `readonly + summary + presentation_seed`。

功能：

- 搜索；
- 故障类型筛选；
- 设备筛选；
- 场站筛选；
- 状态筛选；
- 点击详情。

详情页只显示一页内容，不显示任何修改、审核、删除或发布按钮。

## 7.7 检修知识库

页面 ID：`knowledge-library`

数据：

- `KB-008` 动态知识；
- 6–8 条只读预置知识。

知识卡字段：

- 编号；
- 标题；
- 当前版本；
- 适用设备；
- 故障类型；
- 来源案例数量；
- 最近更新时间；
- 状态。

发布后 `KB-008` 必须置顶并显示：

- `V1.1`；
- `刚刚更新`；
- `来源 CASE-ACP4000-001`；
- `专家账号`。

## 7.8 人员展示页

页面 ID：`people-management`

只读展示：

- 3–4 个工程师；
- 1 个专家；
- 1 个管理员；
- 班组、场站、角色和账号状态。

第一版不实现增删改、密码、权限树和审核范围编辑。

## 8. 前端组件结构

建议新增目录，避免继续扩大 `App.jsx`：

```text
frontend/src/admin/
├── AdminShell.jsx
├── DemoRoleSwitcher.jsx
├── PresentationResetButton.jsx
├── CaseFeedbackWorkbench.jsx
├── EngineerCaseConfirmation.jsx
├── ExpertCaseReview.jsx
├── KnowledgePublishResult.jsx
├── KnowledgeVerification.jsx
├── CaseHistoryPage.jsx
├── ReadonlyCaseDetail.jsx
├── KnowledgeLibraryPage.jsx
├── KnowledgeDetail.jsx
├── PeopleManagementPage.jsx
├── KnowledgeGraphPreview.jsx
├── CaseStatusBadge.jsx
└── admin.css
```

数据层：

```text
frontend/src/admin/data/
├── presentationApi.js
├── adminSelectors.js
└── adminConstants.js
```

组件职责：

- 页面组件只组织布局和用户动作；
- `presentationApi.js` 统一访问 Flask；
- `adminSelectors.js` 计算统计、角色可见项和动态知识；
- 不在 JSX 中写入十余条历史案例；
- 不在组件中直接修改知识版本或案例状态；
- 所有可变状态以后端返回为准。

## 9. JSON 文件设计

目录：

```text
backend/data/presentation/
├── users.json
├── cases.json
├── case_full_001.json
├── knowledge_base.json
├── graph_seed.json
├── verification_scenario.json
├── initial_state.json
└── presentation_state.json
```

### 9.1 `users.json`

```json
{
  "items": [
    {
      "id": "ENG-001",
      "name": "李师傅",
      "role": "engineer",
      "team": "站控运维一班",
      "site": "某输气场站",
      "status": "active"
    },
    {
      "id": "EXP-001",
      "name": "专家账号",
      "role": "expert",
      "scope": "all_cases",
      "status": "active"
    },
    {
      "id": "ADM-001",
      "name": "系统管理员",
      "role": "admin",
      "canEditProfessionalContent": false,
      "status": "active"
    }
  ]
}
```

### 9.2 `cases.json`

列表摘要：

```json
{
  "interactiveCaseId": "CASE-ACP4000-001",
  "collectingCaseId": "CASE-POWER-002",
  "items": [
    {
      "id": "CASE-ACP4000-001",
      "mode": "interactive",
      "dataLevel": "full",
      "source": "verified_demo",
      "title": "站控柜 A01 工控机散热异常检修",
      "site": "某输气场站",
      "equipment": "研华 ACP-4000 / IPC-610",
      "faultType": "散热异常",
      "engineerId": "ENG-001",
      "expertId": "EXP-001"
    }
  ]
}
```

动态案例状态不写回 `cases.json`，由 `presentation_state.json` 覆盖。

### 9.3 `case_full_001.json`

结构：

```json
{
  "id": "CASE-ACP4000-001",
  "incident": {},
  "materials": [],
  "diagnosis": {},
  "maintenancePlan": {},
  "execution": {},
  "engineerResultTemplate": {},
  "expertReviewTemplate": {},
  "knowledgeProposal": {},
  "graphChanges": []
}
```

具体值必须与 `case-feedback-video-script-and-data.md` 第 5 节一致。

### 9.4 `knowledge_base.json`

```json
{
  "dynamicKnowledgeId": "KB-008",
  "items": [
    {
      "id": "KB-008",
      "mode": "interactive",
      "source": "verified_demo",
      "title": "ACP-4000 / IPC-610 风扇检查与更换",
      "baseVersion": "1.0",
      "baseContent": {},
      "publishedContentV11": {}
    }
  ]
}
```

接口根据 `presentation_state.knowledgeVersion` 决定返回 V1.0 还是 V1.1。

### 9.5 `initial_state.json`

只读重置模板：

```json
{
  "schemaVersion": 1,
  "activeRole": "engineer",
  "caseStatus": "awaiting_engineer_confirmation",
  "engineerResult": null,
  "engineerSubmitted": false,
  "expertConclusion": null,
  "expertApproved": false,
  "graphDecision": "pending",
  "knowledgePublished": false,
  "knowledgeVersion": "1.0",
  "publishedAt": null,
  "feedbackVerified": false,
  "updatedAt": null
}
```

### 9.6 `presentation_state.json`

唯一可写数据文件，运行时结构与 `initial_state.json` 一致。

禁止把以下内容写入状态文件：

- 历史摘要；
- 预置知识正文；
- 用户种子数据；
- 基础图谱；
- 完整案例固定事实。

## 10. Flask 状态存储

现有 `backend/app.py` 使用内存变量，重启会丢失。新增轻量文件状态服务：

```python
PRESENTATION_DIR = DATA_DIR / "presentation"
STATE_FILE = PRESENTATION_DIR / "presentation_state.json"
INITIAL_STATE_FILE = PRESENTATION_DIR / "initial_state.json"
```

必须提供：

```python
def load_presentation_state() -> dict: ...
def save_presentation_state(state: dict) -> None: ...
def reset_presentation_state() -> dict: ...
```

写入要求：

1. 写到同目录临时文件；
2. `flush` 后替换正式文件；
3. JSON 使用 UTF-8 和两个空格缩进；
4. 保存 `updatedAt`；
5. 不允许客户端任意覆盖完整状态；
6. 每个动作由后端校验当前状态后更新指定字段。

第一版不处理多进程并发。录制环境只运行一个 Flask 实例。

## 11. API 契约

统一响应：

```json
{
  "ok": true,
  "data": {},
  "message": ""
}
```

错误：

```json
{
  "ok": false,
  "error": "invalid_case_state",
  "message": "当前案例尚未提交专家审核"
}
```

### 11.1 状态

```text
GET  /api/presentation/state
POST /api/presentation/reset
POST /api/presentation/role
```

`POST /api/presentation/role`

```json
{ "role": "engineer" }
```

允许：`engineer | expert | admin`。

### 11.2 案例

```text
GET  /api/admin/cases
GET  /api/admin/cases/:caseId
POST /api/admin/cases/:caseId/adopt-engineer-result
POST /api/admin/cases/:caseId/submit
POST /api/admin/cases/:caseId/adopt-expert-conclusion
POST /api/admin/cases/:caseId/graph-decision
POST /api/admin/cases/:caseId/publish
```

案例列表参数：

```text
?query=&status=&faultType=&equipment=&site=
```

`submit` 请求：

```json
{
  "engineerResult": {
    "finalCause": "...",
    "actualResolution": "...",
    "recoveryResult": "...",
    "fanSpeedRpm": 1280,
    "systemTemperatureC": 42,
    "cpuTemperatureC": 58,
    "observationMinutes": 15,
    "residualRisk": "无明显遗留风险"
  }
}
```

`graph-decision` 请求：

```json
{ "decision": "accepted" }
```

允许：`accepted | rejected`。

`publish` 请求：

```json
{
  "expertConclusion": "清理滤网并更换老化风扇后，风扇转速恢复至 1280 rpm，TEMP/FAN 告警解除。"
}
```

发布后端原子业务动作：

1. 校验案例待审核；
2. 校验当前角色为专家；
3. 校验图谱决定已完成；
4. 保存专家结论；
5. 设置案例已归档并沉淀知识；
6. 设置知识 V1.1；
7. 根据决定加入正式图谱关系；
8. 写入发布时间；
9. 一次保存状态；
10. 返回发布结果。

### 11.3 知识与图谱

```text
GET  /api/admin/knowledge
GET  /api/admin/knowledge/:knowledgeId
GET  /api/admin/knowledge/:knowledgeId/diff
GET  /api/knowledge/graph
POST /api/knowledge/verify-feedback
```

`verify-feedback` 请求：

```json
{
  "input": "同型号站控工控机出现 TEMP/FAN 告警，风扇转速 420 rpm；清理滤网后转速仍未恢复。"
}
```

知识 V1.1 已发布时返回：

```json
{
  "matched": true,
  "knowledgeId": "KB-008",
  "version": "1.1",
  "sourceCaseId": "CASE-ACP4000-001",
  "assessment": "风扇老化可能性较高",
  "recommendation": "断电确认后检查并视情况更换风扇"
}
```

### 11.4 人员

```text
GET /api/admin/users
```

只读，不提供写接口。

## 12. 状态机

### 12.1 案例

```text
awaiting_engineer_confirmation
  --submit-->
pending_expert_review
  --publish-->
archived_with_knowledge
```

第一版不实现可操作退回分支。

状态保护：

- 非工程师不能提交现场结果；
- 非专家不能发布知识；
- 未提交不能进入专家编辑；
- 已发布不能重复发布；
- 已发布案例只能查看；
- reset 是唯一回到初始状态的方式。

### 12.2 图谱决定

```text
pending → accepted | rejected
```

发布时两种决定都允许，但 `rejected` 不新增图谱关系。

视频冻结路径必须选择 `accepted`。

### 12.3 知识

```text
V1.0 --expert publish--> V1.1
```

第一版不继续生成 V1.2，不支持回退版本。

## 13. 前端数据流

初始化：

```text
App mount
→ GET presentation/state
→ GET users / cases / knowledge
→ 根据角色和状态渲染入口
```

工程师提交：

```text
填表或采用模板
→ POST case submit
→ 用响应替换本地 state
→ 成功页
```

专家发布：

```text
采用专家结论
→ graph decision
→ publish
→ 返回 knowledge result
→ 跳转发布结果页
```

禁止乐观伪更新知识版本。必须等待后端发布成功后再显示 V1.1。

## 14. 视觉与交互规范

后台与现有深色工业风保持一致，但减少接诊工作区的大幅动态效果。

### 14.1 主次关系

- 页面主体承载案例事实、审核和知识内容；
- 右侧可显示 Agent 自动归集说明，但不阻塞操作；
- 关键状态和下一步按钮始终清晰；
- 视频操作按钮使用唯一主色；
- 只读摘要降低对比度，避免与完整案例竞争。

### 14.2 状态颜色

| 状态 | 色彩 |
| --- | --- |
| 待工程师确认 | 蓝色 |
| 待专家审核 | 橙色 |
| 已通过 | 绿色 |
| 资料收集中 | 灰蓝色 |
| 已归档 | 中性绿色 |
| 知识新版本 | 青绿色 |
| 图谱新增关系 | 绿色高亮 |

### 14.3 动画

- 提交成功：状态条推进；
- 专家发布：案例、知识、图谱三个阶段逐项完成；
- 图谱新增关系：节点淡入、连线绘制；
- 知识版本：V1.0 滑出，V1.1 高亮进入；
- 验证知识：五步检索轨迹；
- `prefers-reduced-motion` 下只保留状态切换。

### 14.4 自动填充

一键采用后字段依次填入，总时长不超过 1.2 秒；允许用户继续修改。

## 15. 演示重置

入口：后台顶部“重置演示”。

点击后需要二次确认：

```text
将恢复 CASE-ACP4000-001 待工程师确认、KB-008 V1.0 和发布前图谱。历史展示数据不受影响。
```

确认后：

- 后端用 `initial_state.json` 覆盖运行状态；
- 角色恢复工程师；
- 案例恢复待确认；
- 清空工程师和专家临时输入；
- 图谱建议恢复待处理；
- 知识恢复 V1.0；
- 验证状态恢复未验证；
- 前端跳转案例回流工作台并刷新数据。

## 16. 历史展示数据要求

10–12 条历史摘要至少覆盖：

- 工控机散热；
- 风扇异响；
- 滤网积尘；
- 冗余电源异常；
- 通信中断；
- 数据不上送；
- 状态灯异常；
- 机柜环境温度偏高；
- 接线端子松动；
- 交换机端口异常。

状态分布：

- 已归档 7–8 条；
- 已沉淀知识 3–4 条；
- 资料收集中 1 条；
- 动态完整案例 1 条。

历史摘要内容必须合理但明确标记 `presentation_seed`，不得参与知识验证接口。

## 17. 错误与恢复

必须处理：

- 后端离线；
- 状态文件损坏；
- 非法状态提交；
- 重复点击；
- 发布时图谱未决定；
- 知识尚未发布就验证；
- reset 失败。

视频环境错误提示必须提供：

- 简洁原因；
- 重试；
- 返回工作台；
- 不丢失已填写表单。

状态文件损坏时，后端可以读取 `initial_state.json` 恢复，并在日志中记录，不向用户显示 Python 堆栈。

## 18. 实施顺序

### 阶段 A：数据和状态

1. 创建 presentation JSON；
2. 填入唯一完整案例；
3. 填入历史摘要和预置知识；
4. 实现文件状态服务；
5. 实现 reset、role 和 state 接口；
6. 编写状态转换检查。

### 阶段 B：视频核心闭环

1. 工程师案例确认；
2. 工程师退出与专家账号登录；
3. 专家审核详情；
4. 专家发布接口；
5. 知识更新结果；
6. 图谱发布效果；
7. 快速验证。

### 阶段 C：展示宽度

1. 历史案例列表；
2. 只读详情；
3. 预置知识列表；
4. 人员展示；
5. PPT 截图状态。

### 阶段 D：录制验收

1. 一键重置；
2. 从头走完整主线；
3. 刷新检查状态；
4. 后端重启检查状态；
5. 记录实际耗时；
6. 检查控制台；
7. Node 20.19.4 构建；
8. 龙芯开发态逐模块验证。

## 19. 测试与验收用例

### 19.1 主路径

```text
reset
→ engineer adopt result
→ submit
→ refresh
→ switch expert
→ open review
→ adopt expert conclusion
→ accept graph
→ publish
→ refresh
→ knowledge V1.1
→ verify
→ match V1.1
```

### 19.2 状态保护

- 工程师不能发布知识；
- 专家不能在未提交时发布；
- 图谱未决定不能发布；
- 已发布不能重复发布；
- 历史案例没有编辑按钮；
- 管理员没有专业修改按钮。

### 19.3 持久化

- 工程师提交后刷新仍待专家审核；
- Flask 重启后仍待专家审核；
- 发布后刷新仍为 V1.1；
- reset 后刷新恢复 V1.0。

### 19.4 UI

- 1366×768 主流程无重叠；
- 1920×1080 适合录屏；
- 列表不少于 10 条展示数据；
- 专家主要按钮无需滚动过长距离；
- 图谱关系不遮挡关键文字；
- 成功反馈在视频中清晰可见。

## 20. 完成后的文档更新

实现完成后必须更新：

- `current-development-status.md`；
- 本 Spec 的实现状态；
- API 说明；
- 演示重置说明；
- 视频实际录制时长；
- 龙芯验证结果。

## 21. 当前实现审计与剩余计划

> 2026-07-11 更新：本节所列 P0 缺口已完成 WSL 实施与浏览器回归；保留本节作为实现审计记录。龙芯实体机验证仍按第 22.3 节单独验收。

### 21.1 已完成基础

- presentation JSON 和单文件持久化状态；
- 工程师、专家独立登录入口；
- 工程师提交、专家发布、知识 V1.1 和验证接口；
- 后台工作台、历史摘要、预置知识和人员基础页面；
- 基础主路径能够点击完成。

以上只代表技术骨架可用，不代表视频成品完成。

### 21.2 必须补齐的 P0 缺口

1. 检修记录完成后必须自然生成并进入案例草稿，不能依赖用户重新寻找后台入口；
2. 工程师确认页必须清晰展示前序现场、诊断、方案、执行和恢复信息；
3. 工程师提交后必须退出并使用专家账号独立登录；
4. 专家页必须形成“现场证据—系统诊断—工程师结果—专家修订—知识变化”的可读主线；
5. 专家发布必须显示案例归档、知识更新、图谱写入三个连续阶段；
6. 图谱必须支持发布前变更预览、接受建议、发布后新增关系高亮和来源案例；
7. 知识详情必须展示 V1.0/V1.1、修改记录、来源案例和适用条件；
8. 历史案例必须具备故障类型、设备、场站和状态筛选；
9. 演示重置必须有二次确认、范围说明、过程状态和完成反馈；
10. 工程师一键填充、专家修订、知识发布和再次验证必须具备录屏可见的阶段动画；
11. 现有知识图谱入口必须能读取发布后的正式关系；
12. 完整视频主线必须在目标分辨率和时长内连续走通。

### 21.3 实施顺序

```text
A. 前台检修记录 → 案例草稿衔接
→ B. 工程师确认与提交
→ C. 专家独立登录与审核主线
→ D. 三阶段知识发布
→ E. 图谱变化与知识版本详情
→ F. 再次诊断验证
→ G. 历史展示和重置收口
→ H. 完整录屏计时验收
```

任何阶段不得以静态占位代替视频中必须发生的状态变化。

## 22. 录制级完成标准

只有同时满足以下标准，才允许将本 Spec 标记为完成：

### 22.1 连续业务闭环

- 从现有前台异常接入开始，无需开发者工具或手改 JSON；
- 完成诊断、预方案、检修向导和恢复验证；
- 检修记录自动生成案例草稿；
- 工程师确认并提交；
- 退出后使用专家账号登录；
- 专家修改结论、接受图谱建议并发布；
- 知识库显示 V1.1、来源案例和专家记录；
- 相似异常能够命中 V1.1 和新增图谱路径。

### 22.2 视觉与交互

- 1920×1080 和 1366×768 无遮挡、重叠或关键按钮不可见；
- 视频关键动作无需寻找隐藏入口；
- 发布和验证过程有清晰的阶段动画；
- 成功结果至少停留到用户主动继续；
- 专家门户不出现一线诊断功能；
- 历史只读内容不出现误导性编辑按钮；
- 刷新和账号切换后状态一致。
- 工程师案例入口只突出当前任务和唯一主操作，不以后台统计大盘作为默认入口；
- 所有视频主路径页面统一展示四步进度，并提供返回当前账号首页；
- 知识验证异常描述必须可编辑，不能使用只读文本域伪装输入框。

### 22.3 可靠性

- 一键重置后能够连续重复演示三次；
- Flask 重启后关键状态不丢失；
- 重复点击不会重复发布或破坏版本；
- 浏览器控制台无错误；
- 所有 API 错误有可理解提示；
- Node `20.19.4` 构建通过；
- Python 语法与接口主路径通过；
- `git diff --check` 通过。

### 22.4 视频计时

- 前台完整流程建议控制在 3 分 30 秒至 3 分 50 秒；
- 工程师提交约 30 秒；
- 专家审核与发布不超过 70 秒；
- 知识验证约 40 秒；
- 完整流程不超过 6 分 30 秒，保留至少 30 秒录制缓冲。

### 22.5 验收证据

最终验收必须记录：

- 完整流程实际用时；
- 两种目标分辨率截图；
- 发布前 V1.0 和发布后 V1.1 状态；
- 新增图谱关系；
- 验证命中结果；
- 控制台错误数量；
- 构建与接口测试结果；
- 尚未完成的龙芯验证（如有）必须单独标明，不能隐藏。

## 23. 专家三步审核流程修订（V1.3，2026-07-12）

### 23.1 修订原因

原专家页把证据、工程师结果、专家结论、知识和图谱同时横向展示，信息虽然完整，但专家无法快速判断“当前要做什么”。V1.3 将专家任务收敛为三个有明确完成条件的步骤，一次只展示一个主体任务。

### 23.2 固定流程

1. **审核并修正案例**：左侧只读显示现场证据、告警参数、Agent 诊断、执行和恢复结果；右侧编辑最终原因、实际处理、恢复结果和知识价值，并选择“修正后通过 / 退回补充 / 仅归档案例”。
2. **修正知识与知识图谱**：编辑适用设备、异常现象、判断条件、故障原因、检查顺序、处理方法、安全要求、恢复标准和不适用范围；图谱使用“源节点—关系—目标节点”的关系表，可增加、修改、删除并预览。
3. **确认并发布**：只读汇总案例修订、知识 V1.0→V1.1 变化、图谱变化和发布影响；允许返回前两步，确认后连续展示案例归档、知识生成和图谱写入。

### 23.3 页面框架

- 顶部固定显示案例编号和三步进度；
- 左上角始终可返回专家工作台；
- 中央只显示当前步骤的主任务；
- 右侧固定为紧凑案例速览和专家修改记录；
- 底部固定显示上一步、保存草稿和下一步/发布；
- 专家页不再重复展示全局四步业务进度，避免双重导航竞争。

### 23.4 数据与接口

- `presentation_state.json` 升级至 `schemaVersion: 2`；
- 新增 `expertDraft`、`expertAnnotations`、`publishedKnowledge`、`publishedRelations`；
- 新增 `POST /api/admin/cases/:id/expert-draft`，用于刷新后继续审核；
- 发布接口接收完整专家草稿，并校验 9 个知识字段和至少一条图谱关系；
- 发布成功后仍沿用 `archived_with_knowledge`、知识 V1.1 和来源案例追溯机制。

### 23.5 录制级验收

- 专家首次进入后 5 秒内能理解当前步骤和唯一主操作；
- 三步之间可以前进、返回，已输入内容不丢失；
- 保存草稿后刷新页面可以恢复；
- 图谱关系可以新增、修改和删除；
- 最终页能够清楚说明“改了什么、为什么发布、发布后影响哪里”；
- 从进入专家审核到确认发布建议控制在 60 秒内。
