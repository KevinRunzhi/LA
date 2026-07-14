# R0.1【P0】中心态势式动态接诊工作区开发 Spec

> 版本：V1.3
> 日期：2026-07-11
> 需求依据：`teacher-feedback-2026-07-10-dynamic-intake-workspace.md`
> 设计依据：`r0-spatial-intake-workspace-redesign.md`
> 实现边界：React 前端高保真模拟，不新增依赖，不新增后端接口
> 当前状态：V1.2 的“时间 → 地点”布局与动画已通过产品体验确认；V1.3 继续收口地点之后的事件、现象、依据和最终全景链路

## 0. V1.3 本轮增量目标

V1.3 不推翻已经确认的 V1.2 页面骨架，只完善“发生地点”之后的动态链路：

1. 中央场站图从地点确认开始保持稳定，不因后续卡片切换而缩小、移位或被遮挡；
2. 地点确认后只生成一张“发生事件”卡，明确展示系统识别结果、字段来源和“为什么识别为该设备”；
3. 事件确认后只生成一张“其他现象”卡，将灯态、声音、温度、转速和图片/视频/音频统一归入现场现象；
4. 现场材料继续采用紧凑缩略图宫格，点击预览，文字不得覆盖图片；
5. 现象确认后生成“依据与手册”卡，标准和手册默认摘要展示，点击后展开命中原因；
6. 右侧 Agent 只解释生成原因、字段来源、证据汇合和下一步，不承载必须操作；
7. 最终独立页面统一命名为“现场异常事件全景”，按时间、地点、事件、其他现象、现场材料、判断依据和诊断方向组织；
8. 最终页面每一类信息都能返回对应步骤修改，返回后保留其他已确认信息；
9. 每一步继续使用“当前卡进入 → 字段依次出现 → 按钮最后出现 → 确认后归档”的动画节奏；
10. 不增加信息完整度评分，不引入 V1.3 范围之外的真实视觉识别或后端接口。

### 0.1 V1.3 验收路径

```text
确认发生地点
→ 中央图保持稳定并生成发生事件卡
→ 自动识别或人工确认设备字段
→ 展示识别原因和逐字段来源
→ 确认事件并生成其他现象卡
→ 补充运行状态和现场材料
→ 确认现象并生成依据与手册卡
→ 展开核对命中原因
→ 生成现场异常事件全景
→ 可分别返回修改时间、地点、设备或现象
```

验收时，任意页面不得同时出现两张完整业务表单卡；中央图上的故障点不得被业务文字或浮层遮挡。

## 1. 完成定义

同时满足以下条件才算完成本轮 WSL 开发：

1. 首页已知描述进入工作区后缩入左上角或顶部已知信息区，不再作为中央大卡；
2. 接诊生成顺序调整为时间、地点、事件、其他现象、依据与手册；
3. 地点图或设备拓扑图长期位于中央，任何卡片不得遮挡故障点；
4. 周边卡片使用稳定槽位渐进生成，同一时刻只保留一张完整当前卡；
5. 发生时间支持建议值、修改和确认；
6. 设备与告警逻辑迁入发生事件，运行值与材料迁入其他现象；
7. 依据标准和操作手册能解释当前判断来源；
8. 修改上游字段能够标记并重新评估受影响内容；
9. 用户确认后，当前卡必须收缩并归入顶部已知信息区，中央再生成下一任务；
10. 最终“现场异常事件确认”包含时间、地点、事件、现象、材料、依据和本次诊断任务；
11. 中央工作区承载全部业务交互和主要按钮，右侧只展示 Agent 思考、依据与对话；
12. 地图进入、故障点识别、卡片生成、字段逐项出现、确认收缩和顶部归档动画均通过验收；
13. Node `20.19.4` 构建、浏览器主路径、减弱动画和窄屏布局验证通过；
14. 龙芯 Node `20.19.4` 开发态验证后，才能标记“龙芯已完成”。

## 2. 状态模型

### 2.1 主状态

