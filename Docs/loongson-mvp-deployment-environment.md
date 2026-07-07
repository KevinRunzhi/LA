# 龙芯环境 MVP 环境与包下载清单

本文档只列出当前 MVP 需要提前准备、下载或确认的环境与依赖包，不展开安装步骤。目标是让队友在龙芯机器部署前，知道要准备哪些系统组件、Node.js 环境、npm 包、Python 环境、pip 包、源码文件和演示数据。

当前 MVP 技术栈：

- 前端：React 18 + Vite 6 + lucide-react。
- 后端：Python 3 + Flask 3。
- 数据：JSON 预设演示数据。
- 部署：本机进程运行，Flask 监听 `8080`，可托管前端 `dist` 静态文件。
- 不使用：Docker、数据库、向量数据库、本地大模型推理、视频输入、语音播报、真实专家连线。

## 1. 基础系统环境

| 类型 | 需要准备的内容 | 版本/要求 | 用途 | 是否必须 |
| --- | --- | --- | --- | --- |
| 操作系统 | 龙芯 Linux 环境 | 以龙芯机器实际系统为准 | 运行前后端服务 | 必须 |
| Shell | bash | 常见 Linux 默认即可 | 执行项目脚本和命令 | 必须 |
| Git | git | 任意可用稳定版 | 拉取 GitHub 仓库 | 必须 |
| HTTPS 证书 | ca-certificates | 系统源版本即可 | GitHub、npm、pip HTTPS 下载 | 必须 |
| 下载工具 | curl | 系统源版本即可 | 健康检查、下载文件 | 建议 |
| 解压工具 | tar / gzip / unzip | 系统源版本即可 | 解压 Node、源码、离线包 | 建议 |
| 编译工具 | gcc / g++ / make 等 | 系统源版本即可 | 特殊架构下编译部分依赖备用 | 建议 |
| Python 虚拟环境组件 | python3-venv 或等价组件 | 与 Python 版本匹配 | 创建后端虚拟环境 | 必须 |
| Python 包管理组件 | pip | 与 Python 版本匹配 | 安装 Flask 依赖 | 必须 |

说明：

- 当前 npm 与 pip 依赖都比较轻，理论上不需要复杂编译环境。
- 但龙芯属于特殊架构，建议准备基础编译工具，避免遇到没有预编译包时无法继续。

## 2. Node.js 运行环境

| 内容 | 当前要求 | 说明 |
| --- | --- | --- |
| Node.js | `20.19.4` | 项目根目录 `.nvmrc` 已固定为该版本 |
| npm | `10.8.2` | `frontend/package.json` 中声明的 npm 版本 |
| 架构 | 龙芯可用版本 | 需要能在龙芯 Linux 上运行 |

选择 Node.js 20 的原因：

- Node.js 20 是长期支持版本，稳定性更适合当前 MVP。
- Node.js 22 虽然更新，但当前项目没有用到 Node 22 的新增特性。
- 龙芯环境更关注包兼容性、可下载性和部署稳定性，所以 MVP 阶段固定为 `20.19.4`。

需要准备的 Node.js 内容：

| 内容 | 建议准备方式 |
| --- | --- |
| Node.js `20.19.4` 龙芯可用安装包 | 优先龙芯系统源、龙芯适配包或官方/可信来源二进制包 |
| npm `10.8.2` | 通常随 Node 提供；如版本不一致，准备 npm 对应包 |
| npm 缓存或离线包 | 如果龙芯机器网络不稳定，提前准备 |
| `frontend/package-lock.json` | 已在仓库中，用于锁定 npm 依赖版本 |

## 3. 前端直接依赖包

这些是 `frontend/package.json` 中显式声明的包。

### 3.1 运行依赖

| 包名 | 版本 | 用途 | 是否必须 |
| --- | --- | --- | --- |
| `react` | `18.3.1` | 前端组件框架 | 必须 |
| `react-dom` | `18.3.1` | 浏览器 DOM 渲染 | 必须 |
| `lucide-react` | `0.468.0` | 图标组件库 | 必须 |

### 3.2 开发与构建依赖

