# LA MVP

工控设备异常检测与故障分析系统 MVP 骨架。

## 开发环境

开发目录：

```bash
~/projects/LA
```

技术栈：

- Frontend: React + Vite
- Backend: Python 3 + Flask
- Data: JSON seed data

## 启动后端

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

健康检查：

```bash
curl http://127.0.0.1:5000/api/health
```

## 启动前端

```bash
cd ~/projects/LA/frontend
npm install
npm run dev
```

访问：

```text
http://127.0.0.1:5173
```

## MVP 范围

第一版只做一个设备、一个故障、一个闭环：

- 研华 ACP-4000 / IPC-610 工控机
- 高温告警 / 风道堵塞 / 散热异常
- 诊断摘要
- 步骤式检修向导
- 图片占位区
- 检修记录
- 专家修正回流

MVP 不做图片上传、图片插入、真实图片展示、Docker、真实视频、真实语音或真实连线专家。
