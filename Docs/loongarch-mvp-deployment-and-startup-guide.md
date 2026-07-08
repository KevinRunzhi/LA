# 龙芯平台 MVP 部署与启动文档

更新时间：2026-07-08

本文档用于指导队友在龙芯平台上部署并启动当前 MVP。当前项目为演示骨架，采用 React + Vite 前端、Flask 后端、JSON 预设数据，不使用 Docker，不依赖数据库。

## 1. 当前部署目标

当前 MVP 部署后的目标效果：

- 在龙芯 Linux 环境中启动一个 Flask 服务。
- Flask 监听 `8080` 端口。
- Flask 同时提供后端 API 和前端静态页面。
- 浏览器访问 `http://龙芯机器IP:8080` 后进入 MVP 页面。

当前 MVP 不包含：

- Docker 部署。
- 数据库部署。
- 真实大模型 API。
- 真实语音播报。
- 真实专家电话。
- 真实视频输入。
- 真实图像识别。

这些能力目前只做页面入口或模拟效果。

## 2. 推荐部署方式

推荐优先使用“已构建前端包”的部署方式：

1. 在开发机或 WSL 中执行前端构建。
2. 打包 `backend/` 和 `frontend/dist/`。
3. 将压缩包拷贝到龙芯机器。
4. 龙芯机器只安装 Python 依赖并启动 Flask。

这样做的好处：

- 龙芯机器上可以暂时不安装 Node.js。
- 避免 npm 包在龙芯平台下载或构建失败。
- 最适合先验证 MVP 页面组件、图片资源和流程演示。

## 3. 龙芯机器需要准备的环境

### 3.1 必须环境

| 环境 | 建议版本 | 用途 |
| --- | --- | --- |
| 龙芯 Linux 系统 | 以实际机器为准 | 运行服务 |
| Python | `3.10+`，推荐 `3.12.x` | 运行 Flask 后端 |
| pip | 与 Python 匹配 | 安装 Python 依赖 |
| venv | 与 Python 匹配 | 创建虚拟环境 |
| tar / gzip | 系统自带即可 | 解压部署包 |
| bash | 系统自带即可 | 执行启动命令 |

### 3.2 推荐环境

| 环境 | 用途 |
| --- | --- |
| curl | 测试服务是否启动 |
| git | 如需直接从 GitHub 拉取代码 |
| gcc / g++ / make | 离线包或源码包安装时备用 |

### 3.3 不需要

| 环境 | 说明 |
| --- | --- |
| Docker | 当前龙芯平台不使用 Docker |
| MySQL / PostgreSQL | 当前没有数据库 |
| Neo4j | 知识图谱当前为前端页面 + JSON 数据 |
| Node.js | 如果使用已构建部署包，运行时可以不需要 |

## 4. 部署包内容

推荐部署包结构如下：

```text
la-mvp-package/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── data/
│       ├── demo_scenario.json
│       ├── expert_reviews.json
│       ├── graph_relations.json
│       ├── guide_steps.json
│       └── knowledge_items.json
└── frontend/
    └── dist/
        ├── index.html
        ├── assets/
        └── images/
```

说明：

- `frontend/dist/` 是已经构建好的前端静态文件。
- `backend/app.py` 会自动托管 `frontend/dist/`。
- `backend/data/` 是演示流程用的 JSON 数据。
- 不需要拷贝 `frontend/node_modules/`。
- 不需要拷贝 `backend/.venv/`。

## 5. 在开发机打包

以下命令在当前开发环境 WSL 中执行。

### 5.1 构建前端

```bash
cd ~/projects/LA/frontend
npm run build
```

构建成功后会生成：

```text
frontend/dist/
```

### 5.2 生成部署包

```bash
cd ~/projects/LA

rm -rf release/la-mvp-package
mkdir -p release/la-mvp-package/backend
mkdir -p release/la-mvp-package/frontend

cp -r backend/app.py backend/data backend/requirements.txt release/la-mvp-package/backend/
cp -r frontend/dist release/la-mvp-package/frontend/

cd release
tar -czf LA-mvp-$(date +%Y%m%d-%H%M%S).tar.gz la-mvp-package
```

生成结果示例：

