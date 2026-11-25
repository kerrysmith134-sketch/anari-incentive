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

- 出站层已移入 `packages/connectors/src/outbound-http.ts`，`outboundJsonFetch` 用于诊断，`pinnedFetch` 作为 `HttpJsonConnector` 默认 transport：真实同步拉取同样执行 DNS 全量校验 + IP pinning。
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
| KMS / Vault | 关闭（应用层） | keyring + `WEBHOOK_KEYRING_FILE`（Vault Agent/K8s CSI/AWS Secrets Manager 投影）；`WEBHOOK_RAW_KEYS_JSON` / `WEBHOOK_SIGNING_KEYS_JSON` 支持多 keyId；KMS rotate 回调热加载。HSM 不在范围 |
| 旧密文迁移 | 关闭（设计层面） | append-only 原始账本不做 UPDATE 重加密；旧 key 留在 keyring 中可继续解密。keyId 缺失时显式 `RAW_PAYLOAD_KEY_MISSING`，不伪造空 payload。见 [密钥管理](../security/key-management.md) |
| Webhook 签名双密钥窗口 | 关闭 | `signatureKeysFor()` 同时接受旧/新 signing key 派生签名；轮换说明与测试已补 |
| Financial Fact 强类型 | 关闭（API/DB） | 迁移 105：`legal_entity_id`、`order_id`、`contract_ref`、`instrument_type`、`recognition_status`、`accounting_period`、`fx_snapshot`、`source_version`、`reversal_of`、`reopening_ref`；POSTED 必填并由 DB CHECK 兜底；DRAFT 兼容旧数据 |
| Accounting Period 关闭/重开 | 关闭 | `accounting_periods` 表 + `GET /api/v1/accounting-periods`、`POST .../close`、`POST .../reopen`；关闭后 POSTED 409 `PERIOD_CLOSED`，重开后必须携带同一 `reopeningRef` |
| 币种精度（JPY/KWD） | 关闭 | `packages/policy-dsl/src/currency.ts`：ISO 4217 minor units（JPY 0 / USD 2 / KWD 3）；分配池、余数、现金加权模型按币种最小单位舍入 |
| Commercial / PingCode / Ticketing Adapter | 部分关闭 | Commercial Account/Opportunity 已接入 runner；Quote/Contract/Order 外部导入、HubSpot/PingCode/Ticketing 原生 adapter 仍未完成 |
| Account→Opportunity→Quote→Contract→Order 领域模型 | 部分关闭 | 新增 `packages/domain/src/commercial.ts`：Deal→Opportunity（禁止 Deal→Order）、Quote 版本化、Order 必须来自已接受 Quote + 已签 Contract、FinancialFact 可追溯门禁；见 [commercial-domain-model](../v2/commercial-domain-model.md)；迁移 106 已落 6 张表与 API，前端/连接器未做 |
| HubSpot Deal → ORDER | 关闭 | 预设改为 `OPPORTUNITY`，并新增契约样本测试 |
| OAuth token 生命周期 | 关闭（runner） | `oauthTokenResolver` 接入 runner；401 → `invalidate()` + 重新取 token 重试一次；CLI 支持 `OAUTH_*` 环境变量 |
| Integrations 前端拆分 | 关闭 | `IntegrationsPage.tsx` 从 1,391 行降到 434 行；Mappings/Schedules/Runs/Identities/Feishu 拆到 `apps/web/src/components/integrations`，新增工作台摘要 |
| Raw 数据保留分类 | 关闭 | 原始记录按同步目标/来源强制 FINANCIAL/PII；显式 DEFAULT 冲突返回 409 `RETENTION_CLASS_MISMATCH` |
| Financial Fact 维度过滤 | 关闭 | `GET /financial-facts` 支持 `legalEntityId` / `accountingPeriod` / `recognitionStatus` |
| ERP 财务事实标准载荷 | 部分关闭 | 新增 `packages/connectors/src/erp-financial.ts`、`erp-financial-facts` 预设与脱敏样本；仍是 generic HTTP 契约，不是原生 ERP adapter |
| Commercial 工作台 UI | 关闭 | 新增 `/commercial` 页面：客户/机会/报价/合同/订单列表与生命周期操作（接受报价、签合同、确认订单）。 |
| 多法人 shadow settlement 负例 | 关闭（算法/CLI） | `scripts/shadow-settlement.ts` 读取法人/期间/订单/批次维度；新增负例 fixture + 测试证明跨法人金额不会被净额抵消。真实脱敏数据周期仍未跑。 |
| 同步连接器统一出站 | 关闭 | `pinnedFetch` 成为 `HttpJsonConnector` 默认 transport；真实同步拉取也做 URL+DNS 全量校验/IP pin，测试仍可注入 `fetchImpl`。 |
| 会计期间双人审批 | 关闭 | 迁移 107 + `change-requests` + Finance Center 审批工作台：请求人创建 PENDING，另一人 approve 后执行；同一人自批 409。 |
| Keyring 热加载 | 关闭 | `POST /api/v1/integration-keys/reload` 重新读取 KMS/Vault/文件 keyring，无需重启；新增热加载测试。 |
| 其他金额模块币种精度 | 关闭（policy-dsl） | `incentive.ts` 的 DBCP/提成/内部拆分/奖金等与 `tiered-team.ts` 按输入/政策币种最小单位舍入；equity/payroll 仍按 CNY 制度口径。 |
| 多法人多币种影子结算 | 关闭（pilot） | 新增 USD/EUR/JPY 三币种、四法人 pilot fixture 与 CLI 测试；真实脱敏数据周期仍需业务提供。 |
| Accounting Period 审批 UI | 关闭 | Finance Center 新增期间审批工作台：状态列表、发起关/开、批准/驳回。 |
| Commercial 生命周期收口 | 关闭 | 报价作废、合同终止、订单取消 API + UI + 测试。 |
| equity 多币种精度 | 关闭 | 回购/税费按 ISO 4217 最小单位；非 CNY 不套用人民币 5 万/50 万阈值。 |
| Integrations 运行健康/数据质量 | 关闭 | 新增 health/data-quality tab，复用 sync-runs 与 quarantine；计数对平展示。 |
| E2E 新流程 | 关闭 | `commercial.spec.ts`、`accounting-period-approval.spec.ts` 2 passed。 |
| Commercial 接入 Sync Runner | 关闭 | Account/Opportunity/Quote/Contract/Order 均 source-aware 导入并接入 runner。 |
| Raw Ledger 不可变性 | 关闭 | 迁移 108 更新触发器，覆盖 source_version/payload_hash/resource_id/fetched_at/source_updated_at；服务端重新计算并核对 payloadHash。 |
| Financial Fact DB/API 一致性 | 关闭 | 迁移 108 CHECK 增加 order/contract 必填；runner/parser 透传 reopeningRef；ISO 4217 改用运行时 registry。 |
| Commercial 完整性 | 关闭 | 已接受/已拒绝 Quote 不可修订；Contract 金额/币种必须等于 Quote；Order 币种/行金额/总额校验；confirm 先锁 contract 再锁 order。 |
| 财务子账 | 关闭（最小闭环） | 迁移 111 + 发票/收款/退款/冲销/FX 重估 API；document/related/fx/functional 字段落库，POSTED 期间门禁复用。 |
| payroll 多币种 | 关闭 | run/line currency 一致；非 CNY 法定扣除置 0 并标记；JPY/KWD 精度测试。 |
| 绩效上限 | 关闭 | 2026-11-25 业务确认按 110/150/105，不采用 130/150；政策门禁更新。 |
| 子账账龄/税额/坏账 | 关闭 | 迁移 112：账龄桶、发票税额、IFRS 9 简化矩阵计提、坏账核销；跨币种收付按功能币/发票汇率折算，缺汇率 fail-closed。 |
| ERP 对账 | 关闭（子账侧） | 按 documentType/币种对比子账与 ERP 来源事实，返回 PASS/VARIANCE；真实 ERP 样本仍需业务提供。 |
| 复式记账 | 关闭 | gl_accounts/gl_journals/gl_journal_lines + RLS；发票/收付/退款/冲销/重估/坏账自动平衡凭证。 |
| 多法人多币种合并 | 关闭（引擎） | IAS 21/ASC 830：期末/平均/历史汇率、CTA、IC AR/AP 与 IC 损益抵消、NCI（多级有效持股）、平衡校验；fixture + CLI PASS。 |
| Ticketing Work Item | 关闭（模型+同步） | 迁移 114 + Work Item/事件/贡献 + `WORK_ITEM` Runner 目标 + PingCode 通用预设。 |
| Accounting Period 审批人/通知 | 关闭 | 迁移 113 + 审批人目录 + 创建/结果站内通知 + UI。 |
| Integrations Mapping Studio | 关闭（前端） | 映射编辑/预览/版本化保存/失败面板；sync-run 级重放后端仍缺。 |
| 坏账部分核销 | 关闭 | write-off 支持部分金额，累计不超 open，GL 平衡。 |
| Agent 辅助 | 关闭（确定性） | 映射建议/同步异常/对账差异解释 3 个 API，纯规则无外部 LLM。 |
| Sync-run 重放 | 关闭 | 新增 `/sync-runs/:id/replay`，Mapping Studio 按钮启用；幂等/跨租户/状态门禁。 |
| KMS 轮换健康 | 关闭 | `/integration-keys/health` + 超龄/失败告警 webhook；不泄露密钥。 |
| 发票多税种 | 关闭 | taxes[] 多税种、tax breakdown、GL 汇总税额仍平衡。 |
| PG 并发回归 | 关闭 | 合同确认/终止、重复确认、关期/入账并发，124 PG tests。 |
| 本地系统 Provider | 关闭（代码） | Anari ERP/Commercial/CRM/Ticketing/HR/Finance + PingCode 官方 v2 适配器 + import CLI；真实联调需启动本地服务并配置 token。 |
| 连接器 Contract Test / 故障注入 | 部分关闭 | 新增 `fixtures/connectors/*` 脱敏样本 + `connector-contract-samples.test.ts`（HubSpot/Feishu/ERP 映射、500 重试、401 不重试、字段缺失 fail-closed）；真实 provider 样本仍未取得 |

