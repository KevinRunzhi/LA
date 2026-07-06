# GitHub Agent 与大模型创新思路调研

本文档结合 A1 赛题要求与现有 PRD，整理可融入“厂区配电与动力设备多模态检修知识助手”的新颖 Agent / 大模型方案。目标不是复刻最基础的 RAG，而是寻找更适合比赛展示、可通过云 API 快速落地、能体现创新性与实用性的功能设计。

## 1. 项目现状判断

赛题要求覆盖：

- 多模态知识检索：文本、故障图片、设备型号等输入；
- 标准化作业指引：步骤化操作、合规提醒、按设备类型和检修等级推送流程；
- 知识沉淀更新：案例上传、专家审核、知识图谱更新、人工修正模型输出；
- 部署约束：LoongArch + 银河麒麟，B/S 架构，可使用云端大模型 API。

现有 PRD 已经具备较好的差异化方向：

- 场景聚焦“制造企业厂区配电与动力设备运维”；
- 设备范围清晰：开关柜、电缆接头、配电变压器、低压电机；
- 已规划“多专家 Agent 会诊 + 经验记忆回流”；
- 已规划轻量知识图谱、标准化作业卡、专家审核。

因此后续创新不建议再强调“上传文档、向量化、问答”这类普通 RAG 能力，而应围绕：

```text
现场输入 -> Agent 规划 -> 多模态取证 -> 多专家会诊 -> 安全校验 -> 作业卡执行 -> 人类修正 -> 经验记忆和图谱增量更新
```

## 2. 重点参考方向

### 2.1 层级式多专家 Supervisor Agent

参考项目：

- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
- [LangGraph Supervisor](https://github.com/langchain-ai/langgraph-supervisor-py)

参考点：

- OpenAI Agents SDK 支持 Agents、Tools、Handoffs、Guardrails、Human-in-the-loop、Sessions 和 Tracing，适合用来表达多 Agent 协作流程。
- LangGraph Supervisor 强调由一个中心 Supervisor 协调多个专门 Agent，由 Supervisor 决定调用哪个 Agent、如何汇总结果。

可融入项目的方式：

把现有“多专家 Agent 会诊”升级为明确的层级式会诊机制：

```text
检修调度 Supervisor
  -> 视觉取证 Agent
  -> 配电设备专家 Agent
  -> 低压电机专家 Agent
  -> 历史案例检索 Agent
  -> 安全合规 Agent
  -> 作业卡生成 Agent
  -> 质检/反驳 Agent
```

比赛展示亮点：

- 不只是“一个大模型回答”，而是模拟真实检修班组会诊；
- 每个 Agent 只负责一个专业视角，输出更结构化；
- Supervisor 可展示“为什么调用这个专家、采纳哪些意见、哪些意见被驳回”；
- 适合做成可视化流程轨迹，提升演示观感。

最小落地方式：

- 后端用 Python 实现一个轻量 Orchestrator，不强依赖完整框架；
- 每个 Agent 本质是一个带角色提示词、工具权限和 JSON Schema 输出的云 API 调用；
- 数据库记录 `agent_runs`、`agent_messages`、`handoff_trace`；
- 前端展示“会诊时间线”和“专家结论卡片”。

优先级：高。

### 2.2 视觉文档 RAG / 页面级多模态检索

参考项目：

- [Alibaba-NLP/VRAG](https://github.com/Alibaba-NLP/VRAG)
- [microsoft/multi-modal-rag-with-colpali](https://github.com/microsoft/multi-modal-rag-with-colpali)
- [Multimodal-RAG-Survey](https://github.com/llm-lab-org/multimodal-rag-survey)

参考点：

- VRAG / VimRAG 强调视觉 RAG Agent 可从粗粒度到细粒度逐步收集视觉信息，并通过多模态记忆图组织推理过程。
- Microsoft 的 ColPali 示例强调把文档页面作为视觉对象处理，使用 late interaction / multi-vector 方式提升图文混排文档检索效果。
- 多模态 RAG 调研中提到 VisRAG、VISA、Self-adaptive Multimodal RAG、Multi-Agent Filtering RAG 等方向，说明“文档视觉版面 + 图像证据定位”是新趋势。

可融入项目的方式：

不要只抽取 PDF 文本做向量检索，而是增加“手册页面证据”：

```text
PDF 手册 -> 每页渲染为图片 -> OCR/版面分析 -> 保存页面缩略图、文本块、图表区域
现场故障图片/问题 -> 检索相关页面 -> 高亮页面证据 -> VLM 读取页面局部 -> 生成检修建议
```

比赛展示亮点：

- 回答不只引用“第几段文字”，还能显示“手册第 N 页的图示/表格/步骤区域”；
- 对电气手册、维修手册、红外图、仪表图更自然；
- 更贴合“多模态知识检索”，比普通文本 RAG 更有说服力。

最小落地方式：

- 本地只做 PDF 转图片、OCR 文本入库和页面截图存储；
- 检索先用文本 embedding + 设备/故障标签过滤；
- 命中页面后调用云端视觉模型，让模型基于页面截图和故障图片做二次判断；
- 前端在回答旁展示“证据页缩略图 + 高亮区域 + 来源说明”。

优先级：高。

### 2.3 Agentic Document Workflow：文档不是被检索，而是被处理成可执行知识

参考项目/文章：

- [LlamaIndex Agentic Document Workflows](https://www.llamaindex.ai/blog/introducing-agentic-document-workflows)
- [LlamaIndex](https://github.com/run-llama/llama_index)

参考点：

- Agentic Document Workflows 提出将文档处理、检索、结构化输出和 Agent 编排结合起来，区别于只做孤立抽取或问答。
- LlamaIndex 生态强调 agentic applications、agentic OCR、parsing、extraction、indexing。

可融入项目的方式：

把知识导入流程做成“文档理解流水线 Agent”：

```text
文档导入
  -> 文档分类 Agent：判断是手册、规程、案例、安全规范
  -> 设备/故障抽取 Agent：抽取设备、部件、故障、现象、工具、步骤
  -> 安全条款抽取 Agent：抽取停电、验电、接地、挂牌等安全要求
  -> 作业卡模板生成 Agent：生成结构化作业卡草稿
  -> 图谱更新建议 Agent：提出实体和关系增量
  -> 专家审核后入库
```

比赛展示亮点：

- 知识沉淀不是“上传一篇文章等检索”，而是自动转成设备、故障、步骤、风险、图谱关系；
- 能体现“经验数字化沉淀”和“可持续更新”；
- 可作为管理端亮点功能：上传一份检修案例，系统自动生成入库建议。

最小落地方式：

- 支持 Markdown/TXT/PDF 文本；
- 调用云 API 输出固定 JSON；
- 专家审核页面展示“新增知识条目、图谱关系、作业卡步骤”三栏；
- 审核通过后写入 SQLite。

优先级：高。

### 2.4 时间知识图谱 / Agent 经验记忆

参考项目：

- [getzep/graphiti](https://github.com/getzep/graphiti)
- [Awesome Graphs Meet Agents](https://github.com/YuanchenBei/Awesome-Graphs-Meet-Agents)

参考点：

- Graphiti / Zep 的核心方向是为 AI Agent 构建实时、时间感知的知识图谱记忆，用于生产环境 Agent 的上下文检索与组装。
- Graphs Meet Agents 收集了 Agent 记忆、知识图谱、层级记忆等方向，例如 temporal knowledge graph、agentic memory。

可融入项目的方式：

把现有“专家 Agent 经验记忆回流”设计成时间化记忆，而不是静态经验表：

```text
经验记录 = 结论 + 触发条件 + 不适用条件 + 适用设备 + 适用故障 + 来源案例 + 审核人 + 生效时间 + 使用次数 + 最近采纳时间
```

诊断时优先检索：

1. 近期审核通过且多次被采纳的经验；
2. 与当前设备/故障/现象相似的经验；
3. 被专家标记为“强约束”的安全经验；
4. 过期或冲突经验进入复核队列。

比赛展示亮点：

- 专家修正不是简单覆盖答案，而是形成可追踪、可演化的 Agent 记忆；
- 能展示“某条建议来自 2026-xx-xx 专家审核案例，已被采纳 5 次”；
- 比“知识图谱更新”更具 Agent 时代特征。

最小落地方式：

- SQLite 增加 `agent_memories`、`memory_events`、`memory_usage_logs`；
- 前端展示“本次会诊调用了哪些专家记忆”；
- 审核通过后将修正内容写入对应 Agent 记忆；
- 暂不引入 Neo4j 或外部图数据库。

优先级：高。

### 2.5 自适应检索规划 Agent

参考方向：

- Agentic RAG、Self-adaptive Multimodal RAG、Adaptive and Iterative Retrieval；
- GitHub Topics 中的 Agentic RAG 项目普遍包含意图识别、问题重写、多路检索、工具调用和深度思考。

可融入项目的方式：

在检索前增加 Planner，而不是直接 embedding 搜索：

```text
用户输入：图片 + 设备型号 + 故障描述
Planner 输出：
  - 需要识别图片中的哪些信息
  - 需要检索哪些知识源
  - 是否需要查历史案例
  - 是否需要调用安全合规检查
  - 是否需要向用户追问
```

示例：

```json
{
  "intent": "fault_diagnosis",
  "device_type": "cable_joint",
  "evidence_needed": ["thermal_image_temperature", "phase_comparison", "joint_surface_state"],
  "retrieval_routes": ["manual", "historical_case", "safety_rule", "agent_memory"],
  "need_clarification": true,
  "clarification_questions": ["三相温差是多少？", "是否伴随异味或放电声？"]
}
```

比赛展示亮点：

- 系统会“决定怎么查”，不是机械地查；
- 当信息不足时能主动追问；
- 可解释为什么检索了手册、案例或安全规范。

最小落地方式：

- 用云 API 生成检索计划 JSON；
- 后端按计划调用不同检索函数；
- 检索结果再交给专家 Agent 会诊；
- 前端展示“诊断计划”。

优先级：中高。

### 2.6 安全合规 Guardrails Agent

参考项目：

- [OpenAI Agents SDK Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails)

参考点：

- OpenAI Agents SDK 把 Guardrails 作为一等能力，用于输入/输出校验。
- Guardrails AI 关注 LLM 输出结构、规则和验证。

可融入项目的方式：

把“安全合规专家 Agent”从普通建议升级为强校验器：

```text
作业卡草稿
  -> 安全合规 Guardrails
  -> 检查是否包含停电、验电、挂牌、接地、PPE、复电确认、验收标准
  -> 检查高风险操作是否缺失升级条件
  -> 不通过则退回作业卡生成 Agent 重写
```

比赛展示亮点：

- 工业检修场景对安全要求很高，安全校验比普通聊天创新更有业务价值；
- 可以展示“AI 生成的作业卡未包含验电步骤，被安全 Agent 拦截并修正”；
- 能降低大模型幻觉和漏项风险。

最小落地方式：

- 定义作业卡 JSON Schema；
- 定义安全规则表 `safety_rules`；
- 使用规则校验 + LLM 语义校验双层机制；
- 前端展示“合规校验通过/未通过”和缺失项。

优先级：高。

### 2.7 MCP 风格的检修工具层

参考项目：

- [predictive-maintenance-mcp](https://github.com/LGDiMaggio/predictive-maintenance-mcp)
- [Machina](https://github.com/LGDiMaggio/machina)

参考点：

- predictive-maintenance-mcp 将振动分析、轴承故障检测、ISO 合规等能力封装为可被 LLM 调用的工具端点。
- Machina 面向工业维护 Agent，提供工业系统连接器、领域模型和 LLM-powered agent layer。

可融入项目的方式：

不必真的接入复杂传感器，但可以设计“检修工具箱”：

```text
工具 1：温升风险计算器
工具 2：三相温差比较器
工具 3：检修等级判定器
工具 4：停送电安全清单生成器
工具 5：相似案例匹配器
工具 6：作业卡完整性检查器
```

比赛展示亮点：

- Agent 不只是生成文本，还会调用确定性工具；
- 对“红外测温图 + 温度数值”的检修诊断更可信；
- 可以解释“模型判断 + 工具计算 + 手册依据”三者如何共同形成结论。

最小落地方式：

- 后端实现普通 Python 函数，不需要真正 MCP 服务；
- Agent prompt 中声明工具能力；
- 保存工具调用日志；
- 前端展示工具调用结果。

优先级：中高。

### 2.8 Agent 运行轨迹与可审计性

参考项目：

- [OpenAI Agents SDK Tracing](https://github.com/openai/openai-agents-python)
- [Promptfoo](https://github.com/promptfoo/promptfoo)
- [Ragas](https://github.com/vibrantlabsai/ragas)

参考点：

- OpenAI Agents SDK 内置 tracing，可查看、调试和优化 agent workflows。
- Promptfoo 支持测试 prompts、agents 和 RAG，并做红队/漏洞扫描。
- Ragas 用于评估和优化 LLM 应用，尤其适合 RAG 质量评估。

可融入项目的方式：

增加“诊断可审计面板”和“演示评测集”：

```text
一次诊断记录：
  - 用户输入
  - 识别结果
  - 检索计划
  - 检索来源
  - Agent 调用顺序
  - 工具调用结果
  - 安全校验结果
  - 最终作业卡
  - 专家修正记录
```

比赛展示亮点：

- 评委能看到系统不是黑盒；
- 可证明答案有来源、有过程、有安全校验；
- 文档和测试报告更容易写出亮点。

最小落地方式：

- 数据库记录 `diagnosis_trace`；
- 做 8 个典型故障的固定评测样例；
- 每个样例验证“是否命中正确设备、故障、来源、安全项、作业步骤”；
- 不必完整引入 Promptfoo/Ragas，也可以借鉴其评测思路。

优先级：中。

## 3. 推荐纳入比赛项目的创新点

建议最终主打 5 个创新点，避免范围过大：

| 创新点 | 对应赛题能力 | 展示价值 | 落地难度 | 推荐程度 |
|---|---|---:|---:|---:|
| 层级式多专家 Supervisor 会诊 | 多模态检索、作业指引 | 高 | 中 | 强烈推荐 |
| 视觉文档 RAG / 手册页面证据 | 多模态知识检索 | 高 | 中 | 强烈推荐 |
| Agentic 文档入库流水线 | 知识沉淀与更新 | 高 | 中 | 强烈推荐 |
| 时间化专家记忆回流 | 知识图谱、经验沉淀 | 高 | 中 | 强烈推荐 |
| 安全合规 Guardrails Agent | 标准化作业指引 | 高 | 低中 | 强烈推荐 |
| MCP 风格检修工具箱 | 实用性、可信度 | 中高 | 低 | 推荐 |
| Agent 轨迹与评测集 | 文档与演示 | 中 | 低 | 推荐 |
| 自适应检索规划 Agent | 检索智能化 | 中高 | 中 | 推荐 |

## 4. 建议产品叙事

可以把项目从“多模态 RAG 系统”升级为：

> 面向制造企业检修现场的多模态 Agent 会诊与作业闭环系统。

核心卖点：

```text
不是搜索文档，而是模拟检修班组会诊；
不是生成一段答案，而是生成可执行、可校验、可追溯的作业卡；
不是一次性问答，而是专家修正后持续沉淀为 Agent 经验记忆和知识图谱。
```

## 5. 建议演示流程

### 演示 1：现场故障多模态会诊

1. 上传电缆接头红外图或故障图片；
2. 输入设备型号、故障现象、检修等级；
3. Planner 生成诊断计划；
4. 视觉取证 Agent 提取异常；
5. Supervisor 调度配电设备专家、历史案例 Agent、安全合规 Agent；
6. 页面展示多专家会诊卡片；
7. 系统生成作业卡；
8. 安全 Guardrails 检查并补齐安全步骤。

### 演示 2：专家修正与经验回流

1. 专家发现 AI 漏掉“相邻两相温差对比”；
2. 专家修正作业卡；
3. 选择写入“配电设备专家 Agent 记忆”；
4. 系统更新知识图谱关系；
5. 再次发起相似诊断，系统引用该专家记忆。

### 演示 3：新增知识自动入库

1. 上传一条维修案例或规程片段；
2. 文档流水线 Agent 抽取设备、故障、原因、措施、安全要求；
3. 系统生成知识条目、图谱关系和作业卡模板草稿；
4. 专家审核通过；
5. 新知识可被下一次诊断命中。

## 6. 推荐技术路线

在 LoongArch + 银河麒麟上保持本地服务轻量：

```text
前端：React 或 Vue
后端：Flask / FastAPI
数据库：SQLite
图谱展示：ECharts graph
文档处理：PDF 转图片 + OCR/文本抽取
大模型：云 API，优先选择 OpenAI-compatible / Qwen / DeepSeek 等接口
视觉模型：云端 VLM API
Agent 编排：先自研轻量 Orchestrator，必要时参考 OpenAI Agents SDK 或 LangGraph
向量检索：本地 SQLite + embedding 缓存，或云 embedding API + 本地相似度
```

关键原则：

- LoongArch 机器不部署本地大模型；
- Agent 框架不要引入过重依赖，优先保证能稳定演示；
- 每个 AI 输出都要求 JSON Schema，便于页面结构化展示；
- 关键安全项用规则兜底，不完全依赖大模型自由生成；
- 准备演示兜底数据，云 API 失败时也能展示主流程。

## 7. 可直接加入 PRD 的需求条目

### 7.1 检修调度 Supervisor

系统应提供检修调度 Supervisor，根据现场输入、设备类型、故障描述和检修等级，自动规划诊断流程，并调度视觉取证、专业诊断、历史案例、安全合规和作业卡生成等 Agent。

### 7.2 诊断计划

每次快速诊断应生成可视化诊断计划，展示系统将检查哪些信息、检索哪些知识源、调用哪些专家 Agent、是否需要追问用户。

### 7.3 手册页面证据

系统回答应支持展示手册页面级证据，包括页面缩略图、命中区域、来源标题和相关摘要，避免只展示纯文本引用。

### 7.4 安全合规拦截

标准化作业卡生成后，必须经过安全合规 Agent 校验。若缺少停电、验电、挂牌、接地、防护、验收或异常升级条件等关键项，系统应提示缺失项并自动生成修正建议。

### 7.5 专家 Agent 记忆

专家审核通过的修正内容应可写入对应专家 Agent 的经验记忆。后续同类诊断应优先引用已审核且高采纳率的经验记忆，并展示来源。

### 7.6 诊断轨迹

系统应记录每次诊断的输入、检索计划、知识来源、Agent 调用、工具调用、安全校验、作业卡生成和专家修正过程，用于审计、演示和测试报告。

## 8. 参考资料

- OpenAI Agents SDK：https://github.com/openai/openai-agents-python
- LangGraph Supervisor：https://github.com/langchain-ai/langgraph-supervisor-py
- LlamaIndex：https://github.com/run-llama/llama_index
- LlamaIndex Agentic Document Workflows：https://www.llamaindex.ai/blog/introducing-agentic-document-workflows
- Alibaba VRAG：https://github.com/Alibaba-NLP/VRAG
- Microsoft Multi-modal RAG with ColPali：https://github.com/microsoft/multi-modal-rag-with-colpali
- Multimodal RAG Survey：https://github.com/llm-lab-org/multimodal-rag-survey
- Graphiti / Zep temporal graph memory：https://github.com/getzep/graphiti
- Awesome Graphs Meet Agents：https://github.com/YuanchenBei/Awesome-Graphs-Meet-Agents
- predictive-maintenance-mcp：https://github.com/LGDiMaggio/predictive-maintenance-mcp
- Machina industrial maintenance agent：https://github.com/LGDiMaggio/machina
- Guardrails AI：https://github.com/guardrails-ai/guardrails
- Promptfoo：https://github.com/promptfoo/promptfoo
- Ragas：https://github.com/vibrantlabsai/ragas

