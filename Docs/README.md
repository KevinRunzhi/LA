# LA 项目文档入口

更新时间：2026-07-10

本文件是项目文档的唯一入口。阅读顺序和冲突处理规则以这里为准，旧文档不能再单独作为开发依据。

## 1. 当前唯一执行基线

按以下顺序阅读：

1. [`current-development-status.md`](./current-development-status.md)：当前阶段、完成度、进行中任务和明确不做事项；这是进度的唯一事实来源。
2. [`meeting-analysis-and-dev-plan.md`](./meeting-analysis-and-dev-plan.md)：2026-07-10 最新会议需求总纲；这是当前产品需求和优先级的最高版本。
3. [`runtime-and-loongarch-policy.md`](./runtime-and-loongarch-policy.md)：Node、WSL、龙芯运行与逐模块验证的强制决策。
4. [`r0-dynamic-intake-workbench-spec.md`](./r0-dynamic-intake-workbench-spec.md)：当前正在实施的 R0/P0 详细规格与完成定义。
5. [`formal-mvp-development-plan.md`](./formal-mvp-development-plan.md)：最新 MVP 分阶段计划。
6. [`teacher-review-prd-summary-and-demo-flow.md`](./teacher-review-prd-summary-and-demo-flow.md)：最新 PRD 摘要与演示流程。
7. [`agent-streaming-output-pattern.md`](./agent-streaming-output-pattern.md)：当前 Agent 流式呈现的有效实现规范。
8. [`software-cup-a1-competition-requirements.md`](./software-cup-a1-competition-requirements.md)：赛事原始要求；用于验收覆盖，不直接代替当前开发计划。

## 2. 当前阶段

当前阶段统一记为 **R0 / P0（进行中）**。

R0 是最新 Meeting 第一项 P0 工作的执行编号，目标是把旧的固定接入翻页改造成：

```text
开始接诊
  -> 接诊思考过渡
  -> 现场照片居中与位置/台账匹配
  -> 补充项随处理过程逐块生成并由用户确认
  -> 接入摘要最后生成
  -> 触发现有分析诊断流程
```

Meeting 原文将第一项写作 `R1【P0】`。为避免继续改动会议纪要中的全部交叉引用，会议原文保留原编号；项目执行看板统一映射为 `R0 / P0`。以后判断当前进度以 `current-development-status.md` 为准。

## 3. 文档分类

### 有效执行文档

- `current-development-status.md`
- `meeting-analysis-and-dev-plan.md`
- `runtime-and-loongarch-policy.md`
- `agent-streaming-output-pattern.md`
- `loongarch-mvp-deployment-and-startup-guide.md`
- `loongarch-mvp-deployment-environment.md`

### 有效参考文档

这些文档仍可提供领域、赛题或素材参考，但不能决定当前开发顺序：

- `software-cup-a1-competition-requirements.md`
- `function-requirements-breakdown-station-ics-assistant.md`
- `technical-design-factory-power-equipment-maintenance-assistant.md`
- `module-structure-diagram-station-ics-assistant.md`
- `product-requirements-factory-power-equipment-maintenance-assistant.md`
- `visualization-demo-content-and-prompts.md`
- `github-agent-llm-innovation-ideas.md`
- `zou/loongson-competition-brief.md`
- `zou/loongson-technical-support-notes (1).md`

其中如果实现状态、技术选型或优先级与当前执行文档冲突，全部以后者为准。

### 保留但不直接执行的历史/背景文档

旧方向分析、早期骨架 Spec、前一轮界面重构方案和会议前 PRD 继续保留，便于追溯及复用尚未开发的内容；它们不再独立决定当前状态和开发顺序。是否删除必须在确认没有独有需求、素材或验收信息后再处理。

## 4. 冲突处理规则

发生冲突时依次采用：

1. 用户在当前对话中的明确决定。
2. `current-development-status.md`。
3. 2026-07-10 Meeting 总纲。
4. `runtime-and-loongarch-policy.md` 中已经冻结的技术与部署决定。
5. 赛事原始要求。
6. 其他参考文档。

## 5. 文档维护规则

- 每完成一个模块，只更新 `current-development-status.md` 的完成矩阵和验证记录。
- 新会议产生方向变化时，新增会议纪要，同时更新本入口和当前状态；不要直接复活旧计划。
- 旧文档先标注状态并指向最新文档；只有确认没有独有信息且已有替代来源时才删除，宁可少删，不得批量误删。
- 功能状态只允许使用：`已完成`、`部分完成`、`进行中`、`未开始`、`已摒弃`。
- “已有页面/按钮/动画”不等于“真实功能已完成”；模拟功能必须明确标注为模拟。
- 每个 R/P 模块完成后都要在 WSL 和龙芯上分别留下验证结果；未在龙芯验证的功能不得标为“龙芯已完成”。
