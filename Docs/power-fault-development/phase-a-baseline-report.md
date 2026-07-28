# 阶段 A：基线冻结与迁移准备验收报告

> 执行日期：2026-07-26
> 执行分支：`feature/industrial-computer-power-fault`
> 结论：通过阶段 A 门禁，可以进入阶段 B
> 业务代码变更：无

## 1. 执行摘要

阶段 A 已完成：

- WSL 开发环境核对；
- 前后端、数据、测试和启动入口调查；
- SQLite 备份、只读结构审计和恢复校验；
- 散热案例硬编码迁移矩阵；
- 散热案例可信度审计；
- 前端构建、前端问答测试、后端测试和 Python 编译检查；
- Flask 健康与主要 API 检查；
- 散热案例浏览器完整业务链路；
- 两页作业卡 DOM 结构检查；
- 专家发布、图谱增量和工程师同步检查；
- 浏览器控制台检查。

测试期间产生的 SQLite 变化已经从阶段开始前备份恢复，恢复后的数据库哈希与原始哈希一致。

## 2. 环境基线

| 项目 | 结果 |
| --- | --- |
| 主仓库 | `/home/kevin/projects/LA` |
| 分支 | `feature/industrial-computer-power-fault` |
| 要求 Node | `20.19.4` |
| 要求 npm | `10.8.2` |
| 实际 Python | `3.12.3` |
| Flask | `3.0.3` |
| 前端 | React 18 + Vite 6.4.3 |
| 后端端口 | `8080` |
| Vite 开发端口 | `3000` |

WSL 默认 shell 的 Node 为 `18.19.1`、npm 为 `9.2.0`，不符合项目基线。通过：

```bash
source ~/.nvm/nvm.sh
nvm use 20.19.4
```

可以正确切换到：

```text
Node v20.19.4
npm 10.8.2
```

后续所有前端构建和测试必须显式切换版本，不能依赖默认 Node。

## 3. 当前代码和数据入口

### 3.1 前端

| 入口 | 当前职责 |
| --- | --- |
| `frontend/src/main.jsx` | React 挂载 |
| `frontend/src/App.jsx` | 工程师首页、接诊、诊断、预方案、向导、记录、问答和部分图谱；约 242 KB 单体 |
| `frontend/src/admin/AdminShell.jsx` | 专家、管理员、知识、发布、同步和部分图谱 |
| `frontend/src/admin/knowledge-graph/IndustrialKnowledgeGraphPage.jsx` | 专家和工程师共用的全局/变更知识图谱 |
| `frontend/src/components/records/MaintenanceJobCardPrint.jsx` | 两页打印作业卡 |
| `frontend/src/api/client.js` | 工程师主流程旧 API 和离线兜底 |
| `frontend/src/admin/presentationApi.js` | 后台案例回流 API |
| `frontend/src/data/fallbackDemo.js` | 散热离线兜底内容 |
| `frontend/src/data/streamingAssistantDemo.js` | 步骤问答主题、宽松意图和回答 |

当前工程师主流程大量状态直接保存在 `App.jsx` 的 `useState` 中，没有统一 CaseSession、runId 或 revision。

### 3.2 后端

| 入口 | 当前职责 |
| --- | --- |
| `backend/app.py` | Flask 应用、全部路由、旧案例数据装载和前端静态托管 |
| `backend/presentation_store.py` | SQLite 初始化、reset、审核发布、图谱和同步 |
| `backend/data/demo_scenario.json` | 旧散热场景 |
| `backend/data/guide_steps.json` | 旧五步向导 |
| `backend/data/presentation/case_full_001.json` | 当前完整散热案例 |
| `backend/data/presentation/knowledge_base.json` | 17 条知识和动态知识 KB-008 |
| `backend/data/presentation/industrial_computer_graph.json` | 56 个基线节点、70 条基线关系及散热变更模板 |
| `backend/data/presentation/presentation.db` | 当前运行、发布和同步状态 |

### 3.3 当前 API

当前存在 31 个演示 API 规则，分为：

- 健康、场景、诊断、向导和记录；
- 工程师提交、专家草稿和发布；
- 案例、知识、手册和图谱；
- 工程师知识同步；
- 全局 presentation state、role 和 reset。

当前缺少：

- 案例路由 API；
- CaseRun 创建和读取 API；
- runId、revision 和幂等键；
- 阶段/角色 DTO；
- 数据库迁移 API 或命令。

## 4. SQLite 开始前基线

### 4.1 备份

备份文件位于未提交目录：

```text
output/case-platform-baseline/database-backups/
presentation-before-phase-a-20260726-190632.db
```

