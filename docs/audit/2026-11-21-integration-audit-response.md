# N-Perform / Anari Incentive 审计回应（2026-11-21 集成审计）

- 回应日期：2026-11-24
- 审计对象：`anari-incentive-main`（2026-11-21 审计包）
- 代码基线：`dc436ef` + 本回应所列提交
- 结论未变：**不通过正式 ERP / Commercial 集成验收**。本轮只完成集成底座与财务/同步完整性的 P0/P1 加固，不改变连接器就绪度真值表。

## 1. 本轮已修复（含验证）

### P0-1 Raw Source Ledger 版本化一致性

| 问题 | 修复 |
| --- | --- |
| PostgreSQL adapter 仍用三列 `ON CONFLICT`，迁移 100 已改四列 → 42P10 | `appendRawSourceRecord` 改为 `(tenant_id, source_system, external_record_id, source_version)` + `DO NOTHING`，幂等命中后查询返回既有行 |
| 三列 `DO UPDATE` 会触发 099 append-only 触发器 | 彻底移除 `UPDATE`；历史密文/哈希/retention 不可改写 |
| Contract 丢弃 `payloadHash` / `sourceVersion` | `createRawSourceRecordSchema` 新增 `payloadHash`、`sourceVersion`、`resourceId`、`sourceUpdatedAt`；API 缺省时服务端用稳定 JSON 计算哈希并令 `sourceVersion = payloadHash` |
| Memory 与 PG 语义不一致 | Memory 同版本幂等返回、新版本独立成行；两者默认 `payloadHash` / `sourceVersion` 规则一致 |
| Runner 计算了版本/哈希但未真正落库 | Runner 透传全部版本字段、`resourceId`、`sourceUpdatedAt`、`retentionClass`（FINANCIAL / PII / DEFAULT） |
| 同版本内容被篡改仍继续投影 | 返回记录的 `payloadHash` 与本次不一致 → `SOURCE_VERSION_CONFLICT` 隔离，不投影、不覆盖 |
| 迁移 100 的 `DROP CONSTRAINT` 用了未截断名字（PG 63 字节），旧三列 UNIQUE 在全新库仍存在 | 新增迁移 103：按列集合精确删除三列唯一约束，并确保四列 `uq_raw_source_record_version` 存在 |

测试：`integration-pg-contract.test.ts`（同版本幂等、新版本并存、历史不可变、DELETE/UPDATE 被触发器拒绝）、`tdd-attack-rounds-3a.test.ts`（同内容幂等、更正内容独立成行）、`integration-sync-resources.test.ts`。

### P0-2 生产密钥保护

| 问题 | 修复 |
| --- | --- |
| 缺独立密钥时回退 `SESSION_SECRET` / 公开 dev 默认值 | 新增 `apps/api/src/integration-crypto.ts`：生产必须配置 `WEBHOOK_SIGNING_SECRET` 与 `WEBHOOK_RAW_KEY`，各 ≥32 字符且必须不同；否则启动期 fail-closed。永不读取 `SESSION_SECRET` |
| 签名密钥与加密密钥未分离 | 两把密钥独立校验；相同时拒绝启动 |
| 解密失败静默返回 `{}` | `RawPayloadDecryptError`（`RAW_PAYLOAD_DECRYPT_FAILED` / `KEY_MISSING` / `FORMAT_INVALID`）；API 返回 422 稳定错误码并计数，不再以空 payload 重放 |
| 无 Key ID / 轮换 | 新密文 `v2:<keyId>:<iv>:<tag>:<data>`，兼容旧 `v1:`；`WEBHOOK_KEY_ID` 指定活动 keyId；旧 keyId 明确报 `KEY_MISSING` 供隔离/告警 |
| 连接测试 Secret Resolver 只读 `SECRETS_JSON` | 同时读取 `SECRETS_FILE`，与 worker 一致 |

