# 工控机多故障案例开发执行计划

> 版本：V1.0
> 日期：2026-07-26
> 开发分支：`feature/industrial-computer-power-fault`
> 状态：详细计划已编制，尚未开始业务代码开发

## 1. 文档定位

本目录把总方案拆成可以逐阶段实施、验证和提交的详细 Spec。

上位产品与架构约束：

- [`../industrial-computer-power-fault-development-spec.md`](../industrial-computer-power-fault-development-spec.md)

项目整体事实来源：

- [`../current-development-status.md`](../current-development-status.md)
- [`../runtime-and-loongarch-policy.md`](../runtime-and-loongarch-policy.md)

如文档冲突，采用以下顺序：

1. 用户在当前对话中确认的决定；
2. 上位多故障案例 Spec；
3. 本目录各阶段 Spec；
4. 旧功能 Spec 和历史计划。

## 2. 已冻结的产品决定

- 页面统一称“工控机供电异常”；
- 案例内部设备使用 Rockwell ASEM 6300B-EW1；
- 首页继续通过原输入框提交描述，明确命中后直接跳转；
- 页面与 PDF 使用“现场数据”，不显示“演示案例”徽标；
- 供电案例使用已确认的电压值和 DC-端子故障结论；
- 完整演示工程师提交、专家修改、V1.1 发布、图谱新增和工程师同步；
- 保留第三个最小测试案例验证数据驱动扩展；
- 每次重新开始创建新的 CaseRun，不删除历史知识与图谱资产。

## 3. 阶段总览

| 阶段 | 文档 | 核心结果 | 前置依赖 |
| --- | --- | --- | --- |
| A | [`phase-a-baseline-and-migration-readiness-spec.md`](./phase-a-baseline-and-migration-readiness-spec.md) | 当前实现、数据库、散热链路和硬编码基线冻结 | 无 |
| B | [`phase-b-case-platform-foundation-spec.md`](./phase-b-case-platform-foundation-spec.md) | Schema、加载器、路由、CaseRun、迁移器和 API 地基 | A |
| C | [`phase-c-cooling-case-migration-spec.md`](./phase-c-cooling-case-migration-spec.md) | 散热案例迁入统一结构且视觉、交互和闭环不退化 | B |
| D | [`phase-d-power-case-end-to-end-spec.md`](./phase-d-power-case-end-to-end-spec.md) | 供电案例从首页到检修记录完整可运行 | C |
| E | [`phase-e-jobcard-expert-knowledge-graph-spec.md`](./phase-e-jobcard-expert-knowledge-graph-spec.md) | 两页 PDF、专家审核、知识发布、图谱和同步闭环 | D |
| F | [`phase-f-validation-and-demo-release-spec.md`](./phase-f-validation-and-demo-release-spec.md) | 第三夹具、双案例验收、WSL/龙芯验证和演示冻结 | E |

## 4. 总体依赖主线

```text
A 基线冻结
  ↓
B 案例平台基础设施
  ↓
C 散热案例迁移
  ↓
D 供电案例完整业务链路
  ↓
E 作业卡与知识闭环
  ↓
F 综合验收与演示发布
```

不并行开发 C、D、E。允许并行的工作仅限：

- B 阶段中 Schema 草案与数据库迁移设计；
- D 阶段中供电内容校对与视觉素材准备；
- F 阶段中测试语料整理与部署检查表准备。

所有并行工作都不能绕过阶段门禁进入主分支。

## 5. 每阶段统一工作结构

每份详细 Spec 都按相同结构执行：

1. 目标和非目标；
2. 开始条件；
3. 当前基线与受影响范围；
4. 数据和接口设计；
5. 前后端实施任务；
6. 兼容与迁移策略；
7. 自动化测试；
8. 浏览器验收；
9. 风险与回滚；
10. 完成定义；
11. 建议提交拆分；
12. 交付记录。

## 6. 统一开发纪律

- 主仓库和全部命令只在 WSL `/home/kevin/projects/LA` 中执行；
- 不在 Windows 资料目录修改项目代码；
- 每阶段开始前确认分支和工作区；
- 不覆盖用户已有未提交内容；
- 业务代码不得绕开 CasePackage、CaseRun 和统一 API；
- 正式案例内容不得散落到 React 组件常量；
- 正常演示接口不得缺省进入散热案例；
- 已发布知识版本、图谱增量和作业卡快照不可覆盖；
- 阶段门禁失败时先修复，不带病进入下一阶段；
- 每阶段结束更新 `Docs/current-development-status.md`，但只记录实际完成和验证事实。

## 7. 统一验收环境

```text
开发仓库：/home/kevin/projects/LA
Node.js：20.19.4
npm：10.8.2
Python：3.10+
前端：React 18 + Vite 6
后端：Flask 3
数据库：SQLite
目标环境：WSL + 龙芯开发态
```

每阶段至少完成：

- 相关单元和集成测试；
- 前端生产构建；
- Python 语法或测试检查；
- 对应浏览器主路径；
- Git diff 范围检查。

龙芯验证集中在阶段 F，但任何阶段如果提前在龙芯运行，都要保存真实结果。

## 8. 提交与评审策略

建议保持一类变化一个提交：

```text
schema / loader
database migration
backend API
frontend session
case content
job card
expert and publish
graph and sync
tests
docs and status
```

禁止把大规模格式化、无关重命名或旧页面清理混进功能提交。每个阶段结束形成一个可回退的稳定节点。

## 9. 总完成定义

整个计划只有满足以下结果才算完成：

- 原散热案例全链路无明显视觉和功能退化；
- 供电案例能从首页输入直接进入并完成完整业务闭环；
- 两个案例的运行状态、专家审核、知识版本和图谱互不串联；
- 供电作业卡稳定输出两页 PDF；
- 第三个最小案例只增加数据即可进入通用流程；
- 数据库从现有版本安全迁移且可回滚；
- WSL 全量验证通过；
- 龙芯开发态完成实际演示路径验证；
- 演示重置创建新 run，不删除已发布资产；
- 文档、测试结果和当前状态与实现保持一致。
