# 技术方案：工控设备异常检测与故障分析系统

## 1. 技术目标

本技术方案服务于“工控设备异常检测与故障分析系统”的首期实现。

首期场景继续采用油气管道场站叙事，主演示设备为研华 ACP-4000 / IPC-610 工控机整机，主演示故障固定为：

> 工控机高温告警 / 风道堵塞 / 散热异常

首期技术目标：

1. 支持油气场站一线人员通过 Web 页面进入异常检测流程。
2. 支持对话或预设异常事件作为入口，由大模型或缓存结果生成诊断摘要和步骤选项。
3. 支持步骤式检修向导作为主体交互，每一步展示操作说明、安全提醒、依据和图片占位区。
4. MVP 阶段只预留步骤图片位置和素材字段，不实现图片插入、上传、管理或真实图片展示；后续再补充预标注图片按步骤切换。
5. 支持 RAG 证据、知识图谱、多 Agent 会诊和专家回流作为支撑能力。
6. 支持检修完成记录和浏览器打印导出作业卡。
7. 支持部署并持续验证在 LoongArch + 银河麒麟环境中运行。
8. 不在本地部署大模型、向量数据库、图数据库、OCR、OpenCV、PyTorch 或 Docker 编排。

首期技术主线：

```text
对话/异常输入
  -> 大模型总结或读取预设缓存
  -> 匹配预设故障与步骤流
  -> 展示步骤选项
  -> 步骤式检修向导
  -> 按步骤展示图片占位区
  -> 安全合规检查
  -> 生成检修记录 / 导出作业卡
  -> 专家修正回流
```

首期演示策略：

1. 主流程以预置数据和缓存为主，保证演示稳定。
2. 大模型用于总结现象、包装步骤选项、生成解释文本；不承诺第一版完整泛化。
3. 连线专家、语音播报、视频输入只做模拟入口、状态标识和预留接口。
4. 每完成一个可运行迭代，都同步放到龙芯环境验证，避免最后集中适配。

---

## 2. 总体架构

推荐架构：

```text
平板/PC Web
  -> Vite 开发态前端或静态前端
  -> Python Flask API
      -> SQLite 本地业务库
      -> 预设演示流程与步骤库
      -> 步骤图片占位与素材字段预留
      -> 本地知识条目与案例
      -> 本地图谱实体/关系表
      -> 本地专家审核与回流记录
      -> 云端大模型 API
      -> 云端多模态识别 API（可选）
      -> 云端 embedding API（可选）
      -> 演示缓存与兜底数据
```

部署分层：

```text
开发环境：WSL
  - Node.js
  - Vue 3 或 React
  - Vite
  - Python 3 + Flask
  - SQLite
  - 云 API 联调配置
  - 演示图片占位、后续素材和音频素材准备

目标环境：LoongArch + 银河麒麟 V11/V10
  - Node.js（已确认可用，前端开发态直跑，按老师建议）
  - Python 3 + Flask API
  - SQLite 数据文件
  - 图片占位字段、缓存和演示数据
  - 一键启动脚本

可选加固部署
  - Nginx 静态托管前端
  - systemd 托管 Flask 后端
```

说明：

1. 老师建议前端在龙芯上直接用 Node 开发态启动，且当前已确认 Node.js 在龙芯上可用；首期按该方案优先验证。
2. 如果后续需要更规范部署，可补充前端构建 dist + Nginx 托管方案，但不作为第一版阻塞项。
3. 后端按老师建议优先采用 Python，方便大模型 API 编排、缓存和轻量数据处理。
4. 云 API 可作为真实智能能力调用，但主演示流程仍需准备缓存兜底，避免网络或服务波动影响演示。
5. 平板浏览器访问龙芯机器 IP 等双端网络联调问题暂不作为前期开发阻塞项，后期演示联调阶段再处理。
6. 龙芯平台不使用 Docker，本项目不设计 Docker 部署方案。

---

## 3. 技术选型

### 3.1 前端

建议：