## 3. 仍阻断正式接入的项

| 项目 | 原因 |
| --- | --- |
| ERP 财务生产接入 | 无真实 ERP API 契约/样本；财务事实虽已强类型，但 ERP 连接器、科目映射、FX 来源、期间关闭对账未验证 |
| PingCode / Ticketing / Commercial 原生连接器 | Commercial 领域实体/API/UI 已落；PingCode/Ticketing/HubSpot 原生 adapter 仍缺真实 API 契约与样本 |
| 真实多法人/多币种影子结算 | 引擎 + fixture/CLI 已通过；真实脱敏数据仍需业务导入后跑影子周期 |
| HSM / KMS | keyring 文件 + 热加载 + KMS rotate 回调；**HSM/PKCS#11 明确不在范围内**，不引入厂商 SDK |
| Accounting Period 双人审批 | 请求/批准分离 + 工作台 + 审批人目录/通知已完成 |
| 大文件拆分 | 关闭：`app.ts` 2,659 → 2,182；`contracts/index.ts` 3,369 → 3,086；`store.ts` 2,985 → 14（11 个领域 mixin）；`pg-store.ts` 4,836 → 25（18 层继承链）；`PolicyPage.tsx` 3,425 → 1,124（17 文件/22 组件）；`AiPage.tsx` 2,838 → 186（9 组件）。行为保持，全量/PG/构建通过 |
| Integrations UI 工作台 IA | 已加运行健康/数据质量 tab + Mapping Studio；sync-run 级重放仍缺后端接口 |

