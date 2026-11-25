# Integration 密钥管理（KMS / Vault / 轮换）

本文对应 2026-11-21 审计 P0「生产密钥保护」与后续遗留项。代码实现：

- [`apps/api/src/integration-crypto.ts`](../../apps/api/src/integration-crypto.ts)
- [`apps/api/src/config.ts`](../../apps/api/src/config.ts)
- [`db/migrations/099_integration_lifecycle.sql`](../../db/migrations/099_integration_lifecycle.sql) / [`100`](../../db/migrations/100_raw_source_ledger_versions.sql)

## 1. 两把密钥，永不混用

| 用途 | 环境变量 | 说明 |
| --- | --- | --- |
| Webhook 签名（HMAC） | `WEBHOOK_SIGNING_SECRET` | 按 routing key 派生签名密钥；与服务端会话 `SESSION_SECRET` 完全无关 |
| 原始载荷加密（AES-256-GCM） | `WEBHOOK_RAW_KEY` | 加密 `raw_source_records.payload_encrypted`；与签名密钥必须不同 |
| 活动 keyId | `WEBHOOK_KEY_ID` | 写入 `v2:<keyId>:...` 信封；默认 `v1` |
| 签名 keyId | `WEBHOOK_SIGNING_KEY_ID` | 轮换时用于选择活动签名密钥；默认同 `WEBHOOK_KEY_ID` |

生产启动校验（`validateRuntimeConfig` + `IntegrationKeyConfigError`）：

- 两者必须存在（或由 keyring 文件提供）；
- 各至少 32 字符；
- 任意 signing key 与任意 raw key 不得相同；
- 缺失/过短/相同 → **拒绝启动**，不会回退 `SESSION_SECRET` 或公开 dev 默认值。

## 2. 轮换：keyring + 双签名窗口

单密钥无法轮换历史密文。现在支持 keyring：

```bash
# 方式 A：环境变量（不推荐长期使用，/proc/<pid>/environ 可能泄露）
WEBHOOK_RAW_KEYS_JSON='{"2026-10":"<old-raw>","2026-11":"<new-raw>"}'
WEBHOOK_SIGNING_KEYS_JSON='{"2026-10":"<old-signing>","2026-11":"<new-signing>"}'
WEBHOOK_KEY_ID=2026-11
WEBHOOK_SIGNING_KEY_ID=2026-11

# 方式 B：KMS/Vault sidecar 投影文件（推荐）
WEBHOOK_KEYRING_FILE=/run/secrets/webhook-keyring.json
```

`webhook-keyring.json`：

```json
{
  "rawKeys": { "2026-10": "<old-raw>", "2026-11": "<new-raw>" },
  "signingKeys": { "2026-10": "<old-signing>", "2026-11": "<new-signing>" }
}
```

轮换步骤：

1. 把新 key 加入 keyring，活动 keyId 仍指向旧 key；重启/滚动发布；
2. 把 `WEBHOOK_KEY_ID` / `WEBHOOK_SIGNING_KEY_ID` 指向新 key；此时：
   - 新密文用新 raw key 写入；
   - 旧 `v2:<oldKeyId>` 密文仍可从 keyring 解密；
   - webhook 签名同时接受旧/新 signing key 派生值（`signatureKeysFor`）。
3. 观察一段时间后移除旧 key；移除前旧 keyId 的密文会返回 `RAW_PAYLOAD_KEY_MISSING`，旧签名会 `WEBHOOK_SIGNATURE_INVALID`。

> **不要改写 append-only 原始账本。** `raw_source_records` 的 payload/哈希/sourceVersion 被迁移 099 触发器冻结；轮换通过“保留旧 key 可解密”实现，而不是 UPDATE 历史行。若旧 key 已丢失，历史行只能以 `RAW_PAYLOAD_KEY_MISSING` 隔离并人工处置，不能伪造空 payload。

## 3. KMS / Vault / HSM 接入

当前实现不绑定具体云厂商，提供三种接入方式：

1. **Sidecar 文件投影**（本仓库已支持）：Vault Agent / Kubernetes CSI / AWS Secrets Manager 把 keyring 写到 `WEBHOOK_KEYRING_FILE`；进程启动读取一次。轮换需要滚动重启。
2. **环境变量注入**：由编排平台从 KMS 解密后注入；适合短期过渡。
3. **KMS 主动轮换回调**：配置 `WEBHOOK_ROTATION_CALLBACK_TOKEN`（>=32 字符）后，外部 KMS/控制器可调用 `POST /api/v1/integration-keys/rotate` 并携带 `x-rotation-token`，无需员工会话即可热加载 keyring。