- Vue 3 或 React。
- Vite。
- CSS 实现图片占位区；后续可接入普通图片展示。
- ECharts graph 用于知识图谱展示。
- 首期在龙芯目标机上使用 `npm run dev -- --host` 或等价命令启动前端。

不做：

- 不做 Three.js 主线。
- 不做真实三维建模。
- 不做 WebGL 依赖的核心功能。
- 不做 Electron。
- 不引入 `sharp`、`node-sass`、`better-sqlite3`、`sqlite3`、`bcrypt` 等容易触发原生编译的 npm 包。

前端页面核心：

1. 工作台。
2. 异常检测入口。
3. 步骤式检修向导。
4. 检修记录与导出。
5. 专家审核与知识回流。
6. 知识图谱组件或知识库页签。

### 3.2 后端

建议：

- Python 3。
- Flask。
- `requests` 或 Python 标准库 HTTP 客户端调用云 API。
- Python 标准库 `sqlite3` 操作本地数据库。
- 纯 Python 包优先。

避免：

- FastAPI / pydantic v2 作为首选。
- grpc 类 SDK。
- 依赖 C/C++/Rust 编译的 Python 包。
- 本地 OCR、OpenCV、PyTorch、ONNX Runtime。

原因：

1. 老师明确倾向 Python，认为大模型调用和环境配置更容易。
2. Flask 依赖轻，适合快速迭代和龙芯环境验证。
3. SQLite 为 Python 标准库支持，不需要额外部署数据库服务。
4. 目标机资源有限，后端只做编排、缓存、查询和持久化。

### 3.3 数据存储

首期使用 SQLite 保存：

1. 用户、角色和登录会话。
2. 演示故障、步骤流和步骤状态。
3. 步骤图片占位字段和后续素材索引。
4. 检修完成记录。
5. 知识条目和证据卡片 metadata。
6. 知识图谱实体和关系。
7. 专家 Agent 配置、会诊记录和经验记录。
8. 专家审核与修正记录。
9. 云 API 调用缓存。

首期不使用本地向量数据库和本地图数据库。小规模知识库可使用 SQLite 存 embedding JSON 或关键词检索兜底。

### 3.4 大模型与多模态识别

首期策略：

1. 云端大模型 API 用于对话总结、诊断摘要、步骤选项包装和解释文本生成。
2. 预设演示主流程必须有本地缓存，可断网演示。
3. 多模态识别可作为辅助能力，不作为主流程强依赖。
4. 不训练本地视觉模型，不部署本地大模型。

调用方式：

1. 优先 HTTP API。
2. 尽量不用官方 SDK，避免隐藏依赖。
3. 所有演示主线请求按输入、故障和步骤 ID 建缓存。

缓存策略：

```text
cache_key = scenario_id + input_type + normalized_user_input + step_id
```

缓存内容：

1. 大模型诊断摘要。
2. 步骤选项。
3. Agent 会诊意见。
4. 安全合规检查结果。
5. 证据引用。

---

## 4. 步骤式检修向导实现方案

### 4.1 设计原则

步骤式检修向导是第一版核心功能。

原则：

1. 步骤由预设流程驱动，不依赖现场实时生成。
2. 大模型可包装“看起来动态生成”的总结和步骤选项。
3. 每个步骤都必须可展示、可勾选、可返回、可完成。
4. 每个步骤预留图片占位字段，后续可以绑定一张预标注图片。
5. 每个步骤可以绑定安全要求、知识来源和完成条件。
6. 步骤执行结果最终汇总为检修完成记录。

### 4.2 主演示步骤流

主演示故障：

```text
工控机高温告警 / 风道堵塞 / 散热异常
```

建议步骤：

| 步骤 | 名称 | 用户动作 | 图片占位 |
|---|---|---|---|
| 1 | 定位异常设备 | 确认发生高温告警的站控柜和工控机 | `step-01-location` |
| 2 | 确认安全条件 | 确认通知值班负责人、静电防护和禁止带电拆卸要求 | `step-02-safety` |
| 3 | 检查风道 | 查看进风口、出风口和机柜通风是否堵塞 | `step-03-airflow` |
| 4 | 检查滤网和风扇 | 检查滤网积尘、风扇异响和运行状态 | `step-04-filter-fan` |
| 5 | 恢复验证 | 确认温度告警解除、数据上传稳定、运行状态恢复 | `step-05-verify` |