```js
const spatialIntakeStates = {
  PREPARING_CONTEXT: "preparing_context",
  TIME_REQUIRED: "time_required",
  TIME_CONFIRMED: "time_confirmed",
  LOCATION_REQUIRED: "location_required",
  LOCATION_CONFIRMED: "location_confirmed",
  EVENT_REQUIRED: "event_required",
  EVENT_CONFIRMED: "event_confirmed",
  PHENOMENA_REQUIRED: "phenomena_required",
  PHENOMENA_CONFIRMED: "phenomena_confirmed",
  EVIDENCE_GENERATING: "evidence_generating",
  EVIDENCE_READY: "evidence_ready",
  BUILDING_EVENT_CONFIRMATION: "building_event_confirmation",
  EVENT_CONFIRMATION_READY: "event_confirmation_ready",
};
```

### 2.2 卡片状态

```js
const cardStates = {
  HIDDEN: "hidden",
  GENERATING: "generating",
  ACTIVE: "active",
  CONFIRMED: "confirmed",
  STALE: "stale",
  BLOCKED: "blocked",
};
```

## 3. 数据结构

```js
const intakeContext = {
  description: "站控柜内工控机温度告警，风扇声音异常……",
  time: {
    detectedAt: "2026-07-10T10:25",
    duration: "约 10 分钟",
    recurrence: "首次发现",
    source: "system_suggestion",
    confirmed: false,
  },
  location: {
    site: "某输气场站",
    area: "控制中心",
    cabinet: "站控柜 A01",
    deviceNode: "工控机区域",
    visualType: "station-layout",
    source: "site_registry",
    confirmed: false,
  },
  event: {
    deviceModel: "研华 ACP-4000 / IPC-610",
    deviceRole: "站控画面与数据采集终端",
    eventType: "温度告警",
    relatedAlarm: "TEMP/FAN、蜂鸣、温度升高",
    fieldSources: {},
    confirmed: false,
  },
  phenomena: {
    values: {},
    materials: [],
    confirmed: false,
  },
  evidence: {
    standards: [],
    manuals: [],
    generated: false,
  },
  branch: "standard-thermal",
};
```

要求：

- 时间、地点、事件和现象分别存储，不能继续只依赖页面索引；
- 字段来源继续区分系统建议、设备台账、现场描述/告警规则和工程师确认；
- `materials` 继续使用现有对象 URL，不上传服务器；
- 修改上游字段后通过 `staleSections` 记录需要重新生成的下游区域；
- “现场异常事件确认”从 `intakeContext` 读取，不重复维护另一套字段。

## 4. 现有步骤迁移

现有 `activeIntakeStep` 迁移为以下视图顺序：

| 新索引 | 新阶段 | 复用内容 |
| --- | --- | --- |
| 0 | 发生时间 | 新增 |
| 1 | 发生地点 | 现有位置图、故障点和位置确认 |
| 2 | 发生事件 | 现有设备型号、设备角色和关联告警 |
| 3 | 其他现象 | 现有运行值、条件分支和材料宫格 |
| 4 | 依据与手册 | 现有 Agent 依据，新增手册摘要卡 |
| 5 | 现场异常事件确认 | 复用现有最终确认页逻辑，重新命名并扩展时间和依据 |

发生事件卡的设备目录覆盖研华 ACP-4000 / IPC-610、Rockwell ASEM 6300B/6300P、Allen-Bradley 6177R、ControlLogix 1756、浙大中控 ECS-700/JX-300XP、霍尼韦尔 Experion PKS C300/ControlEdge PLC 和西门子 IPC647E。选择具体型号时，系统依据型号知识与设备台账联动推荐设备角色和典型关联告警，工程师仍可逐项修改。

首页描述不再作为步骤 0，而是进入 `intakeContext.description`，并作为顶部已知信息区的第一个紧凑条目；完整描述到“现场异常事件确认”页面集中展示。

## 5. 状态转换

