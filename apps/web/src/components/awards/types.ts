/**
 * 奖励批次支付与对账（迁移 117）前端视图模型。
 *
 * 与 `GET /api/v1/incentive-award-batches/:id/reconciliation` 及
 * `POST /api/v1/incentive-award-batches/:id/payments` 的响应一一对应；
 * 金额一律使用十进制字符串，前端只做展示与相等性校验，不做浮点累加。
 */

export type AwardReconciliationStatus =
  | "RECONCILED"
  | "PARTIAL"
  | "VARIANCE"
  /** 金额已足额，但仍有 PAID 回执缺少平衡的 GL 凭证（迁移 119）。 */
  | "GL_INCOMPLETE";

export type AwardLineReconciliationStatus =
  | "PAID"
  | "PARTIAL"
  | "UNPAID"
  | "OVERPAID";

export type AwardPaymentStatus = "PAID" | "FAILED" | "RETURNED";

export type AwardCreditAccount = "CASH" | "PAYABLE";

export type AwardBadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

export interface AwardReconciliationLine {
  lineId: string;
  personId: string;
  currency: string;
  /** 批次行应付金额。 */
  amount: string;
  /** 该行 PAID 回执累计已付金额。 */
  paidAmount: string;
  /** 未付金额 = max(0, amount - paidAmount)。 */
  unpaidAmount: string;
  /** 差异 = paidAmount - amount（负数=少付，正数=多付）。 */
  variance: string;
  status: AwardLineReconciliationStatus;
  /** 计入已付的银行流水号（PAID only）。 */
  paymentRefs: string[];
}

/** 对账接口返回的历史支付回执行（PAID / FAILED / RETURNED 全量）。 */
export interface AwardReconciliationPayment {
  id: string;
  lineId: string;
  personId: string;
  amount: string;
  currency: string;
  paymentRef: string;
  status: AwardPaymentStatus;
  /** 仅 PAID 必有；FAILED/RETURNED 可能缺省。 */
  paidAt?: string;
  legalEntityId: string;
  accountingPeriod?: string;
  creditAccount: AwardCreditAccount;
  failureCode?: string;
}

export interface AwardReconciliation {
  batchId: string;
  batchNo: string;
  batchStatus: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  unpaidAmount: string;
  variance: string;
  totalLines: number;
  paidLines: number;
  unpaidLines: number;
  partialLines: number;
  overpaidLines: number;
  /** 每条 PAID 回执都有按 documentId 可查、借贷相等的 PAYMENT 凭证。 */
  glComplete: boolean;
  /** 有 PAID 回执但缺少平衡凭证的批次行 id。 */
  missingJournalLineIds: string[];
  status: AwardReconciliationStatus;
  lines: AwardReconciliationLine[];
  /** 全部历史支付回执（含失败/退回），按 paidAt 缺省 createdAt 倒序。 */
  payments: AwardReconciliationPayment[];
}

export interface AwardPaymentReceipt {
  id: string;
  tenantId?: string;
  batchId: string;
  lineId: string;
  personId: string;
  amount: string;
  currency: string;
  paymentRef: string;
  status: AwardPaymentStatus;
  paidAt?: string;
  failureCode?: string;
  createdAt: string;
}

export interface RecordAwardPaymentsResult {
  payments: AwardPaymentReceipt[];
  reconciliation: AwardReconciliation;
  createdPaymentIds: string[];
}

/** POST /payments 的单行请求体。 */
export interface AwardPaymentPayload {
  lineId: string;
  paymentRef: string;
  status: AwardPaymentStatus;
  amount: string;
  currency: string;
  failureCode?: string;
  legalEntityId?: string;
  accountingPeriod?: string;
  creditAccount?: AwardCreditAccount;
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; error: string };

/** 批次台账行中支付工作台需要的最小字段。 */
export interface AwardBatchSummary {
  id: string;
  batchNo: string;
  status: string;
  currency: string;
  paymentRef?: string;
}

export const RECONCILIATION_LABELS: Record<
  AwardReconciliationStatus,
  string
> = {
  RECONCILED: "已对平",
  PARTIAL: "部分支付",
  VARIANCE: "存在差异",
  GL_INCOMPLETE: "GL 凭证不完整",
};

export const LINE_STATUS_LABELS: Record<
  AwardLineReconciliationStatus,
  string
> = {
  PAID: "已付足额",
  PARTIAL: "部分支付",
  UNPAID: "未支付",
  OVERPAID: "多付",
};

export const PAYMENT_STATUS_LABELS: Record<AwardPaymentStatus, string> = {
  PAID: "已支付",
  FAILED: "支付失败",
  RETURNED: "已退回",
};

export const CREDIT_ACCOUNT_LABELS: Record<AwardCreditAccount, string> = {
  CASH: "现金（CASH）",
  PAYABLE: "应付（PAYABLE）",
};

export function reconciliationTone(
  status: AwardReconciliationStatus,
): AwardBadgeTone {
  switch (status) {
    case "RECONCILED":
      return "success";
    case "GL_INCOMPLETE":
      return "warning";
    case "PARTIAL":
      return "warning";
    default:
      return "danger";
  }
}

export function lineStatusTone(
  status: AwardLineReconciliationStatus,
): AwardBadgeTone {
  switch (status) {
    case "PAID":
      return "success";
    case "OVERPAID":
      return "danger";
    case "PARTIAL":
      return "warning";
    default:
      return "warning";
  }
}

export function paymentStatusTone(status: AwardPaymentStatus): AwardBadgeTone {
  switch (status) {
    case "PAID":
      return "success";
    case "RETURNED":
      return "warning";
    default:
      return "danger";
  }
}

/** 只接受 > 0、最多 14 位整数与 6 位小数的十进制字符串（与后端契约一致）。 */
export function isValidPaymentAmount(value: string): boolean {
  const text = value.trim();
  return /^\d{1,14}(\.\d{1,6})?$/.test(text) && Number(text) > 0;
}

/** 十进制字符串按值比较（"100.0" 与 "100" 相等），避免浮点漂移。 */
export function decimalEquals(left: string, right: string): boolean {
  return canonicalDecimal(left) === canonicalDecimal(right);
}

function canonicalDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.trim().split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return `${normalizedInteger}${
    normalizedFraction ? `.${normalizedFraction}` : ""
  }`;
}

export function isValidAccountingPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value.trim());
}

export function currentAccountingPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
