# 项目收尾与 GitHub 归档 Spec

## 1. 文档目的

本文档定义“工控设备智能检修与知识作业系统”在阶段性结束时的收尾方式。目标不是继续扩展产品功能，而是把已经完成的代码、设计、知识资料、比赛材料和交付说明整理成可长期保存、可重新理解、可再次启动的 GitHub 仓库。

本次归档需要解决四个问题：

1. 确定哪个分支代表项目结束时的最新代码；
2. 把尚未提交的正式文档和资料纳入版本管理；
3. 排除运行数据库、缓存、日志和超大生成包，避免污染 Git 历史；
4. 在仓库入口留下准确的阶段总结、阅读顺序和恢复开发方法。

## 2. 当前基线

### 2.1 仓库与远程

| 项目 | 内容 |
| --- | --- |
| WSL 主仓库 | `/home/kevin/projects/LA` |
| 文档 worktree | `/home/kevin/projects/LA-competition-docs` |
| 知识图谱 worktree | `/home/kevin/projects/LA-knowledge-graph` |
| 比赛提交 worktree | `/home/kevin/projects/LA-submission` |
| GitHub 仓库 | `KevinRunzhi/LA` |
| 远程地址 | `https://github.com/KevinRunzhi/LA.git` |

### 2.2 分支结论

| 分支 | 当前结论 | 收尾处理 |
| --- | --- | --- |
| `main` | 远程稳定基线，但落后于最终比赛提交平台 | 最终快进到归档后的最新提交 |
| `submission/competition-platform` | 当前最新产品代码，包含多案例平台、核心业务、运维、案例发布和多 Agent 案例生成 | 作为最终代码整合基线 |
| `feature/industrial-computer-power-fault` | 多故障与供电案例开发分支 | 已完整包含在比赛提交分支中，保留分支历史即可 |
| `feature/knowledge-graph` | 早期知识图谱独立开发分支 | 已被后续主线吸收，保留历史即可 |
| `Docs` | 比赛正式文档和视频材料分支 | 整理、提交并合入最终代码基线，同时保留远程分支 |

### 2.3 最新代码事实

归档前已经确认：

- `main` 是 `submission/competition-platform` 的祖先；
- `feature/industrial-computer-power-fault` 已被 `submission/competition-platform` 完整包含；
- `feature/knowledge-graph` 已被 `main` 及后续分支完整包含；
- `submission/competition-platform` 比远程 `main` 多 23 个提交；
- `Docs` 有独立文档提交和一批未提交材料，需要单独整理后再合入。

## 3. 归档目标

归档完成后，应达到以下状态：

1. GitHub `main` 指向项目结束时的最新完整代码；
2. `submission/competition-platform` 与最终归档代码保持一致；
3. `Docs` 分支保存比赛文档的完整编辑历史；
4. 根目录 `README.md` 不再描述早期 R0 原型，而是说明最终阶段、真实技术栈、运行入口和已知边界；
5. `Docs/README.md` 将项目总结和归档索引放在最前面；
6. `Docs/competition/README.md` 说明每份比赛材料的用途和状态；
7. 原始手册、结构化案例、案例生成模板及正式文档均可在 GitHub 中找到；
8. 数据库、日志、缓存、依赖目录和超大生成包不进入 Git 历史；
9. 项目构建、后端测试和部署预检在最终基线上执行并记录结果；
10. 仓库不包含明文口令、令牌、私钥或真实生产配置。

## 4. 纳入 Git 的内容

### 4.1 源代码与配置

- `backend/` 中的 Flask 业务服务、案例平台、核心业务、平台运维、案例发布和案例生成代码；
- `frontend/` 中的 React、Vite 页面和客户端代码；
- `deploy/`、`scripts/`、`Makefile`、`.github/workflows/` 等工程与部署文件；
- JSON Schema、模块化案例包、故障领域模板和示例配置；
- 可公开的环境变量示例，不包含真实凭据。

### 4.2 项目文档

- 当前架构、部署、运维、功能矩阵和开发 Spec；
- 项目阶段总结、收尾 Spec 和文档索引；
- 软件功能需求分析、功能设计、产品说明、测试报告及安装部署文档；
- 展示视频脚本、配音稿、分镜、视频分析和挑战赛材料；
- 可继续编辑的架构图源文件，例如 `.pptx`。

### 4.3 知识与资料

- `Info/` 下已经整理的厂商手册、安装说明和故障排查资料；
- `backend/data/cases/` 下的散热与供电模块化案例；
- `backend/data/case-generation-templates/` 下的散热、供电、存储、通信、监控、粉尘滤网、凝露及硬件模板；
- 与检修步骤、设备结构和界面呈现直接相关的图片素材；
- 资料清单、抽取文本、结构化知识和处理脚本。

## 5. 不纳入 Git 的内容

以下内容不适合作为源码历史的一部分：

