# 龙芯环境 MVP 部署环境清单

本文档用于队友在龙芯部署环境时逐项准备依赖。范围只覆盖当前 MVP 骨架已经用到的技术栈，不包含后续真实大模型接入、视频输入、语音播报、专家连线等扩展能力。

## 1. MVP 技术栈总览

当前 MVP 是一个轻量 Web 应用：

| 层级 | 技术 | 当前用途 | 是否必须 |
| --- | --- | --- | --- |
| 前端 | React 18 | 构建诊断台、知识图谱、检修向导等页面 | 必须 |
| 前端构建 | Vite 6 | 本地开发服务、打包前端静态文件 | 必须 |
| 前端图标 | lucide-react | 左侧导航、按钮、步骤状态等图标 | 必须 |
| 后端 | Python 3 + Flask 3 | 提供 API、托管前端构建产物 | 必须 |
| 数据 | JSON 文件 | 存放演示场景、检修步骤、知识条目、图谱关系 | 必须 |
| 部署方式 | 本机进程运行 | Flask 监听 8080 端口，前端可由 Flask 托管 | 必须 |
| Docker | 不使用 | 龙芯平台当前不使用 Docker | 不需要 |

## 2. 操作系统基础环境

龙芯机器需要先准备基础命令行环境：

- Linux 发行版：以龙芯机器当前系统为准。
- Shell：`bash`。
- Git：用于拉取 GitHub 仓库。
- curl：用于健康检查和下载工具。
- ca-certificates：用于 HTTPS 证书校验。
- tar / gzip / unzip：用于解压 Node.js 或其他离线包。
- build-essential 或等价编译工具：建议安装，部分 npm 或 Python 包在特殊架构上可能需要本地编译。

建议安装项：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates tar gzip unzip build-essential
```

如果系统不是 Debian/Ubuntu 系，使用系统对应的软件包管理器安装同类工具即可。

## 3. Node.js 与 npm

### 3.1 版本要求

当前项目固定使用：

- Node.js：`20.19.4`
- npm：`10.8.2`

项目根目录的 `.nvmrc` 已写入：

```text
20.19.4
```

前端 `package.json` 也声明了相同版本要求。

### 3.2 为什么选择 Node.js 20

Node.js 20 是长期支持版本，稳定性更适合当前 MVP。Node.js 22 功能更新更多，但对本项目目前没有必要收益；考虑龙芯环境包兼容性、离线下载和部署可控性，MVP 阶段优先用 Node.js 20.19.4。

### 3.3 安装方式

优先使用龙芯系统软件源或龙芯适配包安装 Node.js 20.19.4。如果软件源没有这个版本，可以下载龙芯平台可用的 Node.js 二进制包或源码包。

需要确认：

```bash
node -v
npm -v
```

期望输出：

```text
v20.19.4
10.8.2
```

如果 npm 版本不一致，可以在 Node 安装完成后调整：

```bash
npm install -g npm@10.8.2
```

## 4. 前端依赖包

前端目录：

```bash
frontend/
```

必须安装的运行依赖：

| 包名 | 版本 | 用途 |
| --- | --- | --- |
| react | 18.3.1 | 前端 UI 框架 |
| react-dom | 18.3.1 | React DOM 渲染 |
| lucide-react | 0.468.0 | 图标组件 |

必须安装的开发/构建依赖：

| 包名 | 版本 | 用途 |
| --- | --- | --- |
| vite | 6.4.3 | 前端开发服务器和生产构建 |
| @vitejs/plugin-react | 4.7.0 | Vite 的 React 插件 |

安装命令：

```bash
cd ~/projects/LA/frontend
npm install
```

如果希望严格按锁文件安装：

```bash
npm ci
```

说明：

- `npm install` 会根据 `package.json` 和 `package-lock.json` 安装依赖。
- `npm ci` 更适合部署环境，要求 `package-lock.json` 存在且与 `package.json` 一致。
- 龙芯环境如果下载慢，可以提前在有网络的机器上准备 npm 缓存或离线包。

## 5. Python 与后端依赖

### 5.1 Python 版本

当前开发环境使用：

```text
Python 3.12.3
```

部署环境建议：

- 优先使用 Python 3.10 及以上。
- 推荐 Python 3.12，如果龙芯系统软件源支持，尽量与开发环境保持一致。

必须具备：

- `python3`
- `python3-venv`
- `python3-pip`

安装示例：

```bash
sudo apt install -y python3 python3-venv python3-pip
```

### 5.2 后端直接依赖

后端目录：

```bash
backend/
```

`backend/requirements.txt` 当前只有一个直接依赖：

```text
Flask==3.0.3
```

安装命令：

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

### 5.3 Flask 传递依赖

安装 Flask 后通常会出现以下传递依赖，属于正常情况：

| 包名 | 当前开发环境版本 | 用途 |
| --- | --- | --- |
| Flask | 3.0.3 | Web 后端框架 |
| Werkzeug | 3.1.8 | WSGI 工具库 |
| Jinja2 | 3.1.6 | 模板引擎，Flask 依赖 |
| MarkupSafe | 3.0.3 | Jinja2 安全字符串处理 |
| itsdangerous | 2.2.0 | Flask 签名相关依赖 |
| click | 8.4.2 | Flask 命令行依赖 |
| blinker | 1.9.0 | Flask 信号机制依赖 |

如果龙芯机器无法直接联网安装 Python 包，可以在其他机器提前下载 wheel 或源码包：

```bash
pip download -r backend/requirements.txt -d vendor/python
```

然后拷贝到龙芯机器离线安装：

```bash
pip install --no-index --find-links vendor/python -r backend/requirements.txt
```

## 6. GitHub 仓库拉取

仓库地址：

```text
https://github.com/KevinRunzhi/LA.git
```

拉取命令：

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/KevinRunzhi/LA.git
cd LA
```