### 4.3 数据模型

```sql
guide_flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  fault_type TEXT NOT NULL,
  description TEXT,
  enabled INTEGER,
  created_at TEXT,
  updated_at TEXT
)
```

```sql
guide_steps (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT,
  instruction TEXT NOT NULL,
  safety_note TEXT,
  completion_condition TEXT,
  evidence_refs TEXT,
  asset_id TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

```sql
step_assets (
  id TEXT PRIMARY KEY,
  step_id TEXT,
  asset_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  caption TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

```sql
guide_sessions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL,
  current_step_id TEXT,
  diagnosis_summary TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

```sql
guide_step_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  operator_note TEXT,
  completed_at TEXT
)
```

### 4.4 向导接口

建议接口：

```text
POST /api/guide/start
GET  /api/guide/sessions/:id
POST /api/guide/sessions/:id/steps/:step_id/complete
POST /api/guide/sessions/:id/steps/:step_id/back
POST /api/guide/sessions/:id/ask
POST /api/guide/sessions/:id/finish
```

---

## 5. 图片占位与后续可视化预留方案

### 5.1 实现边界

MVP 阶段不做图片插入、图片上传、图片管理和真实图片展示，只在步骤式检修向导中保留固定尺寸图片区块和素材字段。后续迭代再把手动标注好的图片接入这些占位区。

明确不做：

1. 不做真实三维建模。
2. 不做可旋转模型。
3. 不做自动热点识别。
4. 不做自动坐标标注。
5. 不做复杂设备部件联动动画。
6. 不要求前端根据坐标动态画框。
7. MVP 不做图片插入、上传、替换、裁剪、预览和素材管理。

实现方式：

1. 每个步骤保留 `placeholder_key`、`asset_key`、`asset_url` 字段。
2. MVP 数据中 `asset_url` 可以为空，只展示占位容器和占位文案。
3. 占位容器尺寸固定，避免后续添加图片时破坏页面布局。
4. 后续团队完成手动标注图片后，只需要补充素材路径或静态资源，不改变步骤主流程。

### 5.2 后续素材目录预留

建议：

```text
assets/demo/high-temp-airflow/
  step-01-location.png
  step-02-safety.png
  step-03-airflow.png
  step-04-filter-fan.png
  step-05-verify.png
```

### 5.3 前端展示

页面结构：

```text
左侧：步骤列表与完成状态
中间：当前步骤图片占位区
右侧：操作说明 / 安全提醒 / 来源依据 / 辅助提问
底部：上一步 / 标记完成 / 下一步 / 提交专家审核
```

占位区表现：

1. 固定比例卡片或面板。
2. 文案显示“图片待补充”或“后续添加步骤示意图”。
3. 不阻断演示流程。

### 5.4 视觉风格

MVP 界面参考“站控慧眼 / 智能诊断台”示意图：

1. 整体使用浅色工作台背景、白色卡片、细边框和轻阴影。
2. 主强调色固定为冷静工业蓝 `#2563EB`，悬停色 `#1D4ED8`，弱强调背景 `#EEF4FF`；如确需轻微紫调，只允许使用辅助高亮 `#6366F1`。
3. 基础色固定为页面背景 `#F7F9FC`、卡片背景 `#FFFFFF`、边框 `#DDE4F0`、次级文字 `#64748B`、正文 `#0F172A`。
4. 页面结构采用左侧窄导航、中间诊断/向导主区域、右侧诊断流程与快捷操作。
5. 卡片圆角保持克制，界面应偏专业诊断台，而不是深色工业大屏。
6. 图片占位区要与整体卡片风格一致，后续替换为图片时不影响布局。

---

## 6. 知识图谱实现方案

知识图谱必须保留。赛题明确提到知识沉淀后纳入知识图谱，首期不使用图数据库，但必须有真实数据结构、查询、展示和回流机制。

