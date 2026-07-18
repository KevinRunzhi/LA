# LA 项目 Codex 交接文档

更新时间：2026-07-17

适用对象：新开启的 Codex 对话、临时接手开发的协作者
文档性质：当前代码与产品状态的交接快照

> 新对话开始后，请先完整阅读本文，再阅读 `Docs/README.md` 与任务相关的 Spec。不要仅凭旧聊天、Windows 目录中的副本或较早的状态文档判断当前实现。

## 1. 一句话认识项目

本项目是面向油气场站工控设备检修的演示型智能系统，当前主案例是“山东德州分输站站控柜 A01 中，研华 ACP-4000 / IPC-610 工控机出现 TEMP/FAN 告警及散热异常”。产品通过工程师接诊、动态诊断、可编辑检修预方案、现场检修向导、检修完成记录、专家审核、知识发布和工程师知识同步，展示一个完整的知识回流闭环。

项目以比赛汇报和约 7 分钟演示视频为主要交付目标。界面可以使用预置案例与模拟 Agent 输出，但“案例提交 → 专家修订 → SQLite 发布 → 工程师同步 → 新知识命中/图谱更新”这一段已经做成真实的本地状态闭环。

## 2. 必须遵守的硬约束

1. **唯一开发仓库在 WSL**：`/home/kevin/projects/LA`。
2. Windows 的 `E:\match\LoongArch`、下载目录、视频目录和资料目录可以存素材，但不是代码事实来源；除非用户明确要求，不要修改 Windows 项目副本。
3. 固定使用 Node.js `20.19.4`、npm `10.8.2`。项目根目录 `.nvmrc` 和 `frontend/package.json` 均已冻结该版本。
4. 后端使用 Python 3 + Flask；当前 WSL 虚拟环境为 Python `3.12.3`，路径为 `backend/.venv`。
5. 不使用 Docker。龙芯麒麟开发态同样使用 Node `20.19.4` 启动 Vite，并逐模块验证。
6. UI 和业务发生冲突时，优先级依次为：用户当前明确要求 → 本交接快照 → `Docs/current-development-status.md` → 2026-07-10 老师意见和对应 R0 Spec → 其他旧文档。
7. 文档清理坚持“宁可少删，不要误删”。MVP 计划、状态总结、PRD、评审流程、老师意见和有效 Spec 必须保留。
8. 不要覆盖工作区里尚未提交的用户修改；开始任何新改动前先执行 `git status --short --branch` 和 `git diff`。

## 3. 仓库和 Git 状态

交接时的仓库信息：

```text
WSL 路径：/home/kevin/projects/LA
分支：main
HEAD：以 `git rev-parse HEAD` 的当前输出为准
远端：origin/main
提交作品前应确认 `main` 与 `origin/main` 同步
```

最近重要提交：

```text
91951de fix: include registered manuals in deployment package
5825fe7 fix: optimize assistant streaming scroll on low-end devices
0eadc89 chore: prepare formal LoongArch demo release
4e0e2b4 fix: refine contextual maintenance assistant answers
16c2679 merge: align knowledge display
e996025 fix: align knowledge display
aa0023e fix: remove Windows zone identifier
```

### 3.1 已纳入提交作品版本的调整

以下调整已经作为提交作品版本的一部分保留，后续修改时不要无意回退：

- `frontend/src/App.jsx`
  - 所有 Agent 的随机思考等待由 `0.6–1.8 秒`增加为 `2.1–3.3 秒`，即整体再增加 1.5 秒。
  - 第一个接诊 Agent 的固定等待由 `1.5 秒`增加为 `3 秒`。
- `frontend/src/admin/AdminShell.jsx`
  - 知识条目 `KB-008` 的标签由“唯一完整案例闭环”改为“案例闭环”。
- `frontend/src/admin/user-management.css`
  - 管理员用户管理中心的左侧栏改为固定在视口内并可独立滚动，确保页面较长时底部“退出登录”可见。
`output/pdf/` 是生成的演示作业卡目录，不作为 Git 源码提交；比赛源码包可以包含其中的示例 PDF。新对话接手后仍应先检查工作区，不要用 `git reset --hard`、`git checkout --` 等命令清理未知修改。

