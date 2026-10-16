# 安装部署、演示复位与故障排查

更新日期：2026-10-16。适用版本：默认分支 `main`，业务代码基线 `ce36b01`。

本文以 Linux / WSL 的 Bash 为主要路径；Windows 原生命令单列在第 5 节。除特别说明，命令均在克隆后的项目根目录执行，各步骤按顺序运行。

## 1. 先选运行方式

| 方式 | 需要什么 | 访问入口 |
| --- | --- | --- |
| 推荐：源码构建后统一运行 | 构建时 Node/npm；运行时 Python/Flask | `http://127.0.0.1:8080` |
| 前后端分别开发 | 同时运行 Vite 和 Flask | `http://127.0.0.1:3000`，API 代理到 8080 |
| 龙芯目标机运行预构建包 | 在开发机构建打包，目标机只安装 Python 依赖 | `http://127.0.0.1:8080` |

GitHub 的源码 ZIP 不含 `node_modules`、虚拟环境、前端 `dist` 或运行数据库。不能把源码 ZIP 当成已经构建好的可执行包。

## 2. Linux / WSL 首次安装

### 2.1 环境准备

要求：Git（克隆方式需要）、Python 3.10+ 及 venv/pip、Node.js 20.19.4、npm 10.8.2、curl。SQLite 随 Python 使用，不需要单独启动数据库服务器。

Ubuntu / Debian 缺少基础工具时，可按本机管理要求安装：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip curl
```

安装 Node.js 20.19.4，并核对版本。已经安装 nvm 的开发机可以使用：

```bash
nvm install 20.19.4
nvm use 20.19.4
```

其他发行版的系统包名称及 Node 安装方法依其现有软件源与管理方式处理。龙芯目标机优先采用第 6 节的预构建包，不在演示现场解决前端构建环境问题。

```bash
python3 --version
node --version
npm --version
```

应分别满足 Python 3.10+、Node `v20.19.4` 和 npm `10.8.2`。系统 Python 版本不足时，先准备合适版本，不修改系统 Python 的默认链接。

### 2.2 获取主分支

在希望存放项目的父目录执行：

```bash
git clone --depth 1 https://github.com/KevinRunzhi/LA.git LA-demo
cd LA-demo
git branch --show-current
```

预期分支为 `main`，默认克隆即为 7 月 18 日演示版及交接文档。也可下载 [源码 ZIP](https://github.com/KevinRunzhi/LA/archive/refs/heads/main.zip) 后进入解压目录，随后跳过 Git 命令。项目可以放在自己的目录，不需要创建原开发者的 `/home/kevin/projects/LA` 路径。

### 2.3 安装后端依赖并构建前端

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend
npm ci
npm run build
cd ..
```

构建完成后应存在 `frontend/dist/index.html`。本版后端直接依赖为 `Flask==3.0.3`，不需要模型密钥、Docker、PostgreSQL 或 Neo4j。

## 3. 推荐：前台启动完整演示

在项目根目录执行：

```bash
backend/.venv/bin/python backend/app.py
```

保持该终端运行，浏览器打开 **http://127.0.0.1:8080**。在另一个终端检查：

```bash
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/presentation/state
```

健康接口应含 `"status":"ok"`。首次初始化的演示状态应含：

```text
caseStatus = awaiting_engineer_confirmation
knowledgeVersion = 1.0
knowledgePublished = false
```

停止时在启动终端按 `Ctrl+C`。修改前端源码后必须重新执行 `npm run build`，Flask 才会提供新页面。

页面的演示身份、完整操作及验收点见 [交接说明](README.md)。

## 4. 开发模式：两个终端

终端一，项目根目录：

```bash
backend/.venv/bin/python backend/app.py
```

终端二，项目根目录：

```bash
cd frontend
npm run dev
```

浏览器打开 **http://127.0.0.1:3000**，Vite 会将 `/api` 转发到 `127.0.0.1:8080`。完整演示需要同时保留后端；只运行 Vite 时部分主流程有兜底，但专家发布和同步不可完整使用。

Vite 若提示改用了其他端口，按终端实际地址访问，同时检查原 3000 端口由谁占用。停止两个终端中的对应服务即可。

## 5. Windows 原生运行

以下为 PowerShell 命令，需要先安装 Git、Python 3.10+（带 `py` 启动器）和 Node.js 20.19.4 / npm 10.8.2。也可以直接采用 WSL 路径；不要把 Linux 下的 `.venv` 或 `node_modules` 复制到 Windows 使用。

```powershell
git clone --depth 1 https://github.com/KevinRunzhi/LA.git LA-demo
Set-Location LA-demo
py -3 --version
node --version
npm --version
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location frontend
npm ci
npm run build
Set-Location ..
backend\.venv\Scripts\python.exe backend\app.py
```