| 当前状态 | 触发 | 下一状态 | 页面结果 |
| --- | --- | --- | --- |
| `PREPARING_CONTEXT` | 进入接诊工作区 | `TIME_REQUIRED` | 起始事实进入顶部，时间卡在中央生成 |
| `TIME_REQUIRED` | 确认发生时间 | `TIME_CONFIRMED` | 时间卡收缩并归入顶部已知信息区 |
| `TIME_CONFIRMED` | 位置 Agent 完成 | `LOCATION_REQUIRED` | 中央图高亮候选故障点 |
| `LOCATION_REQUIRED` | 用户确认地点 | `LOCATION_CONFIRMED` | 中央图保留，地点信息归入顶部 |
| `LOCATION_CONFIRMED` | 台账匹配完成 | `EVENT_REQUIRED` | 事件卡逐字段生成 |
| `EVENT_REQUIRED` | 用户确认设备与事件 | `EVENT_CONFIRMED` | 事件卡收缩并计算条件分支 |
| `EVENT_CONFIRMED` | 现象任务生成 | `PHENOMENA_REQUIRED` | 现象字段和材料宫格出现 |
| `PHENOMENA_REQUIRED` | 用户确认现象 | `PHENOMENA_CONFIRMED` | 现象卡收缩，重新评估诊断方向 |
| `PHENOMENA_CONFIRMED` | 自动检索依据 | `EVIDENCE_GENERATING` | 标准与手册槽位进入生成态 |
| `EVIDENCE_GENERATING` | 模拟检索完成 | `EVIDENCE_READY` | 依据和手册依次出现 |
| `EVIDENCE_READY` | 用户继续 | `BUILDING_EVENT_CONFIRMATION` | Agent 归集异常事件信息 |
| `BUILDING_EVENT_CONFIRMATION` | 归集完成 | `EVENT_CONFIRMATION_READY` | 进入独立“现场异常事件确认”页面 |

状态保护：

- 运行态禁止重复触发；
- 当前卡未确认时不生成下一主要卡；
- 重新编辑只回到对应状态，不得清空无关信息；
- 所有定时器必须在状态切换或组件卸载时清理；
- `equipment-mismatch` 分支继续阻止进入未实现的散热诊断结论。

## 6. 页面组件拆分

建议从现有 `DynamicIntakeStage` 拆分：

```text
SpatialIntakeStage
├── KnownContextDock
├── BusinessTaskHeader
├── SpatialIntakeBoard
│   ├── LocationVisualCenter
│   ├── TimeTaskCard
│   ├── EventTaskCard
│   ├── PhenomenaTaskCard
│   │   └── CompactMaterialGrid
│   ├── StandardsEvidenceCard
│   └── OperationManualCard
├── IntakeGenerationStatus
└── AssistantChat（复用）

EventConfirmationStage
├── EventOverview
├── LocationSnapshot
├── PhenomenaAndMaterials
├── EvidenceAndManuals
└── DiagnosisLaunch
```

职责约束：

- `KnownContextDock` 位于左上角或中央业务区顶部，只展示已确认的时间、地点、事件和现象短摘要；
- `KnownContextDock` 新条目必须由当前任务卡确认后的收缩归档动画生成，点击条目可返回修改；
- `BusinessTaskHeader` 只展示当前任务和步骤进度；
- `LocationVisualCenter` 负责图、故障点、候选节点与确认状态，不放长解释；
- 各任务卡只接收本区域数据和回调，不直接推进全局状态；
- `SpatialIntakeStage` 统一决定卡片可见性、状态和动画类；
- `AssistantChat` 继续显示生成原因、字段来源和下一步。
- `EventConfirmationStage` 替代原用户可见的“接入摘要”页面，负责最终信息归集和诊断启动；现有 `IntakeSummaryStage` 内部逻辑可以迁移后再重命名。

### 6.1 中央与右侧职责约束

- 所有业务字段、确认按钮、修改入口、继续按钮、错误和重试操作必须位于中央工作区；
- 右侧只允许显示 Agent 思考过程、生成原因、来源、依据、风险提示和追问输入；
- 右侧内容不得成为业务流程的阻断条件；
- 右侧宽度保持在可用工作区的 24%–30%，中央业务区保持 70%–76%；
- 右侧独立滚动并支持收缩，收缩或展开不得改变中央图的最小宽度；
- 窄屏下右侧改为抽屉，中央业务任务始终优先显示。

