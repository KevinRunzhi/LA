# 站控慧眼：工控设备智能检修助手

本仓库默认分支 `main` 提供 **2026 年 7 月 18 日的前端演示版**，业务代码基线为 `ce36b01`。本次主分支调整恢复前期代码并保留交接文档，保留动态接诊、检修方案、图文向导、作业卡、专家审核、知识图谱及同步的原有演示闭环。

## 交接阅读入口

1. [项目交接说明](Docs/handoff/README.md)：版本、功能边界、代码入口、角色、演示流程和验收清单。
2. [安装部署与故障排查](Docs/handoff/deployment.md)：Linux / WSL、Windows 原生、龙芯部署、启停、备份和重置。

## 获取本版

```bash
git clone --depth 1 https://github.com/KevinRunzhi/LA.git LA-demo
cd LA-demo
```

[主分支](https://github.com/KevinRunzhi/LA/tree/main) · [下载源码 ZIP](https://github.com/KevinRunzhi/LA/archive/refs/heads/main.zip)

默认克隆或下载 `main` 即为本演示版。后期竞赛平台扩建已从当前文件中移除，完整历史保留在归档标签 [`project-archive-2026-08-09`](https://github.com/KevinRunzhi/LA/tree/project-archive-2026-08-09)。源码 ZIP 需要安装依赖并构建前端，不是预构建运行包。

## 最短启动路径（Linux / WSL）

先准备 Node.js **20.19.4**、npm **10.8.2** 和 Python **3.10+**，再从项目根目录执行：

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend
npm ci
npm run build
cd ..
backend/.venv/bin/python backend/app.py
```

浏览器打开 **http://127.0.0.1:8080**。其他启动方式及问题处理见上面的部署文档。

本版实际技术栈为 React + Vite、Flask、SQLite。Agent、语音、多模态等包含预置内容及演示交互；没有真实大模型或生产账号认证。专家审核、知识发布与同步需要后端，不能仅保留前端完成全部演示。

`Docs/` 原有设计和状态文档继续保留作历史参考；本轮交接与部署以 `Docs/handoff/` 为入口。
