/**
 * ERP Financial Fact adapter contract（2026-11-21 审计 Sprint 5）。
 *
 * 这不是“已完成的 ERP 原生连接器”——真实 ERP 的科目、法人、FX、期间关闭
 * 语义仍需厂商样本与对账验证。本模块定义 **标准化 ERP 财务事实载荷**：
 * 只要上游把字段映射到下列名称，generic HTTP/JSON 连接器即可投递；
 * 未来原生 adapter 也必须产出同一形状。
 *
 * 标准载荷（示例见 fixtures/connectors/erp-financial-facts.sample.json）：
 *   fact_id, fact_type, amount, currency, occurred_at, updated_at,
 *   legal_entity_id, order_id, contract_ref, instrument_type,
 *   recognition_status, accounting_period, source_version, fx_snapshot,
 *   reversal_of, reopening_ref
 */
import {
  parseFinancialFact,
  type ParsedFinancialFact,
} from "./sync-runner.js";

export interface ErpFinancialFactRecord extends Record<string, unknown> {
  fact_id?: unknown;
  fact_type?: unknown;
  amount?: unknown;
  currency?: unknown;
  legal_entity_id?: unknown;
  order_id?: unknown;
  contract_ref?: unknown;
  instrument_type?: unknown;
  recognition_status?: unknown;
  accounting_period?: unknown;
  source_version?: unknown;
  reversal_of?: unknown;
  reopening_ref?: unknown;
  fx_snapshot?: unknown;
  occurred_at?: unknown;
  updated_at?: unknown;
}

export interface ErpFinancialFactParseError {
  error: string;
  reason: "SCHEMA_MISMATCH" | "INVALID_CURRENCY" | "MISSING_RELATION";
}

/**
 * 把 ERP 标准载荷归一化为内部财务事实并执行与 runner 相同的类型化校验。
 * 返回的错误是稳定 reason，用于隔离区分类。
 */
export function parseErpFinancialFact(
  record: ErpFinancialFactRecord,
): ParsedFinancialFact | ErpFinancialFactParseError {
  const sourceRecordId = String(record.fact_id ?? "").trim();
  if (!sourceRecordId) {
    return {
      error: "ERP financial fact is missing fact_id",
      reason: "SCHEMA_MISMATCH",
    };
  }
  const event = {
    sourceRecordId,
    evidenceType: record.fact_type ?? "REVENUE",
    sourceEventVersion: record.source_version,
    occurredAt: record.occurred_at,
    sourceUpdatedAt: record.updated_at,
    payload: {
      amount: record.amount,
      currency: record.currency,
      legalEntityId: record.legal_entity_id,
      orderId: record.order_id,
      contractRef: record.contract_ref,
      instrumentType: record.instrument_type,
      recognitionStatus: record.recognition_status ?? "DRAFT",
      accountingPeriod: record.accounting_period,
      sourceVersion: record.source_version,
      reversalOf: record.reversal_of,
      reopeningRef: record.reopening_ref,
      fxSnapshot: record.fx_snapshot,
    },
  };
  const parsed = parseFinancialFact(event as Record<string, unknown>);
  if ("error" in parsed) {
    return {
      error: parsed.error,
      reason: parsed.reason as ErpFinancialFactParseError["reason"],
    };
  }
  if (
    parsed.recognitionStatus === "POSTED" &&
    !parsed.orderId &&
    !parsed.contractRef
  ) {
    return {
      error: `ERP POSTED fact ${sourceRecordId} must reference order_id or contract_ref`,
      reason: "MISSING_RELATION",
    };
  }
  return parsed;
}

/**
 * 生成 `POST /api/v1/financial-facts` 的请求体；调用方负责签发/审计。
 * `sourceUpdatedAt`/`sourceVersion` 保留来源时间与版本，供迟到快照判定。
 */
export function buildErpFinancialFactBody(
  record: ErpFinancialFactRecord,
  input: { sourceSystem: string },
): Record<string, unknown> | ErpFinancialFactParseError {
  const parsed = parseErpFinancialFact(record);
  if ("error" in parsed) return parsed;
  const occurredAt = String(record.occurred_at ?? "").slice(0, 10);
  return {
    sourceSystem: input.sourceSystem,
    sourceRecordId: String(record.fact_id),
    factType: parsed.factType,
    amount: parsed.amount,
    currency: parsed.currency,
    periodStart: occurredAt || undefined,
    periodEnd: occurredAt || undefined,
    qualityStatus: "UNVERIFIED",
    sourceUpdatedAt: record.updated_at,
    legalEntityId: parsed.legalEntityId,
    orderId: parsed.orderId,
    contractRef: parsed.contractRef,
    instrumentType: parsed.instrumentType,
    recognitionStatus: parsed.recognitionStatus,
    accountingPeriod: parsed.accountingPeriod,
    fxSnapshot: parsed.fxSnapshot,
    sourceVersion: parsed.sourceVersion,
    reversalOf: parsed.reversalOf,
    reopeningRef: record.reopening_ref,
    payload: record,
  };
}