第一版可继续保留在 `App.jsx`，但新增组件必须保持独立函数边界，避免继续扩大单个 `DynamicIntakeStage`。

## 7. 布局约束

桌面端使用命名 Grid Area：

```css
grid-template-areas:
  ". time ."
  "phenomena center event"
  "standards center manual";
grid-template-columns: minmax(220px, 0.8fr) minmax(440px, 1.7fr) minmax(220px, 0.8fr);
```

实现要求：

- 中央列不低于 `440px`；
- 周边卡不通过 `position: absolute` 覆盖中央图；
- 中央图高度在卡片生成前后保持稳定；
- 地点标题和故障点始终可见；
- 材料宫格位于现象卡，1–4 项两列，5–9 项三列；
- 常规桌面允许底部依据区换行；
- 小于 `1180px` 改为纵向布局，不缩小到不可操作。
- 同一时刻只出现一张完整业务卡；已确认卡从中央移除并进入 `KnownContextDock`；
- 顶部已知信息区高度控制在 `52–64px`，每项只显示一行短摘要，不展示完整字段表单；
- 未确认项不在顶部保留空占位。

## 8. 动画实现规范

统一类名：

```text
intake-card-enter
intake-card-active
intake-card-confirming
intake-card-confirmed
intake-card-stale
location-node-pulse
location-map-enter
location-scan-once
intake-field-reveal
intake-confirm-reveal
intake-card-to-context
context-chip-arrive
```

统一 CSS 变量：

```css
--motion-fast: 220ms;
--motion-base: 320ms;
--motion-slow: 720ms;
--motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
```

约束：

- 地图首次进入使用淡入和 `0.94 → 1` 缩放，故障点随后进行两次短促脉冲；
- 卡片首次从 `hidden` 变为可见时使用淡入、上移和 `0.88 → 1` 缩放；
- 标题、说明、字段、来源和确认按钮必须分段出现，不能整卡一次性显示；
- 字段按 `300–450ms` 间隔逐项生成，确认按钮最后出现；
- 用户确认后播放 `intake-card-to-context`，卡片收缩并归入顶部；
- 顶部新条目播放一次 `context-chip-arrive`，随后保持静止；
- 输入值变化不重新播放整卡动画；
- 字段逐项生成沿用现有时间序列，但总时长不得超过 2.5 秒；
- 确认后先更新状态，再播放收缩，不使用固定空白占位；
- `prefers-reduced-motion: reduce` 下将动画时长降到 `1ms`，保留状态颜色变化；
- 不引入动画依赖库。

## 9. 重新评估规则

| 修改内容 | 标记为 stale | 重新计算 |
| --- | --- | --- |
| 发生时间 | 对应收缩卡、最终事件信息 | 不改变诊断分支 |
| 发生地点 | 事件、现象、依据、手册 | 台账对象和可用资料 |
| 设备型号或角色 | 现象、依据、手册 | 字段集合和操作资料 |
| 事件类型或关联告警 | 现象、依据、手册 | 三条现有条件分支 |
| 运行值或灯态 | 依据、最终事件信息 | 诊断方向与风险提示 |
| 现场材料 | 最终事件信息 | 材料数量和现场事实，不声明真实识别 |

重新评估必须同步更新：顶部已知信息项、当前卡状态、右侧 Agent 解释和最终“现场异常事件确认”。

## 10. “现场异常事件确认”页面

“接入摘要”不再作为用户可见名称。最终页面统一命名为：

```text
阶段名称：异常事件确认
页面标题：现场异常事件全景
状态文案：事件信息已归集
主要操作：确认并启动智能诊断
```

内容顺序统一为：

1. 发生时间；
2. 发生地点与中央图缩略图；
3. 发生事件与设备对象；
4. 其他现象与现场材料；
5. 依据标准与操作手册；
6. 当前诊断方向和是否允许启动诊断。