| 包名 | 版本 | 用途 | 是否必须 |
| --- | --- | --- | --- |
| `vite` | `6.4.3` | 前端开发服务和生产构建 | 必须 |
| `@vitejs/plugin-react` | `4.7.0` | Vite React 插件 | 必须 |

说明：

- 即使最终只用 Flask 托管静态页面，也需要 Vite 先把前端构建成 `frontend/dist`。
- 如果直接拷贝已经构建好的 `frontend/dist`，龙芯机器上可以临时不装 npm 依赖；但为了后续继续开发和迭代，建议准备完整 Node/npm 环境。

## 4. 前端 npm 包准备清单

前端包以 `frontend/package.json` 和 `frontend/package-lock.json` 为准。实际准备时不需要人工逐个下载锁文件里的所有传递依赖，更不需要把 `x64`、`arm64`、`win32`、`darwin` 等平台可选包全部下载。npm 会根据当前系统和架构自动解析并拉取需要的包。

### 4.1 必须关注的前端包名

这些是当前项目直接使用或构建必须依赖的包，准备环境时主要关注这些包名即可。

| 包名 | 当前版本 | 类型 | 用途 |
| --- | --- | --- | --- |
| `react` | `18.3.1` | 运行依赖 | 前端组件框架 |
| `react-dom` | `18.3.1` | 运行依赖 | 浏览器 DOM 渲染 |
| `lucide-react` | `0.468.0` | 运行依赖 | 图标组件库 |
| `vite` | `6.4.3` | 构建依赖 | 前端开发服务和生产构建 |
| `@vitejs/plugin-react` | `4.7.0` | 构建依赖 | Vite React 插件 |

### 4.2 会自动带出的主要传递依赖包名

这些包一般不需要单独手动找。只要上面的直接依赖按锁文件下载，npm 会自动把这些传递依赖一起放进 `node_modules` 或 npm 缓存里。

| 包名 | 当前版本 | 来源/用途 |
| --- | --- | --- |
| `react-refresh` | `0.17.0` | Vite React 热更新和构建相关 |
| `rollup` | `4.62.2` | Vite 构建底层打包器 |
| `esbuild` | `0.25.12` | Vite 构建底层工具 |
| `scheduler` | `0.23.2` | React 传递依赖 |
| `loose-envify` | `1.4.0` | React 传递依赖 |
| `js-tokens` | `4.0.0` | React 传递依赖 |
| `postcss` | `8.5.16` | Vite/CSS 构建相关 |
| `nanoid` | `3.3.15` | Vite/PostCSS 传递依赖 |
| `picocolors` | `1.1.1` | Vite/Rollup 输出相关 |
| `source-map-js` | `1.2.1` | Source map 处理 |
| `tinyglobby` | `0.2.17` | Vite 文件匹配相关 |
| `fdir` | `6.5.0` | 文件遍历相关 |
| `picomatch` | `4.0.5` | 文件匹配相关 |

### 4.3 Babel 相关包名

`@babel` 这一类包属于 Vite React 插件的构建依赖。它们通常会作为一组依赖自动下载，不需要人工一个个下载。离线准备时，建议让 npm 根据 `package-lock.json` 一次性生成缓存或打包 `node_modules`。

当前会用到的主要 Babel 包名：

| 包名 | 当前版本 |
| --- | --- |
| `@babel/core` | `7.29.7` |
| `@babel/parser` | `7.29.7` |
| `@babel/generator` | `7.29.7` |
| `@babel/traverse` | `7.29.7` |
| `@babel/types` | `7.29.7` |
| `@babel/template` | `7.29.7` |
| `@babel/helpers` | `7.29.7` |
| `@babel/code-frame` | `7.29.7` |
| `@babel/compat-data` | `7.29.7` |
| `@babel/helper-compilation-targets` | `7.29.7` |
| `@babel/helper-globals` | `7.29.7` |
| `@babel/helper-module-imports` | `7.29.7` |
| `@babel/helper-module-transforms` | `7.29.7` |
| `@babel/helper-plugin-utils` | `7.29.7` |
| `@babel/helper-string-parser` | `7.29.7` |
| `@babel/helper-validator-identifier` | `7.29.7` |
| `@babel/helper-validator-option` | `7.29.7` |
| `@babel/plugin-transform-react-jsx-self` | `7.29.7` |
| `@babel/plugin-transform-react-jsx-source` | `7.29.7` |