| 类型 | 示例 | 原因 |
| --- | --- | --- |
| 运行数据库 | `run/**/*.db`、`backend/data/presentation/*.db` | 包含运行状态，易产生无意义二进制变更 |
| 日志和 PID | `logs/`、`*.log`、`run/*.pid` | 可重新生成，可能包含本机路径和运行信息 |
| 依赖和构建缓存 | `.venv/`、`node_modules/`、`dist/`、`__pycache__/` | 体积大，可由锁文件和依赖清单恢复 |
| 测试生成物 | `output/case-platform-baseline/`、`output/pdf/` | 属于验收过程输出，不是长期源文件 |
| 比赛压缩包 | `output/submission/*.zip` | 单文件接近或超过 GitHub 100 MB 限制，且可重新打包 |
| 运行验证包 | `run/*validation*` | 属于本地验证结果，已经由提交和脚本取代 |
| 工具检查中间文件 | `*.inspect.ndjson` | 可由源文件重新生成，对后续阅读无直接价值 |
| 密钥和本机配置 | `.env`、真实 API Key、密码、证书私钥 | 安全风险，不得提交 |

已经进入历史的早期发布包不在本次重写 Git 历史的范围内；本次只阻止新增生成包继续进入版本库。

## 6. 文档整理规则

### 6.1 状态区分

归档文档必须区分以下三类：

1. **当前实现文档**：描述 `submission/competition-platform` 的真实代码和运行方式；
2. **目标设计文档**：描述比赛材料中规划的产品化架构，不代表仓库已经采用相同技术栈；
3. **历史过程文档**：保存需求讨论、阶段 Spec、视频制作和方案演变，用于追溯，不再作为继续开发的唯一依据。

### 6.2 入口文件

- 根目录 `README.md`：首次打开仓库时的项目说明和快速运行入口；
- `Docs/README.md`：全部技术、业务和历史文档导航；
- `Docs/project-final-stage-summary.md`：项目结束时的完整状态说明；
- `Docs/competition/README.md`：比赛材料目录和状态说明。

### 6.3 内容一致性

- 产品名称统一为“工控设备智能检修与知识作业系统”；
- 当前实现技术栈按 React、Vite、Flask、Gunicorn、SQLite、JSON Schema 和本地文件存储说明；
- Vue、FastAPI、PostgreSQL、pgvector 和 Neo4j 等内容只作为目标技术架构保留，不写成当前代码事实；
- LoongArch 与银河麒麟兼容结论只引用真实验证记录，未完成实体机验证的部分明确保留边界；
- 不把规则诊断、本地结构化生成或预置多模态交互表述为已经接入真实工业网关或通用模型识别。

## 7. 提交与整合策略

### 7.1 文档分支

在 `Docs` 分支分两组提交：

1. 提交比赛正式文档、视频材料、部署资料和可编辑架构图；
2. 提交项目收尾 Spec、最终阶段总结和文档索引。

每组提交只显式暂存目标文件，不使用无检查的 `git add .`。

### 7.2 最终代码分支

1. 将整理后的 `Docs` 合入 `submission/competition-platform`；
2. 更新根 README、文档入口和 `.gitignore`；
3. 执行完整检查；
4. 提交归档入口和工程清理；
5. 推送 `submission/competition-platform`；
6. 在确认是快进关系后，将 GitHub `main` 更新到相同提交。

### 7.3 历史分支

知识图谱、供电故障和其他已经被最终主线吸收的分支不删除。它们保留早期设计和开发脉络，但 README 明确提示后续阅读者以 `main` 为最终基线。

## 8. 校验方案

### 8.1 文档校验

- Markdown 文件无尾随空白；
- 文档内部链接和相对路径可解析；
- 竞赛材料索引覆盖目录内全部长期文件；
- 不提交 `*.inspect.ndjson` 和临时渲染文件；
- 搜索 API Key、Token、Password、Private Key 等敏感模式；
- 检查新增文件大小，禁止普通 Git 提交超过 100 MB 的单文件。

### 8.2 代码校验

在最终整合分支执行：

```bash
make check
```

该命令包括：

- Python 编译检查；
- Shell 脚本语法检查；
- 后端全部 `unittest`；
- React/Vite 生产构建；
- 生产配置 preflight。

如果环境依赖缺失，先执行 `make install`，再重新运行一次完整检查。

### 8.3 Git 校验

- `git diff --check` 通过；
- `git status` 只剩明确排除的本地生成物；
- `git log --branches --not --remotes` 不再包含应推送的归档提交；
- `origin/main` 与最终归档提交一致；
- `origin/Docs` 保存完整文档历史；
- GitHub 仓库网页能够正常浏览 README、Docs 和 Info。

## 9. 验收标准

以下条件全部满足后，本次项目收尾视为完成：

1. 已生成并提交项目最终阶段总结；
2. 文档分支中的正式资料已提交并推送；
3. 文档目录存在用途和状态索引；
4. 最新比赛提交平台已合入全部归档文档；
5. 根 README 已更新为最终状态；
6. 生成包、数据库、日志和检查中间文件未误提交；
7. 敏感信息扫描无真实凭据；
8. 完整自动化检查通过，或对无法完成的目标机验证作出明确说明；
9. 最新代码和文档均已推送到 GitHub；
10. 后续人员只阅读 README、项目总结和部署指南即可重新理解并启动项目。

## 10. 已知边界

- 本次归档不重写或压缩既有 Git 历史；
- 已经提交的早期二进制发布包继续保留；
- 比赛源代码 ZIP 和作品 ZIP 不进入普通 Git 历史；
- 当前默认是单机部署，不宣称集群高可用；
- 真实图像识别、真实语音识别和工业协议网关仍属于适配或后续能力；
- LoongArch 与银河麒麟最终兼容性仍以目标机真实验收记录为准；
- 归档完成表示项目当前阶段结束，不代表所有目标设计都已经实现。
