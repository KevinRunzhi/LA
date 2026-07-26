# 阶段 E：作业卡、专家、知识与图谱闭环 Spec

> 状态：未开始
> 前置依赖：阶段 D 门禁通过
> 阶段结果：供电案例完成两页 PDF、专家审核、知识发布、图谱增量和工程师同步

## 1. 目标

把供电 CaseRun 的执行结果固化为可打印、可审核、可发布和可同步的完整闭环：

```text
工程师完成检修
→ 生成两页作业卡
→ 提交专家
→ 专家修改与审核
→ 发布知识 V1.1
→ 写入图谱增量
→ 工程师同步
```

## 2. 非目标

- 不做通用报表设计器；
- 不做电子签章；
- 不做生产级权限系统；
- 不做图数据库；
- 不允许专家直接修改历史已发布版本；
- 不改变用户确认的“现场数据”展示口径。

## 3. 工程师提交快照

提交时固化：

```text
runId
caseId
packageVersion
packageHash
resolvedPlanSnapshot
stepExecution
measurements
assistantEvidence
engineerResult
attachments
sourceRefs
submittedBy
submittedAt
revision
snapshotHash
```

专家读取该快照，不读取工程师后续未提交草稿，也不使用最新案例模板重算。

## 4. 两页作业卡

### 4.1 第一页

- 工控机和故障位置；
- 故障摘要；
- 风险等级；
- 核心诊断结论；
- 供电路径图；
- 官方判据；
- 处理前现场数据；
- 压降定位结果；
- 安全前置条件。

### 4.2 第二页

- 实际处理摘要；
- 接线与端子工艺参数；
- 处理前后指标对比；
- Power LED、POST、Windows 和业务恢复；
- 观察时长和结果；
- 遗留风险；
- 工程师与专家签字区域；
- 资料和数据来源摘要。

### 4.3 字段契约

每个字段声明：

```text
id
label
type
unit
required
validation
displayOrder
source
emptyBehavior
```

生成前后端都要校验；服务端结果为最终权威。

### 4.4 分页策略

- A4 两页；
- 关键区块设置 `keepTogether`；
- 安全、结论、处理和恢复不能被裁掉；
- 附件只列摘要；
- 低优先级长文本按规则压缩；
- 超出极限时生成明确错误，不输出缺少关键内容的 PDF；
- 页面和 PDF 使用“现场数据”，不显示“演示案例”徽标或水印。

### 4.5 PDF 快照

保存：

- jobCardSnapshot；
- 模板版本；
- 渲染器版本；
- 生成时间；
- PDF 文件哈希；
- 页数；
- 字体和纸张配置。

历史 PDF 不随模板升级改变。

## 5. 专家工作台

### 5.1 多案例选择

专家状态：

```text
selectedRunId
selectedCaseId
selectedKnowledgeId
selectedVersion
```

待审核列表支持：

- 案例；
- 故障域；
- 提交时间；
- 工程师；
- 审核状态；
- 内部来源与核验状态。

选中项写入 URL 或等价可恢复状态，刷新和多标签页不串案例。

### 5.2 审核内容

专家可：

- 核对现场数据；
- 核对官方判据；
- 修改工程师总结；
- 增加或删除候选知识表述；
- 决定图谱节点和关系；
- 退回工程师；
- 批准并发布。

专家不可：

- 修改原始执行快照；
- 覆盖已发布历史版本；
- 把内部未核验数据自动升级为真实案例；
- 绕过知识和图谱引用校验。

## 6. 知识版本

候选知识 ID：

```text
KB-ROCKWELL-6300-POWER-001
```

### 6.1 V1.0

只包含官方可核实内容：

- 供电范围；
- 针脚和极性；
- 接线工艺；
- LED 状态；
- 安全要求。

### 6.2 V1.1

加入本次现场处理经验：

- 上游正常不能排除设备端路径异常；
- 启动瞬间分段测量比静态测量更有效；
- DC 端子松动可能造成严重启动压降；
- 修复后应同时验证电气、系统和业务层。

服务端计算下一版本号。客户端不提交 `targetVersion`。

## 7. 原子发布事务

请求至少包含：

