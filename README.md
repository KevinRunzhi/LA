# 站控慧眼：工控设备智能检修助手 · 交接演示版

本分支用于交接原有前端与完整演示流程。代码基线为 `4ff7aed`，提交时间 **2026-07-26 18:49:13（北京时间）**。它与 7 月 18 日的 `ce36b01` 前后端代码一致，只新增了多案例开发规划文档；后续竞赛平台扩建不包含在本分支中。

交接整理日期：2026-10-16。本次整理仅更新本 README，不修改历史演示代码。

## 获取正确版本

请使用交接分支 `codex/handoff-demo-20260726`：

```bash
git clone --branch codex/handoff-demo-20260726 --single-branch https://github.com/KevinRunzhi/LA.git LA-demo
cd LA-demo
```

[交接分支](https://github.com/KevinRunzhi/LA/tree/codex/handoff-demo-20260726) · [下载交接版 ZIP](https://github.com/KevinRunzhi/LA/archive/refs/heads/codex/handoff-demo-20260726.zip)

仓库 `main` 保存后续完整竞赛归档；交接时请分享上面的分支链接。ZIP 解压后的目录名可能不同，后续命令中的 `LA-demo` 替换为实际目录即可。

## 保留的演示内容

- 工程师、专家、管理员三类演示入口。
- 动态接诊、场站定位、Agent 会诊与流式输出。
- 诊断结论、可编辑检修预方案、图文检修向导及步骤问答。
- 语音输入、播报和专家视频协同的演示交互。
- 检修完成记录、两页打印作业卡。
- 专家审核、知识发布、知识图谱和工程师知识同步。

主案例为研华 ACP-4000 / IPC-610 工控机散热异常。前端主要使用预置数据与模拟输出，未接入真实大模型、多模态识别或现场工业网关。案例审核、知识发布与同步使用本地 SQLite，因此完整演示需要同时运行小型 Flask 后端。

## 环境

建议使用 Linux 或 WSL：Node.js **20.19.4**、npm **10.8.2**、Python **3.10+**。

前端运行时由浏览器执行，后端依赖见 `backend/requirements.txt`。不要求 Docker、外部数据库或模型 API 密钥。

## 首次安装

在仓库根目录执行：

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend
npm ci
cd ..
```

安装前请用 `node -v` 和 `npm -v` 核对版本。使用 nvm 时可先执行 `nvm use 20.19.4`。

## 启动演示

### 方式一：构建后由 Flask 统一提供页面

```bash
cd frontend
npm run build
cd ..
backend/.venv/bin/python backend/app.py
```

访问 **http://127.0.0.1:8080**。健康检查为 `http://127.0.0.1:8080/api/health`。

### 方式二：前后端分别开发

终端一，在仓库根目录：

```bash
backend/.venv/bin/python backend/app.py
```

终端二，在仓库根目录：

```bash
cd frontend
npm run dev
```

访问 **http://127.0.0.1:3000**；Vite 已将 `/api` 代理到后端 `8080` 端口。

## 演示顺序与重置

1. 工程师登录，输入散热异常并完成动态接诊。
2. 查看诊断，编辑并确认检修预方案。
3. 完成五步检修向导和恢复验证，生成记录及作业卡。
4. 上传专家，切换专家入口，完成审核与知识发布。
5. 返回工程师入口，同步新知识并查看图谱变化。

演示账号和详细操作见 [7 月 17 日交接快照](Docs/CODEX-HANDOFF-2026-07-17.md)。其中原开发目录、Git 状态和运行状态是历史记录，当前获取及启动方式以本页为准。

SQLite 数据库首次启动时根据 JSON 种子自动创建，路径为 `backend/data/presentation/presentation.db`。重新从头演示时，在后端运行期间执行：

```bash
curl -X POST http://127.0.0.1:8080/api/presentation/reset
```

重置会清除本地审核、发布和同步进度；需要保留时先停止服务并备份数据库。刷新浏览器不会重置数据库，前端接诊和执行过程也不具备完整的刷新恢复能力。

## 代码阅读入口

| 路径 | 职责 |
| --- | --- |
| `frontend/src/App.jsx` | 工程师工作台、接诊、诊断、预方案、向导与记录 |
| `frontend/src/admin/AdminShell.jsx` | 专家门户、审核与知识发布 |
| `frontend/src/admin/AdminUserPortal.jsx` | 管理员演示界面 |
| `frontend/src/admin/knowledge-graph/` | 知识图谱 |
| `frontend/src/components/records/MaintenanceJobCardPrint.jsx` | 打印作业卡 |
| `backend/app.py` | 演示 API 与前端静态托管 |
| `backend/presentation_store.py` | SQLite 演示状态、知识发布与同步 |
| `backend/data/` | 场景、步骤、知识、案例和重置种子 |
| `Info/` | 手册与资料 |

`Docs/` 保留原开发计划和设计讨论，其中多案例平台规划属于后续设想，不代表本交接版已实现。

## 验证

此交接版的业务代码与本次已验证的 `ce36b01` 相同：前端构建通过、前端问答测试 4/4、后端测试 10/10，以及首页、健康接口和初始演示状态检查通过。尚未重新完成浏览器全流程与龙芯实机验收。

复验命令：

```bash
cd frontend
npm run build
node --test src/data/streamingAssistantDemo.test.js
cd ..
backend/.venv/bin/python -m unittest discover -s backend -v
```

旧版后端测试会重置当前目录的演示数据库，请在干净副本中执行，或先备份需要保留的数据。
