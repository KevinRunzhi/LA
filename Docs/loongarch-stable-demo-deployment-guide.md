# 龙芯稳定演示包部署说明

更新时间：2026-07-16

适用环境：银河麒麟高级服务器操作系统 V11、`loongarch64`、Python 3.10+

部署目录：`/home/vmuser/project`

运行方式：预构建 React 静态文件 + Flask API/静态托管 + SQLite 演示状态
服务端口：`8080`

## 1. 这份包是什么

这是面向现场汇报的“方式 A：稳定演示模式”。前端已经在开发机使用 Node.js `20.19.4` 编译为普通 HTML、CSS 和 JavaScript；龙芯机器运行时只需要 Python/Flask。浏览器负责执行前端 JavaScript，Flask 同时提供页面、API 和演示状态存储。

包内不包含 `node_modules`、开发虚拟环境、资料 PDF 和开发机的 SQLite 数据库。首次启动时，后端会根据 JSON 种子数据自动创建干净的 `backend/data/presentation/presentation.db`。

## 2. 给协助部署的 ChatGPT 的说明

可以把本文和下面这段话一起发给 ChatGPT：

> 请指导我在银河麒麟高级服务器操作系统 V11（loongarch64）部署这个项目。目标目录是 /home/vmuser/project，使用包内的稳定演示模式，端口 8080。请每次只让我执行一小组命令，等我粘贴完整输出后再继续；不要直接删除旧项目，不要杀死来源不明的进程，不要修改系统 Python。若命令失败，请先依据输出定位问题。

## 3. 部署前提

目标机器应具备：能访问 pip、Python `3.10+`、`sudo` 权限，CPU 架构为 `loongarch64`。Node.js `20.19.4` 可保留用于后续开发，但稳定包运行时不依赖 Node。

```bash
uname -m
cat /etc/os-release
python3 -V
curl --version | head -1
tar --version | head -1
```

## 4. 检查并处理旧服务

先检查旧服务是否占用演示端口：

```bash
sudo ss -lntp | grep -E ':8080|:5173' || true
```

如果 `8080` 有输出，使用其中的 PID 确认进程：

```bash
ps -fp <PID>
```

只有确认它是以前部署的本项目 Python/Flask 进程后，才执行：

```bash
kill <PID>
sleep 2
sudo ss -lntp | grep ':8080' || true
```

若旧包带有停止脚本，优先运行旧包自己的 `stop.sh`。不要使用 `pkill python`，也不要直接杀死来源不明的进程。

## 5. 上传、校验和解压

将压缩包和同名 `.sha256` 文件传到 `/home/vmuser/`，然后执行（文件名以实际收到的为准）：

```bash
cd /home/vmuser
sha256sum -c LA-formal-demo-*.tar.gz.sha256
```

必须显示 `OK`。如果失败，重新传输文件，不要继续解压。

备份旧项目并创建新的部署目录：

```bash
cd /home/vmuser
if [ -e project ]; then mv project "project-backup-$(date +%Y%m%d-%H%M%S)"; fi
mkdir -p /home/vmuser/project
tar -xzf LA-formal-demo-*.tar.gz --strip-components=1 -C /home/vmuser/project
cd /home/vmuser/project
cat VERSION
```

不要直接覆盖旧目录，以免旧的 `node_modules`、虚拟环境或数据库混入新版本。

## 6. 检查与安装

```bash
cd /home/vmuser/project
chmod +x deploy/loongarch/scripts/*.sh
./deploy/loongarch/scripts/check-env.sh
./deploy/loongarch/scripts/install.sh
```

安装脚本只在项目内部创建 `backend/.venv`，不会修改系统 Python。在线安装的后端直接依赖目前只有 Flask。

若提示 venv 不可用，先判断包管理器：

```bash
command -v dnf || command -v yum || command -v apt
```

然后根据系统实际软件源安装 Python venv/pip 支持。例如使用 dnf 的系统可能需要 `python3-pip`，使用 apt 的系统通常需要 `python3-venv python3-pip`。软件包名称以银河麒麟 V11 当前软件源为准。

## 7. 启动和访问

```bash
cd /home/vmuser/project
./deploy/loongarch/scripts/start.sh
./deploy/loongarch/scripts/healthcheck.sh
hostname -I
```