## 4. 产品主线与老师要求

老师强调的界面主次关系如下：

- 中间工作区是主业务空间，用于工作人员与系统交互。
- 右侧“检修智能体”是辅助区域，展示 Agent 思考、依据、会诊过程和对话，不应抢占中央业务空间。
- 接诊卡片出现时要有淡入、缩放等动画。
- 信息出现顺序是：发生时间 → 发生地点 → 发生事件 → 其他现象 → 依据标准/操作手册。
- 上一步确认的已知信息收缩到顶部或左上角，不继续占据中央主体。
- 发生地点（场站布局图或设备拓扑图）在中央重点展示，故障点标在站控柜位置。
- 页面内容增多后仍要保持一条清晰主线，避免同时铺开过多卡片。

目前 R0 中央态势式接诊、顶部已知信息、中央场站图、周边动态卡片和右侧 Agent 区域已经有可演示实现。旧文档中“V1.2 等待重新实施”“R0 尚未完成单页状态机”等描述已落后于当前代码，判断实际能力时应以页面和本交接为准。

## 5. 三类角色和登录

登录页提供三种演示身份：

| 身份 | 页面账号 | 密码 | 登录后入口 |
| --- | --- | --- | --- |
| 工程师 | `worker001` | `123456` | 工程师首页、诊断台、知识图谱、检修记录、设置 |
| 专家 | `expert001` | `123456` | 独立专家门户，不显示工程师诊断台 |
| 管理员 | `admin` | `123456` | 独立用户管理中心 |

注意：当前登录是演示登录，不是真实鉴权。页面根据选中的身份进入对应门户，尚未校验用户实际输入的账号和密码。后端角色切换也属于演示状态，不具备生产级认证和授权。

角色定位：

- 工程师（李师傅）：完成异常接入、诊断、检修、结果确认和案例上传。
- 专家（第一版只需一个可审全部案例的专家）：检查和修正案例、结构化知识及图谱关系，然后直接发布。
- 管理员：只做账号与平台治理，默认不能修改专业案例结论和检修知识。

专家审核顶部流程只保留三步：工程师确认 → 专家审核 → 知识发布；“应用验证”第四步已经按用户要求移除。

## 6. 工程师完整演示流程

推荐从全新状态按以下顺序演示：

1. 使用 `worker001` 登录。
2. 首页输入现场描述，并可上传故障图片、视频、音频。图片以小型宫格缩略图展示，不铺满页面。
3. 点击开始接诊，Agent 先等待一段时间，再开始流式输出。
4. 按发生时间、发生地点、发生事件、其他现象、依据/手册逐项确认。
5. 中央持续突出山东德州分输站场站图和站控柜 A01 故障点，文字解释主要进入右侧“检修智能体”。
6. 进入异常事件全景和多 Agent 分析。多 Agent 的详细会诊动画已迁移到右侧，中央只保留业务状态。
7. 查看诊断结论以及“为什么得出该判断”的证据来源。
8. 进入 R2 可编辑检修预方案：系统先生成大步骤和小维修步骤，工程师可增、删、改、调整顺序；安全项保持受控。
9. 确认预方案后进入逐步检修向导，完成各步骤和恢复观察。
10. 生成检修完成记录。该页整合现场事实、诊断依据、完成步骤、处理前后指标、现场材料和实际检修结果。
11. 点击“上传至专家知识库”。不再进入独立“案例回流”页面；上传成功即表示案例进入专家待审核库。
12. 退出工程师账号。

重要产品决定：工程师侧已经取消独立案例回流工作台。案例回流能力集中在“检修完成记录”页，按钮“上传至专家知识库”是工程师侧闭环终点。

## 7. 专家审核与知识回流演示流程

1. 使用 `expert001` 登录独立专家门户。
2. 左侧菜单进入专家工作台，看到 `CASE-ACP4000-001` 待审核案例。
3. 打开案例，按步骤查看工程师现场事实、诊断结论、实际处理和恢复结果。
4. 专家可手动修注与标正：
   - 最终故障原因；
   - 实际处理与知识价值；
   - 结构化知识字段；
   - 一条或多条知识图谱关系。
