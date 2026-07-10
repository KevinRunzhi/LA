# 运行环境与龙芯验证决策

冻结日期：2026-07-10

本文记录已经确定、不得再被旧文档覆盖的运行环境和龙芯开发策略。

## 1. 固定版本

- Node.js：`20.19.4`
- npm：`10.8.2`
- 前端：React 18 + Vite 6
- 后端：Python 3 + Flask 3
- 当前数据：案例 JSON 和前端状态
- Docker：不使用

版本来源：项目根目录 `.nvmrc` 与 `frontend/package.json`。开发机、WSL、龙芯的功能验收统一使用 Node `20.19.4`，不能因为其他版本暂时能构建就改变基线。

## 2. 开发位置

唯一开发仓库：

```text
/home/kevin/projects/LA
```

位于 WSL2 Ubuntu。Windows 目录可放会议文档、图片、音视频和检索资料，但代码改动必须回到 WSL 仓库实施和验证。

## 3. 龙芯运行方式

当前迭代期的主方式是 **Node 开发态启动并逐模块验证**：

```bash
cd ~/projects/LA/frontend
npm install
npm run dev -- --host 0.0.0.0
```

后端单独启动：

```bash
cd ~/projects/LA/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

浏览器访问 Vite 开发服务，API 由 Flask 提供。具体端口以 Vite 实际终端输出和前端 API 配置为准。

## 4. 逐模块验证规则

每完成一个 R/P 模块后立即执行：

1. 在 WSL 使用 Node `20.19.4` 完成构建和主路径验证。
2. 同步代码到龙芯。
3. 在龙芯确认 `uname -m`、系统版本、`node -v`、`npm -v`、`python3 -V`。
4. 在龙芯用 `npm run dev -- --host 0.0.0.0` 启动前端。
5. 启动 Flask，并检查 `/api/health`。
6. 从浏览器完整操作本模块新路径。
7. 记录日期、提交号、环境版本、操作结果、控制台/终端错误和截图位置。

没有完成第 2–7 步，只能写“WSL 已完成”，不能写“龙芯已完成”。

## 5. 构建包的定位

`frontend/dist` + Flask 托管方式保留为最终汇报、断网兜底或稳定交付方案，但不替代当前逐模块适配流程。

因此两种方式的定位是：

| 方式 | 用途 | 当前优先级 |
| --- | --- | --- |
| Node 开发态 | 日常开发、观察错误、每模块龙芯验证 | 主方式 |
| 预构建 `dist` + Flask | 最终稳定演示、发布包、断网兜底 | 交付方式 |

旧部署文档中“龙芯不需要 Node、优先只运行预构建包”的表述已经失效，不能再用于当前开发阶段。

## 6. 依赖约束

- 新依赖必须在加入当天进行龙芯安装验证。
- 优先纯 JavaScript 和纯 Python 依赖。
- 避免依赖没有 LoongArch 包、必须复杂源码编译或依赖 GPU 的库。
- `esbuild` 和 Rollup 的 LoongArch 平台包必须在目标系统实际验证。
- 模块装不上时优先更换等价轻量实现，不把源码编译变成主开发任务。
