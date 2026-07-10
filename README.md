# LA 工业设备智能接诊系统

当前项目是面向油气场站工控设备检修的演示型 MVP。

## 当前开发状态

- 当前阶段：`R0 / P0`，进行中。
- 当前目标：接诊思考过渡、照片与台账匹配、详细信息动态补充。
- 当前主案例：研华 ACP-4000 / IPC-610 散热异常。
- 当前能力以案例 JSON 和前端模拟为主，不接真实大模型或真实多模态识别。

完整文档从 [`Docs/README.md`](./Docs/README.md) 开始阅读。不要使用旧状态文档判断当前进度。

## 固定环境

```text
Node.js 20.19.4
npm 10.8.2
Python 3.10+
```

唯一开发目录：

```bash
/home/kevin/projects/LA
```

## WSL 开发启动

前端：

```bash
cd ~/projects/LA/frontend
npm install
npm run dev
```

后端：

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

## 龙芯开发原则

龙芯同样使用 Node.js `20.19.4` 开发态启动前端。每完成一个 R/P 模块就同步到龙芯验证，不等待全部功能完成后再适配。

具体步骤见 [`Docs/loongarch-mvp-deployment-and-startup-guide.md`](./Docs/loongarch-mvp-deployment-and-startup-guide.md)。