```text
release/LA-mvp-20260708-221505.tar.gz
```

## 6. 拷贝到龙芯机器

可以使用 U 盘、SCP、内网文件共享等方式。

如果使用 SCP，示例：

```bash
scp LA-mvp-20260708-221505.tar.gz 用户名@龙芯机器IP:/home/用户名/
```

如果没有网络文件传输能力，可以用 U 盘拷贝到龙芯机器任意目录，例如：

```text
/home/用户名/LA-mvp-20260708-221505.tar.gz
```

## 7. 在龙芯机器解压

进入压缩包所在目录：

```bash
cd /home/用户名
```

解压：

```bash
tar -xzf LA-mvp-20260708-221505.tar.gz
```

进入后端目录：

```bash
cd la-mvp-package/backend
```

确认文件存在：

```bash
ls
```

应看到：

```text
app.py  data  requirements.txt
```

## 8. 安装 Python 依赖

### 8.1 创建虚拟环境

```bash
python3 -m venv .venv
```

如果提示没有 `venv`，说明系统缺少 Python 虚拟环境组件，需要先安装系统对应的 `python3-venv` 或等价组件。

### 8.2 激活虚拟环境

```bash
source .venv/bin/activate
```

激活后，命令行前面通常会出现：

```text
(.venv)
```

### 8.3 安装依赖

联网环境：

```bash
pip install -r requirements.txt
```

当前直接依赖只有：

```text
Flask==3.0.3
```

Flask 会带出这些依赖：

```text
Werkzeug
Jinja2
MarkupSafe
itsdangerous
click
blinker
```

## 9. 无外网环境的依赖准备

如果龙芯机器无法访问外网，需要提前准备离线 Python 包。

### 9.1 需要准备的 Python 包

至少准备：

```text
Flask==3.0.3
Werkzeug
Jinja2
MarkupSafe
itsdangerous
click
blinker
```

### 9.2 离线安装方式

假设离线包放在：

```text
/home/用户名/wheels/
```

安装：

```bash
pip install --no-index --find-links=/home/用户名/wheels -r requirements.txt
```

注意：

- 如果包含二进制 wheel，需要确认支持龙芯平台。
- 当前 Flask 依赖通常比较轻，很多包可以用纯 Python wheel 或源码包安装。

## 10. 启动服务

确保当前目录是：

```text
la-mvp-package/backend
```

启动：

```bash
source .venv/bin/activate
python app.py
```

正常输出类似：

```text
 * Serving Flask app 'app'
 * Running on all addresses (0.0.0.0)
 * Running on http://127.0.0.1:8080
 * Running on http://龙芯机器IP:8080
```

说明：

- `127.0.0.1:8080` 只能在龙芯机器本机访问。
- `龙芯机器IP:8080` 可以给同一网络下的其他机器访问，前提是防火墙允许。

## 11. 浏览器访问

在龙芯机器本机浏览器访问：

```text
http://127.0.0.1:8080
```

在其他电脑访问龙芯机器：

```text
http://龙芯机器IP:8080
```

例如：

```text
http://192.168.1.20:8080
```

## 12. 健康检查

在龙芯机器上执行：

```bash
curl http://127.0.0.1:8080/api/health
```

正常返回：

```json
{"service":"la-mvp-backend","status":"ok"}
```

如果其他电脑要测试龙芯机器服务：

```bash
curl http://龙芯机器IP:8080/api/health
```

## 13. 后台运行

临时演示可以直接 `python app.py` 前台运行。

如果希望关闭终端后继续运行，可以使用 `nohup`：

```bash
cd /home/用户名/la-mvp-package/backend
source .venv/bin/activate
nohup python app.py > la-mvp.log 2>&1 &
```

查看日志：

```bash
tail -f la-mvp.log
```

查看端口：

```bash
ss -ltnp | grep 8080
```

停止服务：

```bash
pkill -f "python app.py"
```

## 14. 可选：systemd 服务

如果需要更稳定的启动方式，可以后续配置 systemd。第一轮验证可以先不做。

示例服务文件：

```ini
[Unit]
Description=LA MVP Flask Service
After=network.target

[Service]
WorkingDirectory=/home/用户名/la-mvp-package/backend
ExecStart=/home/用户名/la-mvp-package/backend/.venv/bin/python app.py
Restart=always
RestartSec=3
User=用户名

[Install]
WantedBy=multi-user.target
```