打开 **http://127.0.0.1:8080**。另开 PowerShell 检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

无需激活虚拟环境或调整 PowerShell 执行策略。如果 `npm.ps1` 被执行策略阻止，使用 `npm.cmd ci`、`npm.cmd run build`；不要直接放宽全局执行策略。

原生 Windows 路径未在本轮执行完整验收；本轮实际验证环境为 WSL Ubuntu，见第 10 节。

## 6. Linux 后台运行与龙芯部署

### 6.1 已有源码：先构建，再使用脚本

第 2 节已完成安装和构建的 Linux 源码目录，可以直接执行：

```bash
bash deploy/loongarch/scripts/check-env.sh
bash deploy/loongarch/scripts/start.sh
bash deploy/loongarch/scripts/healthcheck.sh
```

如果之前没有建立后端虚拟环境，可在前端构建完成后执行：

```bash
bash deploy/loongarch/scripts/install.sh
```

该安装脚本会先检查 `frontend/dist/index.html`，不能替代前端构建。x86 开发机的架构提示不代表检查失败。

查看与停止：

```bash
tail -50 logs/la-mvp.log
cat run/la-mvp.pid
bash deploy/loongarch/scripts/stop.sh
```

脚本使用本目录 PID 文件，不会替你接管其他目录启动的服务。停止前可用 `ps -fp "$(cat run/la-mvp.pid)"` 确认进程来源。前台启动的实例用原终端停止，不与后台脚本混用。

### 6.2 开发机构建龙芯演示包

目标机运行预构建包不需要 Node.js；Node 仅用于开发机构建。打包脚本要求 Git 工作区干净，并且会重新构建前端。

```bash
node --version
git status --short
bash scripts/package-loongarch-stable.sh
```

输出位于 `release/`，包含 `.tar.gz` 和同名 `.sha256`。包内有静态页面、后端、JSON、登记的厂商手册和脚本，排除开发依赖及运行数据库。不要用旧日期的现成包冒充当前交接版；应以 `VERSION` 中的 commit 为准。

### 6.3 目标机安装

目标环境：银河麒麟 / Linux，Python 3.10+、venv/pip、curl、tar。以下假设已将本次生成的包和校验文件放到同一个目录；将占位文件名换成实际名称。

```bash
sha256sum -c LA-formal-demo-实际文件名.tar.gz.sha256
mkdir LA-demo-runtime
tar -xzf LA-formal-demo-实际文件名.tar.gz --strip-components=1 -C LA-demo-runtime
cd LA-demo-runtime
cat VERSION
bash deploy/loongarch/scripts/check-env.sh
bash deploy/loongarch/scripts/install.sh
bash deploy/loongarch/scripts/start.sh
bash deploy/loongarch/scripts/healthcheck.sh
```

必须先看到校验 `OK`。`mkdir` 如果提示目录已存在，应另选新目录或先检查原内容，不直接覆盖旧部署。

预构建包仍需安装 Python 依赖；没有 pip 网络的环境，需要提前为目标架构准备可用的依赖与 venv 支持，本流程不宣称完整离线安装。银河麒麟的软件包名称依现场软件源确定，不直接套用 Ubuntu 的 apt 命令。

### 6.4 局域网访问与运行边界

后端监听 `0.0.0.0:8080`；同网段可尝试 `http://<部署机器IP>:8080`。若本机正常而远端打不开，依次检查 IP、网络可达性及系统防火墙，仅在获准的网络范围开放 8080。

WSL 下优先从本机 Windows 浏览器访问 `127.0.0.1:8080`。其他电脑访问 WSL 的行为取决于宿主机转发及网络配置，不能仅依据 Linux 监听地址保证局域网可达。WSL 关闭或 Windows 休眠后需重新启动服务。

本版使用 Flask 自带服务器与演示角色，适用于单机或受控局域网演示；没有生产认证、多人会话隔离及生产部署治理，不作为直接公网服务交付。

## 7. 备份、恢复与重置

### 7.1 备份

先停止当前目录的服务：前台实例按 `Ctrl+C`，后台实例使用本目录 `stop.sh`。确认没有其他实例继续使用该数据库后，在项目根目录执行：

```bash
mkdir -p backups
cp backend/data/presentation/presentation.db "backups/presentation-$(date +%Y%m%d-%H%M%S).db"
```

首次未启动时数据库尚不存在，无须备份。`backups/` 只是本地备份目录，本版忽略规则未排除它；不要把运行备份提交到 Git。

### 7.2 恢复

仍然保持服务停止。先备份当前数据库，再将下面的文件名替换成确定要恢复的、属于本版的备份：