测试：`integration-crypto.test.ts`（39 例）、`config.test.ts`（生产缺失/过短/相同均 fatal）、`audit-hardening.test.ts`（生产 `buildApp` 需显式密钥）。

### P0-3 SSRF / 统一出站

- 新增 `apps/api/src/outbound-http.ts`：`outboundJsonFetch` 统一出站；起始 URL 与每一跳重定向都执行 `assertEgressAllowed`。
- DNS 全量 A/AAAA 逐条 `assertEgressIpAllowed`，任一私网记录整体拒绝；默认 transport 用 Node `lookup` pin 已校验 IP，`servername` 保留原 host 做 SNI/证书校验，`agent: false` 禁止连接池绕过。
- 跨 origin 重定向丢弃 `authorization` / `cookie` / `proxy-authorization`；总超时 10s、响应上限 1 MiB。
- 集成页 `/test` 与 `/schema-preview` 不再直接 `fetch()`，统一走该层。
- `redactSample` 对样本字段值脱敏（邮箱/手机/高熵 token/敏感键），保留字段名用于 mapping；`mappedPreview` 同样脱敏。
- 连接级 `egressAllowlist` 透传到出站层。

测试：`outbound-http.test.ts`（39 例，含私网/DNS rebinding/重定向/大小/脱敏）、`audit-wave4-http.test.ts`。

### P1 同步引擎

| 审计项 | 修复 |
| --- | --- |
| `cursor = COALESCE($3, old)` 无法清空 | 三态语义：字段缺省保留、显式 `null` 清空、字符串更新；PG 用 `CASE WHEN provided`，Memory 用 `undefined` 判断 |
| Fencing token 未保护 checkpoint | `PUT /checkpoint` 必须携带 `leaseOwner` + `fencingToken`；PG 在同一事务 `FOR UPDATE` 校验 owner/token/未过期，Memory 同语义；旧持有者写 checkpoint → 409 `RESOURCE_LEASE_STALE` |
| 固定 900s 租约无心跳 | 新增 `POST /sync-resources/:id/renew-lease`；Runner 每 5 分钟续约，续约失败立即停止同步 |
| 幂等键只用 `payloadHash:mappingVersion` | 改为 `sourceSystem + resourceId + externalRecordId + externalObjectId + sourceVersion + mappingVersion + targetType` |
| 任意 HTTP 409 都当重复成功 | 只有结构化幂等码（`DUPLICATE_*` / `IDEMPOTENT_REPLAY` / `STALE_FINANCIAL_FACT`）或已知 message 前缀才算重复；其它 409 抛 `SYNC_CONFLICT_UNCLASSIFIED`，run FAILED |
| 指标不区分 created/duplicate | `SyncCounters` 拆为 fetched / rawPersisted / created / updated / duplicate / invalid / quarantined / failed；迁移 102 持久化，finish API 落库 |
| Raw 写入失败不计 failed | raw 写入单独 try/catch，失败计数后抛；canonical 契约失败进隔离并计 `invalid` |
| 增量水位用 `occurredAt` | 新增 `sourceUpdatedAt` 贯穿 mapping → canonical → runner → raw ledger；watermark 取 `sourceUpdatedAt ?? occurredAt`；`updatedSinceParam` / `updatedSinceBodyKey` 真正进入 connector 配置 |
| 配置缺失 mapping 静默跳过 | `buildHttpJsonConnectorConfig` 返回 null 时 run FAILED（`MAPPING_CONFIG_INVALID`），不再假装成功 |
| `intervalOverrideMinutes` 是死代码 | 迁移 104 增加 `sync_resources.interval_minutes`；创建资源可传 `intervalMinutes`；checkpoint API 回传 `intervalOverrideMinutes`；runner 节流分支重新生效 |
| Mapping 缺失导致跳过 | 见上，显式失败 |

测试：`integration-sync-resources.test.ts`（未知 409 失败、sourceUpdatedAt 水位、checkpoint fencing）、`integration-pg-contract.test.ts`（显式 null 清空、stale token 拒绝）。

