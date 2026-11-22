# ERP 财务事实接入数据契约（Sprint 2.1 附）

> 状态：**约定稿（DRAFT）**——本文件定义 ERP 财务事实接入 N-Perform 时
> `financial_facts.payload` 的语义字段约定。满足本契约并通过影子核算周期
> 是 README Provider Readiness 真值表中 ERP `NO_GO` 解除的前置条件。
> 字段在业务方确认后提升为数据库列（迁移），当前以 payload 约定先行。

## 必填语义字段（缺任一 → 接入被拒绝）

| payload 键 | 类型 | 语义 | 为什么重要 |
|---|---|---|---|
| `legalEntity` | string | 法人主体标识（统一社会信用代码或内部法人编码） | 多法人主体的收入/成本不可跨主体合并计算激励 |
| `orderId` | string | 关联业务订单（N-Perform 内部订单对象的外部键） | 财务事实必须可追溯到产生它的业务订单 |
| `contractRef` | string | 合同/报价引用（Commercial 系统键） | 打通 报价→合同→订单→收入 的业务链 |
| `instrumentType` | enum | `INVOICE` / `CREDIT_NOTE` / `PAYMENT` / `COST` / `REFUND` | 发票、贷项、收款与成本是不同性质的财务事实，不可互相替代 |
| `revenueRecognition` | enum | `DRAFT` / `POSTED` | 只有 `POSTED` 的收入确认事实才允许参与正式激励计算 |
| `fxSnapshot` | object | `{ rate: decimal, quoteCurrency: string, source: string, asOf: datetime }` | 非本位币事实的历史汇率与转换依据（审计可追溯） |
| `accountingPeriod` | string | 会计期间（`YYYY-MM`） | 与 evaluation cycle 解耦；期间关闭后事实不可再变更 |

## 版本与冲销（INT-208 已落地的机制约定）

- 每次同步把 `sourceUpdatedAt` 映射为事实的 `source_updated_at`；**迟到的旧
  快照会被 409 `STALE_FINANCIAL_FACT` 拒绝**（迁移 101 修订账本保留全部历史）。
- 冲销/更正通过**新版本快照**表达（`instrumentType: CREDIT_NOTE` + 关联原
  `orderId`），系统按修订链追溯，不原位改写历史。
- 同一来源记录的多次同步由 `(tenant, source_system, source_record_id,
  source_version)` 版本键幂等去重。

## 同步通道约定

- 财务事实同步走 `targetType: FINANCIAL_FACT` 资源流；每条记录在投影前
  **先加密落 raw**（版本化 raw ledger），满足可追溯与重放。
- `POST /api/v1/financial-facts` 接受 `finance` 或 `integration` 角色；
  `integration` 角色仅可写、不可读他人薪酬字段（字段矩阵照常生效）。
- 期间关闭（`accountingPeriod` 已 close）后到达的事实变更必须携带
  `reopeningRef`（重开凭证引用），否则拒绝。

## 影子核算验收清单（NO_GO → GO）

1. 单法人、单币种、单订单的 GROSS_PROFIT 事实端到端同步 → 与 ERP 控制总额一致。
2. 一次更正（新版本快照）+ 一次迟到旧快照 + 一次冲销 → 修订链完整、主表正确。
3. 跨会计期间的期间关闭行为验证（关闭后变更被拒或要求重开凭证）。
4. 完整影子结算周期通过（`npm run pilot:report` PASS + shadow:settle exit 0）。