### 4.4 平台可选包说明

`rollup` 和 `esbuild` 会根据操作系统和 CPU 架构选择平台包。文档不再列出所有平台包，因为龙芯部署不需要准备 Windows、macOS、x64、ARM64 等平台包。

龙芯环境只需要让 npm 能拿到当前平台匹配的包即可，重点可能涉及：

| 包名 | 当前版本 | 说明 |
| --- | --- | --- |
| `@esbuild/linux-loong64` | `0.25.12` | 龙芯 Linux 对应的 esbuild 平台包 |
| `@rollup/rollup-linux-loong64-gnu` | `4.62.2` | 龙芯 glibc 环境对应的 Rollup 平台包 |
| `@rollup/rollup-linux-loong64-musl` | `4.62.2` | 龙芯 musl 环境备用 |

如果队友直接在龙芯机器上联网安装，npm 会自动选择上述平台包，不需要手动判断全部平台包。

### 4.5 推荐准备方式

前端依赖可以按以下思路准备：

| 准备方式 | 适用情况 | 说明 |
| --- | --- | --- |
| 准备 `package.json` + `package-lock.json` | 龙芯机器可以访问 npm 源 | npm 会按锁文件自动下载需要的包 |
| 准备 npm 缓存包 | 龙芯机器网络慢或不稳定 | 在可联网环境预先缓存依赖，再拷贝到龙芯机器 |
| 准备完整 `node_modules` 压缩包 | 网络受限、只做短期演示 | 需要尽量在同架构或龙芯机器上生成，避免平台二进制包不匹配 |
| 准备 `frontend/dist/` | 只运行演示，不在龙芯上改前端 | 可以减少前端构建需求，但后续开发仍建议保留完整 npm 环境 |

## 5. Python 运行环境

| 内容 | 当前开发环境 | 部署建议 | 是否必须 |
| --- | --- | --- | --- |
| Python | `3.12.3` | Python `3.10+`，推荐 `3.12.x` | 必须 |
| pip | 随 Python 环境 | 与 Python 匹配即可 | 必须 |
| venv | Python 虚拟环境模块 | 与 Python 匹配即可 | 必须 |

说明：

- 当前后端没有使用数据库驱动、AI 推理库、图像处理库或科学计算库。
- 后端只依赖 Flask，部署压力较小。

## 6. 后端 pip 包完整清单

### 6.1 直接依赖

| 包名 | 版本 | 用途 |
| --- | --- | --- |
| `Flask` | `3.0.3` | 后端 Web 框架、API、静态文件托管 |

### 6.2 解析后的完整 pip 包

以下来自当前后端虚拟环境 `pip freeze`：

| 包名 | 版本 | 用途 |
| --- | --- | --- |
| `Flask` | `3.0.3` | Web 后端框架 |
| `Werkzeug` | `3.1.8` | WSGI 工具库，Flask 依赖 |
| `Jinja2` | `3.1.6` | 模板引擎，Flask 依赖 |
| `MarkupSafe` | `3.0.3` | Jinja2 安全字符串处理 |
| `itsdangerous` | `2.2.0` | Flask 签名与安全相关依赖 |
| `click` | `8.4.2` | Flask 命令行依赖 |
| `blinker` | `1.9.0` | Flask 信号机制依赖 |

如果需要准备离线 Python 包，至少准备上述 7 个包对应的 wheel 或源码包。

## 7. 项目源码与配置文件

需要准备完整 Git 仓库源码：

```text
https://github.com/KevinRunzhi/LA.git
```

当前 MVP 必须包含的关键文件：

| 路径 | 用途 | 是否必须 |
| --- | --- | --- |
| `.nvmrc` | 固定 Node.js 版本为 `20.19.4` | 必须 |
| `README.md` | 项目基础说明 | 建议 |
| `frontend/package.json` | 前端直接依赖与脚本 | 必须 |
| `frontend/package-lock.json` | 前端锁定依赖版本 | 必须 |
| `frontend/index.html` | 前端入口 HTML | 必须 |
| `frontend/src/App.jsx` | MVP 主界面逻辑 | 必须 |
| `frontend/src/main.jsx` | React 入口 | 必须 |
| `frontend/src/styles/app.css` | 页面样式 | 必须 |
| `frontend/vite.config.js` | Vite 配置和 API 代理 | 必须 |
| `backend/app.py` | Flask 后端入口 | 必须 |
| `backend/requirements.txt` | 后端 Python 直接依赖 | 必须 |
| `scripts/dev.sh` | 开发命令提示脚本 | 可选 |