### P1 算法与财务计算

| 审计项 | 修复 |
| --- | --- |
| 绩效周期上限代码/制度可能漂移 | 抽出唯一来源 `packages/policy-dsl/src/policy-caps.ts` + 机器基线 `fixtures/policy/performance-caps.json` + 验收门禁测试 + `docs/acceptance/policy-caps.md`。**未按审计数值擅自改动**：仓库现行批准口径为 110/150/105，审计提议的 130/150 记为待业务书面确认的冲突 |
| `reconcileLines()` 同人多行被覆盖 | 按 person + 可选 currency/incentiveType/dimensionKey 聚合求和；旧调用保持兼容；跨币种/跨激励类型不再净额抵消 |
| Shadow Settlement 只按 person+currency | 可选 dimensions：legalEntity / accountingPeriod / orderId / contractRef / payoutBatch / incentiveType；旧 fixture 行为与 hash 保持稳定 |
| 现金加权模型缺边界 | `cashCollected >= 0`、`contractAmount > 0`、权重/留存率 ∈ [0,1]、池比例/上限非负；越界 fail-closed |
| 小数超 6 位被静默截断 | `parseDecimal` 超有效精度抛 `DECIMAL_PRECISION_EXCEEDED`（末尾补零不误伤） |

测试：`policy-caps.acceptance.test.ts`、`reconcile-dimensions.test.ts`、`shadow-settlement-dimensions.test.ts`、`cash-weighted-boundaries.test.ts`、`decimal-precision.test.ts`。

## 2. 第二轮（2026-11-24 16:xx）继续关闭的项

| 项目 | 状态 | 实现 / 证据 |
| --- | --- | --- |
| KMS / Vault / HSM | 部分关闭 | 新增 keyring + `WEBHOOK_KEYRING_FILE`（Vault Agent/K8s CSI/AWS Secrets Manager 投影）；`WEBHOOK_RAW_KEYS_JSON` / `WEBHOOK_SIGNING_KEYS_JSON` 支持多 keyId；HSM 内加密与自动轮换回调仍未实现 |
| 旧密文迁移 | 关闭（设计层面） | append-only 原始账本不做 UPDATE 重加密；旧 key 留在 keyring 中可继续解密。keyId 缺失时显式 `RAW_PAYLOAD_KEY_MISSING`，不伪造空 payload。见 [密钥管理](../security/key-management.md) |
| Webhook 签名双密钥窗口 | 关闭 | `signatureKeysFor()` 同时接受旧/新 signing key 派生签名；轮换说明与测试已补 |
| Financial Fact 强类型 | 关闭（API/DB） | 迁移 105：`legal_entity_id`、`order_id`、`contract_ref`、`instrument_type`、`recognition_status`、`accounting_period`、`fx_snapshot`、`source_version`、`reversal_of`、`reopening_ref`；POSTED 必填并由 DB CHECK 兜底；DRAFT 兼容旧数据 |
| Accounting Period 关闭/重开 | 关闭 | `accounting_periods` 表 + `GET /api/v1/accounting-periods`、`POST .../close`、`POST .../reopen`；关闭后 POSTED 409 `PERIOD_CLOSED`，重开后必须携带同一 `reopeningRef` |
| 币种精度（JPY/KWD） | 关闭 | `packages/policy-dsl/src/currency.ts`：ISO 4217 minor units（JPY 0 / USD 2 / KWD 3）；分配池、余数、现金加权模型按币种最小单位舍入 |
| Commercial / PingCode / Ticketing Adapter | 未关闭 | 仍无真实 API 契约与样本；README 真值表保持 `NOT_READY` |
| Account→Opportunity→Quote→Contract→Order 领域模型 | 部分关闭 | 新增 `packages/domain/src/commercial.ts`：Deal→Opportunity（禁止 Deal→Order）、Quote 版本化、Order 必须来自已接受 Quote + 已签 Contract、FinancialFact 可追溯门禁；见 [commercial-domain-model](../v2/commercial-domain-model.md)；持久化/API 尚未建立 |
| HubSpot Deal → ORDER | 关闭 | 预设改为 `OPPORTUNITY`，并新增契约样本测试 |
| OAuth token 生命周期 | 关闭（runner） | `oauthTokenResolver` 接入 runner；401 → `invalidate()` + 重新取 token 重试一次；CLI 支持 `OAUTH_*` 环境变量 |
| Integrations 前端拆分 | 关闭 | `IntegrationsPage.tsx` 从 1,391 行降到 434 行；Mappings/Schedules/Runs/Identities/Feishu 拆到 `apps/web/src/components/integrations`，新增工作台摘要 |
| 连接器 Contract Test / 故障注入 | 部分关闭 | 新增 `fixtures/connectors/*` 脱敏样本 + `connector-contract-samples.test.ts`（HubSpot/Feishu/ERP 映射、500 重试、401 不重试、字段缺失 fail-closed）；真实 provider 样本仍未取得 |

