# 龙芯开发态启动与逐模块验证指南

更新时间：2026-07-10

本指南用于当前开发阶段。冻结决策是：龙芯安装并使用 Node.js `20.19.4`，前端以 Vite 开发态启动；每完成一个功能模块就同步到龙芯验证，不等待全部功能完成后再集中适配。

最终汇报时可以另行生成 `frontend/dist` 并由 Flask 托管，但这不是当前模块开发与兼容性验证的替代方案。

当前最终汇报采用的稳定演示包、旧服务切换和现场操作步骤，统一以 [`loongarch-stable-demo-deployment-guide.md`](./loongarch-stable-demo-deployment-guide.md) 为准。

## 1. 固定环境

| 环境 | 版本/要求 |
| --- | --- |
| CPU 架构 | `loongarch64` |
| Node.js | `20.19.4` |
| npm | `10.8.2` |
| Python | `3.10+`，推荐 `3.12.x` |
| 前端 | React 18 + Vite 6 |
| 后端 | Flask 3 |

不使用 Docker，不在龙芯本地运行大模型，不引入当前模块不需要的数据库或图数据库。

## 2. 第一次环境核验

在龙芯终端记录：

```bash
uname -m
cat /etc/os-release
node -v
npm -v
python3 -V
git --version
```

预期至少满足：

```text
uname -m  -> loongarch64
node -v   -> v20.19.4
npm -v    -> 10.8.2
```

版本不符合时先修正环境，不把其他 Node 版本的偶然运行结果作为正式验收。

## 3. 获取与更新代码

当前唯一开发仓库是 WSL 的 `/home/kevin/projects/LA`。每个模块完成后，通过 Git、SCP 或内网文件传输将同一提交同步到龙芯。

使用 Git 时示例：

```bash
git clone https://github.com/KevinRunzhi/LA.git
cd LA
git pull --ff-only
git rev-parse --short HEAD
```

如果本地最新提交尚未推送，应先明确同步方式，确保龙芯验证的是与 WSL 完全相同的代码。

## 4. 前端开发态启动

```bash
cd ~/projects/LA/frontend
npm install
npm run dev -- --host 0.0.0.0
```

保留终端窗口并观察 Vite 输出。浏览器访问 Vite 显示的地址；其他同网段设备使用：

```text
http://龙芯机器IP:Vite实际端口
```

当前 `package.json` 脚本已经包含 `--host 0.0.0.0`，额外参数用于强调验收要求，不改变功能。

## 5. 后端启动

首次执行：

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

以后启动：

```bash
cd ~/projects/LA/backend
source .venv/bin/activate
python app.py
```

健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

预期返回包含：

```json
{"service":"la-mvp-backend","status":"ok"}
```

## 6. 前后端联调

- 前端使用 Vite 开发地址访问。
- 后端监听 `0.0.0.0:8080`。
- 如果页面显示后端未连接，先检查 `frontend/src/api/client.js` 中的 API 地址，再检查防火墙、端口和浏览器控制台。
- 调试时必须保留 Node 和 Python 两个终端的错误输出。

## 7. 每模块验证清单

每完成一个 R/P 模块，都必须记录：

- [ ] WSL 使用 Node `20.19.4` 构建通过。
- [ ] 本次 Git 提交号或代码快照编号已记录。
- [ ] 相同代码已同步到龙芯。
- [ ] 龙芯 `node -v` 为 `v20.19.4`。
- [ ] 龙芯前端开发服务成功启动。
- [ ] Flask 成功启动且健康检查返回 `ok`。
- [ ] 新增模块的完整用户路径通过。
- [ ] 浏览器控制台无阻断性错误。
- [ ] Node/Python 终端无阻断性错误。
- [ ] 关键页面截图和问题记录已保存。

当前 R0/P0 还需要验证：开始接诊 → 业务处理过渡 → 照片与台账匹配 → 补充项逐块生成 → 逐项确认 → 方案生成过渡。

## 8. 新依赖规则

新增 npm 或 pip 依赖的当天就必须在龙芯安装和启动验证：

- 优先纯 JavaScript、纯 Python 包。
- 避免依赖 GPU、WebGL 或复杂本地编译的方案。
- npm 安装重点观察 `esbuild`、Rollup 的 LoongArch 平台包。
- 如果依赖在龙芯上无法直接安装，优先更换轻量等价实现。

## 9. 最终稳定演示包

只有在需要最终汇报、断网兜底或稳定交付时，才执行：

```bash
cd ~/projects/LA/frontend
npm run build

cd ../backend
source .venv/bin/activate
python app.py
```

此时 Flask 可以托管 `frontend/dist`，访问 `http://龙芯机器IP:8080`。该方式用于交付，不取消开发期的 Node 开发态逐模块验证。

## 10. 验证记录模板

每次验证在 `current-development-status.md` 追加：

```text
日期：
模块：R?/P?
提交号：
龙芯系统：
Node/npm：
Python：
启动方式：npm run dev + python app.py
验证路径：
结果：通过/阻断
问题与处理：
截图位置：
```
