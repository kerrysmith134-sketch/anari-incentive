# PingCode 开放 API 核对记录（2026-11-25）

实现：`packages/connectors/src/providers/pingcode.ts`（`pingcodeProvider: LocalProvider`）。
本文档只记录**官方文档可核对**的事实；未使用生产凭据调用线上接口，字段样本取自官方响应示例。

## 1. 结论

官方**有**公开的工作项 REST API，适配器按官方 v2 端点实现：

- 拉取：`GET /v2/pjm/workitems`（分页工作项列表）
- 写入：`POST /api/v1/work-items/import`（N-Perform 既有 Work Item 导入契约）
- `sourceSystem = "PINGCODE"`，`baseUrlEnv = PINGCODE_BASE_URL`，`tokenEnv = PINGCODE_ACCESS_TOKEN`

> 注意：官方现行文档为 **v2**。旧资料中的 `/v1/pjm/workitems` 不在官方文档数据里
> （`api_data.js` 中 `"url": "/v1/...` 为 0 条），实现不使用 v1。

## 2. 官方来源

- REST API 文档入口：<https://open.pingcode.com/>
- 文档 JS 数据源（页面为 SPA，接口清单实际来自此文件）：<https://open.pingcode.com/api_data.js>
- URI / 根地址约定：<https://open.pingcode.com/#api-URI_结构>
- 分页与响应结构：<https://open.pingcode.com/#api-数据结构>
- 获取企业令牌（Client Credentials）：<https://open.pingcode.com/#api-获取企业令牌>
- 个人访问令牌：<https://open.pingcode.com/#api-个人访问令牌>
- 获取工作项列表：<https://open.pingcode.com/#api-获取工作项列表>
- 工作项类型 `group` 允许值：<https://open.pingcode.com/#api-创建一个工作项类型>
- 工作项状态 `type` 允许值：<https://open.pingcode.com/#api-创建一个工作项状态>

以上锚点由文档 `name` 字段生成（`#api-<name>`）；核对日期 2026-11-25。

## 3. 基础地址

官方 URI 格式：

```
https://{rest_api_root}/v2[/{area}]/{resource}[/{action}]
```

- 公有云 `rest_api_root` = `open.pingcode.com` → 基础地址 `https://open.pingcode.com`
- 私有部署 `rest_api_root` = `{自定义域名}/open`
- 其他环境使用上下文提供的地址

因此公有云的 env 取值：

```bash
PINGCODE_BASE_URL=https://open.pingcode.com
PINGCODE_ACCESS_TOKEN=<access_token>
```

## 4. 鉴权

两种方式最终都是 `Authorization: Bearer {access_token}`：

1. **OAuth2 Client Credentials（企业令牌）**

   ```
   GET /v2/auth/token?grant_type=client_credentials
       &client_id={client_id}
       &client_secret={client_secret}
   Authorization: Bearer {access_token}
   ```

   响应：`{ "access_token": "...", "token_type": "Bearer", "expires_in": 1577808000 }`
   官方说明有效期 30 天；删除应用或重置 Secret 会使令牌立即失效。

2. **个人访问令牌（Personal Access Token）**
   在个人设置创建，配置有效期与 `scopes`；调用时同样用 `Authorization: Bearer {access_token}`。

**实现边界**：provider 不获取 token，只消费已签发的 `PINGCODE_ACCESS_TOKEN`；
`client_id` / `client_secret` 换 token 由 runner/凭据层负责（与 `LocalProvider` 契约一致）。

## 5. 工作项列表端点

```
GET /v2/pjm/workitems?page_index=0&page_size=30
```

- 权限：企业令牌/用户令牌，scope `pcp:read:pjm:workitem`
- 用途：分页获取工作项；默认不含已删除/已归档项
- 常用查询参数：`project_id`、`type_id`、`assignee_id`、`state_id`、`sprint_id`、
  `updated_between`（逗号分隔起止时间戳）、`include_deleted`、`include_archived`
- 分页：
  - `page_index` **从 0 开始**
  - `page_size` 默认 30、最大 100
- 响应：

```json
{
  "page_size": 30,
  "page_index": 0,
  "total": 1,
  "values": [ { "id": "...", "title": "...", "...": "..." } ]
}
```

实现取 `page_size = 100`（官方上限），`pageParam = page_index`，`limitParam = page_size`。

> 契约提醒：`LocalProvider` 没有“页码起始值”字段，消费该 provider 的 runner
> 必须按 **0-based** 传入 `page_index`，否则会漏掉第一页。

## 6. 官方字段与实际映射

官方响应示例（摘录）与实现映射：