该页面是接诊流程结束后的唯一总信息页面。过程工作区不再复制同样的完整汇总。按此前用户决定，仍不展示“信息完整度”评分。

## 11. 验收用例

### 主路径

1. 首页输入描述并选择材料；
2. 进入接诊后描述缩入顶部已知信息区；
3. 时间卡经过容器、标题、字段、来源和按钮的分段动画出现，确认后收缩并归入顶部；
4. 中央位置图高亮站控柜 A01，确认后仍保持中央展示；
5. 事件卡逐字段写入型号、角色和告警来源；
6. 现象卡展示运行值和紧凑材料宫格；
7. 标准与手册卡依次出现；
8. “现场异常事件确认”按新顺序归集全部信息；
9. 主演示分支稳定进入多 Agent 诊断。

### 修改与分支

- 修改地点后事件、现象和依据进入重新评估；
- 把设备改为 PLC 或把告警改为通信中断，现象字段切换并阻止误入散热结论；
- 修改灯态为正常后，最终事件信息切换为无灯态高温方向；
- 删除或新增材料后，现象卡与最终事件信息数量同步。

### 视觉与动画

- 卡片按时间、地点、事件、现象、依据顺序出现；
- 中央图在所有步骤中尺寸稳定且故障点无遮挡；
- 当前卡与已确认卡层级清楚；
- 顶部只显示紧凑已知信息项，不出现完整表单或大段文字；
- 中央同时只存在一张完整当前任务卡；
- 卡片确认后可观察到收缩、移动和顶部新条目高亮；
- 中央业务工作区明显强于右侧 Agent 区域，主要操作全部位于中央；
- 开启减弱动画后无明显位移和缩放；
- 1180px 以下无横向溢出和卡片遮挡。

### 回归

- 位置图和材料预览仍可点击；
- 返回修改不会跳错步骤或卡死；
- “现场异常事件确认”启动诊断仍可进入现有会诊流程；
- R2 可编辑检修预方案不受影响。

## 12. 实施批次与提交点

| 批次 | 内容 | 建议提交点 |
| --- | --- | --- |
| A | 数据结构、时间状态和步骤映射 | `refactor:intake-context-state` |
| B | 顶部已知信息区、业务标题与中央地点主视觉 | `feat:spatial-intake-shell` |
| C | 事件、现象和材料槽位迁移 | `feat:spatial-intake-cards` |
| D | 依据标准、操作手册和动画 | `feat:intake-evidence-motion` |
| E | 异常事件确认、分支回归和响应式验证 | `fix:intake-event-confirmation` |

每个批次完成后先在 WSL 使用 Node `20.19.4` 构建并验证对应模块；全部完成后再进入龙芯开发态逐模块验证。

## 13. V1.1 第一版布局验证与否决结论

2026-07-11 技术验证结果：

- 中央业务区与右侧 Agent 区按约 `74% : 26%` 落地；在 1280px 浏览器视口中，业务页主体实测约 `840px`，右侧 Agent 区约 `272px`；
- 地点确认状态下，场站图位于中央，宽度约 `605px`，现场材料位于左侧，右侧仅保留辅助对话；
- 事件确认状态下，中央地点图约 `365px`，右侧当前事件卡约 `240px`，已确认地点进入底部轨迹；
- 其他现象状态下，材料、中央地点图、运行状态卡和底部依据/手册形成稳定槽位，没有覆盖中央故障点；
- 最终页面已从“接入摘要”改名为“现场异常事件全景”，主要按钮改为“确认并启动智能诊断”；
- Node `20.19.4` 生产构建通过，浏览器控制台无运行错误。

产品确认结论：V1.1 未达到老师要求，不作为继续开发基线。主要问题是动画只做了简单入场、发生时间为静态卡、已确认信息放在底部轨迹、中央同时保留多张卡片，仍然缺少“生成—确认—归入顶部—继续生成”的主线。

V1.2 必须移除底部 `ConfirmedStepRail`，建立顶部 `KnownContextDock`，并完成地图、故障点、卡片、字段、确认和归档的连续动画后重新验收。
