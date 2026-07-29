# 多 Agent 案例生成 Spec 实现矩阵

本文是 `competition-submission-document-driven-multi-agent-case-generation-spec.md`
的逐项实施清单。状态只有 `implemented`、`partial`、`pending`，不能用“已有接口”
代替实现完成。

| Spec 项 | 当前状态 | 本轮验收标准 |
| --- | --- | --- |
| 来源快照 | implemented | 保存手册页/chunk、案例 hash、图谱版本、CaseRun revision，任务内不可漂移 |
| 文档理解 | implemented | 去页眉页脚、合并断行、保留页码、章节和表格提示，并限制页数/字符数 |
| 证据提取 | implemented | 单位、否定、原页、冲突并列、excerpt hash 去重 |
| 故障领域 | implemented | 主/次领域、证据、排除项、未决问题；低置信度暂停 |
| 案例大纲 | implemented | 八模块范围与专家问题在模块生成前审批 |
| Routing Agent | implemented | 规范词项并输出与已发布案例的 overlap/margin |
| Manifest Agent | implemented | claim 与真实 evidence 对应，无证据不得 source verified |
| Intake Agent | implemented | 字段类型、单位、枚举、必填数量符合模板限制 |
| Diagnosis Agent | implemented | 原因支持度、矛盾证据和 intake/claim 映射可审计 |
| Guide Agent | implemented | 安全→检查→测量→处置→验证，完成条件和高风险证据齐全 |
| Assistant Agent | implemented | 当前步骤裁剪、口语/否定问法、边界回答和测试集 artifact |
| Output Agent | implemented | 字段来自步骤，两页摘要结构和引用完整 |
| KnowledgeGraph Agent | implemented | 受控关系、重复节点 merge candidate、source claim 映射 |
| CrossModuleCritic | implemented | 覆盖 routing/intake/diagnosis/guide/assistant/output/graph/claim 全部规则 |
| 确定性校验 | implemented | 复用生产 CasePackageRegistry 并保存 package hash |
| Targeted Repair | implemented | 错误码、JSON Pointer、允许模块、每轮 RFC 6902 Patch、三轮及重复错误停止 |
| Patch Assembly | implemented | 生成字段级 RFC 6902，可选择字段，应用时校验 revision/hash |
| Structured Local Provider | implemented | 无 Key 可重复运行 |
| Remote JSON Provider | implemented | HTTP JSON、超时、重试、大小和 Schema、环境变量且不记录凭据 |
| Worker | implemented | HTTP 不执行任务、租约恢复、取消优先、单 job 单 worker、模块并行度 3 |
| 前端六步向导 | implemented | 四来源、页码预览、双栏 diff、字段选择、证据页码、最终校验 |
| 权限与安全 | implemented | expert/admin、来源范围、data delimiter、输入输出限制、全审计 |
| 可观测性 | implemented | 指标完整，日志关联 job/run/request ID |
| 局部验收 | implemented | 覆盖 Agent 边界、编排、业务、冲突、部分应用和发布保护 |
| 阶段 E 闭环 | implemented | storage 生成→应用→校验→审核→发布→首页路由→CaseRun→回滚 |

本轮实施顺序：

1. 先补 Provider、来源、Worker、模板与运行合同；
2. 再补 Agent 语义和证据血缘；
3. 再补精细 Patch、修复循环和发布保护；
4. 最后补六步向导及端到端验收。