### 6.1 实现原则

1. 使用 SQLite 保存实体和关系。
2. 使用 ECharts graph 或轻量 SVG 图展示子图。
3. 图谱不作为复杂图算法平台，只作为检修关系、影响范围和回流结果的可视化表达。
4. 专家修正后可以新增或更新关系。
5. 图谱内容可参与 RAG 上下文和步骤依据。

### 6.2 数据模型

```sql
kg_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  source_id TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

```sql
kg_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  evidence TEXT,
  confidence REAL,
  source_doc_id TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

实体类型：

1. station
2. cabinet
3. equipment
4. component
5. fault
6. cause
7. inspection_method
8. treatment
9. safety_requirement
10. case
11. impact

关系类型：

1. located_in
2. contains
3. has_fault
4. caused_by
5. detected_by
6. handled_by
7. requires_safety_step
8. impacts
9. has_case

### 6.3 主演示图谱关系

```text
某输气场站 -> 包含 -> 站控柜
站控柜 -> 包含 -> 工控机
工控机 -> 包含 -> 风扇
工控机 -> 包含 -> 滤网
工控机 -> 发生 -> 高温告警
高温告警 -> 可能原因 -> 风道堵塞
高温告警 -> 可能原因 -> 滤网积尘
高温告警 -> 可能原因 -> 风扇异常
风道堵塞 -> 检查方法 -> 检查进风口和出风口
滤网积尘 -> 处理措施 -> 清理或更换滤网
风扇异常 -> 处理措施 -> 检查风扇运行状态
高温告警 -> 影响 -> 数据上传稳定性
高温告警 -> 影响 -> 监控告警可靠性
处理措施 -> 前置安全要求 -> 静电防护
处理措施 -> 前置安全要求 -> 禁止带电拆卸非热插拔部件
```

### 6.4 图谱接口

```text
GET  /api/kg/graph?entity_id=xxx&depth=2
GET  /api/kg/entities?type=fault&keyword=高温
POST /api/kg/entities
POST /api/kg/relations
POST /api/kg/update-from-review
```

---

## 7. RAG 与证据实现方案

### 7.1 知识条目结构

```sql
knowledge_chunks (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT NOT NULL,
  equipment_type TEXT,
  fault_type TEXT,
  source_type TEXT,
  source_name TEXT,
  source_section TEXT,
  embedding_json TEXT,
  expert_verified INTEGER,
  created_at TEXT,
  updated_at TEXT
)
```

### 7.2 检索流程

```text
诊断上下文
  -> 生成查询文本
  -> 命中演示缓存或知识条目
  -> 可选 embedding 相似度检索
  -> metadata 过滤
  -> 召回知识条目
  -> 拼接图谱上下文
  -> 生成诊断摘要 / 步骤依据 / 安全提醒
  -> 返回引用来源
```

首期可选实现：

1. 预置知识条目 + 关键词检索。
2. 云 embedding API + SQLite 存向量 JSON。
3. 不强制接入 DashVector。

### 7.3 来源展示

每条关键结论应尽量绑定：

1. 知识条目标题。
2. 来源文档或案例名称。
3. 来源段落。
4. 关联设备和故障。

PDF 文本抽取首期可后置。若实现，优先使用纯 Python PDF 文本库；扫描版 PDF OCR 不做。

---

## 8. 多 Agent 协同会诊方案

### 8.1 会诊目标

多 Agent 协同会诊用于支撑“故障分析”和“安全合规检查”，不是独立炫技模块。

首期 Agent：

| Agent | 实现方式 | 职责 |
|---|---|---|
| 接诊/检索 Agent | 规则 + 缓存 + 可选大模型 | 整理用户输入、匹配故障、召回知识 |
| 分析诊断 Agent | 云端大模型 + 缓存 | 给出高温/风道/滤网/风扇相关判断 |
| 操作合规 Agent | 规则 + 云端大模型 + 缓存 | 检查安全项、恢复验证和异常升级 |

### 8.2 会诊输入

