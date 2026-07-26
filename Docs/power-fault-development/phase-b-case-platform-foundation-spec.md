# 阶段 B：案例平台基础设施 Spec

> 状态：未开始
> 前置依赖：阶段 A 门禁通过
> 阶段结果：在不依赖具体页面的情况下，建立可验证的多案例运行平台

## 1. 目标

实现统一案例包、服务端路由、CaseRun、数据库迁移和阶段化 API。完成后，即使前端尚未迁移，也能通过测试完成：

```text
加载案例
→ 路由输入
→ 创建 CaseRun
→ 状态转换
→ 保存执行数据
→ 处理并发冲突
→ 恢复运行状态
```

## 2. 非目标

- 不新增供电业务页面；
- 不改变散热页面的展示；
- 不发布供电知识；
- 不生成正式供电 PDF；
- 不实现真实大模型、RAG 或图数据库。

## 3. 子阶段划分

### B1：Schema 和案例包加载器

交付：

- `case_registry.json` Schema；
- manifest、intake、diagnosis、guide、assistant、output Schema；
- 模块加载器；
- 引用完整性检查；
- 包版本和内容哈希；
- 加载错误契约。

加载顺序：

```text
读取注册表
→ 校验 registry
→ 定位 manifest
→ 校验路径边界
→ 校验 manifest
→ 加载各模块
→ 校验各模块 Schema
→ 校验跨模块引用
→ 计算 packageHash
→ 返回 CasePackage
```

任一步失败则该案例不进入可运行列表。

### B2：SQLite 迁移器

交付：

- `schema_migrations`；
- 有序迁移脚本；
- 迁移前备份；
- 事务回滚；
- 空库初始化；
- 旧库升级测试；
- seed 协调规则。

建议新增：

```text
case_runs
case_run_events
case_run_idempotency
case_run_attachments
engineer_submission_snapshots
job_card_snapshots
expert_review_snapshots
```

禁止通过删除数据库实现升级。

### B3：CaseRun 服务

CaseRun 必须保存：

```text
runId
caseId
packageVersion
packageHash
status
revision
payload
createdBy
createdAt
updatedAt
```

状态机：

```text
created
→ intake_confirmed
→ diagnosed
→ plan_confirmed
→ in_progress
→ engineer_submitted
→ expert_reviewing
→ approved | rejected
→ published
→ synced
```

写操作统一接收 `expectedRevision` 和 `idempotencyKey`。

### B4：服务端案例路由

统一接口：

```text
POST /api/demo/case-routing
```

必须实现：

- 文本和单位规范化；
- 型号、告警、症状和测量识别；
- 同义词、错别字和否定表达；
- exclusion 硬门槛；
- 权重、最低分和领先差值；
- 确定性同分规则；
- matched、ambiguous、insufficient、unsupported。

`matched` 后由首页动作创建新 run；正常接口不能默认进入散热案例。

### B5：阶段化 API

建议接口：

```text
GET  /api/demo/cases
POST /api/demo/case-routing
POST /api/demo/case-runs
GET  /api/demo/case-runs/<run_id>
POST /api/demo/case-runs/<run_id>/diagnosis
GET  /api/demo/case-runs/<run_id>/guide/steps
POST /api/demo/case-runs/<run_id>/guide/steps/<step_id>/complete
POST /api/demo/case-runs/<run_id>/records/generate
```

响应按 role 和 stage 裁剪，不能提前返回最终原因、恢复值、专家答案或图谱结论。

## 4. Schema 设计清单

每个 Schema 必须覆盖：

- required、type、enum、pattern；
- 默认 `additionalProperties: false`；
- ID 格式和唯一性；
- 字段长度和数字范围；
- 单位枚举；
- 视觉和附件路径；
- evidence 引用；
- 版本兼容范围。

跨模块校验：

- step/check/topic/source ID 均存在；
- assistant topic 只引用有效步骤；
- completion criteria 引用有效检查或测量；
- 作业卡字段引用有效 engineer result；
- 图谱边起止节点存在；
- manifest、注册表和目录 caseId 一致。

## 5. 路由配置初稿

路由权重和阈值必须通过 golden corpus 调整，不能写死在组件中。第一版建议起点：

| 项目 | 初始值 |
| --- | ---: |
| 完整型号 | +50 |
| 同系列或通用设备 | +25 |
| 核心告警 | +30 |
| 核心症状 | +10/项 |
| 关键测量 | +25 |
| 场景角色 | +5 |
| 明确排除 | -100 |
| `minScore` | 50 |
| `minMargin` | 20 |

这些值只有在路由语料测试通过后才能冻结。

## 6. 并发和幂等

### 6.1 revision

- 创建 run 时 revision 为 1；
- 每次成功写入 revision + 1；
- 客户端 revision 过期返回 409；
- 响应返回当前状态和 revision；
- 不自动覆盖其他标签页的更新。

### 6.2 idempotency

- 客户端生成 UUID；
- 服务端记录 run、接口、key、请求哈希和响应；
- 相同 key、相同请求返回原结果；
- 相同 key、不同请求返回冲突；
- 完成步骤、提交审核和发布都不得重复执行。

## 7. 重置设计

接口分离：

```text
POST /api/demo/case-runs/<run_id>/reset
POST /api/demo/cases/<case_id>/new-run
POST /api/admin/demo/reset-all
```

正常“重新开始演示”调用 `new-run`，保留旧 run、知识、图谱和同步记录。

## 8. 安全与健壮性

- 包路径不得逃逸案例目录；
- 未知 Schema 版本拒绝加载；
- 错误响应不泄露本地路径和堆栈；
- 所有写接口验证角色和状态；
- 锁定安全项由服务端校验；
- JSON 大小、字符串长度和附件引用有上限；
- 数据库操作使用参数化语句；
- 发布前的基础设施不能改变现有发布数据。

## 9. 自动化测试

### 9.1 Schema

- 正式样例通过；
- 缺模块、错类型、未知字段失败；
- 重复 ID 和断裂引用失败；
- `../`、绝对路径和目录外符号链接失败；
- 不支持版本失败。

### 9.2 数据库

- 空库初始化；
- 当前旧库升级；
- 重复执行迁移无变化；
- 中途失败完整回滚；
- seed 不覆盖用户数据；
- 备份可恢复。

### 9.3 状态

- 每个合法转换；
- 每个非法转换；
- revision 冲突；
- 幂等重试；
- 两个 run 并行；
- reset 只影响目标 run。

### 9.4 路由

- 标准、口语、错字和缩写；
- 单位变体；
- 否定表达；
- 散热/供电冲突；
- 信息不足；
- 未支持故障；
- 相同输入确定性。

### 9.5 API

- 阶段和角色裁剪；
- 缺少 caseId/runId；
- 统一错误码；
- 不提前泄露答案。

## 10. 阶段门禁

- 所有 Schema 和跨引用测试通过；
- 空库和旧库迁移测试通过；
- API 可完成创建、读取和合法状态转换；
- 并发与幂等测试通过；
- 路由 golden corpus 达到约定结果；
- 正常接口不默认散热；
- 当前散热前端仍可运行；
- 无供电业务 UI 提前混入本阶段。

## 11. 建议提交拆分

```text
feat: add modular case package schemas
feat: add validated case package loader
feat: add versioned presentation database migrations
feat: add case run state service
feat: add deterministic case routing API
test: cover case platform contracts
docs: record phase B validation
```

每个提交都应单独通过相关测试，数据库迁移和 API 不混成一个不可回退的大提交。
