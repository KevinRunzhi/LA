# 竞赛提交代码架构与数据流

## 1. 代码阅读主线

```text
首页输入
  │
  ▼
POST /api/platform/case-routing
  │  文本、型号、告警、症状、测量、否定和排除规则
  ▼
CasePackageRegistry ── JSON Schema / 引用 / 路径边界 / packageHash
  │
  ▼
POST /api/platform/case-runs
  │
  ▼
SQLite CaseRun
  ├── revision
  ├── event log
  ├── idempotency result
  ├── resolved plan snapshot
  ├── step execution
  ├── engineer submission snapshot
  └── expert review snapshot
  │
  ▼
KnowledgeLifecycleService
  ├── immutable KnowledgeVersion
  ├── GraphVersionDelta
  └── EngineerSyncRecord
```

## 2. 数据权威

| 对象 | 存储 | 说明 |
| --- | --- | --- |
| CasePackage | 模块化 JSON | 稳定案例模板，运行开始时固化版本和哈希 |
| CaseRun | SQLite | 一次工程师检修或演示运行 |
| CaseRunEvent | SQLite | 每次状态变化和业务写入的审计轨迹 |
| Snapshot | SQLite/CaseRun payload | 预方案、执行、提交、审核和作业卡不可变输入 |
| KnowledgeVersion | SQLite | 专家批准后形成的独立知识版本 |
| GraphVersionDelta | SQLite | 与知识版本一一关联的图谱增量 |

React 不再被设计为业务事实的最终存储；页面负责交互和动画，后端负责案例选择、状态、冲突和版本。

部署调用链：

```text
Nginx（可选）
  → Gunicorn gthread
    → backend.wsgi application factory
      → RuntimeSettings
      → request-id / metrics / JSON access log
      → Flask legacy + platform blueprints
      → SQLite / CasePackage / attachment storage
```

龙芯正式演示采用原生 Linux 部署，不把 Docker 设为目标机前提。systemd 负责启动、重启和权限边界，Nginx 可选用于反向代理与静态缓存。

## 3. 案例加载

加载顺序：

```text
registry Schema
→ 注册表 ID 唯一
→ manifest 路径边界
→ manifest Schema
→ 六个模块 Schema
→ step/check/topic/claim 引用
→ 手册 ID 与页码
→ 图谱节点和边
→ packageHash
```

非法路径、绝对路径、`..`、符号链接、未知 Schema、断裂引用和未知字段都会使单个案例失败关闭。失败案例不会进入 `/api/platform/cases` 的可运行列表。

## 4. 路由

路由是服务端权威操作：

```text
NFKC 与大小写规范化
→ V/mV、rpm、℃ 单位规范化
→ 同义表达
→ 否定前缀
→ 各类别加权
→ exclusion 硬排除
→ minScore / minMargin
→ matched / ambiguous / insufficient / unsupported
```

相同输入、注册表版本和算法版本返回相同结果。同分按 `caseId` 稳定排序。正常 API 不提供默认散热案例。

## 5. 并发与幂等

所有写接口携带：

```json
{
  "expectedRevision": 4,
  "idempotencyKey": "UUID",
  "actor": {
    "id": "worker001",
    "role": "engineer"
  }
}
```

- revision 不一致：`409 state_conflict`；
- 同键同请求：返回第一次保存的响应；
- 同键不同请求：`409 idempotency_conflict`；
- 状态不允许：`409 state_conflict`；
- 角色不允许：`403 role_forbidden`。

## 6. 外部提供方

`providers.py` 使用 Protocol 定义四类扩展：

- DiagnosisProvider；
- TelemetryProvider；
- KnowledgeSearchProvider；
- AttachmentStore。

当前可运行：

- 基于 CasePackage 的规则诊断；
- 工程师提交事实遥测；
- 案例 claim 检索；
- 本地受限目录附件存储。

附件通过 multipart API 写入受限目录，生成 SHA-256 后登记到 `case_run_attachments`，数据库登记失败会补偿删除文件。远程模型适配器在注入客户端后执行真实调用并验证结果合同；未配置时明确返回 `provider_not_configured`。

## 7. 可信度

案例包使用 claim 级字段：

```text
sourceType
verificationStatus
reviewStatus
evidenceRefs
```

知识发布保留 `verificationLevel`。如果尝试发布 `verified_case` 而没有现场证据 ID，服务拒绝发布。专家审核不会自动把 `synthetic_demo` 升级为真实案例。

## 8. 与稳定演示的关系

本分支不要求替换已录制视频。旧 `/api/demo`、`/api/admin` 和 React 展示路径继续保留；首页输入已通过 `CasePlatformSession` 真实调用 `/api/platform/case-routing` 和 `/api/platform/case-runs`，启动诊断时继续推进 intake 与 diagnosis。其余旧页面按兼容层逐步迁移，不影响录制版本的视觉与节奏。

## 9. 运行保障

- `/api/health/live` 只表示进程可响应；
- `/api/health/ready` 检查数据库、迁移、案例注册表、附件目录和生产前端；
- `/api/metrics` 提供低基数 Prometheus 文本指标；
- 每个响应携带 `X-Request-ID`；
- SQLite 备份使用 backup API，并附带完整性检查和 SHA-256；
- preflight 在启动前加载真实案例并应用有序迁移。

完整说明见 [`competition-submission-deployment-guide.md`](./competition-submission-deployment-guide.md)。
