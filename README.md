# 工控设备智能检修与知识作业系统

## 项目状态

本仓库保存“工控设备智能检修与知识作业系统”的阶段性最终成果。项目已完成中国软件杯参赛阶段和后续平台化增强，目前进入归档状态，不再按原开发计划持续迭代。

归档日期：2026-08-09。

项目从最初的工控机散热异常单案例 MVP，逐步发展为包含模块化案例、检修运行状态、专家审核、知识版本、图谱增量、手册证据检索、案例发布和资料驱动案例生成的单机平台。

以后重新使用本项目时，请先阅读：

1. [`Docs/project-final-stage-summary.md`](./Docs/project-final-stage-summary.md)：项目完整推进过程、最终能力和已知边界；
2. [`Docs/competition-submission-feature-matrix.md`](./Docs/competition-submission-feature-matrix.md)：当前源码能力矩阵；
3. [`Docs/competition-submission-architecture.md`](./Docs/competition-submission-architecture.md)：最终代码架构和数据流；
4. [`Docs/competition-submission-deployment-guide.md`](./Docs/competition-submission-deployment-guide.md)：安装、运行、备份和排障；
5. [`Docs/project-closure-and-github-archive-spec.md`](./Docs/project-closure-and-github-archive-spec.md)：本次归档范围和验收标准。

## 产品主线

系统围绕一次设备检修任务组织完整业务闭环：

```text
现场异常接入
  → 设备与故障确认
  → 检修资料与知识检索
  → 智能辅助诊断
  → 检修方案确认
  → 步骤化检修
  → 恢复运行验证
  → 专家审核
  → 检修记录与作业卡输出
  → 案例、知识和图谱回流
```

工程师端负责现场信息、检修方案、步骤执行和恢复结果；专家端负责审核案例、知识和图谱关系；管理员端负责用户、角色和组织；平台后端负责案例路由、状态、版本、审计、知识发布和运行资产。

## 当前主要能力

### 工程师检修

- 文字、语音、图片、视频、音频、设备信息和运行参数接入；
- 历史案例、结构化知识和厂商手册选择；
- 设备与故障确认、辅助诊断和检修依据展示；
- 可编辑检修预方案和关键安全项保护；
- 步骤化检修、当前步骤问答和语音播报；
- 恢复运行验证、检修记录和两页 A4 PDF 作业卡；
- CaseRun、revision、事件日志和不可变业务快照。

### 专家与知识

- 工程师提交、专家审核、退回返工和多轮审核；
- 知识版本、图谱增量和工程师同步；
- PDF 手册入库、按页分块、FTS 检索和证据引用；
- 全局图谱、本次新增修改、全量版本和版本差异；
- 案例草稿、确定性校验、审核、发布和历史版本激活；
- 资料驱动的多 Agent 案例生成、大纲确认和模块 Patch 审核。

### 平台与运维

- 用户会话、密码哈希、令牌撤销、角色权限和审计；
- 检修工单、手册批量入库和多来源统一证据检索；
- SQLite、FTS、图谱摘要和运行资产一致性巡检；
- JSON 日志、请求 ID、Prometheus 指标、存活和就绪检查；
- Gunicorn、systemd、可选 Nginx、preflight、备份和恢复；
- GitHub Actions、Python 单元测试和 React 生产构建。

## 模块化案例与资料

仓库内置两个模块化案例：

- `CASE-ACP4000-001`：散热异常完整闭环；
- `CASE-ROCKWELL-6300-002`：供电故障案例。

案例由 `manifest` 和 `intake`、`diagnosis`、`guide`、`assistant`、`output`、`feedback-and-graph` 六个业务模块组成，并通过 JSON Schema、引用校验和 SHA-256 固化。

`Info/` 保存多品牌工控设备手册及散热知识资料；`backend/data/case-generation-templates/` 保存散热、供电、存储、通信、监控、粉尘滤网、凝露和硬件等故障领域模板。

## 当前真实技术栈

| 层次 | 技术 |
| --- | --- |
| 前端 | React 18、Vite 6、Lucide React |
| 后端 | Python、Flask 3、Gunicorn |
| 数据 | SQLite |
| 案例合同 | JSON、JSON Schema Draft 2020-12、SHA-256 |
| 检索 | SQLite FTS5、结构化 claim 检索 |
| PDF | pypdf、ReportLab |
| 文件 | 受限本地文件目录与 SHA-256 校验 |
| 部署 | 原生 Linux、systemd、可选 Nginx |
| 测试 | unittest、Vite build、preflight、GitHub Actions |