```json
{
  "equipment_type": "工控机",
  "fault_type": "高温告警/风道堵塞/散热异常",
  "symptom": "站控柜内工控机温度告警，风扇声音异常",
  "guide_flow_id": "flow_high_temp_airflow",
  "rag_evidence": [],
  "kg_context": [],
  "historical_cases": []
}
```

### 8.3 会诊输出

```json
{
  "summary": "当前优先判断为工控机散热异常，需检查风道、滤网和风扇状态。",
  "step_options": [
    "定位异常设备",
    "查看故障分析",
    "进入检修步骤",
    "提交专家审核"
  ],
  "agent_opinions": [
    {
      "agent_name": "分析诊断 Agent",
      "conclusion": "优先检查风道堵塞、滤网积尘和风扇运行异常。",
      "evidence_refs": ["chunk_airflow_001", "case_high_temp_001"]
    },
    {
      "agent_name": "操作合规 Agent",
      "conclusion": "检查前应确认静电防护、禁止带电拆卸非热插拔部件，并通知值班负责人。",
      "evidence_refs": ["safety_001"]
    }
  ]
}
```

---

## 9. 模拟能力与预留接口

### 9.1 连线专家

首期实现：

1. 页面保留“连线专家”按钮。
2. 点击后展示模拟弹窗或专家在线状态。
3. 展示“当前为模拟功能，后续可接入 IM/RTC 服务”的说明。

预留接口：

```text
POST /api/expert-connect/request
GET  /api/expert-connect/status/:request_id
POST /api/expert-connect/end
```

### 9.2 语音播报

首期实现：

1. 可预留每步语音按钮。
2. 可使用预生成 mp3/wav 文件。
3. 第一版不要求真实 TTS。

预留字段：

```sql
guide_steps.audio_path TEXT
```

### 9.3 视频输入

首期实现：

1. 页面保留视频上传入口或标识。
2. 不做真实视频识别。
3. 可展示“视频识别能力预留，第一版使用图片/文本演示”的提示。

预留接口：

```text
POST /api/media/video/upload
POST /api/media/video/analyze
```

---

## 10. 检修记录与作业卡导出方案

作业卡不再是第一版核心演示，核心是检修向导。作业卡作为检修完成后的记录导出。

### 10.1 检修记录数据模型

```sql
maintenance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  equipment_type TEXT,
  fault_type TEXT,
  diagnosis_summary TEXT,
  completed_steps TEXT,
  safety_check_result TEXT,
  evidence_refs TEXT,
  operator_note TEXT,
  review_status TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

### 10.2 导出方式

```text
检修记录 JSON
  -> 渲染为 HTML 打印页
  -> 浏览器打印 / 另存为 PDF
```

不做：

1. 后端 PDF 生成。
2. Word 导出。
3. 复杂排版引擎。

---

## 11. 专家修正回流方案

### 11.1 修正对象

1. 诊断摘要。
2. 步骤式检修向导。
3. 检修完成记录。
4. 安全提醒。
5. 图谱实体。
6. 图谱关系。
7. 专家 Agent 会诊意见。
8. 专家 Agent 经验记录。

### 11.2 回流流程

```text
专家提交修正
  -> 审核通过
  -> 写入知识条目
  -> 更新图谱实体/关系
  -> 可选写入专家 Agent 经验记录
  -> 更新当前检修记录
  -> 后续同类诊断优先引用