```bash
cp backups/选定备份.db backend/data/presentation/presentation.db
```

然后按第 3 或第 6 节启动。恢复会覆盖当前演示状态，不要在服务写入期间复制覆盖数据库。

### 7.3 演示复位

确认不需要保留当前审核发布进度，且后端正在运行时：

```bash
bash deploy/loongarch/scripts/reset-demo.sh
```

等价调用为 `POST /api/presentation/reset`。Windows PowerShell 可执行：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/presentation/reset
```

重置会清除本地案例审核、知识发布和同步状态。随后刷新页面或重新登录，重新开始工程师流程。浏览器刷新本身不等于复位。

## 8. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| `frontend dist not found` | 确认在本版项目根目录，进入 `frontend` 执行 `npm ci`、`npm run build` |
| 页面能开，但专家审核或同步失败 | 检查 8080 后端及 `/api/presentation/state`；不要只启动 Vite |
| `No module named flask` | 用本目录 `.venv` 的 Python 启动，并安装本版 `backend/requirements.txt` |
| venv 创建失败 | 检查 Python 版本与系统 venv/pip 支持，不修改系统 Python 链接 |
| Node/npm 版本不符 | 切换到 20.19.4 / 10.8.2，再重新安装前端依赖 |
| 出现 Vite/Rollup 架构相关错误 | 不复用其他操作系统或架构的 `node_modules`；在本机新目录按锁文件安装；龙芯可选预构建包 |
| 8080 被占用 | Linux 用 `ss -lntp` 定位，确认来源后停止对应旧实例；不要批量结束 Python |
| 健康检查成功但页面仍旧 | 重新构建本目录前端，并确认浏览器访问的是此目录启动的服务 |
| PDF 手册打不开 | 保留完整 `Info/`，核对 `manual_sources.json` 中登记文件是否存在 |
| 数据库只读或无法创建 | 确认项目及 `backend/data/presentation/` 对运行用户可写，不使用 `chmod -R 777` |
| 发布后仍显示 V1.0 | 返回工程师入口，点击同步最新知识；要从头演示则按第 7 节复位 |
| 修改页面后没生效 | 8080 静态托管需重新构建；开发模式看 Vite 终端的实际地址 |
| 后端测试导入失败 | 从项目根目录执行第 9 节命令，不从 `backend/` 子目录启动测试 |
| 停止脚本找不到 PID 文件 | 可能采用前台方式或另一个项目目录启动，先定位原终端或实际进程 |

## 9. 开发者复验

以下测试会重置当前目录的演示数据库。应使用没有需要保留数据的独立副本，或先按第 7 节备份，并在测试结束后恢复需要的状态。

Linux / WSL，在项目根目录：

```bash
cd frontend
npm run build
node --test src/data/streamingAssistantDemo.test.js
cd ..
backend/.venv/bin/python -m unittest discover -s backend -v
```

Windows 原生使用同样的前端命令，后端改为：

```powershell
backend\.venv\Scripts\python.exe -m unittest discover -s backend -v
```

本版预期有 4 项前端问答测试和 10 项后端测试。完成后还需按交接说明人工验收工程师、专家、同步和打印路径。

## 10. 验证记录

2026-10-16，在独立干净的 `ce36b01` 导出副本中执行，未操作日常演示目录的数据库：

| 检查 | 实际结果 |
| --- | --- |
| 环境 | WSL Ubuntu 24.04.3 LTS，x86_64，Python 3.12.3，Node 20.19.4 / npm 10.8.2 |
| 前端依赖 | 从本机 npm 缓存按锁文件安装成功；这不代表目标机已有离线依赖 |
| 前端构建与问答 | `npm run build` 成功，问答测试 4/4 |
| 后端安装 | 新建项目 venv，按 `requirements.txt` 安装 Flask 3.0.3 及其依赖成功 |
| 后端测试 | 从根目录执行 discover，10/10 通过 |
| 环境与启停脚本 | `check-env.sh`、`install.sh`、`start.sh`、`healthcheck.sh`、`reset-demo.sh`、`stop.sh` 均执行成功 |
| HTTP 与初始状态 | 8080 返回前端 HTML 和健康 JSON；状态为待工程师确认、V1.0、未发布 |
| 文档静态检查 | 新交接文档本地链接、Bash 示例及 PowerShell 示例语法通过 |
| 业务代码 | 当前 main 对齐已验收的 `ce36b01` 演示业务代码，另保留交接文档 |

未验证范围：Windows 原生完整安装、龙芯目标机实测、全部浏览器交互与真实打印、真实模型及工业现场接入。打包章节按既有脚本核对，本轮未重新发布部署压缩包。