原始和备份 SHA-256：

```text
9F093F047C05F5A1A96DD25D99BC8450D384C761245615860B4710FF5793C505
```

文件大小：

```text
106496 bytes
```

验收结束后已经恢复该备份，恢复后哈希相同。

### 4.2 表和记录数

| 表 | 开始前记录数 |
| --- | ---: |
| `presentation_state` | 1 |
| `cases` | 1 |
| `expert_reviews` | 0 |
| `knowledge_items` | 1 |
| `knowledge_versions` | 1 |
| `graph_nodes` | 56 |
| `graph_relations` | 0 |
| `engineer_sync_records` | 1 |

开始前状态：

```text
activeRole = expert
caseStatus = pending_expert_review
engineerSubmitted = true
knowledgePublished = false
knowledgeVersion = 1.0
graphDecision = pending
```

### 4.3 初始化和 reset 风险

`PresentationStore.initialize()` 只有在不存在 `presentation_state.id=1` 时才调用 reset。因此：

- 已有数据库不会自动获得新的完整案例种子；
- 不能依靠 `CREATE TABLE IF NOT EXISTS` 完成版本化数据迁移；
- 新表或新案例需要正式 migration 和 seed reconciliation。

当前 `reset()` 会依次删除以下全部表内容：

```text
presentation_state
cases
expert_reviews
knowledge_items
knowledge_versions
graph_nodes
graph_relations
engineer_sync_records
```

它会删除专家审核、发布版本和同步资产，不符合“重新开始只创建新 run”的产品决定。

当前 `publish()`：

- 固定发布 `1.1`；
- 使用 `INSERT OR REPLACE`；
- 删除同版本图谱再重建；
- 自动把节点和关系写成 `verified_case`；
- 不支持 expected version、revision 或 idempotency key。

这些问题进入阶段 B 的数据库和发布基础设施清单。

## 5. 自动化验证

### 5.1 前端构建

命令：

```bash
source ~/.nvm/nvm.sh
nvm use 20.19.4
cd frontend
npm run build
```

结果：通过。

```text
1603 modules transformed
dist/index.html
dist/assets/index-DVImWA5f.css
dist/assets/index-CUYd2XAT.js
```

### 5.2 前端问答测试

命令：

```bash
node --test src/data/streamingAssistantDemo.test.js
```

结果：4/4 通过。

覆盖：

- 宽松接线意图；
- 风扇低速原因意图；
- 当前步骤允许主题；
- 非允许步骤不返回专用答案。

### 5.3 后端测试

正确命令必须从仓库根目录执行：

```bash
backend/.venv/bin/python -m unittest discover -s backend -v
```

结果：10/10 通过。

第一次从 `backend/` 目录执行时，`test_presentation_store.py` 因 `from backend.app` 找不到包而导入失败。该结果属于测试启动目录约束，不是业务断言失败。

### 5.4 Python 编译

```bash
backend/.venv/bin/python -m compileall -q backend
```

结果：通过。

### 5.5 API

WSL 中 Flask 监听 `0.0.0.0:8080`。以下接口均返回 200：

```text
/api/health
/api/demo/scenario
/api/guide/steps
/api/knowledge/evidence
/api/admin/knowledge-graph?view=overview
/api/presentation/state
```

## 6. 浏览器完整链路验收

浏览器通过 `127.0.0.1:8080` 访问 WSL 内运行的 Flask 服务。直接使用 WSL `100.104.178.39` 地址被浏览器安全层阻止；代码和服务始终位于 WSL。

### 6.1 工程师主路径

通过：

1. `worker001` 登录；
2. 首页输入散热异常描述；
3. 确认时间；
4. 确认地点；
5. 自动识别 ACP-4000 / IPC-610 和 TEMP/FAN；
6. 确认运行状态；
7. 核对依据；
8. 形成异常事件全景；
9. 完成三 Agent 会诊；
10. 生成 5 阶段、23 项检修预方案；
11. 确认方案并进入五步向导；
12. 完成告警、断电、风道、部件和恢复检查；
13. 生成检修记录；
14. 上传专家。

### 6.2 步骤问答

在“检查滤网、风扇和接线”步骤提问：

> 这个接线顺序是怎么样的？

返回内容正确包含：

- 单风扇接 FAN1；
- 双风扇接 FAN1、FAN2；
- 多风扇从 FAN1 连续接入，不能跳号；
- 双风扇 SW1 Pin4/5/6 为 OFF/ON/OFF；
- Pin 1 GND、Pin 2 +12V_FAN、Pin 3 FAN_DEC；
- 断电、拍照、标记和防静电要求；
- 不根据线缆颜色自行换针。