保存为：

```text
/etc/systemd/system/la-mvp.service
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable la-mvp
sudo systemctl start la-mvp
```

查看状态：

```bash
sudo systemctl status la-mvp
```

## 15. 防火墙与网络

如果龙芯机器本机能访问 `127.0.0.1:8080`，但其他电脑访问不了，通常是网络或防火墙问题。

需要检查：

1. 龙芯机器 IP 是否正确。
2. 两台机器是否在同一网络。
3. Flask 是否监听 `0.0.0.0:8080`。
4. 防火墙是否放行 `8080`。

查看监听：

```bash
ss -ltnp | grep 8080
```

如果看到：

```text
0.0.0.0:8080
```

说明 Flask 已经允许外部访问。

防火墙放行方式因系统而异，示例：

```bash
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --reload
```

如果系统不用 `firewalld`，需要按实际系统防火墙工具处理。

## 16. 常见问题

### 16.1 打开页面是 404

可能原因：

- 没有拷贝 `frontend/dist/`。
- 前端没有先执行 `npm run build`。
- 部署包目录结构不对。

检查：

```bash
ls ../frontend/dist
```

应看到：

```text
index.html  assets  images
```

### 16.2 `/api/health` 正常，但页面空白

可能原因：

- 前端静态资源没有完整拷贝。
- `frontend/dist/assets/` 缺文件。
- 浏览器缓存旧资源。

处理：

- 强制刷新浏览器。
- 重新打包并拷贝完整 `frontend/dist/`。

### 16.3 其他电脑访问不了

可能原因：

- 用了 `127.0.0.1`，这个只表示本机。
- 龙芯机器防火墙没有放行 `8080`。
- 网络不通。

应使用：

```text
http://龙芯机器IP:8080
```

### 16.4 `python3 -m venv .venv` 失败

说明缺少 venv 组件。

需要安装系统对应包，例如：

```text
python3-venv
```

具体包名以龙芯机器 Linux 发行版为准。

### 16.5 `pip install -r requirements.txt` 失败

可能原因：

- 龙芯机器没有外网。
- pip 源不可访问。
- 缺少离线包。

解决：

- 准备离线 wheel 包。
- 或配置可访问的 pip 镜像源。

### 16.6 图片不显示

当前检修向导图片位于：

```text
frontend/dist/images/guide/
```

检查：

```bash
ls ../frontend/dist/images/guide
```

如果目录不存在，说明前端构建包没有包含图片资源，需要重新构建并打包。

## 17. 更新部署

后续前端或数据更新后，推荐重新打包并覆盖部署：

1. 开发机执行 `npm run build`。
2. 重新生成 `LA-mvp-时间戳.tar.gz`。
3. 拷贝到龙芯机器。
4. 解压到新目录或覆盖旧目录。
5. 重启 Flask 服务。

重启命令：

```bash
pkill -f "python app.py"
cd /home/用户名/la-mvp-package/backend
source .venv/bin/activate
python app.py
```

如果使用 `nohup`：

```bash
pkill -f "python app.py"
nohup python app.py > la-mvp.log 2>&1 &
```

## 18. 验收清单

部署完成后按以下顺序检查：

- [ ] `python app.py` 能正常启动。
- [ ] `curl http://127.0.0.1:8080/api/health` 返回 `ok`。
- [ ] 浏览器能打开首页。
- [ ] 登录页能进入。
- [ ] 工作台首页能显示。
- [ ] 异常接入流程能进入。
- [ ] 分析诊断动态效果能显示。
- [ ] 检修向导能切换步骤。
- [ ] 检修向导图片能显示。
- [ ] 辅助对话能模拟回复。
- [ ] 检修记录页能打开。
- [ ] 知识图谱页能打开。
- [ ] 设置页能打开。

## 19. 当前 MVP 运行命令摘要

最短启动命令：

```bash
tar -xzf LA-mvp-xxxx.tar.gz
cd la-mvp-package/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

访问：

```text
http://127.0.0.1:8080
```

局域网访问：

```text
http://龙芯机器IP:8080
```