## 3. 验证命令与结果

```bash
npm test                 # 全量 Vitest（含新增用例）
npm run typecheck        # tsc --noEmit（根 + web）
npm run test:pg          # 全新 PostgreSQL 16 + 全部迁移 + PG 契约测试
npm run test:pg-upgrade  # 迁移升级路径
```

2026-11-24 本地实际结果：

- `npm test`：148 files passed / 2 skipped；1649 tests passed / 111 skipped。
- `npm run typecheck`：API + web 全绿。
- `npm run test:pg`：3 files / 124 tests passed（迁移 102–115；含 Commercial 并发、期间关闭并发、Work Item、子账/多税种）。
- `npm run test:pg-upgrade`：89 → 115 migrations，110 tests passed。
- `npm run web:build`：通过（Integrations 页面拆分与工作台摘要）。
- Playwright E2E 未在本轮运行（前端仅组件拆分 + 摘要，无交互逻辑变更）。

## 4. 结论

- 集成底座的 P0 阻断已修复：Raw Ledger 不再与迁移冲突，生产密钥不再有可预测回退，诊断与同步拉取都走 DNS-pinned 出站层。
- 同步引擎的 P1 可靠性缺陷已大部分关闭：checkpoint 三态、fencing、心跳、幂等键、409 分类、指标拆分、sourceUpdatedAt 水位。
- Sprint 3/5 的**模型与账务控制**已补：Commercial 领域模型（Deal≠Order、Quote 版本、Order 合同门禁）、Financial Fact 强类型、会计期间关闭/重开、ISO 4217 精度、keyring 轮换与 OAuth 生命周期。
- **但审计的最终判断不变**：ERP 财务与 Commercial 仍不可正式接入。缺的不是字段，而是真实 provider 契约、原生 adapter、ERP 科目/FX 映射与多法人影子结算周期。下一阶段应做 `ERP Financial Integrity` 的连接器与影子对账，而不是继续加页面。