**HSM 不支持，也不在本项目范围内。** 本项目只做应用层 AES-256-GCM + keyring 轮换；不引入 PKCS#11/HSM 厂商 SDK，不承诺 HSM 内加解密。KMS 侧只需把 keyring 投影为文件，并通过 rotate 回调触发 reload。生产接入 KMS 时应把 keyring 文件权限设为 `0400`、挂载为 tmpfs，并限制 sidecar 的读取主体。

## 4. 失败语义

| 场景 | 错误码 | HTTP |
| --- | --- | --- |
| 密文格式不合法 | `RAW_PAYLOAD_FORMAT_INVALID` | 422 |
| keyId 不在 keyring | `RAW_PAYLOAD_KEY_MISSING` | 422 |
| 认证标签不匹配/密钥错误 | `RAW_PAYLOAD_DECRYPT_FAILED` | 422 |
| 生产密钥配置不安全 | `INTEGRATION_KEY_CONFIG_INVALID` | 启动失败 |

解密失败不再返回 `{}`；重放/lineage 会显式失败并计数 `integration_raw_payload_decrypt_failed`。

## 5. 轮换健康与告警（KMS/keyring）

进程内记录每次 keyring 加载（`reload` / KMS `rotate` 回调后更新）与当前 active keyId，并通过 admin 端点暴露**不含任何密钥材料**的健康快照。

配置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WEBHOOK_KEY_MAX_AGE_DAYS` | `90` | 活动密钥的最大年龄，取值 `1-3650`；非法值退回 90 并 `logger.warn`（不阻断启动） |
| `WEBHOOK_KEY_ALERT_URL` | 未设置 | 可选告警接收地址（必须是绝对 http(s) URL）；未设置时只写日志 |
| `WEBHOOK_KEY_HEALTH_INTERVAL_MS` | `3600000` | 进程内定时检查间隔，最小 `60000`；启动时另有一次检查 |

`GET /api/v1/integration-keys/health`（`admin`）：

```json
{
  "ok": false,
  "activeKeyId": "2026-05",
  "keyCount": 2,
  "keyIds": ["2026-01", "2026-05"],
  "source": "FILE",
  "lastLoadedAt": "2026-08-01T00:00:00.000Z",
  "ageDays": 96.5,
  "rotationDue": true,
  "maxAgeDays": 90,
  "usedDevDefaults": false,
  "lastError": "WEBHOOK_KEYRING_FILE.rawKeys[v1] must be at least 32 characters in production"
}
```

语义：

- `ageDays` 是**活动 key 材料**在本进程内首次出现至今的天数。`reload` 若没有改变材料，不会重置年龄（否则每天 reload 就能掩盖过期的轮换）；换新 keyId / 新材料才重新计时。
- `rotationDue = ageDays > maxAgeDays`；超龄时 `ok=false`。
- `source`：`WEBHOOK_KEYRING_FILE` 提供了 key 时为 `FILE`，否则 `ENV`。
- `lastError`：最近一次被拒绝的 reload 的**脱敏**原因（只含变量名/keyId，不含密钥值）；成功 reload 后清除。同样 `ok=false`。
- 快照只有 keyId，没有密钥值；`reload` 失败时旧 keyring 继续生效（fail-closed 不静默降级），reload 端点返回 `409 INTEGRATION_KEY_RELOAD_FAILED`，KMS `rotate` 回调返回 `500 INTEGRATION_KEY_ROTATION_FAILED`。

启动 / 定时检查（`apps/api/src/modules/integrations/integration.routes.ts`）：

- 启动检查**不阻塞** `listen()`：超龄只写 `logger.warn` + 计数 `integration_keys_rotation_due`，绝不阻断启动；
- 定时器 `unref()`，并在 Fastify `onClose` 时清理；
- 告警（`WEBHOOK_KEY_ALERT_URL`，5s 超时）POST 一条 JSON：

```json
{ "event": "rotation_due", "activeKeyId": "2026-05", "ageDays": 96.5, "at": "2026-11-25T00:00:00.000Z" }
```

`event` 取值：`rotation_due`（超龄，每个 activeKeyId 每进程最多一条，轮换后重新武装）、`reload_failed`（每次被拒绝的 reload/rotate）。

投递失败只记日志（`integration_keys_alert_failed`），**不重试、不递归**触发新的告警；告警失败不影响健康端点与业务路径。