5. 专家修改后可直接通过，不要求再退回工程师确认。若现场事实或材料确实缺失，业务文档允许以后增加“退回补充”，但第一版演示主线不强调它。
6. 一条案例允许同时更新多条知识；当前完整演示集中更新 `KB-008`，由 V1.0 发布为 V1.1。
7. 发布后，案例状态变为 `archived_with_knowledge`，知识版本、来源案例和图谱关系写入 SQLite。
8. 专家“检修知识图谱”可查看当前图谱和本次更新；节点详情中的可信等级统一使用“正式资料依据”，不再使用“预置展示知识”。
9. 专家退出登录。
10. 工程师重新登录，进入工程师知识图谱。
11. 工程师本地快照若仍是旧版本，点击同步最新知识。
12. 同步后应看到 `KB-008 V1.1` 和专家新增/修订的图谱关系，再进行知识回流验证或相似异常问答。

这段不是纯 JSON 假演示：案例状态、专家草稿、知识版本、图谱关系和工程师同步快照由 SQLite 持久化。

## 8. 当前唯一完整案例与第二案例

### 8.1 完整交互案例

```text
案例：CASE-ACP4000-001
记录：REC-ACP4000-001
场站：山东德州分输站
位置：站控柜 A01
设备：研华 ACP-4000 / IPC-610 工控机
故障：TEMP/FAN 告警、风扇低速、散热异常
动态知识：KB-008
版本变化：V1.0 → V1.1
```

发布后的核心专家结论：滤网积尘导致风道阻力升高，风扇老化导致转速持续偏低；清理风道后若转速仍未恢复，应更换老化风扇并核对 FAN1/FAN2 接线。

### 8.2 第二案例

第二案例资料来源原位于 Windows：`E:\match\LoongArch\Info\case-02-rockwell-6300-power`。WSL 中已经有结构化整理文档：

`Docs/case-02-rockwell-6300-power-structured-summary.md`

第二案例目前主要用于扩充案例库、知识库和 PPT 内容，尚未做成与案例一等价的完整交互闭环。不要误称它已经完整开发；是否将其接入交互流程需要用户另行确定。

历史案例库展示采用“1 条完整可交互案例 + 约 10 条只读摘要”的演示策略。摘要案例可以点开查看一页内容，但不必具备编辑、审核和发布能力。

## 9. 当前 SQLite 演示状态与重置

交接时数据库状态已经走完一次完整流程：

```text
activeRole = engineer
caseStatus = archived_with_knowledge
engineerSubmitted = true
expertApproved = true
graphDecision = accepted
knowledgePublished = true
knowledgeVersion = 1.1
feedbackVerified = false
```

SQLite 文件：

`backend/data/presentation/presentation.db`

初始状态来源：

`backend/data/presentation/initial_state.json`

从头录制或重新演示前，必须执行：

```bash
curl -X POST http://127.0.0.1:8080/api/presentation/reset
```

该接口会重置页面使用的演示状态和 SQLite 数据。只刷新浏览器不会重置数据库。重置后预期状态为：

```text
activeRole = engineer
caseStatus = awaiting_engineer_confirmation
knowledgePublished = false
knowledgeVersion = 1.0
```

## 10. 技术架构与关键文件

### 10.1 前端

- React 18 + Vite 6，主要代码仍集中在 `frontend/src/App.jsx`。
- 全局样式主要在 `frontend/src/styles/app.css` 和 `tokens.css`。
- 专家/案例回流门户：`frontend/src/admin/AdminShell.jsx`、`admin.css`。
- 管理员用户中心：`frontend/src/admin/AdminUserPortal.jsx`、`user-management.css`。
- 工业知识图谱：`frontend/src/admin/knowledge-graph/IndustrialKnowledgeGraphPage.jsx`。
- 主流程 API 及离线兜底：`frontend/src/api/client.js`。
- 案例回流 API：`frontend/src/admin/presentationApi.js`。
- Agent 流式组件：`frontend/src/components/chat/StreamingMarkdown.jsx`、`ThinkingProcess.jsx`、`SourceCard.jsx`。
- 检修作业卡/PDF：`frontend/src/components/records/MaintenanceJobCardPrint.jsx`。

