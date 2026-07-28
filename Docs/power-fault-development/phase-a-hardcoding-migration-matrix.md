# 阶段 A：散热硬编码迁移矩阵

> 日期：2026-07-26
> 用途：阶段 B/C/D/E 逐项清除业务组件中的单案例绑定

## 1. 搜索结果摘要

搜索范围：

```text
frontend/src
backend
```

排除：

```text
node_modules
dist
.venv
__pycache__
Markdown 文档
SQLite 和 pyc
```

| 关键词 | 命中数 |
| --- | ---: |
| `CASE-ACP4000-001` | 29 |
| `KB-008` | 40 |
| `TEMP/FAN` | 85 |
| `FAN1` | 40 |
| `FAN2` | 31 |
| `fanSpeedRpm` | 17 |
| `systemTemperatureC` | 16 |
| `cpuTemperatureC` | 16 |
| `ACP-4000` | 78 |
| `IPC-610` | 77 |

命中并不全部需要删除。案例包内容、测试 fixture 和官方知识可以保留；业务组件、运行状态和通用接口中的固定值必须迁移。

## 2. 高风险业务硬编码

| 文件与代表行 | 当前硬编码 | 业务表面 | 迁移目标 | 阶段 |
| --- | --- | --- | --- | --- |
| `frontend/src/App.jsx:76` | `PRESENTATION_CASE_ID` | 全工程师主流程 | `CaseSession.caseId` | C |
| `frontend/src/App.jsx:79-83` | 散热结果与三项指标 | 检修记录 | `output.engineerResult` Schema | C/D |
| `frontend/src/App.jsx:228-274` | 型号、角色、告警选项映射 | 首页/接诊 | `intake.json` | C/D |
| `frontend/src/App.jsx:290-353` | TEMP/FAN 分支判断 | 路由/接诊 | 服务端路由和 intake rules | B/C |
| `frontend/src/App.jsx:359-546` | 阈值和 guide visuals | 接诊/向导 | `intake.json`、`guide.json` | C |
| `frontend/src/App.jsx:582-906` | Agent 流程文案 | 接诊/诊断/向导 | diagnosis/guide DTO | C/D |
| `frontend/src/App.jsx:1167` | 首页散热建议 | 首页 | 路由状态和 CasePackage 摘要 | C |
| `frontend/src/App.jsx:2151-2166` | 快速接诊散热卡 | 首页 | registry 路由索引 | C/D |
| `frontend/src/App.jsx:2854-3258` | 散热依据、会诊和结论 | 诊断 | `diagnosis.json` | C |
| `frontend/src/App.jsx:3812-3963` | 记录、指标、知识和 case ID | 记录/上传 | run 快照与 `output.json` | C/E |
| `frontend/src/App.jsx:4761-4831` | 当前步骤建议 | 智能体 | `assistant.json` | C/D |
| `frontend/src/admin/AdminShell.jsx:8-9` | case ID 和验证输入 | 专家/知识 | selectedRunId、知识选择 | E |
| `frontend/src/admin/AdminShell.jsx:256-301` | 单案例工作台 | 工程师/专家 | 多案例列表和 URL 状态 | E |
| `frontend/src/admin/AdminShell.jsx:295-298` | 固定散热表单字段 | 专家审核 | 动态字段 renderer | E |
| `frontend/src/admin/AdminShell.jsx:319-378` | KB-008 V1.1 发布 | 专家发布 | 服务端版本事务 | E |
| `frontend/src/admin/AdminShell.jsx:567-619` | 本地散热知识图 | 工程师同步 | knowledgeId/version DTO | E |
| `frontend/src/components/records/MaintenanceJobCardPrint.jsx:140-143` | 固定散热指标 | PDF | 动态 metric renderer | E |
| `frontend/src/components/records/MaintenanceJobCardPrint.jsx:212-213` | case/knowledge ID | PDF 追溯 | jobCardSnapshot | E |
| `backend/app.py:228` | 固定散热结果必填字段 | 工程师提交 | CasePackage field validation | B/E |
| `backend/app.py:505` | 固定 KB-008 | 知识验证 | 请求 knowledgeId/version | E |
| `backend/presentation_store.py:107` | 固定版本 1.1 | 发布 | 服务端计算版本 | B/E |
| `backend/presentation_store.py:125-139` | 自动 `verified_case` | 图谱发布 | claim-level provenance | B/E |

## 3. 数据文件迁移

| 当前文件 | 现状 | 目标 | 阶段 |
| --- | --- | --- | --- |
| `backend/data/demo_scenario.json` | 单散热场景 | 散热 CasePackage diagnosis/intake | C |
| `backend/data/guide_steps.json` | 固定五步 | 散热 `guide.json` | C |
| `backend/data/knowledge_items.json` | 旧证据列表 | 共享知识或兼容层 | C |
| `backend/data/graph_relations.json` | 旧图谱关系 | 基线图谱兼容层 | C/E |
| `backend/data/presentation/case_full_001.json` | 单个大 JSON | 模块化散热案例目录 | C |
| `backend/data/presentation/knowledge_base.json` | KB-008 与共享知识混合 | 共享知识 + 版本化运行发布 | B/C/E |
| `backend/data/presentation/industrial_computer_graph.json` | 基线与变更模板混合 | 基线图谱 + 发布增量 | B/E |
| `frontend/src/data/fallbackDemo.js` | 散热离线兜底 | 通用 CasePackage fixture/兼容层 | C |
| `frontend/src/data/streamingAssistantDemo.js` | 散热问答和通用问答混合 | `assistant.json` + 通用 fallback | C/D |

## 4. 可保留内容

以下内容不是错误硬编码，可在迁移后作为案例数据保留：

- ACP-4000 / IPC-610 官方设备身份；
- TEMP/FAN 官方告警含义；
- 风扇低于 500 rpm 判据；
- 系统 55℃、CPU 70℃ 判据；
- FAN1/FAN2 连续接入要求；
- SW1 风扇数量配置；
- FAN 针脚定义；
- 断电和防静电要求；
- 散热专用图片和问答。

保留条件是它们只能存在于散热 CasePackage、共享官方知识或测试 fixture，不再存在于通用业务组件的判断逻辑中。

## 5. 迁移完成检查

阶段 C 结束时重新执行相同搜索。允许命中的位置：

```text
backend/data/cases/CASE-ACP4000-001/
共享知识库中的官方散热知识
散热专用静态素材
明确标记的兼容 adapter
测试 fixture 和断言
```

以下位置不得再命中案例业务常量：

```text
通用 React 页面组件
通用 API client
CaseSession reducer/store
通用记录和 PDF renderer
专家多案例选择逻辑
通用发布、图谱和同步服务
```
