# LA 工业设备智能接诊系统

当前项目是面向油气场站工控设备检修的演示型 MVP。

> 当前分支为竞赛提交源码增强分支 `submission/competition-platform`。它保留已录制视频使用的 React 页面，同时提供可执行案例 Schema、确定性案例路由、SQLite CaseRun、revision/幂等控制、专家审核状态和知识/图谱版本接口。稳定演示版本继续在原 worktree 中维护。

## 当前开发状态

- 当前前端主案例：工控机散热异常。
- 案例平台已注册散热和供电两个案例合同。
- 后端平台接口前缀：`/api/platform`。
- 首页输入、CaseRun 创建和诊断入口已连接平台 API。
- 本地规则诊断、提交事实遥测、步骤知识检索和本地附件存储可运行；远程诊断客户端、工业协议网关和对象存储可通过稳定适配接口替换。

完整文档从 [`Docs/README.md`](./Docs/README.md) 开始阅读。不要使用旧状态文档判断当前进度。

## 固定环境

```text
Node.js 20.19.4
npm 10.8.2
Python 3.10+
```

竞赛提交 worktree：

```bash
/home/kevin/projects/LA-submission
```

核心代码阅读入口：

- [`backend/case_package.py`](./backend/case_package.py)：案例包安全加载与引用校验；
- [`backend/case_platform/routing.py`](./backend/case_platform/routing.py)：案例路由；
- [`backend/case_platform/case_runs.py`](./backend/case_platform/case_runs.py)：CaseRun、revision、事件与幂等；
- [`backend/case_platform/migrations.py`](./backend/case_platform/migrations.py)：SQLite 有序迁移；
- [`backend/case_platform/api.py`](./backend/case_platform/api.py)：Flask Blueprint；
- [`backend/case_platform/providers.py`](./backend/case_platform/providers.py)：外部能力适配接口；
- [`frontend/src/api/casePlatformClient.js`](./frontend/src/api/casePlatformClient.js)：Web 端平台 API 与 CaseRun 会话；
- [`backend/openapi/case-platform.openapi.yaml`](./backend/openapi/case-platform.openapi.yaml)：OpenAPI 合同；
- [`Docs/competition-submission-architecture.md`](./Docs/competition-submission-architecture.md)：架构和数据流。
- [`backend/runtime/`](./backend/runtime/)：运行配置、观测、preflight 和数据库运维；
- [`deploy/`](./deploy/)：Gunicorn、systemd、Nginx 和龙芯部署脚本；
- [`Docs/competition-submission-deployment-guide.md`](./Docs/competition-submission-deployment-guide.md)：生产部署、备份、升级和回滚。
- [`Docs/competition-submission-technical-architecture.md`](./Docs/competition-submission-technical-architecture.md)：前端、后端、数据、知识闭环和运行拓扑详解。

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
curl http://127.0.0.1:8080/api/health/ready
```

案例平台检查：

```bash
curl http://127.0.0.1:8080/api/platform/cases

curl -X POST http://127.0.0.1:8080/api/platform/case-routing \
  -H 'Content-Type: application/json' \
  -d '{"description":"Rockwell 6300B Power LED不亮，上游24V正常，设备端只有11.6V"}'
```

## 工程化检查与生产运行

```bash
make install
make check
cp deploy/env/production.env.example run/platform.env
set -a && source run/platform.env && set +a
make run
```

生产入口使用 Gunicorn；龙芯稳定部署还提供 systemd、可选 Nginx、一致性 SQLite 备份恢复和部署 preflight。当前龙芯策略仍为原生 Linux 部署，不要求 Docker。

## 龙芯开发原则

龙芯同样使用 Node.js `20.19.4` 开发态启动前端。每完成一个 R/P 模块就同步到龙芯验证，不等待全部功能完成后再适配。

具体步骤见 [`Docs/loongarch-mvp-deployment-and-startup-guide.md`](./Docs/loongarch-mvp-deployment-and-startup-guide.md)。