访问地址：

```text
龙芯本机：http://127.0.0.1:8080
同一局域网：http://<龙芯机器IP>:8080
```

如果本机可以访问、其他电脑不能访问，检查防火墙：

```bash
sudo firewall-cmd --state 2>/dev/null || true
sudo firewall-cmd --list-ports 2>/dev/null || true
```

仅当系统确实使用 `firewalld` 时开放端口：

```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

## 8. 演示前验收

```bash
cd /home/vmuser/project
./deploy/loongarch/scripts/healthcheck.sh
tail -50 logs/la-mvp.log
```

浏览器验收主路径：

1. 打开首页并分别确认工程师、专家入口可进入；
2. 打开全局知识图谱，检查节点、连线、局部放大和节点详情；
3. 在专家侧查看“本次新增与修改”，完成案例审核与知识发布；
4. 在工程师侧确认知识同步提示并同步到最新版本；
5. 使用已发布知识完成验证，确认版本和图谱关系已更新；
6. 刷新页面，确认关键状态仍然保留；
7. 演示前把数据重置到需要的起点。

重置命令：

```bash
./deploy/loongarch/scripts/reset-demo.sh
```

## 9. 日常控制命令

```bash
# 启动
cd /home/vmuser/project
./deploy/loongarch/scripts/start.sh

# 健康检查
./deploy/loongarch/scripts/healthcheck.sh

# 查看实时日志
tail -f logs/la-mvp.log

# 停止
./deploy/loongarch/scripts/stop.sh
```

服务 PID 位于 `run/la-mvp.pid`。停止脚本只处理该 PID，不会批量终止其他 Python 进程。

## 10. 数据备份、重置和恢复

演示状态数据库位于 `backend/data/presentation/presentation.db`。

```bash
cd /home/vmuser/project
./deploy/loongarch/scripts/stop.sh
cp backend/data/presentation/presentation.db \
  "backend/data/presentation/presentation.db.backup-$(date +%Y%m%d-%H%M%S)"
./deploy/loongarch/scripts/start.sh
```

一般演示复位优先使用 `reset-demo.sh`。只有数据库损坏且已经停止服务时，才删除 `presentation.db`；下次启动会根据包内 JSON 自动重建。

## 11. 常见问题

### 端口 8080 被占用

```bash
sudo ss -lntp | grep ':8080'
ps -fp <PID>
```

确认进程来源后停止旧服务，再运行新包的 `start.sh`。

### 启动失败

```bash
cd /home/vmuser/project
tail -100 logs/la-mvp.log
backend/.venv/bin/python -V
backend/.venv/bin/python -m pip show Flask
```

### 页面提示 `frontend dist not found`

```bash
ls -l /home/vmuser/project/frontend/dist/index.html
```

正式稳定包应自带该文件；缺失通常表示解压目录不正确或传输包不完整。

### 数据库没有写权限

```bash
chmod u+rwx /home/vmuser/project/backend/data/presentation
ls -ld /home/vmuser/project/backend/data/presentation
```

不要使用 `chmod -R 777`。

### pip 下载较慢

```bash
backend/.venv/bin/python -m pip install \
  -i https://pypi.tuna.tsinghua.edu.cn/simple \
  -r backend/requirements.txt
```

### 局域网无法打开

依次检查服务健康、监听端口、机器 IP、防火墙和两台机器是否处于可互访网络。Flask 已监听 `0.0.0.0:8080`。

## 12. 回退旧版本

如果新版现场验证失败：

```bash
cd /home/vmuser/project
./deploy/loongarch/scripts/stop.sh
cd /home/vmuser
mv project "project-failed-$(date +%Y%m%d-%H%M%S)"
mv <原来的project-backup目录> project
```

然后按旧版本原有方式启动。确认新版本稳定运行后，再人工决定是否删除备份；部署脚本不会自动删除旧目录。

## 13. 方案边界

- 这是单机、单进程、演示用途部署，不是生产集群方案；
- Flask 自带服务器适合本次稳定演示，不用于公网高并发生产环境；
- Node.js 不参与日常运行，但修改前端源码后必须重新构建发布包；
- 真正的龙芯兼容性最终仍需在目标机器上完成浏览器主路径验收。