比赛正式文档中还保留 Vue、FastAPI、PostgreSQL、pgvector、Neo4j 和千问模型等目标产品架构。它们用于未来产品化重构参考，不代表当前源码已经采用这些技术。

## 仓库结构

```text
LA/
├── backend/                 Flask 服务、案例平台、核心业务和测试
├── frontend/                React/Vite 前端
├── backend/data/cases/      模块化案例包和 JSON Schema
├── backend/data/case-generation-templates/
│                            故障领域案例生成模板
├── deploy/                  Gunicorn、systemd、Nginx 和龙芯脚本
├── scripts/                 开发、检查和打包脚本
├── Docs/                    项目业务、技术、部署和归档文档
├── Docs/competition/        比赛正式文档、视频与挑战赛材料
├── Info/                    厂商手册和检修知识资料
├── Makefile                 统一工程命令
└── .github/workflows/       持续集成
```

## 环境要求

推荐环境：

```text
Node.js 20.19.4
npm 10.8.2
Python 3.10 或 3.12
Linux / WSL2
```

目标部署方向为 LoongArch64 与银河麒麟。仓库包含相关原生部署脚本，但最终兼容结论仍应以真实目标机验收记录为准。

## 快速恢复与验证

安装依赖：

```bash
make install
```

执行完整检查：

```bash
make check
```

`make check` 会执行 Python 编译、Shell 语法、全部后端测试、前端生产构建和部署 preflight。

启动生产形态服务：

```bash
cp deploy/env/production.env.example run/platform.env
set -a
source run/platform.env
set +a
make run
```

默认访问：

```text
http://127.0.0.1:8080
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8080/api/health/live
curl -fsS http://127.0.0.1:8080/api/health/ready
curl -fsS http://127.0.0.1:8080/api/metrics
```

完整安装、服务化运行和备份恢复见 [`Docs/competition-submission-deployment-guide.md`](./Docs/competition-submission-deployment-guide.md)。

## 文档入口

- [`Docs/README.md`](./Docs/README.md)：全部项目文档导航；
- [`Docs/competition/README.md`](./Docs/competition/README.md)：比赛正式文档和视频材料索引；
- [`Docs/project-final-stage-summary.md`](./Docs/project-final-stage-summary.md)：最终阶段总结；
- [`Docs/project-closure-and-github-archive-spec.md`](./Docs/project-closure-and-github-archive-spec.md)：归档 Spec；
- [`Docs/competition-submission-feature-matrix.md`](./Docs/competition-submission-feature-matrix.md)：实现与适配边界；
- [`Docs/competition-submission-operations-runbook.md`](./Docs/competition-submission-operations-runbook.md)：运维手册。

## 已知边界

- 当前是可恢复的单机平台，不是集群高可用系统；
- 默认诊断和案例生成以规则及本地结构化提供方为主；
- 远程 JSON 模型适配器需要部署环境提供服务和凭据；
- 真实图像识别、真实语音识别和工业协议网关未作为最终能力验证；
- 当前图谱使用 SQLite 版本和关系快照，不是 Neo4j 运行实例；
- 当前遥测来自工程师提交事实或演示数据，不宣称连接真实 PLC 或 SCADA；
- LoongArch 与银河麒麟的最终适配状态以目标机实际测试为准。

## 分支说明

- `main`：归档后的最终默认基线；
- `submission/competition-platform`：比赛提交平台完整开发历史；
- `Docs`：比赛正式文档和视频材料编辑历史；
- `feature/industrial-computer-power-fault`：多故障与供电案例阶段历史；
- `feature/knowledge-graph`：知识图谱独立开发阶段历史。

项目恢复开发时，应从 `main` 创建新分支，不再以早期 feature 分支作为代码基线。

## 资料使用说明

`Info/` 中的厂商手册和技术资料版权归原权利人所有，仓库保留这些内容用于项目研究、检修知识整理和复用。再次公开发布或用于商业用途前，请重新核对资料授权范围。
