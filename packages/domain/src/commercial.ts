/**
 * Canonical commercial domain（2026-11-21 审计 Sprint 3）。
 *
 * 关键约束：CRM Deal ≠ Order。销售链路必须是
 *
 *   Account → Opportunity → Quote(version) → Contract(signed) → Order → OrderLine
 *
 * 只有 Contract 已签署且 Quote 已接受，才允许创建 CONFIRMED Order；
 * FinancialFact 再通过 orderId/contractRef 关联。任何“把 Deal 当订单”的
 * 捷径都必须在领域层被拒绝，否则会污染销售绩效、订单贡献和激励计算。
 */

export type CommercialAccountStatus = "ACTIVE" | "INACTIVE";
export type OpportunityStage =
  | "PROSPECT"
  | "QUALIFIED"
  | "PROPOSAL"
  | "WON"
  | "LOST";
export type QuoteStatus = "DRAFT" | "ISSUED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
export type ContractStatus = "DRAFT" | "SIGNED" | "TERMINATED";
export type OrderStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type OrderLineKind = "PRODUCT" | "SERVICE" | "DISCOUNT" | "SURCHARGE";

export interface Account {
  id: string;
  tenantId: string;
  externalAccountId?: string;
  sourceSystem?: string;
  name: string;
  status: CommercialAccountStatus;
  ownerPersonId?: string;
}

export interface Opportunity {
  id: string;
  tenantId: string;
  accountId: string;
  /** CRM Deal/机会的外部键；它永远不是 Order 的外部键。 */
  externalOpportunityId?: string;
  sourceSystem?: string;
  name: string;
  stage: OpportunityStage;
  estimatedAmount?: string;
  currency: string;
  ownerPersonId?: string;
}

export interface Quote {
  id: string;
  tenantId: string;
  opportunityId: string;
  /** 版本号从 1 开始；修订生成新版本，不改写旧版本。 */
  version: number;
  status: QuoteStatus;
  currency: string;
  /** 含税/未税口径必须在合同前锁定。 */
  amount: string;
  issuedAt?: string;
  acceptedAt?: string;
  supersedesQuoteId?: string;
  sourceSystem?: string;
  externalQuoteId?: string;
}

export interface Contract {
  id: string;
  tenantId: string;
  accountId: string;
  opportunityId: string;
  quoteId: string;
  contractRef: string;
  status: ContractStatus;
  sourceSystem?: string;
  externalContractId?: string;
  signedAt?: string;
  currency: string;
  amount: string;
}

export interface OrderLine {
  id: string;
  orderId: string;
  kind: OrderLineKind;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  currency: string;
}

export interface CommercialOrder {
  id: string;
  tenantId: string;
  accountId: string;
  contractId: string;
  /** 正式订单号（ERP/OMS）；不是 CRM Deal id。 */
  orderNumber: string;
  status: OrderStatus;
  sourceSystem?: string;
  externalOrderId?: string;
  currency: string;
  lines: OrderLine[];
  confirmedAt?: string;
}

export class CommercialLifecycleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CommercialLifecycleError";
    this.code = code;
  }
}

/**
 * CRM Deal → Opportunity 的唯一合法入口。
 *
 * 该函数故意不返回 Order：Deal 只在销售机会阶段，金额是“预计金额”，
 * 不能用于订单贡献/开票/收入确认。
 */
export function opportunityFromCrmDeal(input: {
  tenantId: string;
  id: string;
  accountId: string;
  externalDealId: string;
  name: string;
  stage?: OpportunityStage;
  estimatedAmount?: string;
  currency: string;
  ownerPersonId?: string;
}): Opportunity {
  if (!input.externalDealId.trim()) {
    throw new CommercialLifecycleError(
      "CRM_DEAL_ID_REQUIRED",
      "CRM deal must carry an external deal id",
    );
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    accountId: input.accountId,
    externalOpportunityId: input.externalDealId,
    name: input.name,
    stage: input.stage ?? "QUALIFIED",
    estimatedAmount: input.estimatedAmount,
    currency: input.currency.toUpperCase(),
    ownerPersonId: input.ownerPersonId,
  };
}