## 3. 仍阻断正式接入的项

| 项目 | 原因 |
| --- | --- |
| ERP 财务生产接入 | 无真实 ERP API 契约/样本；财务事实虽已强类型，但 ERP 连接器、科目映射、FX 来源、期间关闭对账未验证 |
| Commercial / PingCode / Ticketing | 无原生 adapter；领域模型不等于连接器 |
| 多法人/多币种影子结算 | 算法与对账已支持维度，但真实脱敏数据影子周期未跑 |
| HSM / KMS 自动轮换 | keyring 文件已支持，HSM 内加解密与 reload 未实现 |
| Accounting Period 并发/审批 | 关闭/重开有角色与凭证，但尚未接入双人审批流 |
| Integrations UI 工作台 IA | 已拆分组件并加摘要，但 Mapping Studio / Sync Monitor / Data Quality 的深度工作台尚未重构 |

## 3. 验证命令与结果

```bash
npm test                 # 全量 Vitest（含新增用例）
npm run typecheck        # tsc --noEmit（根 + web）
npm run test:pg          # 全新 PostgreSQL 16 + 全部迁移 + PG 契约测试
npm run test:pg-upgrade  # 迁移升级路径
```

2026-11-24 本地实际结果：

- `npm test`：131 files passed / 2 skipped；1318 tests passed / 106 skipped。
- `npm run typecheck`：API + web 全绿。
- `npm run test:pg`：3 files / 119 tests passed（含迁移 102–105、Raw Ledger 四列唯一键、checkpoint fencing、显式 null 清空、lease renew、Financial Fact 强类型与期间关闭/重开）。
- `npm run test:pg-upgrade`：89 → 105 migrations，107 tests passed。
- `npm run web:build`：通过（Integrations 页面拆分与工作台摘要）。
- Playwright E2E 未在本轮运行（前端仅组件拆分 + 摘要，无交互逻辑变更）。

## 4. 结论

- 集成底座的 P0 阻断已修复：Raw Ledger 不再与迁移冲突，生产密钥不再有可预测回退，诊断请求不再绕过 SSRF 防护。
- 同步引擎的 P1 可靠性缺陷已大部分关闭：checkpoint 三态、fencing、心跳、幂等键、409 分类、指标拆分、sourceUpdatedAt 水位。
- Sprint 3/5 的**模型与账务控制**已补：Commercial 领域模型（Deal≠Order、Quote 版本、Order 合同门禁）、Financial Fact 强类型、会计期间关闭/重开、ISO 4217 精度、keyring 轮换与 OAuth 生命周期。
- **但审计的最终判断不变**：ERP 财务与 Commercial 仍不可正式接入。缺的不是字段，而是真实 provider 契约、原生 adapter、ERP 科目/FX 映射与多法人影子结算周期。下一阶段应做 `ERP Financial Integrity` 的连接器与影子对账，而不是继续加页面。
