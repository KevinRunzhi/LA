# 比赛文档与材料索引

## 1. 目录说明

本目录集中保存“工控设备智能检修与知识作业系统”在中国软件杯、正赛材料准备和挑战赛准备过程中形成的正式文档、视频脚本、分析材料和可编辑图表。

这些文件具有不同用途。部分文档描述比赛提交时希望形成的目标产品架构，部分文档记录实际展示流程和视频制作过程。阅读时应先确认文件状态，不要把目标技术架构直接当作当前源码事实。

当前真实代码和部署状态以以下文档为准：

1. `../project-final-stage-summary.md`；
2. `../competition-submission-feature-matrix.md`；
3. `../competition-submission-architecture.md`；
4. `../competition-submission-deployment-guide.md`。

## 2. 正式软件文档

| 文件 | 用途 | 状态说明 |
| --- | --- | --- |
| `software-functional-requirements-analysis.md` | 软件功能需求分析 | 目标产品需求基线 |
| `software-functional-design.md` | 软件功能设计正文 | 目标产品设计，不等同于当前 React/Flask 实现 |
| `software-functional-design-outline.md` | 功能设计大纲 | 设计文档结构参考 |
| `software-product-manual.md` | 软件产品说明书 | 面向用户和评审的操作说明送审稿 |
| `software-functional-test-report.md` | 软件功能测试报告 | 测试范围、用例和阶段性结果材料 |
| `software-installation-package-and-deployment.md` | 安装包及部署文档 | 比赛交付文档，实际运行同时参考提交平台部署指南 |
| `software-installation-package-and-deployment-outline.md` | 部署文档大纲 | 编写过程材料 |
| `software-installation-package-and-deployment-spec.md` | 部署文档 Spec | 编写约束和内容边界 |
| `software-installation-package-and-deployment-writing-plan.md` | 部署文档计划 | 分批编写过程记录 |
| `target-technical-architecture-baseline.md` | 目标技术架构基线 | 产品化目标选型，不代表当前源码技术栈 |

## 3. 视频材料

| 文件 | 用途 | 状态说明 |
| --- | --- | --- |
| `software-demo-video-script.md` | 软件展示视频完整脚本 | 正式录制版本之一 |
| `software-demo-video-voiceover.md` | 视频配音稿 | 与展示视频脚本配套 |
| `demo1-video-storyboard-script.md` | 分镜脚本 | Demo 1 录制过程材料 |
| `demo1-video-final-voiceover.md` | Demo 1 最终配音 | 配音定稿材料 |
| `demo1-voiceover-pure-text.txt` | 纯文本配音 | 便于语音合成或复制使用 |
| `demo1-video-detailed-analysis.md` | Demo 1 视频分析 | 节奏和内容复盘 |
| `origin-video-detailed-analysis.md` | 原始视频分析 | 历史视频复盘材料 |

## 4. 挑战赛与写作材料

| 文件 | 用途 | 状态说明 |
| --- | --- | --- |
| `challenge-competition-reasons-and-highlights.md` | 参加挑战赛理由及作品亮点 | 已预留待补图位置和截图要求 |
| `competition-documentation-guidelines.md` | 比赛文档编写注意事项 | 统一产品名称、业务主线和写作边界 |
| `codex-session-handoff.md` | 长对话交接文档 | 保存 2026 年 7 月阶段上下文，属于历史交接材料 |

## 5. 可编辑图表

| 文件 | 用途 | 状态说明 |
| --- | --- | --- |
| `ppt/system-logical-architecture.pptx` | 系统逻辑架构图源文件 | 可继续使用 PowerPoint 编辑 |

`ppt/system-logical-architecture.pptx.inspect.ndjson` 属于工具检查中间文件，不纳入长期 Git 归档。

## 6. 阅读建议

### 了解产品功能

1. 阅读 `software-functional-requirements-analysis.md`；
2. 阅读 `software-product-manual.md`；
3. 阅读 `software-demo-video-script.md`。

### 了解目标架构

1. 阅读 `target-technical-architecture-baseline.md`；
2. 阅读 `software-functional-design.md`；
3. 再与 `../competition-submission-architecture.md` 对照，区分目标方案和当前实现。

### 重新制作展示视频

1. 先根据最终代码确认页面状态；
2. 选择 `software-demo-video-script.md` 或 Demo 1 分镜作为基础；
3. 更新页面名称、数值和账号状态；
4. 使用最终版本重新录制，不直接把历史脚本中的时间点当作当前事实。

### 重新申请挑战赛或其他比赛

1. 阅读 `challenge-competition-reasons-and-highlights.md`；
2. 根据最终软件补充文档中标出的截图；
3. 对照 `../project-final-stage-summary.md` 更新已实现能力；
4. 不把尚未完成的真实模型、工业网关和目标机验证写成已完成。

## 7. 维护规则

- 新增比赛材料时同步更新本索引；
- 正文与视频脚本使用相同产品名称和业务主线；
- 图片统一存入 `assets/` 子目录，不散落在文档根目录；
- 生成的 PDF、录屏文件和压缩包不直接进入普通 Git 历史；
- 最终测试结论必须来自真实执行结果；
- 厂商手册和图片在对外发布前重新核对版权与授权范围。