/** Quote 修订：生成新版本并显式指向被替代版本，旧版本保持只读。 */
export function reviseQuote(
  previous: Quote,
  next: {
    id: string;
    amount: string;
    currency?: string;
    issuedAt?: string;
  },
): Quote {
  if (previous.status === "ACCEPTED" || previous.status === "REJECTED") {
    throw new CommercialLifecycleError(
      "QUOTE_NOT_REVISABLE",
      `quote ${previous.id} is ${previous.status}; create a new opportunity/quote instead`,
    );
  }
  return {
    ...previous,
    id: next.id,
    version: previous.version + 1,
    status: "DRAFT",
    amount: next.amount,
    currency: (next.currency ?? previous.currency).toUpperCase(),
    issuedAt: next.issuedAt,
    acceptedAt: undefined,
    supersedesQuoteId: previous.id,
  };
}

/**
 * 创建 CONFIRMED Order 的领域门禁：Quote 已接受、Contract 已签署、
 * 三者指向同一 opportunity/account，且行项目币种一致。
 */
export function assertOrderMayBeConfirmed(input: {
  order: CommercialOrder;
  contract: Contract;
  quote: Quote;
}): void {
  const { order, contract, quote } = input;
  if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
    throw new CommercialLifecycleError(
      "ORDER_NOT_CONFIRMABLE",
      `order ${order.id} is ${order.status}`,
    );
  }
  if (quote.status !== "ACCEPTED" || !quote.acceptedAt) {
    throw new CommercialLifecycleError(
      "QUOTE_NOT_ACCEPTED",
      `order ${order.id} requires an accepted quote (quote ${quote.id} is ${quote.status})`,
    );
  }
  if (contract.status !== "SIGNED" || !contract.signedAt) {
    throw new CommercialLifecycleError(
      "CONTRACT_NOT_SIGNED",
      `order ${order.id} requires a signed contract (contract ${contract.id} is ${contract.status})`,
    );
  }
  if (contract.quoteId !== quote.id || contract.opportunityId !== quote.opportunityId) {
    throw new CommercialLifecycleError(
      "CONTRACT_QUOTE_MISMATCH",
      "contract must reference the accepted quote and its opportunity",
    );
  }
  if (order.contractId !== contract.id || order.accountId !== contract.accountId) {
    throw new CommercialLifecycleError(
      "ORDER_CONTRACT_MISMATCH",
      "order must reference the signed contract and its account",
    );
  }
  if (order.lines.length === 0) {
    throw new CommercialLifecycleError(
      "ORDER_LINES_REQUIRED",
      "a confirmed order must have at least one order line",
    );
  }
  for (const line of order.lines) {
    if (line.orderId !== order.id) {
      throw new CommercialLifecycleError(
        "ORDER_LINE_MISMATCH",
        `line ${line.id} does not belong to order ${order.id}`,
      );
    }
    if (line.currency.toUpperCase() !== order.currency.toUpperCase()) {
      throw new CommercialLifecycleError(
        "ORDER_CURRENCY_MISMATCH",
        `line ${line.id} currency ${line.currency} != order ${order.currency}`,
      );
    }
  }
}

/**
 * FinancialFact 只能关联正式业务实体：必须能追溯到 Order/Contract。
 * 仅有 CRM Deal id 的财务事实不允许进入正式结算。
 */
export function assertFinancialFactTraceable(fact: {
  orderId?: string;
  contractRef?: string;
  legalEntityId?: string;
  accountingPeriod?: string;
  recognitionStatus: "DRAFT" | "POSTED";
}): void {
  if (fact.recognitionStatus !== "POSTED") return;
  if (!fact.orderId && !fact.contractRef) {
    throw new CommercialLifecycleError(
      "FACT_NOT_TRACEABLE",
      "POSTED financial fact requires orderId or contractRef",
    );
  }
  if (!fact.legalEntityId || !fact.accountingPeriod) {
    throw new CommercialLifecycleError(
      "FACT_ACCOUNTING_SEMANTICS_MISSING",
      "POSTED financial fact requires legalEntityId and accountingPeriod",
    );
  }
}
