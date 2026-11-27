/**
 * 奖励批次支付回执的 GL（总账）状态投影。
 *
 * 迁移 119 起由服务端在对账投影里直接返回：
 * - `glComplete`：每条 PAID 回执都有按 documentId=payment.id 可查、
 *   借贷相等且金额为正的 PAYMENT 凭证；
 * - `missingJournalLineIds`：缺少这种凭证的批次行。
 * 前端不再自行扫描 /financial-journals，避免凭证明细窗口截断导致误判。
 */
import type {
  AwardBadgeTone,
  AwardReconciliation,
  AwardReconciliationLine,
} from "./types.js";

export type AwardGlLineStatus = "POSTED" | "MISSING" | "NOT_REQUIRED";

export const GL_STATUS_LABELS: Record<AwardGlLineStatus, string> = {
  POSTED: "已记账",
  MISSING: "缺少凭证",
  NOT_REQUIRED: "无需记账",
};

export function glStatusTone(status: AwardGlLineStatus): AwardBadgeTone {
  switch (status) {
    case "POSTED":
      return "success";
    case "MISSING":
      return "danger";
    default:
      return "neutral";
  }
}

export function missingJournalLineIdSet(
  reconciliation: AwardReconciliation | undefined,
): ReadonlySet<string> {
  return new Set(reconciliation?.missingJournalLineIds ?? []);
}

/**
 * 行级 GL 状态：未付行无需记账；缺少平衡凭证的行标红；
 * 其余已付行视为已记账（服务端已按凭证完整性计算）。
 */
export function glStatusForLine(
  line: AwardReconciliationLine,
  missingLineIds: ReadonlySet<string>,
): AwardGlLineStatus {
  if (line.paymentRefs.length === 0) return "NOT_REQUIRED";
  return missingLineIds.has(line.lineId) ? "MISSING" : "POSTED";
}

export function glSummaryLabel(reconciliation: AwardReconciliation): string {
  const hasPaidReceipt = reconciliation.lines.some(
    (line) => line.paymentRefs.length > 0,
  );
  if (!hasPaidReceipt) return "GL 无待记账";
  if (reconciliation.glComplete) return "GL 凭证完整";
  return `GL 缺 ${reconciliation.missingJournalLineIds.length} 行`;
}

export function glSummaryTone(
  reconciliation: AwardReconciliation,
): AwardBadgeTone {
  const hasPaidReceipt = reconciliation.lines.some(
    (line) => line.paymentRefs.length > 0,
  );
  if (!hasPaidReceipt) return "neutral";
  return reconciliation.glComplete ? "success" : "danger";
}
