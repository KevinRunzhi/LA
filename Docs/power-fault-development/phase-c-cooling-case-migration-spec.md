# 阶段 C：散热案例迁移与回归 Spec

> 状态：未开始
> 前置依赖：阶段 B 门禁通过
> 阶段结果：现有散热案例完全由统一案例平台驱动，功能和演示效果不退化

## 1. 目标

把当前散热案例作为第一个正式 CasePackage，迁移已有内容和状态，并将前端从散热常量切换到 `CaseSession + stage DTO`。

本阶段是架构验证阶段，不以重做视觉为目标。

## 2. 非目标

- 不开发供电页面；
- 不改变散热故障结论；
- 不重新设计现有知识图谱视觉；
- 不增加新的真实识别能力；
- 不删除旧接口，先保留兼容层。

## 3. 散热案例包

目录：

```text
backend/data/cases/CASE-ACP4000-001/
├── manifest.json
├── intake.json
├── diagnosis.json
├── guide.json
├── assistant.json
├── output.json
└── feedback-and-graph.json
```

迁移原则：

- 当前实际页面内容为迁移输入；
- 手册和知识只引用 ID，不复制全文；
- 步骤、检查项和问答主题使用稳定 ID；
- 原有展示顺序保持不变；
- 可信等级按阶段 A 审计结论设置；
- 当前运行值进入 run，不写回模板。

## 4. 前端 CaseSession

统一状态至少包括：

```text
sessionId
intakeSessionId
runId
caseId
routeStatus
stage
runStatus
dataRevision
activeStepId
pendingRequestIds
```

### 4.1 请求竞态

案例或 run 改变时：

- abort 旧 fetch；
-取消旧动画和计时器；
- 清理旧步骤问答；
- 晚到响应必须校验 session/run/revision；
- 不允许旧散热响应覆盖新页面。

### 4.2 刷新恢复

- URL 或持久状态能够定位 run；
- 刷新后从服务端恢复当前阶段；
- 未完成的纯动画可以重播；
- 已完成的业务写入不能重复；
- 找不到 run 时回到首页并给出可理解提示。

## 5. 页面迁移矩阵

### 5.1 首页与接诊

迁移：

- 默认描述；
- 设备选项；
- 告警和测量；
- 接诊任务；
- 条件分支；
- 资料引用。

首页提交散热描述后由路由 API 命中并创建新 run。

### 5.2 诊断

迁移：

- Agent 名称和阶段；
- 证据链；
- 可能原因；
- 阈值；
- 排除项；
- 诊断结论。

### 5.3 检修预方案

模板生成初稿；工程师确认后保存 `resolvedPlanSnapshot`。向导必须读取快照，不再读取原始模板。

### 5.4 检修向导

迁移：

- 五个现有大步骤；
- 检查项和测量项；
- 锁定安全项；
- 图片和视觉联动；
- 完成条件；
- 下一步规则。

### 5.5 检修智能体

重点保留：

- “检查滤网、风扇和接线”步骤上下文；
- FAN1/FAN2 接线顺序回答；
- “怎么接”“先接哪个”“这个顺序怎么样”等宽松表达；
- 当前步骤之外不提前返回接线答案；
- 可能原因文字保持清晰可读。

### 5.6 记录、专家与图谱

先完成读取 CaseRun 和 caseId 的适配，保持现有散热输出和操作不变。正式通用发布事务在阶段 E 完成。

## 6. 硬编码处理

按阶段 A 矩阵逐条处理：

| 类型 | 目标 |
| --- | --- |
| 案例身份 | manifest |
| 输入字段 | intake |
| 诊断内容 | diagnosis |
| 步骤与检查项 | guide |
| 问答 | assistant |
| 记录和 PDF 字段 | output |
| 知识和图谱候选 | feedback-and-graph |
| 兼容默认 | 仅 legacy adapter |

业务组件不得继续引用散热 ID 或固定温度/风扇字段。测试可以保留明确的 fixture 常量。

## 7. 兼容策略

- 旧 API 保留一轮；
- 旧接口只能在 legacy/dev 模式默认散热；
- 新页面全部使用 run API；
- 兼容层只做字段映射，不保存第二份状态；
- 新路径稳定后再单独决定是否删除旧接口；
- 不在本阶段大规模删除旧代码。

## 8. 自动化测试

- 散热案例包 Schema；
- 页面 DTO 快照；
- 路由命中；
- CaseRun 创建与恢复；
- 预方案快照驱动向导；
- 步骤完成和 revision；
- assistant 步骤约束及同义问法；
- 记录字段；
- 现有 KB-008、图谱和同步回归；
- 切换 run 后无串状态。

## 9. 浏览器验收

完整执行：

1. 以原散热描述从首页进入；
2. 检查接诊布局和动画；
3. 完成诊断；
4. 生成并编辑预方案；
5. 进入“检查滤网、风扇和接线”；
6. 追问 FAN1/FAN2 接线顺序；
7. 完成所有步骤；
8. 查看记录和 PDF；
9. 上传专家；
10. 专家审核和发布；
11. 查看图谱变更；
12. 工程师同步；
13. 刷新并检查恢复；
14. 新建第二个散热 run，确认不覆盖第一个。

视口至少覆盖当前主演示分辨率和一个较窄桌面分辨率。

## 10. 阶段门禁

- 散热全链路通过；
- 原有主要视觉效果无明显退化；
- 接线问答在正确步骤返回；
- CaseRun 刷新恢复通过；
- 两个散热 run 互不覆盖；
- 硬编码扫描达到预期；
- 旧知识和图谱资产未丢失；
- 前端生产构建和后端测试通过；
- 阶段验证结果写入当前状态文档。

## 11. 回滚

- CasePackage 和新 API 可以保留；
- 前端迁移按页面小步提交；
- 任一页面失败可回退该页面适配提交；
- 数据库迁移不通过时从阶段 A 备份恢复；
- 不使用删除数据库作为回滚。

## 12. 建议提交拆分

```text
feat: migrate cooling content to case package
feat: add frontend case session
refactor: drive cooling intake and diagnosis from case data
refactor: drive cooling plan and guide from run state
refactor: drive cooling assistant and records from case data
test: preserve cooling case end-to-end behavior
docs: record phase C validation
```
