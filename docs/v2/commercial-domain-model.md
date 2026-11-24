# Commercial 领域模型（Sprint 3）

> 状态：**领域模型已建立（代码）**，持久化/API 与真实 Commercial 连接器仍未建立。
> README Provider Readiness 中 Commercial 仍为 `NOT_READY`。

代码：[`packages/domain/src/commercial.ts`](../../packages/domain/src/commercial.ts)
测试：[`commercial-model.test.ts`](../../packages/domain/src/__tests__/commercial-model.test.ts)

## 链路

```
Account
  → Opportunity（CRM Deal 只到这里）
  → Quote v1 → v2 …（版本化，旧版本只读）
  → Contract（SIGNED 才能下单）
  → Order + OrderLine（正式订单号）
  → FinancialFact（orderId / contractRef 关联）
```

## 强制不变量

1. `opportunityFromCrmDeal()` 是 CRM Deal 的唯一入口，返回 **Opportunity**，不返回 Order。
2. `reviseQuote()` 生成新版本并指向 `supersedesQuoteId`；已 ACCEPTED/REJECTED 的 Quote 不可改写。
3. `assertOrderMayBeConfirmed()`：
   - Quote 必须 `ACCEPTED` 且有 `acceptedAt`；
   - Contract 必须 `SIGNED` 且有 `signedAt`，且指向同一 Quote/Opportunity；
   - Order 必须指向该 Contract/Account；
   - 至少一条 OrderLine，且行币种与订单一致。
4. `assertFinancialFactTraceable()`：POSTED 事实必须带 `orderId` 或 `contractRef`，
   以及 `legalEntityId` / `accountingPeriod`。

## 下一步（未做）

- 6 张表的持久化（account/opportunity/quote/contract/order/order_line）与迁移；
- API + 前端订单/合同工作台；
- HubSpot / Commercial 内部系统 adapter：Deal→Opportunity、Quote 版本、Contract 签署状态；
- 与 ERP Order / FinancialFact 的关联对账。

在这些完成前，不能把 CRM Deal 金额用于订单贡献、开票或收入确认。