### 10.2 后端

- Flask 入口和 API：`backend/app.py`。
- SQLite 状态与发布事务：`backend/presentation_store.py`。
- 依赖：`backend/requirements.txt`。
- 测试：`backend/test_presentation_store.py`、`backend/test_content_catalog.py`。

### 10.3 数据源

- 主场景：`backend/data/demo_scenario.json`。
- 检修步骤：`backend/data/guide_steps.json`。
- 完整案例：`backend/data/presentation/case_full_001.json`。
- 案例摘要：`backend/data/presentation/cases.json`。
- 知识库：`backend/data/presentation/knowledge_base.json`。
- 手册目录：`backend/data/presentation/manual_sources.json`。
- 工业知识图谱：`backend/data/presentation/industrial_computer_graph.json`。
- 用户展示数据：`backend/data/presentation/users.json`。
- SQLite：`backend/data/presentation/presentation.db`。

JSON 是预置内容和重置种子，SQLite 负责案例回流和知识同步的动态状态。主诊断流程仍包含大量前端状态与预置 Agent 文案，不应误称为真实大模型推理。

## 11. 主要 API

基础与诊断：

```text
GET  /api/health
GET  /api/demo/scenario
POST /api/diagnosis/start
GET  /api/guide/steps
POST /api/guide/steps/<step_id>/complete
POST /api/records/generate
GET  /api/knowledge/evidence
GET  /api/knowledge/graph
```

案例回流与专家发布：

```text
GET  /api/presentation/state
POST /api/presentation/reset
POST /api/presentation/role
GET  /api/admin/users
GET  /api/admin/cases
GET  /api/admin/cases/<case_id>
POST /api/admin/cases/<case_id>/submit
POST /api/admin/cases/<case_id>/expert-draft
POST /api/admin/cases/<case_id>/graph-decision
POST /api/admin/cases/<case_id>/publish
GET  /api/admin/knowledge
GET  /api/admin/knowledge/<knowledge_id>
GET  /api/admin/knowledge/<knowledge_id>/diff
GET  /api/admin/manuals
GET  /api/admin/knowledge-graph?view=overview|changes
```

工程师同步与验证：

```text
GET  /api/engineer/knowledge-sync
POST /api/engineer/knowledge-sync
GET  /api/engineer/knowledge-snapshot
POST /api/knowledge/verify-feedback
```

## 12. 启动、重启和验证

### 12.1 WSL 中用两个终端启动（最清楚）

后端：

```bash
cd /home/kevin/projects/LA/backend
source .venv/bin/activate
python app.py
```

前端：

```bash
source ~/.nvm/nvm.sh
nvm use 20.19.4
cd /home/kevin/projects/LA/frontend
npm run dev -- --port 3000
```

访问地址：

```text
前端：http://localhost:3000
后端：http://localhost:8080
健康检查：http://localhost:8080/api/health
```

### 12.2 从 Windows/Codex 隐藏启动

电脑重启后，单次 `wsl ... nohup ...` 可能因为 WSL 生命周期而退出。可用 Windows 隐藏的持久 WSL 进程：

```powershell
$backendArgs = '-d Ubuntu --cd /home/kevin/projects/LA/backend /home/kevin/projects/LA/backend/.venv/bin/python app.py'
Start-Process -FilePath wsl.exe -ArgumentList $backendArgs -WindowStyle Hidden

$frontendArgs = '-d Ubuntu --cd /home/kevin/projects/LA/frontend /home/kevin/.nvm/versions/node/v20.19.4/bin/npm run dev -- --port 3000'
Start-Process -FilePath wsl.exe -ArgumentList $frontendArgs -WindowStyle Hidden
```

验证：