### 6.3 作业卡

打印 DOM 中：

```text
job-card-sheet = 2
第 1 / 2 页 footer 存在
第 2 / 2 页 footer 存在
记录号 = REC-ACP4000-001
```

本阶段验证现有两页结构，不把它视为阶段 E 动态作业卡验收。

### 6.4 专家、图谱和同步

通过：

- `expert001` 登录；
- 专家三步审核；
- 发布 KB-008 V1.1；
- 生成 5 个变更节点和 6 条变更关系；
- 专家图谱可查看全局和本次变化；
- 工程师重新登录；
- 页面提示 V1.1 可同步；
- 同步后显示“本地知识 V1.1 已同步并参与诊断”。

验收后的测试状态为：

```text
caseStatus = archived_with_knowledge
knowledgeVersion = 1.1
graph nodes = 61
graph relations V1.1 = 6
engineer local version = 1.1
```

该状态仅用于验收确认，随后数据库已恢复到开始前状态。

### 6.5 控制台

整个浏览器验收过程中：

```text
error = 0
warning = 0
```

## 7. 可信度审计

### 7.1 官方资料可以证明

- ACP-4000 / IPC-610 散热结构；
- 风扇和滤网配置；
- TEMP/FAN 告警；
- 风扇低速、系统温度和 CPU 温度判据；
- FAN1/FAN2 连续接线；
- SW1 风扇数量配置；
- FAN 针脚；
- 断电和防静电要求。

### 7.2 当前仓库不能证明

仓库中没有与 `CASE-ACP4000-001` 绑定的真实：

- 现场原始照片或视频；
- 仪表或监控原始读数；
- 维修工单；
- 更换部件记录；
- 处理前后可核验证据；
- 真实专家签字。

因此以下数据目前是预设现场数据，而不是已取得的真实案例证据：

```text
420 rpm → 1280 rpm
系统温度 58℃ → 42℃
CPU 温度 74℃ → 58℃
观察 15 分钟
最终原因为滤网积尘叠加风扇老化
```

### 7.3 结论

当前顶层 `verified_case` 证据不足。阶段 B/C 应改成逐 claim 记录：

- 官方判据：`official_document`；
- 专家确认的组织和经验：`expert_confirmed`；
- 本次预设现场数据：内部未核验现场数据状态；
- 真实证据补齐后，再升级对应 claim，不整体升级案例。

产品界面继续按已确认口径显示“现场数据”，不显示“演示案例”徽标；内部可信等级必须如实保存。

## 8. 已发现的现有问题

| ID | 问题 | 影响 | 处理阶段 |
| --- | --- | --- | --- |
| A-01 | WSL 默认 Node 18.19.1，不是项目要求版本 | 可能导致构建差异 | B 前持续显式 `nvm use`，F 固化启动方式 |
| A-02 | 从 `backend/` 运行 unittest 会导入失败 | 测试命令容易误用 | B 统一仓库根测试命令 |
| A-03 | 后端测试直接操作正式演示数据库 | 测试会改变当前状态 | B 改为临时数据库 fixture |
| A-04 | 检修记录显示 4/4，没有计入第 5 个恢复步骤 | 记录与实际五步向导不一致 | C |
| A-05 | `reset()` 删除所有发布和同步资产 | 与新 run 产品决定冲突 | B |
| A-06 | 发布固定 V1.1 且使用 replace | 版本可能被覆盖 | B/E |
| A-07 | 预设数据自动写成 `verified_case` | 内部可信度失真 | B/C/E |
| A-08 | App.jsx 和 AdminShell 高度单案例绑定 | 第二案例会产生大量条件分支 | B/C |
| A-09 | 工程师主流程状态只在前端会话中 | 刷新不能恢复完整执行进度 | B/C |
| A-10 | 浏览器直接访问 WSL IP 被安全层阻止 | 自动验收需使用端口转发入口 | F |

A-04 需要在散热迁移时修复；其他问题已经进入相应阶段 Spec，不阻断阶段 A。

## 9. 阶段门禁结论

| 门禁 | 结果 |
| --- | --- |
| 当前结构和启动方式清楚 | 通过 |
| 散热主路径可重复 | 通过 |
| 数据库已备份并有结构摘要 | 通过 |
| 硬编码迁移矩阵完成 | 通过 |
| 可信度审计有结论 | 通过 |
| 构建、测试和关键 API 有结果 | 通过 |
| 浏览器完整链路通过 | 通过 |
| 测试后恢复原数据库 | 通过 |
| 未修改业务行为 | 通过 |

阶段 A 结论：**通过，可以进入阶段 B。**
