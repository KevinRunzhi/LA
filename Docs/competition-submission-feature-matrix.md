# 竞赛提交源码功能矩阵

> 本表用于让评审快速区分已实现代码、可替换适配器和后续计划，不把接口预留写成已上线能力。

| 能力 | 状态 | 代码入口 | 当前边界 |
| --- | --- | --- | --- |
| 模块化案例包 | `implemented` | `backend/data/cases/` | 已有散热、供电平台合同 |
| JSON Schema | `implemented` | `backend/data/cases/schemas/` | Draft 2020-12 |
| 路径与引用校验 | `implemented` | `backend/case_package.py` | 拒绝越界、符号链接、断裂引用 |
| 案例内容哈希 | `implemented` | `backend/case_package.py` | SHA-256 固化到 CaseRun |
| 服务端案例路由 | `implemented` | `backend/case_platform/routing.py` | 规则路由，不声称开放式 AI 理解 |
| 路由解释 | `implemented` | `backend/case_platform/contracts.py` | 返回命中、否定、排除和缺失事实 |
| SQLite 版本迁移 | `implemented` | `backend/case_platform/migrations.py` | 有序、备份、事务、checksum |
| CaseRun 状态机 | `implemented` | `backend/case_platform/case_runs.py` | 角色和状态均由后端校验 |
| revision 冲突 | `implemented` | `backend/case_platform/case_runs.py` | 过期写返回 409 |
| 幂等写入 | `implemented` | `backend/case_platform/case_runs.py` | 同键同请求重放；不同请求冲突 |
| 运行事件日志 | `implemented` | `case_run_events` | 保存状态、revision、角色和摘要 |
| 检修计划快照 | `implemented` | `plan/confirm` API | 向导读取固化版本 |
| 步骤执行校验 | `implemented` | `guide/steps/*/complete` API | 必需检查和测量由后端校验 |
| 动态记录字段 | `implemented` | `records/generate` API | 从当前案例 output 模块读取 |
| 工程师提交 | `implemented` | `engineer-submit` API | 依赖已生成检修记录 |
| 专家审核状态 | `implemented` | `expert/review/*` API | 角色和状态转换受控 |
| 知识版本发布 | `implemented` | `backend/case_platform/knowledge.py` | 与 run/case/hash 绑定 |
| 图谱版本增量 | `implemented` | `case_graph_version_deltas` | 与知识版本绑定 |
| 可信度保护 | `implemented` | `knowledge.py` | 无现场证据不得升级 verified_case |
| 工程师知识同步 | `implemented` | `knowledge/*/sync` API | 按 engineer + knowledge 隔离 |
| 本地规则诊断 | `implemented` | `RuleBasedDiagnosisProvider` | 读取案例诊断模块 |
| 工程师提交事实遥测 | `implemented` | `SubmittedFactsTelemetryProvider` | 不声称连接真实 PLC/网关 |
| 案例 claim 检索 | `implemented` | `CatalogKnowledgeSearchProvider` | 按当前步骤允许 claim 裁剪 |
| 本地附件存储 | `adapter_ready` | `LocalAttachmentStore` | 尚未接入现有上传页面 |
| 远程大模型 | `adapter_ready` | `RemoteModelDiagnosisProvider` | 未配置时明确失败 |
| 工业协议网关 | `adapter_ready` | `TelemetryProvider` Protocol | 需要部署侧具体实现 |
| 向量知识检索 | `adapter_ready` | `KnowledgeSearchProvider` Protocol | 当前使用结构化 claim 检索 |
| 对象存储 | `planned` | `AttachmentStore` Protocol | 未提供虚假云端实现 |
| 真实图像识别 | `planned` | 前端仍使用人工确认标签 | 当前不声称真实识别 |
| 真实语音识别 | `planned` | 前端保留交互入口 | 当前不声称真实识别 |

## 评审建议阅读顺序

1. `backend/case_platform/api.py`；
2. `backend/case_platform/routing.py`；
3. `backend/case_platform/case_runs.py`；
4. `backend/case_platform/knowledge.py`；
5. `backend/case_package.py`；
6. `backend/openapi/case-platform.openapi.yaml`；
7. `backend/test_case_platform.py`。