```powershell
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

交接时两个服务已启动并验证：前端 HTTP 200，后端返回 `{"service":"la-mvp-backend","status":"ok"}`。

## 13. 流式输出与龙芯性能

龙芯麒麟机器性能较弱，工程师在右侧“检修智能体”中发问时，流式文字期间的自动滚动曾跟不上；多 Agent 分析区相对流畅。已经在提交 `5825fe7` 中针对低性能设备优化滚动：降低滚动调度压力，使用分段跟随，而不是每个字符都强制平滑滚动。

当前关键常量位于 `frontend/src/App.jsx`：

```text
ASSISTANT_STREAM_SCROLL_INTERVAL = 120 ms
ASSISTANT_STREAM_SCROLL_MIN_STEP = 18
ASSISTANT_STREAM_SCROLL_MAX_STEP = 72
```

用户偏好是“字符输出可以快一些，但滚动可慢一点并持续贴着输出”。不要恢复成每字符一次 `scrollIntoView({behavior: 'smooth'})`，这在龙芯上容易堆积动画帧，表现为输出结束后才突然滚到底。

尚未提交的 Agent 等待时间调整为：普通 Agent 随机 `2.1–3.3 秒`，第一个接诊 Agent `3 秒`。这是为了先展示思考加载圈，再开始流式输出。

## 14. 已完成的重要细节和产品决定

- 所有“某输气场站”主案例描述已统一为“山东德州分输站”。
- 场站图故障标点已移动到站控柜，而不是道路位置。
- 上传图片/视频/音频采用缩略图宫格，避免挤掉中央现场材料。
- 设备位置识别是独立业务模块，不与现场材料混排；确认后中央保留场站图模块。
- 左侧异常诊断流程支持收缩，默认可仅显示编号。
- 右侧标题已由“辅助对话”改为“检修智能体”。
- 多 Agent 会诊详细动画已迁移到右侧，并有自动向下滚动。
- “接入摘要”旧命名和单独覆盖式页面已被重新组织；现在强调异常事件全景和主线式业务确认。
- R2 预方案支持大步骤 + 小维修步骤的可编辑提纲。
- 工程师侧案例回流合并进检修完成记录，不再保留独立页面。
- 检修完成记录支持打印作业卡；后台案例/知识不做 PDF 导出或打印。
- 专家侧有工作台、全部案例、检修知识库、知识图谱和设置等左侧菜单。
- 管理员独立进入用户管理中心，不显示诊断台。
- “后端已连接”绿色小组件已删除。
- 首页知识库状态展示数值按后台知识内容的两倍显示，这是用户明确要求的展示口径，不要擅自改回真实计数。
- 快速接诊已统一状态颜色：已接入内容使用绿色表达。
- 知识图谱节点详情可信等级统一为“正式资料依据”。
- 专家流程仅 1、2、3 步，不做第四步“应用验证”。
- 高风险知识自动停用、专家待办提醒、后台案例 PDF/打印均不属于第一版范围。

## 15. 当前限制和不要误判的地方

1. **没有真实大模型**：Agent 回复、诊断和多模态识别主要由预置数据、前端状态和流式动画模拟。
2. **媒体不持久化**：上传的图片/视频/音频主要用于当前浏览器会话预览；回流包保存的是元数据，不是完整文件存储。
3. **登录不是鉴权**：账号密码仅用于演示界面，不具备安全认证。
4. **只有一个完整闭环案例**：其他案例大多是只读摘要，第二案例仍是结构化资料阶段。
5. **SQLite 只接了知识回流与同步**：前面的接诊、预方案和向导没有全部数据库化，这是有意的轻后端策略。
6. **状态文档存在滞后**：`Docs/current-development-status.md` 最后更新时间早于最近代码提交，部分“未完成”条目实际上已经实现。后续应基于代码与实测更新它。
7. **龙芯仍需逐模块实机验收**：WSL 通过不等于龙芯完成，尤其关注滚动、动画帧率、Vite/Rollup 平台包和 PDF 打印。
8. **不要依赖 Windows Zone.Identifier**：该元数据文件已从 Git 中删除，不影响图片本体；不要重新加入仓库。

## 16. 有效文档阅读顺序

新对话建议按任务需要阅读，不要一次把全部旧文档当成同等权威：

1. 本文 `CODEX-HANDOFF-2026-07-17.md`。
2. `Docs/README.md`：文档总入口和冲突规则。
3. `Docs/current-development-status.md`：了解原计划，但注意部分状态已滞后。
4. R0 页面：
   - `teacher-feedback-2026-07-10-dynamic-intake-workspace.md`
   - `r0-spatial-intake-workspace-redesign.md`
   - `r0-spatial-intake-workspace-spec.md`
   - `r0-right-agent-consultation-stream-spec.md`
5. R2 预方案：
   - `r2-editable-maintenance-plan-design.md`
   - `r2-editable-maintenance-plan-spec.md`
6. 案例回流：
   - `engineer-maintenance-record-feedback-spec.md`
   - `backend-case-feedback-business-plan.md`
   - `backend-case-feedback-development-spec.md`
   - `case-feedback-video-script-and-data.md`
   - `sqlite-knowledge-feedback-and-sync-spec.md`
7. 知识图谱：
   - `expert-knowledge-graph-display-spec.md`
   - `industrial-computer-knowledge-graph-development-spec.md`
   - `maintenance-knowledge-and-graph-content-expansion-spec.md`
8. 龙芯：
   - `runtime-and-loongarch-policy.md`
   - `loongarch-mvp-deployment-and-startup-guide.md`
   - `loongarch-stable-demo-deployment-guide.md`

## 17. 新 Codex 接手后的建议动作

先执行只读检查：

```bash
cd /home/kevin/projects/LA
git status --short --branch
git diff -- frontend/src/App.jsx frontend/src/admin/AdminShell.jsx frontend/src/admin/user-management.css
git log --oneline --decorate -8
source ~/.nvm/nvm.sh
nvm use 20.19.4
node -v
npm -v
backend/.venv/bin/python --version
curl http://127.0.0.1:8080/api/health
```

然后建议依次处理：

1. 保留并验证三处未提交 UI 修改；运行前端构建和后端测试。
2. 经用户确认后提交这些小修改，不要把 `output/pdf/` 自动混入提交。
3. 更新 `Docs/current-development-status.md`，消除它与当前代码的状态差异。
4. 在 WSL 浏览器走一遍三角色主流程；录制前调用演示重置。
5. 在龙芯上重点复测右侧流式滚动、Agent 等待动画、管理员退出、检修预方案初次渲染和 PDF 打印。
6. 若继续扩展业务，优先把第二案例和知识图谱内容扩充到展示级，不要先做大规模后端重构。

## 18. 验证命令

前端：

```bash
cd /home/kevin/projects/LA/frontend
source ~/.nvm/nvm.sh
nvm use 20.19.4
npm run build
node --test src/data/streamingAssistantDemo.test.js
```

后端：

```bash
cd /home/kevin/projects/LA/backend
.venv/bin/python -m unittest test_presentation_store.py test_content_catalog.py
.venv/bin/python -m py_compile app.py presentation_store.py
```

接口：

```bash
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/presentation/state
curl http://127.0.0.1:8080/api/engineer/knowledge-sync
```

UI 修改不能只依赖构建成功。至少手动检查：工程师登录与退出、R0 动画主线、右侧滚动、R2 初次渲染、检修记录上传、专家三步流程、知识发布、工程师同步、管理员退出按钮。

## 19. 给新对话的开场提示词

可在新 Codex 对话中直接发送：

```text
请先完整阅读 WSL 项目 /home/kevin/projects/LA/Docs/CODEX-HANDOFF-2026-07-17.md，
再阅读 /home/kevin/projects/LA/Docs/README.md 和与当前任务相关的 Spec。
真实开发仓库只在 /home/kevin/projects/LA，Node 固定使用 20.19.4。
开始修改前先检查 git status 和 git diff，保留交接文档列出的未提交改动。
读完后先向我概括当前阶段、未提交内容、SQLite 演示状态和你建议的下一步，不要立刻大范围改代码。
```

---

如果本文与新对话中用户的明确要求冲突，以用户最新要求为准；完成新功能后，应同步更新本文或 `current-development-status.md`，避免下一次交接再次依赖超长聊天记录。