如果只做演示部署，还可以提前准备构建产物：

| 路径 | 用途 |
| --- | --- |
| `frontend/dist/` | 前端生产构建产物，由 Flask 后端托管 |

## 8. MVP 演示数据文件

当前 MVP 不接数据库，以下 JSON 文件就是演示数据来源。

| 文件 | 用途 | 是否必须 |
| --- | --- | --- |
| `backend/data/demo_scenario.json` | 工控机高温、风道堵塞、散热异常的演示场景 | 必须 |
| `backend/data/guide_steps.json` | 检修向导步骤 | 必须 |
| `backend/data/knowledge_items.json` | 知识检索证据条目 | 必须 |
| `backend/data/graph_relations.json` | 知识图谱关系 | 必须 |
| `backend/data/expert_reviews.json` | 专家审核模拟结果 | 必须 |

这些 JSON 文件需要随代码一起部署。当前不需要准备 MySQL、PostgreSQL、SQLite、Neo4j 或向量数据库。

## 9. 端口与浏览器环境

| 内容 | 当前要求 | 说明 |
| --- | --- | --- |
| 后端端口 | `8080` | Flask 服务端口，也是推荐演示入口 |
| 前端开发端口 | `3000` | 仅开发模式使用 |
| 浏览器 | Chromium / Chrome / Firefox / Edge 均可 | 用于打开 Web 页面 |
| 局域网访问 | 需要龙芯机器 IP 和防火墙放行 | 平板访问后期再处理 |

MVP 演示优先准备 `8080` 端口即可。

## 10. 暂不需要下载或部署的内容

| 内容 | 当前状态 | 是否需要准备 |
| --- | --- | --- |
| Docker | 龙芯平台当前不用 Docker | 不需要 |
| Docker 镜像 | 项目没有 Docker 部署方案 | 不需要 |
| 数据库安装包 | 当前使用 JSON 文件 | 不需要 |
| Neo4j / 图数据库 | 知识图谱目前前端静态展示 + JSON 数据 | 不需要 |
| 向量数据库 | 当前未接真实 RAG | 不需要 |
| 本地大模型权重 | 当前未接本地模型推理 | 不需要 |
| CUDA / GPU 驱动 | 当前无 GPU 推理需求 | 不需要 |
| OpenAI / 云 API Key | 骨架当前不依赖云 API | 暂不需要 |
| 语音 TTS 包 | 语音播报仅预留/模拟 | 不需要 |
| 视频输入依赖 | 视频输入仅预留/模拟 | 不需要 |
| WebRTC / 实时通信服务 | 专家连线仅预留/模拟 | 不需要 |
| 图片上传服务 | MVP 第一阶段不做图片上传 | 不需要 |
| 三维建模工具 | 不做复杂三维建模 | 不需要 |

## 11. 最终准备清单

队友部署前建议确认已经准备好：

- 龙芯 Linux 可用系统环境。
- Git、curl、ca-certificates、tar、gzip、unzip。
- 基础编译工具链，作为特殊架构依赖编译备用。
- Node.js `20.19.4`。
- npm `10.8.2`。
- 前端直接包：`react`、`react-dom`、`lucide-react`、`vite`、`@vitejs/plugin-react`。
- npm 离线准备物：可联网 npm 源、npm 缓存包，或在龙芯/同架构环境生成的 `node_modules` 压缩包。
- Python `3.10+`，推荐 `3.12.x`。
- pip 和 venv。
- `Flask==3.0.3` 及其 6 个传递依赖包。
- GitHub 仓库源码 `KevinRunzhi/LA`。
- `backend/data/` 下全部 JSON 演示数据。
- 浏览器环境。
- `8080` 端口可用。

当前最小可运行 MVP 只需要上述内容，不需要额外模型、数据库、Docker 或多媒体服务。