如果 HTTPS 拉取需要账号密码，不要输入 GitHub 登录密码。GitHub 现在需要使用以下方式之一：

- GitHub CLI 登录后拉取。
- Personal Access Token。
- SSH key。

## 7. 构建与启动顺序

### 7.1 安装前端依赖并构建

```bash
cd ~/projects/LA/frontend
npm ci
npm run build
```

构建成功后会生成：

```text
frontend/dist/
```

### 7.2 安装后端依赖并启动

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

后端默认监听：

```text
0.0.0.0:8080
```

本机访问：

```text
http://127.0.0.1:8080
```

局域网访问时，把 `127.0.0.1` 换成龙芯机器 IP：

```text
http://<龙芯机器IP>:8080
```

### 7.3 健康检查

```bash
curl http://127.0.0.1:8080/api/health
```

期望返回：

```json
{"service":"la-mvp-backend","status":"ok"}
```

## 8. 开发模式与部署模式区别

### 8.1 开发模式

开发时可以同时运行前后端：

```bash
cd ~/projects/LA/backend
. .venv/bin/activate
python app.py
```

另开一个终端：

```bash
cd ~/projects/LA/frontend
npm run dev
```

前端开发服务默认：

```text
http://127.0.0.1:3000
```

Vite 会把 `/api` 请求代理到：

```text
http://127.0.0.1:8080
```

### 8.2 MVP 演示部署模式

演示时建议只启动后端：

```bash
cd ~/projects/LA/frontend
npm run build

cd ~/projects/LA/backend
. .venv/bin/activate
python app.py
```

然后访问：

```text
http://<龙芯机器IP>:8080
```

这样浏览器只需要访问一个端口，部署更简单。

## 9. 当前数据文件

MVP 不接数据库，所有演示数据来自 JSON 文件：

| 文件 | 用途 |
| --- | --- |
| `backend/data/demo_scenario.json` | 工控机高温、风道堵塞、散热异常演示场景 |
| `backend/data/guide_steps.json` | 检修向导步骤 |
| `backend/data/knowledge_items.json` | 知识检索证据条目 |
| `backend/data/graph_relations.json` | 知识图谱关系 |
| `backend/data/expert_reviews.json` | 专家审核模拟结果 |

这些文件是当前 MVP 的“预设流程”来源，后续接入真实大模型或数据库前，不需要额外部署数据库服务。

## 10. 当前不需要部署的内容

以下能力在 MVP 阶段只保留位置或模拟入口，不需要队友现在部署：

| 能力 | 当前状态 | 是否部署 |
| --- | --- | --- |
| Docker | 龙芯平台当前不用 Docker | 不部署 |
| 数据库 | 暂用 JSON 文件 | 不部署 |
| 向量数据库 | 知识检索为预设数据 | 不部署 |
| 大模型本地推理 | 暂未接入 | 不部署 |
| 云 API Key | 后续可接云 API，目前骨架不依赖 | 暂不需要 |
| 语音播报 | 模拟能力，预留接口 | 不部署 |
| 视频输入 | 模拟能力，预留接口 | 不部署 |
| 专家连线 | 模拟能力，预留接口 | 不部署 |
| 图片上传/插入 | MVP 第一阶段不做 | 不部署 |
| 三维建模 | 不做复杂三维，仅后续预留图片区域 | 不部署 |

## 11. 端口与网络

需要确认：

- 后端端口：`8080`
- 前端开发端口：`3000`
- 演示优先使用：`8080`

如果其他设备需要访问龙芯机器：

1. 确认龙芯机器和访问设备在同一网络。
2. 确认防火墙允许 `8080` 端口。
3. 使用 `http://<龙芯机器IP>:8080` 访问。

如果平板或外部浏览器暂时不方便访问龙芯 IP，这部分可后期再处理；当前环境先保证龙芯机器本机浏览器能打开页面。

## 12. 最小验收清单

部署完成后逐项检查：

- `git --version` 正常。
- `node -v` 为 `v20.19.4`。
- `npm -v` 为 `10.8.2`。
- `python3 --version` 为 `3.10+`，推荐 `3.12.x`。
- `cd frontend && npm ci && npm run build` 成功。
- `cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` 成功。
- `python app.py` 可以启动。
- `curl http://127.0.0.1:8080/api/health` 返回 `ok`。
- 浏览器可以打开 `http://127.0.0.1:8080`。
- 页面能看到智能诊断台、异常接入、分析诊断、检修向导、知识图谱等 MVP 页面。

## 13. 建议交付给队友的下载内容

如果龙芯机器网络不稳定，建议提前准备：

- Git 仓库源码压缩包，或确保能访问 GitHub 仓库。
- Node.js `20.19.4` 的龙芯可用安装包。
- npm 依赖缓存或 `frontend/package-lock.json` 对应依赖包。
- Python 3、venv、pip 的系统安装包。
- `Flask==3.0.3` 及其传递依赖的离线包。

当前 MVP 不需要下载模型权重、Docker 镜像、数据库安装包或三维资源。
