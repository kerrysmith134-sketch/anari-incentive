# ERP 财务事实接入数据契约（Sprint 5）

> 状态：**已落库（IMPLEMENTED，2026-11-24）**——迁移 105 把下列会计语义从
> `payload` 提升为 `financial_facts` 强类型列，并用数据库 CHECK 兜底。
> **这不等于 ERP 连接器已可生产接入**：README 真值表中 ERP 仍为 `NO_GO`，
> 解除条件是真实 ERP 样本、连接器契约测试与影子核算周期全部通过。

## 必填语义字段（`recognitionStatus=POSTED` 时缺任一 → 400/409 拒绝）

| 列 / API 字段 | 类型 | 语义 | 为什么重要 |
|---|---|---|---|
| `legalEntityId` | string | 法人主体标识（统一社会信用代码或内部法人编码） | 多法人主体的收入/成本不可跨主体合并计算激励 |
| `orderId` | string | 关联业务订单（N-Perform 内部订单对象的外部键） | 财务事实必须可追溯到产生它的业务订单 |
| `contractRef` | string | 合同/报价引用（Commercial 系统键） | 打通 报价→合同→订单→收入 的业务链 |
| `instrumentType` | enum | `INVOICE` / `CREDIT_NOTE` / `PAYMENT` / `COST` / `REFUND` | 发票、贷项、收款与成本是不同性质的财务事实，不可互相替代 |
| `recognitionStatus` | enum | `DRAFT` / `POSTED` | 只有 `POSTED` 才允许参与正式激励计算；`DRAFT` 是未确认证据 |
| `fxSnapshot` | object | `{ rate: decimal, quoteCurrency: string, source: string, asOf: datetime }` | 非本位币事实的历史汇率与转换依据（审计可追溯） |
| `accountingPeriod` | string | 会计期间（`YYYY-MM`） | 与 evaluation cycle 解耦；期间关闭后事实不可再变更 |
| `sourceVersion` | string | 来源记录版本 | 幂等/迟到快照/修订链的版本键 |

`DRAFT` 事实保留兼容：只需 `sourceSystem/sourceRecordId/factType/amount/currency`，
用于尚未完成会计确认的预导入数据；不得当作已确认收入。

> 收入确认状态与现金收款状态分离：`instrumentType=PAYMENT` 只表示现金事实，
> 不等于收入确认；`INVOICE` 也不等于收入确认。只有 `recognitionStatus=POSTED`
> 的 `REVENUE`/`GROSS_PROFIT` 事实可进入正式激励计算。

## 版本与冲销（INT-208 / Sprint 5）

- 每次同步把 `sourceUpdatedAt` 映射为事实的 `source_updated_at`；**迟到的旧
  快照会被 409 `STALE_FINANCIAL_FACT` 拒绝**（迁移 101/105 修订账本保留全部历史
  与会计语义字段）。
- 冲销/更正通过**新版本快照**表达（`instrumentType: CREDIT_NOTE` + `reversalOf`
  关联原事实/订单），系统按修订链追溯，不原位改写历史。
- 同一来源记录的多次同步由 `(tenant, source_system, source_record_id,
  fact_type)` 主键 + `source_updated_at` 排序；raw ledger 另按
  `(tenant, source_system, external_record_id, source_version)` 版本化。

## 同步通道约定

- 财务事实同步走 `targetType: FINANCIAL_FACT` 资源流；每条记录在投影前
  **先加密落 raw**（版本化 raw ledger），满足可追溯与重放。
- `POST /api/v1/financial-facts` 接受 `finance` 或 `integration` 角色；
  `integration` 角色仅可写、不可读他人薪酬字段（字段矩阵照常生效）。
- 会计期间按 `(tenant, legalEntityId, accountingPeriod)` 管理：
  `POST /api/v1/accounting-periods/close` 关闭后，新的 `POSTED` 事实返回
  409 `PERIOD_CLOSED`；
  `POST /api/v1/accounting-periods/reopen` 必须提供 `reopeningRef`，之后
  该期间的 `POSTED` 事实必须携带同一 `reopeningRef`，否则 409
  `REOPENING_REF_REQUIRED`。
- 首次 `POSTED` 事实会按需创建 `OPEN` 期间；关闭/重开操作要求 `finance`/`admin`
  角色，并记录操作人/原因/凭证号。

## 影子核算验收清单（NO_GO → GO）

1. 单法人、单币种、单订单的 GROSS_PROFIT 事实端到端同步 → 与 ERP 控制总额一致。
2. 一次更正（新版本快照）+ 一次迟到旧快照 + 一次冲销 → 修订链完整、主表正确。
3. 跨会计期间的期间关闭行为验证（关闭后变更被拒或要求重开凭证）。
4. 完整影子结算周期通过（`npm run pilot:report` PASS + shadow:settle exit 0）。