```

### 11.3 数据表

```sql
expert_reviews (
  id TEXT PRIMARY KEY,
  target_type TEXT,
  target_id TEXT,
  original_content TEXT,
  corrected_content TEXT,
  review_status TEXT,
  reviewer TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

---

## 12. API 规划

建议接口：

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

POST /api/diagnosis/summary
POST /api/diagnosis/analyze-image

POST /api/guide/start
GET  /api/guide/sessions/:id
POST /api/guide/sessions/:id/steps/:step_id/complete
POST /api/guide/sessions/:id/ask
POST /api/guide/sessions/:id/finish

GET  /api/assets/:asset_id

POST /api/rag/ask
GET  /api/evidence/cards

POST /api/agents/consult
GET  /api/agents
GET  /api/agents/:id/memories

GET  /api/kg/graph
POST /api/kg/update-from-review

POST /api/safety/guardrails/check

GET  /api/maintenance-records/:id
GET  /api/maintenance-records/:id/print

POST /api/reviews
POST /api/reviews/:id/approve
```

---

## 13. LoongArch 部署与验证方案

### 13.1 迭代部署纪律

按老师建议，不能等系统全部开发完再上龙芯验证。

每个迭代都要做：

```text
本地完成一个小功能
  -> 同步到龙芯
  -> 前端 dev server 启动
  -> Flask 后端启动
  -> 走一遍该功能
  -> 记录报错和修复方式
```

### 13.2 迭代 0：空壳上机

目标：先证明龙芯环境能跑起来。

检查项：

1. `uname -a` 和 `/etc/os-release`。
2. `node -v`。
3. `npm -v`。
4. `python3 -V`。
5. Flask Hello API。
6. Vite Hello 页面 `npm run dev -- --host` 在龙芯本机可打开。
7. 记录 npm 依赖下载方式、可用镜像源和需要离线准备的包。

暂不要求：

1. 平板浏览器访问龙芯 IP。
2. 双端联调和平板访问链路。

这些内容移到后期演示联调阶段处理；前期以本机运行、页面可打开、后端可启动、云 API 或缓存流程可走通为准。

### 13.3 迭代 1：向导骨架

验证内容：

1. 异常检测入口页面。
2. 步骤式检修向导页面。
3. 图片占位区展示。
4. 上一步、下一步、标记完成。
5. SQLite 读写步骤状态。

### 13.4 迭代 2：分析与缓存

验证内容：

1. 大模型总结或本地缓存命中。
2. 步骤选项展示。
3. Agent 会诊卡片。
4. 断网时走本地缓存。

### 13.5 迭代 3：记录与回流

验证内容：

1. 检修记录生成。
2. 打印页打开。
3. 专家修正。
4. 知识库 / 图谱 / 经验记录回流。

### 13.6 目标机运行方式

第一版建议：

```text
前端：npm run dev -- --host 0.0.0.0
后端：python app.py 或 flask run --host 0.0.0.0
数据库：SQLite 文件
素材：本地 assets 目录
```

后续可加固：

```text
前端：npm run build + Nginx 托管 dist
后端：systemd 托管 Flask
```

---

## 14. 暂不实现的技术内容

首期不实现：

1. 本地大模型。
2. 本地向量数据库。
3. 本地图数据库。
4. 本地 OCR。
5. 本地视觉模型训练。
6. Docker 编排。
7. 真实实时传感器接入。
8. 复杂权限系统。
9. 大规模图算法。
10. 本地多 Agent 运行平台。
11. 真实三维建模、可旋转模型、自动热点识别。
12. 后端 PDF 生成。
13. Word 导出。
14. 真实连线专家、真实 TTS、真实视频识别。

---

## 15. 技术风险

| 风险 | 影响 | 应对 |
|---|---|---|
| npm 包下载或镜像源不可用 | 前端依赖安装受阻 | 记录可用镜像源；必要时提前离线准备 npm 包 |
| Python 包安装失败 | 后端无法运行 | Flask、requests、sqlite3 优先，避免 C 扩展 |
| 云 API 网络或服务波动 | 智能分析结果无法实时返回 | 云 API 正常可用时实时调用；主演示流程必须准备本地缓存 |
| 图片未补充 | 不影响 MVP 主流程，后续视觉补充延后 | MVP 只展示固定图片区块占位，预留素材字段 |
| 知识图谱范围过大 | 开发延期 | 首期只做主演示故障相关子图 |
| 多 Agent 调用耗时长 | 用户等待时间变长 | 使用缓存和预设会诊结果 |
| 专家回流复杂 | 开发延期 | 首期只做文本修正 + 写入知识库/图谱/经验记录 |
| 真实三维/视频/语音拖慢开发 | 偏离核心闭环 | 只做模拟入口和预留接口 |
