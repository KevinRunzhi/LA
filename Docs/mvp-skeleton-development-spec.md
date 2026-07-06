# MVP 骨架开发 Spec：工控设备异常检测与故障分析系统

## 1. 文档目标

本文档用于指导第一版 MVP 骨架开发。后续开发以本文档为执行基准，先做一个能启动、能演示主流程、能持续迭代的最小版本。

MVP 骨架目标不是一次性完成全部智能能力，而是先打通以下闭环：

```text
异常输入 / 一键触发
  -> 诊断摘要
  -> 步骤式检修向导
  -> 图片占位区
  -> 检修记录
  -> 专家修正
  -> 再次触发时展示专家修正
```

## 2. 开发环境

开发在 WSL 的 Ubuntu 中进行，项目目录固定为：

```bash
~/projects/LA
```

首期技术栈：

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React + Vite | 快速搭建，适合诊断台界面 |
| 样式 | CSS Modules 或普通 CSS | 不引入重型 UI 框架 |
| 图标 | lucide-react | 只使用常规图标 |
| 后端 | Python 3 + Flask | 轻量 API 编排 |
| 数据 | JSON 种子数据，后续切 SQLite | 先保证骨架快跑通 |
| 部署 | WSL 开发态，后续同步验证龙芯 | 不使用 Docker |

暂不引入：

1. Docker。
2. 本地大模型。
3. 本地向量数据库。
4. Neo4j 或图数据库。
5. OCR、OpenCV、PyTorch。
6. 图片上传、图片插入、图片管理。
7. 真实语音、真实视频、真实连线专家。

## 3. 目录结构

第一版建议目录：

```text
LA/
  backend/
    app.py
    requirements.txt
    data/
      demo_scenario.json
      guide_steps.json
      knowledge_items.json
      graph_relations.json
      expert_reviews.json
  frontend/
    package.json
    vite.config.js
    index.html
    src/
      main.jsx
      App.jsx
      styles/
        tokens.css
        app.css
      api/
        client.js
      data/
        fallbackDemo.js
      components/
        AppShell.jsx
        Sidebar.jsx
        TopBar.jsx
        DiagnosisPanel.jsx
        GuideStepper.jsx
        StepDetail.jsx
        ImagePlaceholder.jsx
        EvidenceCards.jsx
        KnowledgeGraphPanel.jsx
        MaintenanceRecord.jsx
        ExpertReviewPanel.jsx
  scripts/
    dev.sh
  Docs/
```

骨架阶段可以先用 JSON 文件，不急着上 SQLite。等页面和 API 跑通后，再把 JSON 种子数据迁移为 SQLite 表。

## 4. 第一版页面

### 4.1 应用外壳

布局参考“站控慧眼 / 智能诊断台”：

```text
左侧窄导航
顶部状态栏
中间主诊断区
右侧诊断流程与快捷操作
```

主色 token 固定：

```css
:root {
  --color-primary: #2563EB;
  --color-primary-hover: #1D4ED8;
  --color-primary-soft: #EEF4FF;
  --color-accent: #6366F1;
  --color-bg: #F7F9FC;
  --color-card: #FFFFFF;
  --color-border: #DDE4F0;
  --color-text: #0F172A;
  --color-muted: #64748B;
}
```

注意：

1. 不使用大面积蓝紫渐变。
2. 不做深色工业大屏。
3. 不做装饰性光球、毛玻璃滥用或明显 AI 模板风。
4. 卡片圆角克制，建议 `8px`。

### 4.2 诊断入口

必须包含：

1. 现场现象输入框。
2. “一键触发主演示异常”按钮。
3. 诊断摘要卡片。
4. 多 Agent 会诊卡片，使用预置结果。
5. “进入检修向导”按钮。

主演示输入：

```text
站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。
```

### 4.3 步骤式检修向导

5 个主步骤：

| 步骤 | 名称 | 图片占位 key |
|---|---|---|
| 1 | 确认告警与定位设备 | `step-01-location` |
| 2 | 执行安全准备 | `step-02-safety` |
| 3 | 检查机柜环境与风道 | `step-03-airflow` |
| 4 | 检查滤网、风扇和接线 | `step-04-filter-fan` |
| 5 | 恢复运行与验证 | `step-05-verify` |

每一步显示：

1. 步骤标题。
2. 图片占位区，不显示真实图片。
3. 操作说明。
4. 安全提醒。
5. 判断阈值。
6. 来源依据。
7. 完成按钮。

图片占位区文案：

```text
图片待补充
后续添加步骤示意图
```

### 4.4 检修记录

骨架阶段生成前端展示即可，后端返回固定记录结构。

记录内容：

1. 设备：研华 ACP-4000 / IPC-610 工控机。
2. 故障：高温告警 / 风道堵塞 / 散热异常。
3. 已完成步骤。
4. 关键阈值检查结果。
5. 安全确认项。
6. 建议处理结论。
7. 专家审核状态。

导出先用浏览器打印，不做复杂 PDF 生成。

### 4.5 专家修正

骨架阶段只做一条固定修正：

```text
沙尘环境下，站控柜工控机滤网维护周期应从季度检查缩短为月度检查。
恢复运行后需观察数据上传稳定不少于 10 分钟。
```

点击“审核通过”后，前端状态显示：

```text
专家修正 · 已审核
```

再次触发同类异常时，在诊断摘要或证据区展示该修正。

## 5. 后端 API

