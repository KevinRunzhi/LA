# LA 项目文档入口

更新时间：2026-07-13

本文件是项目文档的唯一入口。阅读顺序和冲突处理规则以这里为准，旧文档不能再单独作为开发依据。

## 1. 当前唯一执行基线

按以下顺序阅读：

1. [`current-development-status.md`](./current-development-status.md)：当前阶段、完成度、进行中任务和明确不做事项；这是进度的唯一事实来源。
2. [`teacher-feedback-2026-07-10-dynamic-intake-workspace.md`](./teacher-feedback-2026-07-10-dynamic-intake-workspace.md)：2026-07-10 老师对动态接诊工作区的最新修改意见；下一轮页面规划以此为最新输入。
3. [`r0-spatial-intake-workspace-redesign.md`](./r0-spatial-intake-workspace-redesign.md)：R0.1 V1.2 页面信息架构、顶部已知信息区、中央生成舞台和完整动画编排方案。
4. [`r0-spatial-intake-workspace-spec.md`](./r0-spatial-intake-workspace-spec.md)：R0.1 V1.3 状态模型、地点之后的动态链路、组件拆分、动画规范和验收标准。
5. [`r0-right-agent-consultation-stream-spec.md`](./r0-right-agent-consultation-stream-spec.md)：多 Agent 会诊迁移到右侧辅助对话区的消息流、动画、自动滚动和验收规范。
6. [`backend-case-feedback-business-plan.md`](./backend-case-feedback-business-plan.md)：面向 PPT 与几分钟视频的后台案例回流、专家审核和知识沉淀 V1.2 演示基线。
7. [`case-feedback-video-script-and-data.md`](./case-feedback-video-script-and-data.md)：案例回流七分钟视频分镜、唯一完整案例、动态知识、图谱变更和演示状态冻结数据。
8. [`backend-case-feedback-development-spec.md`](./backend-case-feedback-development-spec.md)：从视频脚本反推的后台信息架构、页面组件、JSON 状态、Flask 接口、状态机和开发验收规格。
9. [`engineer-maintenance-record-feedback-spec.md`](./engineer-maintenance-record-feedback-spec.md)：工程师侧最新页面基线；取消独立案例回流工作台，将完整案例确认、恢复对比和上传动作合并进检修完成记录。
10. [`expert-knowledge-graph-display-spec.md`](./expert-knowledge-graph-display-spec.md)：专家知识图谱的入口、当前/本次更新视图、节点详情、发布状态联动和录制验收规格。
11. [`industrial-computer-knowledge-graph-overview-and-focus-plan.md`](./industrial-computer-knowledge-graph-overview-and-focus-plan.md)：工控机全局知识图谱、本次新增与修改、工程师候选变更、专家发布及后续轻量案例扩展方案。
12. [`industrial-computer-knowledge-graph-development-spec.md`](./industrial-computer-knowledge-graph-development-spec.md)：全局/变更视图、React SVG 镜头缩放、数据结构、API、发布动画、实施批次和录制验收规格。
13. [`sqlite-knowledge-feedback-and-sync-spec.md`](./sqlite-knowledge-feedback-and-sync-spec.md)：案例回流、知识版本、图谱关系与工程师本地同步的 SQLite 数据结构和事务规范。
14. [`case-02-rockwell-6300-power-structured-summary.md`](./case-02-rockwell-6300-power-structured-summary.md)：第二案例的设备判据、演示事实、检修流程、结构化知识、图谱关系与待补现场证据。
15. [`meeting-analysis-and-dev-plan.md`](./meeting-analysis-and-dev-plan.md)：2026-07-10 会议需求总纲；与老师最新修改意见冲突时以后者为准。
16. [`runtime-and-loongarch-policy.md`](./runtime-and-loongarch-policy.md)：Node、WSL、龙芯运行与逐模块验证的强制决策。
17. [`r0-dynamic-intake-workbench-spec.md`](./r0-dynamic-intake-workbench-spec.md)：现有 R0/P0 动态接诊实现规格；R0.1 以新方案和新 Spec 为增量基线。
18. [`r2-editable-maintenance-plan-design.md`](./r2-editable-maintenance-plan-design.md)：R2 千问式两级检修大纲的用户确认设计。
19. [`r2-editable-maintenance-plan-spec.md`](./r2-editable-maintenance-plan-spec.md)：R2 状态机、数据结构、组件职责和验收规格。
20. [`project-business-and-agent-flow.md`](./project-business-and-agent-flow.md)：项目主线业务、Agent 辅线及其对应关系的统一讲解文档。
21. [`formal-mvp-development-plan.md`](./formal-mvp-development-plan.md)：最新 MVP 分阶段计划。
22. [`teacher-review-prd-summary-and-demo-flow.md`](./teacher-review-prd-summary-and-demo-flow.md)：PRD 摘要与演示流程。
23. [`agent-streaming-output-pattern.md`](./agent-streaming-output-pattern.md)：当前 Agent 流式呈现的有效实现规范。
24. [`software-cup-a1-competition-requirements.md`](./software-cup-a1-competition-requirements.md)：赛事原始要求；用于验收覆盖，不直接代替当前开发计划。

## 2. 当前阶段

当前产品开发已完成 R0 动态接诊主链路和 R2 可编辑检修预方案的 WSL 第一版。当前进入 **R0.1 / P0 中心态势式动态接诊 V1.2 改进**；V1.1 试验布局已否决，下一步按顶部已知信息区与中央动态生成主线重新实现。

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
- `teacher-feedback-2026-07-10-dynamic-intake-workspace.md`
- `r0-spatial-intake-workspace-redesign.md`
- `r0-spatial-intake-workspace-spec.md`
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
3. `teacher-feedback-2026-07-10-dynamic-intake-workspace.md`。
4. 2026-07-10 Meeting 总纲。
5. `runtime-and-loongarch-policy.md` 中已经冻结的技术与部署决定。
6. 赛事原始要求。
7. 其他参考文档。

## 5. 文档维护规则

- 每完成一个模块，只更新 `current-development-status.md` 的完成矩阵和验证记录。
- 新会议产生方向变化时，新增会议纪要，同时更新本入口和当前状态；不要直接复活旧计划。
- 旧文档先标注状态并指向最新文档；只有确认没有独有信息且已有替代来源时才删除，宁可少删，不得批量误删。
- 功能状态只允许使用：`已完成`、`部分完成`、`进行中`、`未开始`、`已摒弃`。
- “已有页面/按钮/动画”不等于“真实功能已完成”；模拟功能必须明确标注为模拟。
- 每个 R/P 模块完成后都要在 WSL 和龙芯上分别留下验证结果；未在龙芯验证的功能不得标为“龙芯已完成”。