| 官方字段 | 官方形态 | 映射 |
| --- | --- | --- |
| `id` | 24 位十六进制，如 `5edca524cad2fa1125cb0630` | `externalId`（首选） |
| `whole_identifier` / `identifier` | `"SCR-5"` / 数字 `5` | `externalId` 兜底 |
| `title` | 字符串 | `title`；空白 → 跳过 |
| `project.id` | 24 位十六进制 | `projectId`；缺失 → 跳过 |
| `project.identifier` / `name` | `"SCR"` / 项目名 | 仅保留在 `payload` |
| `type.name` / `type.group` / `type.icon` | `group` 允许值 `requirement/task/bug/issue/plan`（官方 `POST /v2/pjm/workitem_types`） | 映射到规范 `type` |
| `state.type` | 允许值 `pending/in_progress/completed/closed`（官方 `POST /v2/pjm/workitem_states`） | 映射到规范 `status` |
| `assignee.id` | 常见为 32 位十六进制，**非 UUID** | 仅 UUID 才写 `assigneePersonId` |
| `sprint.id/name/status` | 迭代引用 | 仅保留在 `payload`（导入契约无 sprint 列） |
| `created_at` / `updated_at` | 10 位秒级时间戳 | 保留在 `payload` |
| `completed_at` | 秒级时间戳或 `null` | `completedAt`（ISO 8601） |
| `participants[].user.id` | 人员引用 | 仅 UUID 生成 `contributions` |
| `priority` | 优先级引用 | 未映射（本次范围只要求 type/state） |

### 类型映射

| PingCode | 规范枚举 |
| --- | --- |
| 用户故事 / story（`group=requirement`） | `STORY` |
| 任务 / task（`group=task`） | `TASK` |
| 子任务 / subtask | `TASK`（规范枚举无 SUBTASK） |
| 缺陷 / bug（`group=bug`） | `BUG` |
| 史诗 / 特性 / epic | `EPIC` |
| issue / 其他 / `group=plan` | `OTHER` |
| 未知名称且未知分组 | **跳过**（不硬塞 `OTHER`） |

### 状态映射

| `state.type` | 规范枚举 |
| --- | --- |
| `pending` | `OPEN` |
| `in_progress` | `IN_PROGRESS` |
| `completed` | `DONE` |
| `closed` | `CANCELLED` |
| 其他 | **跳过**（不按中文状态名猜） |

官方允许值来源：`POST /v2/pjm/workitem_states` 的 `type` 参数。
自定义状态只改 `name`，`type` 仍是这四类之一。

### 事件（events）

列表接口只返回当前快照，没有流转历史（另有
`GET /v2/pjm/workitems/{workitem_id}/transition_histories`，本次不额外拉取）。
因此：

- `DONE` / `CANCELLED` 且 `completed_at` 存在时，生成一条终态事件：
  `{ toStatus, occurredAt: completed_at }`，幂等键稳定；
- 非终态不生成事件，避免每次 `updated_at` 变化都虚假追加“初始状态”；
  由导入器按已存储状态追加真实转换（`planStatusTransition`）。

### 人员与贡献

PingCode 人员 id 通常是 32 位十六进制（如 `a0417f68e846aae315c85d24643678a9`），
与 N-Perform 的 UUID 人员主键不兼容。实现严格按 UUID 过滤：

- `assignee.id` 是 UUID → `assigneePersonId`，并生成 role=`ASSIGNEE` 的贡献；
- `participants` 中 `type=user` 且 `user.id` 是 UUID → role=`PARTICIPANT`（去重）；
- `type=user_group` 或非 UUID 一律忽略。

这样不会把外部字符串写进 `person_id`；代价是真实 PingCode 租户通常不会产生贡献，
需要人员映射表在后续接入（本次不在允许改动范围内）。

## 7. 验证

```bash
npx tsc --noEmit
# exit 0

CI=1 npx vitest run packages/connectors/src/providers/__tests__/pingcode.test.ts </dev/null
# Test Files 1 passed (1)
# Tests 7 passed (7)
```

fixture 使用官方响应字段结构（`fixtures/connectors/pingcode-*.json`）：
分页包裹、`values`、`type.group/name/icon`、`state.type`、`project/sprint/assignee`、
秒级 `created_at/updated_at/completed_at`。UUID 人员用独立 fixture 验证放行规则，
不冒充真实租户数据。

## 8. 未实现 / 风险

- 未调用线上 API（无生产凭据），端点与字段以官方文档为准；首次真实同步前应跑一次
  `GET /v2/pjm/workitems?page_index=0&page_size=1` 冒烟。
- `state.type` 的四个允许值已按官方 `POST /v2/pjm/workitem_states` 核对；
  未知值仍跳过而不是猜。
- 未映射 `priority`、`created_by`、`start/due`，也未拉取流转历史；均不在本次要求内。
- 分页起始值 0-based 需要 runner 配合，provider 契约无法表达。