第一版 API 保持少而稳。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/demo/scenario` | 获取主演示场景 |
| POST | `/api/diagnosis/start` | 开始诊断，返回摘要和步骤选项 |
| GET | `/api/guide/steps` | 获取 5 个向导步骤 |
| POST | `/api/guide/steps/<step_id>/complete` | 标记步骤完成 |
| POST | `/api/records/generate` | 生成检修记录 |
| GET | `/api/knowledge/evidence` | 获取证据卡片 |
| GET | `/api/knowledge/graph` | 获取知识图谱关系 |
| POST | `/api/expert/review` | 提交专家修正并审核通过 |

骨架阶段不要求登录鉴权。

## 6. 种子数据

### 6.1 关键阈值

| 项目 | 阈值 |
|---|---|
| 系统风扇转速 | `< 500 rpm` 判定异常 |
| 系统温度 | `> 55°C` 判定过高 |
| CPU 温度 | `> 70°C` 判定过高 |
| 环境温度 | `≤ 40°C` |
| 恢复观察 | `≥ 10 分钟` |

### 6.2 知识条目

首期预置 10 条：

1. ACP-4000 / IPC-610 散热系统结构。
2. TEMP/FAN LED 与蜂鸣告警含义。
3. 风扇 `<500 rpm` 告警阈值。
4. 系统温度 `>55°C` 与 CPU `>70°C` 告警阈值。
5. 环境工作温度 `0~40°C`。
6. 断电、防静电和禁止带电拆装要求。
7. 门滤网与风扇滤网检查清理方法。
8. 风扇更换与 FAN1/FAN2 接线顺序。
9. 恢复运行确认清单。
10. 异常升级条件。

### 6.3 知识图谱关系

骨架阶段用列表展示或简单 SVG/ECharts 展示均可。第一版先保证数据存在。

```text
输气场站 -> 包含 -> 站控柜
站控柜 -> 包含 -> 工控机
工控机 -> 包含 -> 风道
工控机 -> 包含 -> 滤网
工控机 -> 包含 -> 风扇
工控机 -> 发生 -> 高温告警
高温告警 -> 可能原因 -> 风道堵塞
高温告警 -> 可能原因 -> 滤网积尘
高温告警 -> 可能原因 -> 风扇异常
风扇异常 -> 判断依据 -> 风扇转速 <500 rpm
高温告警 -> 判断依据 -> 系统温度 >55°C
高温告警 -> 判断依据 -> CPU 温度 >70°C
恢复验证 -> 要求 -> 连续观察 ≥10 分钟
```

## 7. 开发顺序

### Iteration 0：仓库准备

1. 新建 `frontend/`、`backend/`、`scripts/`。
2. 写 `README.md` 的启动说明。
3. 写 `.gitignore`，排除 `node_modules/`、`.venv/`、`__pycache__/`、SQLite 临时文件。

验收：

```bash
git status --short
```

只出现预期新增文件。

### Iteration 1：后端最小 API

1. 建 Flask app。
2. 实现 `/api/health`。
3. 实现固定 JSON 数据接口。
4. 本地跑通 `python app.py`。

验收：

```bash
curl http://127.0.0.1:8080/api/health
```

返回：

```json
{"status":"ok"}
```

### Iteration 2：前端空壳

1. 建 Vite React 项目。
2. 加入颜色 token。
3. 搭应用外壳布局。
4. 请求 `/api/health` 并显示后端状态。

验收：

```bash
npm run dev -- --host 0.0.0.0
```

页面能打开并显示系统名称与后端连接状态。Vite 开发端口使用 `3000`，后端托管入口使用 `8080`。

### Iteration 3：诊断入口与摘要

1. 输入现场现象。
2. 一键触发主演示异常。
3. 调 `/api/diagnosis/start`。
4. 展示诊断摘要、多 Agent 会诊和步骤入口。

### Iteration 4：步骤式检修向导

1. 展示 5 个步骤。
2. 支持上一步、下一步、完成步骤。
3. 每一步显示图片占位区。
4. 展示阈值、安全提醒和来源依据。

### Iteration 5：检修记录与专家修正

1. 生成检修记录。
2. 展示专家审核入口。
3. 提交固定专家修正。
4. 再次触发时展示“专家修正 · 已审核”。

### Iteration 6：打磨与龙芯验证准备

1. 补启动脚本 `scripts/dev.sh`。
2. 清理样式和页面状态。
3. 确认没有图片功能误实现。
4. 记录 Node、npm、Python、Flask 版本。

## 8. 开发注意事项

1. 每次只实现一个小闭环，不同时开太多页面。
2. 前端先用后端固定数据，不等真实云 API。
3. 图片区域只做占位，不做上传、不做预览、不接入真实文件。
4. 所有主演示数据必须可离线兜底。
5. 不引入需要原生编译的复杂 npm 包或 Python 包。
6. 不使用 Docker。
7. API 返回结构要稳定，避免前端反复改字段。
8. 页面风格按固定色号实现，不使用随机渐变。
9. 先保证 WSL 跑通，再考虑龙芯适配。
10. 每个迭代完成后都提交一次可运行版本。

## 9. 第一版完成标准

MVP 骨架完成时应满足：

1. 前端能启动。
2. 后端能启动。
3. 前端能请求后端。
4. 能一键触发主演示异常。
5. 能展示诊断摘要。
6. 能进入 5 步检修向导。
7. 每一步都有图片占位区、操作说明、安全提醒和完成按钮。
8. 能生成检修记录。
9. 能展示证据卡片和知识图谱关系。
10. 能完成一条专家修正并在再次触发时展示。
11. 全流程不依赖真实图片、真实云 API 或 Docker。