```text
runId
caseId
knowledgeId
expectedCurrentVersion
expectedRevision
idempotencyKey
expertDecision
graphDecisions
```

事务：

1. 校验专家角色；
2. 校验 run 状态；
3. 校验 revision；
4. 读取当前知识版本；
5. 固化 expertReviewSnapshot；
6. 计算新版本；
7. INSERT KnowledgeVersion；
8. INSERT GraphVersionDelta；
9. 更新 CaseRun；
10. 写入审计事件；
11. 提交事务。

失败全部回滚。禁止 `INSERT OR REPLACE`。

## 8. 图谱增量

第一版至少包含：

```text
DC-端子松动 → 导致 → 启动负载压降
启动瞬间 11.6V → 低于 → 设备工作电压下限
启动负载压降 → 导致 → Power LED OFF
启动负载压降 → 导致 → POST 无法开始
重做并复紧 DC 端头 → 修复 → 设备端供电路径
设备端 24.0V → 支持 → 供电恢复
Power LED 绿色常亮 → 指示 → 输入电源供电正常
供电 CaseRun → 形成 → 供电检修知识 V1.1
```

每个节点和关系保存：

- stable ID；
- changeType；
- status；
- runId；
- caseId；
- knowledgeId；
- version；
- sourceRefs；
- 内部核验状态。

### 8.1 图谱视图

保留两个视图：

1. 全局知识图谱；
2. 本次新增与修改。

“本次新增与修改”按 `runId + knowledgeId + version` 过滤。不得把另一个案例或旧版本增量混入。

节点点击、镜头缩放和聚焦动画沿用当前图谱页面风格。

## 9. 工程师同步

同步请求：

```text
knowledgeId
version
idempotencyKey
```

行为：

- UPSERT 指定知识版本；
- 重复同步无重复记录；
- 保留旧版本同步历史；
- 页面显示本地版本和最新版本；
- 不依赖当前 active case；
- 同步完成后 CaseRun 可进入 synced。

## 10. 自动化测试

### 10.1 PDF

- 字段映射；
- 单位；
- 空值策略；
- 两页；
- 长文本溢出；
- 关键区块不裁切；
- 快照和哈希；
- 散热 PDF 回归。

### 10.2 专家

- 待审核列表隔离；
- URL 恢复；
- 多标签页；
- 退回和批准；
- 不可修改提交快照；
- 角色限制。

### 10.3 发布

- 正常 V1.0 → V1.1；
- 重复 idempotency key；
- revision 冲突；
- expected version 冲突；
- 图谱插入失败事务回滚；
- 历史版本不覆盖；
- 内部来源状态不自动升级。

### 10.4 图谱和同步

- 按 run/knowledge/version 过滤；
- 全局图谱合成；
- 重复同步；
- 散热和供电互不影响。

## 11. 浏览器验收

1. 从已完成供电 run 生成作业卡；
2. 浏览器打印预览确认两页；
3. 保存 PDF 并检查内容；
4. 工程师提交专家；
5. 退出工程师账号；
6. 专家登录并选中正确 run；
7. 修改候选知识；
8. 审核图谱变更；
9. 发布 V1.1；
10. 查看“本次新增与修改”动画；
11. 切换全局图谱；
12. 工程师重新登录并同步 V1.1；
13. 重复同步确认无重复；
14. 打开散热知识确认未被覆盖。

## 12. 阶段门禁

- 供电 PDF 稳定两页；
- 作业卡内容清楚且以总结为主；
- 专家能正确选择供电 run；
- 发布事务原子、幂等且有版本冲突保护；
- V1.1 和图谱增量一致；
- 图谱过滤准确；
- 工程师同步准确；
- 散热知识、图谱和同步回归通过；
- 历史快照不可变；
- 自动化、构建和浏览器验收通过。

## 13. 建议提交拆分

```text
feat: render case-driven maintenance job cards
feat: persist immutable engineer and pdf snapshots
feat: support multi-case expert review selection
feat: publish versioned knowledge atomically
feat: display versioned graph changes
feat: sync selected knowledge versions
test: cover feedback and publish transaction
docs: record phase E validation
```
