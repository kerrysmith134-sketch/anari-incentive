/**
 * 财务子账（迁移 111/112）：发票 / 收款 / 退款 / 冲销 / FX 重估 /
 * 账龄 / 税额 / 坏账 / ERP 对账 / 复式记账。
 *
 * 设计约束（与 Sprint 5 一致）：
 * - 所有写入都以 recognitionStatus=POSTED 落库，因此完整复用
 *   createFinancialFact 的会计期间门禁（关闭期间 / reopeningRef）；
 * - 金额（含税额、坏账、凭证）全部走 1e6 定点 BigInt，服务端重算并拒绝
 *   不一致；
 * - 业务文档 (document_type, document_id) 在租户内唯一，冲销/重估/坏账用
 *   relatedFactId 串起可追溯链；
 * - 每张子账事实在同一请求内自动生成借贷平衡的 journal；借贷不等时
 *   store 层抛 ConflictError（HTTP 409），数据库 CHECK 二次兜底。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { divRound, formatDecimal, parseDecimal } from "@anari/policy-dsl";
import type {
  FinancialAgingBucket,
  FinancialFact,
} from "@anari/domain";
import { FINANCIAL_AGING_BUCKETS, GL_ACCOUNT_CODES } from "@anari/domain";
import {
  createFinancialInvoiceSchema,
  createFinancialPaymentSchema,
  createFinancialRevaluationSchema,
  createGlJournalSchema,
  financialAgingQuerySchema,
  financialBadDebtProvisionSchema,
  financialBadDebtWriteOffSchema,
  financialJournalQuerySchema,
  financialReconciliationQuerySchema,
  financialSubledgerQuerySchema,
  reverseFinancialFactSchema,
} from "@anari/contracts";
import type { BudgetPort } from "../../store-ports.js";
import { ConflictError } from "../../store.js";
import { data, idOf, parse, requireRoles, tenantOf } from "../../http-helpers.js";

const SCALE = 1_000_000n;
/** 百分比定点：1% = 1e6；amount × percent / 100 → 除以 1e8。 */
const PERCENT_SCALE = 100_000_000n;
const SUBLEDGER_SOURCE = "financial-subledger";
const DAY_MS = 86_400_000;

/** 默认坏账计提矩阵（百分比）。body.matrix 可逐桶覆盖。 */
const DEFAULT_PROVISION_MATRIX: Record<FinancialAgingBucket, number> = {
  CURRENT: 0,
  "1-30": 2,
  "31-60": 5,
  "61-90": 10,
  "90+": 50,
};

const RECONCILED_DOCUMENT_TYPES = new Set([
  "INVOICE",
  "PAYMENT",
  "REFUND",
]);

function normalizeAmount(value: string): string {
  return formatDecimal(parseDecimal(value));
}

function multiplyRound(amount: string, rate: string): string {
  return formatDecimal(
    divRound(parseDecimal(amount) * parseDecimal(rate), SCALE, "HALF_UP"),
  );
}

function percentOf(amount: string, percent: number): string {
  return formatDecimal(
    divRound(
      parseDecimal(amount) * parseDecimal(String(percent)),
      PERCENT_SCALE,
      "HALF_UP",
    ),
  );
}

/** 税额 = amount × taxRate / 100（1e6 定点、HALF_UP）。 */
function computeTaxAmount(amount: string, taxRate: number): string {
  return percentOf(amount, taxRate);
}

function normalizePercent(percent: number): string {
  return formatDecimal(parseDecimal(String(percent)));
}

function absAmount(value: string): bigint {
  const parsed = parseDecimal(value);
  return parsed < 0n ? -parsed : parsed;
}

function negate(value: string): string {
  return formatDecimal(-parseDecimal(value));
}

function invoiceTotal(fact: FinancialFact): string {
  return formatDecimal(
    parseDecimal(fact.amount) + parseDecimal(fact.taxAmount ?? "0"),
  );
}

// ----------------------------------------------------------------------
// 账龄
// ----------------------------------------------------------------------

function issuedDateOf(fact: FinancialFact): string {
  const issuedAt = fact.payload?.issuedAt;
  if (typeof issuedAt === "string" && Number.isFinite(Date.parse(issuedAt))) {
    return issuedAt.slice(0, 10);
  }
  const created = Date.parse(fact.createdAt);
  return Number.isFinite(created)
    ? new Date(created).toISOString().slice(0, 10)
    : fact.createdAt.slice(0, 10);
}

function agingBucketFor(days: number): FinancialAgingBucket {
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

interface InvoiceSettlement {
  total: bigint;
  payments: bigint;
  refunds: bigint;
  writeOffs: bigint;
  reversed: boolean;
  open: bigint;
}

function settleInvoice(
  invoice: FinancialFact,
  related: FinancialFact[],
): InvoiceSettlement {
  const total = parseDecimal(invoiceTotal(invoice));
  const sameCurrency = related.filter(
    (fact) => fact.currency === invoice.currency,
  );
  const sumOf = (type: FinancialFact["documentType"]) =>
    sameCurrency
      .filter((fact) => fact.documentType === type)
      .reduce((sum, fact) => sum + parseDecimal(fact.amount), 0n);
  const payments = sumOf("PAYMENT");
  const refunds = sumOf("REFUND");
  const writeOffs = sumOf("BAD_DEBT_WRITE_OFF");
  // 全额冲销的发票不再形成应收；退款金额本身为负，减负数即回到 open。
  const reversed = related.some((fact) => fact.documentType === "REVERSAL");
  const open = reversed
    ? 0n
    : total - payments - refunds - writeOffs;
  return { total, payments, refunds, writeOffs, reversed, open };
}

interface AgingInvoiceRow {
  invoiceFactId: string;
  documentId: string | null;
  currency: string;
  issuedAt: string;
  ageDays: number;
  bucket: FinancialAgingBucket;
  invoiceAmount: string;
  taxAmount: string;
  totalAmount: string;
  payments: string;
  refunds: string;
  writeOffs: string;
  openAmount: string;
  status: "OPEN" | "SETTLED" | "REVERSED" | "OVER_APPLIED";
}

interface AgingTotals {
  currency: string;
  invoiceAmount: string;
  taxAmount: string;
  payments: string;
  refunds: string;
  writeOffs: string;
  openAmount: string;
  buckets: Record<FinancialAgingBucket, string>;
}

function emptyBucketRecord(): Record<FinancialAgingBucket, bigint> {
  return {
    CURRENT: 0n,
    "1-30": 0n,
    "31-60": 0n,
    "61-90": 0n,
    "90+": 0n,
  };
}

function buildAging(
  invoices: FinancialFact[],
  related: FinancialFact[],
  asOf: string,
): {
  rows: AgingInvoiceRow[];
  totals: AgingTotals[];
  invoiceById: Map<string, FinancialFact>;
} {
  const asOfMs = Date.parse(`${asOf}T00:00:00.000Z`);
  const relatedByInvoice = new Map<string, FinancialFact[]>();
  for (const fact of related) {
    if (!fact.relatedFactId) continue;
    const list = relatedByInvoice.get(fact.relatedFactId) ?? [];
    list.push(fact);
    relatedByInvoice.set(fact.relatedFactId, list);
  }
  const bucketTotals = new Map<
    string,
    { buckets: Record<FinancialAgingBucket, bigint> } & Record<
      "invoiceAmount" | "taxAmount" | "payments" | "refunds" | "writeOffs" | "openAmount",
      bigint
    >
  >();
  const invoiceById = new Map<string, FinancialFact>();
  const rows: AgingInvoiceRow[] = [];
  for (const invoice of invoices) {
    const issuedAt = issuedDateOf(invoice);
    const issuedMs = Date.parse(`${issuedAt}T00:00:00.000Z`);
    if (Number.isFinite(issuedMs) && issuedMs > asOfMs) continue;
    const ageDays = Number.isFinite(issuedMs)
      ? Math.floor((asOfMs - issuedMs) / DAY_MS)
      : 0;
    const bucket = agingBucketFor(ageDays);
    const settlement = settleInvoice(
      invoice,
      relatedByInvoice.get(invoice.id) ?? [],
    );
    const status = settlement.reversed
      ? "REVERSED"
      : settlement.open === 0n
        ? "SETTLED"
        : settlement.open < 0n
          ? "OVER_APPLIED"
          : "OPEN";
    rows.push({
      invoiceFactId: invoice.id,
      documentId: invoice.documentId ?? null,
      currency: invoice.currency,
      issuedAt,
      ageDays,
      bucket,
      invoiceAmount: formatDecimal(parseDecimal(invoice.amount)),
      taxAmount: formatDecimal(parseDecimal(invoice.taxAmount ?? "0")),
      totalAmount: formatDecimal(settlement.total),
      payments: formatDecimal(settlement.payments),
      refunds: formatDecimal(settlement.refunds),
      writeOffs: formatDecimal(settlement.writeOffs),
      openAmount: formatDecimal(settlement.open),
      status,
    });
    invoiceById.set(invoice.id, invoice);
    let totals = bucketTotals.get(invoice.currency);
    if (!totals) {
      totals = {
        buckets: emptyBucketRecord(),
        invoiceAmount: 0n,
        taxAmount: 0n,
        payments: 0n,
        refunds: 0n,
        writeOffs: 0n,
        openAmount: 0n,
      };
      bucketTotals.set(invoice.currency, totals);
    }
    totals.invoiceAmount += parseDecimal(invoice.amount);
    totals.taxAmount += parseDecimal(invoice.taxAmount ?? "0");
    totals.payments += settlement.payments;
    totals.refunds += settlement.refunds;
    totals.writeOffs += settlement.writeOffs;
    totals.openAmount += settlement.open;
    totals.buckets[bucket] += settlement.open;
  }
  rows.sort(
    (left, right) =>
      left.issuedAt.localeCompare(right.issuedAt) ||
      left.invoiceFactId.localeCompare(right.invoiceFactId),
  );
  const totals: AgingTotals[] = [...bucketTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => ({
      currency,
      invoiceAmount: formatDecimal(value.invoiceAmount),
      taxAmount: formatDecimal(value.taxAmount),
      payments: formatDecimal(value.payments),
      refunds: formatDecimal(value.refunds),
      writeOffs: formatDecimal(value.writeOffs),
      openAmount: formatDecimal(value.openAmount),
      buckets: {
        CURRENT: formatDecimal(value.buckets.CURRENT),
        "1-30": formatDecimal(value.buckets["1-30"]),
        "31-60": formatDecimal(value.buckets["31-60"]),
        "61-90": formatDecimal(value.buckets["61-90"]),
        "90+": formatDecimal(value.buckets["90+"]),
      },
    }));
  return { rows, totals, invoiceById };
}

// ----------------------------------------------------------------------
// 复式记账
// ----------------------------------------------------------------------

interface JournalLinePlan {
  accountCode: string;
  debit?: string;
  credit?: string;
}

function planInvoiceJournal(fact: FinancialFact): JournalLinePlan[] {
  const total = invoiceTotal(fact);
  const tax = formatDecimal(parseDecimal(fact.taxAmount ?? "0"));
  const lines: JournalLinePlan[] = [
    { accountCode: GL_ACCOUNT_CODES.AR, debit: total },
    { accountCode: GL_ACCOUNT_CODES.REVENUE, credit: fact.amount },
  ];
  if (parseDecimal(tax) > 0n) {
    lines.push({ accountCode: GL_ACCOUNT_CODES.TAX_PAYABLE, credit: tax });
  }
  return lines;
}

function planPaymentJournal(fact: FinancialFact): JournalLinePlan[] {
  const amount = formatDecimal(absAmount(fact.amount));
  if (parseDecimal(amount) === 0n) return [];
  if (fact.documentType === "REFUND") {
    return [
      { accountCode: GL_ACCOUNT_CODES.AR, debit: amount },
      { accountCode: GL_ACCOUNT_CODES.CASH, credit: amount },
    ];
  }
  return [
    { accountCode: GL_ACCOUNT_CODES.CASH, debit: amount },
    { accountCode: GL_ACCOUNT_CODES.AR, credit: amount },
  ];
}

function planRevaluationJournal(fact: FinancialFact): JournalLinePlan[] {
  const amount = parseDecimal(fact.amount);
  if (amount === 0n) return [];
  const magnitude = formatDecimal(absAmount(fact.amount));
  if (amount > 0n) {
    return [
      { accountCode: GL_ACCOUNT_CODES.AR, debit: magnitude },
      { accountCode: GL_ACCOUNT_CODES.FX_GAIN_LOSS, credit: magnitude },
    ];
  }
  return [
    { accountCode: GL_ACCOUNT_CODES.FX_GAIN_LOSS, debit: magnitude },
    { accountCode: GL_ACCOUNT_CODES.AR, credit: magnitude },
  ];
}

function planProvisionJournal(fact: FinancialFact): JournalLinePlan[] {
  const amount = formatDecimal(absAmount(fact.amount));
  if (parseDecimal(amount) === 0n) return [];
  return [
    { accountCode: GL_ACCOUNT_CODES.BAD_DEBT_EXPENSE, debit: amount },
    { accountCode: GL_ACCOUNT_CODES.ALLOWANCE, credit: amount },
  ];
}

function planWriteOffJournal(fact: FinancialFact): JournalLinePlan[] {
  const amount = formatDecimal(absAmount(fact.amount));
  if (parseDecimal(amount) === 0n) return [];
  return [
    { accountCode: GL_ACCOUNT_CODES.ALLOWANCE, debit: amount },
    { accountCode: GL_ACCOUNT_CODES.AR, credit: amount },
  ];
}

function planJournalForFact(fact: FinancialFact): JournalLinePlan[] {
  switch (fact.documentType) {
    case "INVOICE":
      return planInvoiceJournal(fact);
    case "PAYMENT":
    case "REFUND":
      return planPaymentJournal(fact);
    case "FX_REVALUATION":
      return planRevaluationJournal(fact);
    case "BAD_DEBT_PROVISION":
      return planProvisionJournal(fact);
    case "BAD_DEBT_WRITE_OFF":
      return planWriteOffJournal(fact);
    default:
      return [];
  }
}

function reverseJournalLines(lines: JournalLinePlan[]): JournalLinePlan[] {
  return lines.map((line) => ({
    accountCode: line.accountCode,
    debit: line.credit,
    credit: line.debit,
  }));
}

async function postJournalForFact(
  platformStore: BudgetPort,
  tenantId: string,
  fact: FinancialFact,
  description: string,
): Promise<void> {
  if (
    !fact.documentType ||
    !fact.documentId ||
    !fact.accountingPeriod ||
    !fact.legalEntityId
  ) {
    return;
  }
  const lines = planJournalForFact(fact);
  if (lines.length === 0) return;
  await platformStore.createJournalEntry({
    tenantId,
    documentType: fact.documentType,
    documentId: fact.documentId,
    legalEntityId: fact.legalEntityId,
    accountingPeriod: fact.accountingPeriod,
    currency: fact.currency,
    description,
    sourceFactId: fact.id,
    lines,
  });
}

/**
 * 计算/补齐功能币金额。调用方传入的 functionalAmount 原样保留，交由
 * store 层重算比对（不一致 → 409 FUNCTIONAL_AMOUNT_INCONSISTENT）。
 */
interface FunctionalPlan {
  fxRate?: string;
  functionalCurrency?: string;
  functionalAmount?: string;
}

function planFunctional(input: {
  amount: string;
  currency: string;
  functionalCurrency?: string;
  fxRate?: string;
  functionalAmount?: string;
}): FunctionalPlan {
  const functionalCurrency = input.functionalCurrency?.trim();
  if (!functionalCurrency) return {};
  const fxRate =
    input.fxRate ?? (input.currency === functionalCurrency ? "1" : undefined);
  if (
    input.currency === functionalCurrency &&
    fxRate !== undefined &&
    parseDecimal(fxRate) !== SCALE
  ) {
    throw new ConflictError(
      `FX_RATE_INCONSISTENT: fxRate must be 1 when currency equals functionalCurrency (${functionalCurrency})`,
    );
  }
  const functionalAmount =
    input.functionalAmount ??
    (fxRate ? multiplyRound(input.amount, fxRate) : undefined);
  return {
    fxRate: fxRate === undefined ? undefined : normalizeAmount(fxRate),
    functionalCurrency,
    functionalAmount:
      functionalAmount === undefined
        ? undefined
        : normalizeAmount(functionalAmount),
  };
}

async function requireInvoice(
  platformStore: BudgetPort,
  tenantId: string,
  factId: string,
): Promise<FinancialFact> {
  const fact = await platformStore.getFinancialFact(tenantId, factId);
  if (fact.documentType !== "INVOICE") {
    throw new ConflictError(
      `INVOICE_REQUIRED: fact ${factId} is ${fact.documentType ?? fact.factType}, not an INVOICE`,
    );
  }
  if (fact.recognitionStatus !== "POSTED") {
    throw new ConflictError(
      `POSTED_FACT_REQUIRED: fact ${factId} is ${fact.recognitionStatus}`,
    );
  }
  return fact;
}

/** 同币种时补齐 functional 字段；跨币种坏账/计提不臆造汇率。 */
function sameCurrencyFunctional(
  currency: string,
  functionalCurrency: string | undefined,
  amount: string,
): FunctionalPlan {
  if (functionalCurrency && functionalCurrency !== currency) return {};
  return {
    fxRate: "1",
    functionalCurrency: currency,
    functionalAmount: amount,
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerFinancialSubledgerRoutes(deps: {
  platformStore: BudgetPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
    // ------------------------------------------------------------------
    // POST /api/v1/financial-invoices
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-invoices", async (request, reply) => {
      requireRoles(request, "finance", "integration");
      const body = parse(createFinancialInvoiceSchema, request.body);
      const tenantId = tenantOf(request);
      const documentId = body.documentId ?? `INV-${randomUUID()}`;
      // 迁移 112：税额由服务端 1e6 定点计算，客户端 taxAmount 必须一致。
      const taxAmount =
        body.taxRate === undefined
          ? undefined
          : computeTaxAmount(body.amount, body.taxRate);
      if (body.taxAmount !== undefined) {
        if (taxAmount === undefined) {
          throw new ConflictError(
            "TAX_RATE_REQUIRED: taxAmount cannot be supplied without taxRate",
          );
        }
        if (normalizeAmount(body.taxAmount) !== taxAmount) {
          throw new ConflictError(
            `TAX_AMOUNT_INCONSISTENT: expected ${taxAmount} for amount ${body.amount} at taxRate ${body.taxRate}%, got ${body.taxAmount}`,
          );
        }
      }
      const functional = planFunctional({
        amount: body.amount,
        currency: body.currency,
        functionalCurrency: body.functionalCurrency,
        fxRate: body.fxRate,
        functionalAmount: body.functionalAmount,
      });
      const fact = await platformStore.createFinancialFact({
        tenantId,
        sourceSystem: SUBLEDGER_SOURCE,
        sourceRecordId: documentId,
        factType: "INVOICE",
        amount: normalizeAmount(body.amount),
        currency: body.currency,
        qualityStatus: "VALID",
        payload: {
          documentType: "INVOICE",
          documentId,
          issuedAt: body.issuedAt,
          taxRate:
            body.taxRate === undefined ? undefined : normalizePercent(body.taxRate),
          taxAmount,
        },
        legalEntityId: body.legalEntityId,
        orderId: body.orderId,
        contractRef: body.contractRef,
        instrumentType: "INVOICE",
        recognitionStatus: "POSTED",
        accountingPeriod: body.accountingPeriod,
        fxSnapshot:
          body.currency !== body.functionalCurrency && functional.fxRate
            ? {
                rate: functional.fxRate,
                quoteCurrency: body.functionalCurrency,
                source: "manual",
                asOf: body.issuedAt ?? new Date().toISOString(),
              }
            : undefined,
        sourceVersion: body.sourceVersion,
        documentType: "INVOICE",
        documentId,
        fxRate: functional.fxRate,
        functionalCurrency: functional.functionalCurrency,
        functionalAmount: functional.functionalAmount,
        taxRate:
          body.taxRate === undefined ? undefined : normalizePercent(body.taxRate),
        taxAmount,
      });
      await postJournalForFact(
        platformStore,
        tenantId,
        fact,
        `Invoice ${documentId}`,
      );
      return reply.status(201).send(data(fact, request));
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-payments
    // 收款为正、退款为负；金额符号完全由 documentType 决定。
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-payments", async (request, reply) => {
      requireRoles(request, "finance", "integration");
      const body = parse(createFinancialPaymentSchema, request.body);
      const tenantId = tenantOf(request);
      const invoice = await requireInvoice(
        platformStore,
        tenantId,
        body.relatedFactId,
      );
      const documentType = body.documentType ?? "PAYMENT";
      const negative = documentType === "REFUND";
      const currency = body.currency ?? invoice.currency;
      const signedAmount = negative
        ? negate(body.amount)
        : normalizeAmount(body.amount);
      const functional = planFunctional({
        amount: signedAmount,
        currency,
        functionalCurrency:
          body.functionalCurrency ??
          invoice.functionalCurrency ??
          (currency === invoice.currency ? currency : undefined),
        fxRate:
          body.fxRate ??
          (currency === invoice.currency ? invoice.fxRate : undefined),
        functionalAmount:
          body.functionalAmount === undefined
            ? undefined
            : negative
              ? negate(body.functionalAmount)
              : normalizeAmount(body.functionalAmount),
      });
      const documentId =
        body.documentId ??
        `${negative ? "REF" : "PAY"}-${randomUUID()}`;
      const fact = await platformStore.createFinancialFact({
        tenantId,
        sourceSystem: SUBLEDGER_SOURCE,
        sourceRecordId: documentId,
        factType: documentType,
        amount: signedAmount,
        currency,
        qualityStatus: "VALID",
        payload: {
          documentType,
          documentId,
          relatedFactId: invoice.id,
          invoiceDocumentId: invoice.documentId,
          paidAt: body.paidAt,
        },
        legalEntityId: body.legalEntityId ?? invoice.legalEntityId,
        orderId: invoice.orderId,
        contractRef: invoice.contractRef,
        instrumentType: documentType,
        recognitionStatus: "POSTED",
        accountingPeriod: body.accountingPeriod ?? invoice.accountingPeriod,
        fxSnapshot:
          functional.functionalCurrency &&
          currency !== functional.functionalCurrency &&
          functional.fxRate
            ? {
                rate: functional.fxRate,
                quoteCurrency: functional.functionalCurrency,
                source: "manual",
                asOf: body.paidAt ?? new Date().toISOString(),
              }
            : undefined,
        sourceVersion: body.sourceVersion,
        documentType,
        documentId,
        relatedFactId: invoice.id,
        fxRate: functional.fxRate,
        functionalCurrency: functional.functionalCurrency,
        functionalAmount: functional.functionalAmount,
      });
      await postJournalForFact(
        platformStore,
        tenantId,
        fact,
        `${documentType} ${documentId}`,
      );
      return reply.status(201).send(data(fact, request));
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-facts/:id/reverse
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-facts/:id/reverse", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(reverseFinancialFactSchema, request.body);
      const tenantId = tenantOf(request);
      const original = await platformStore.getFinancialFact(
        tenantId,
        idOf(request),
      );
      if (original.recognitionStatus !== "POSTED") {
        throw new ConflictError(
          `POSTED_FACT_REQUIRED: fact ${original.id} is ${original.recognitionStatus}`,
        );
      }
      const priorReversals = await platformStore.listFinancialFacts(tenantId, {
        relatedFactId: original.id,
        documentType: "REVERSAL",
      });
      if (priorReversals.length > 0) {
        throw new ConflictError(
          `FACT_ALREADY_REVERSED: fact ${original.id} already has a reversal`,
        );
      }
      const currency = original.currency;
      const functionalCurrency = original.functionalCurrency ?? currency;
      const documentId = `REV-${original.id}`;
      const fact = await platformStore.createFinancialFact({
        tenantId,
        sourceSystem: SUBLEDGER_SOURCE,
        sourceRecordId: documentId,
        factType: "REVERSAL",
        amount: negate(original.amount),
        currency,
        qualityStatus: "VALID",
        payload: {
          documentType: "REVERSAL",
          documentId,
          relatedFactId: original.id,
          originalDocumentType: original.documentType,
          originalDocumentId: original.documentId,
          reason: body.reason,
        },
        legalEntityId: body.legalEntityId ?? original.legalEntityId,
        orderId: original.orderId,
        contractRef: original.contractRef,
        instrumentType: original.instrumentType ?? "INVOICE",
        recognitionStatus: "POSTED",
        accountingPeriod: body.accountingPeriod ?? original.accountingPeriod,
        fxSnapshot: original.fxSnapshot,
        sourceVersion: body.sourceVersion,
        reversalOf: original.id,
        documentType: "REVERSAL",
        documentId,
        relatedFactId: original.id,
        fxRate: original.fxRate,
        functionalCurrency,
        functionalAmount: negate(
          original.functionalAmount ?? original.amount,
        ),
      });
      // 冲销凭证 = 原凭证借贷互换，保证同一 chain 借贷仍平衡。
      const originalPlan = planJournalForFact(original);
      if (
        originalPlan.length > 0 &&
        fact.documentType &&
        fact.documentId &&
        fact.accountingPeriod &&
        fact.legalEntityId
      ) {
        await platformStore.createJournalEntry({
          tenantId,
          documentType: "REVERSAL",
          documentId: fact.documentId,
          legalEntityId: fact.legalEntityId,
          accountingPeriod: fact.accountingPeriod,
          currency: fact.currency,
          description: `Reversal of ${original.documentType ?? original.factType} ${original.id}`,
          sourceFactId: fact.id,
          lines: reverseJournalLines(originalPlan),
        });
      }
      return reply.status(201).send(data(fact, request));
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-revaluations
    // 金额 = 原币金额 × (新汇率 - 原汇率)，以功能币计价。
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-revaluations", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createFinancialRevaluationSchema, request.body);
      const tenantId = tenantOf(request);
      const original = await platformStore.getFinancialFact(
        tenantId,
        body.factId,
      );
      if (original.recognitionStatus !== "POSTED") {
        throw new ConflictError(
          `POSTED_FACT_REQUIRED: fact ${original.id} is ${original.recognitionStatus}`,
        );
      }
      const oldRate =
        original.fxRate ?? original.fxSnapshot?.rate ?? "1";
      const delta = formatDecimal(
        divRound(
          parseDecimal(original.amount) *
            (parseDecimal(body.fxRate) - parseDecimal(oldRate)),
          SCALE,
          "HALF_UP",
        ),
      );
      const newRate = normalizeAmount(body.fxRate);
      const functionalCurrency = body.functionalCurrency.trim();
      const documentId = `FXREV-${original.id}-${newRate}`;
      const fact = await platformStore.createFinancialFact({
        tenantId,
        sourceSystem: SUBLEDGER_SOURCE,
        sourceRecordId: documentId,
        factType: "FX_REVALUATION",
        amount: delta,
        currency: functionalCurrency,
        qualityStatus: "VALID",
        payload: {
          documentType: "FX_REVALUATION",
          documentId,
          relatedFactId: original.id,
          originalDocumentId: original.documentId,
          oldRate,
          newRate,
          reason: body.reason,
        },
        legalEntityId: original.legalEntityId,
        orderId: original.orderId,
        contractRef: original.contractRef,
        instrumentType: original.instrumentType ?? "INVOICE",
        recognitionStatus: "POSTED",
        accountingPeriod: original.accountingPeriod,
        fxSnapshot: {
          rate: newRate,
          quoteCurrency: functionalCurrency,
          source: "FX_REVALUATION",
          asOf: new Date().toISOString(),
        },
        sourceVersion: "1",
        documentType: "FX_REVALUATION",
        documentId,
        relatedFactId: original.id,
        fxRate: newRate,
        functionalCurrency,
        functionalAmount: delta,
      });
      await postJournalForFact(
        platformStore,
        tenantId,
        fact,
        `FX revaluation ${documentId}`,
      );
      return reply.status(201).send(data(fact, request));
    });

    // ------------------------------------------------------------------
    // GET /api/v1/financial-subledger/aging
    // ------------------------------------------------------------------
    app.get("/api/v1/financial-subledger/aging", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = parse(financialAgingQuerySchema, request.query);
      const tenantId = tenantOf(request);
      const asOf = query.asOf ?? todayIsoDate();
      const facts = await platformStore.listFinancialFacts(tenantId, {
        legalEntityId: query.legalEntityId,
        recognitionStatus: "POSTED",
      });
      const invoices = facts.filter(
        (fact) => fact.documentType === "INVOICE",
      );
      const related = facts.filter((fact) =>
        [
          "PAYMENT",
          "REFUND",
          "REVERSAL",
          "BAD_DEBT_WRITE_OFF",
        ].includes(fact.documentType ?? ""),
      );
      const aging = buildAging(invoices, related, asOf);
      return data(
        {
          legalEntityId: query.legalEntityId,
          asOf,
          buckets: FINANCIAL_AGING_BUCKETS,
          invoices: aging.rows,
          totals: aging.totals,
        },
        request,
      );
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-bad-debt/provision
    // 按账龄矩阵逐张发票计提；已计提（同发票 + 同期间）幂等跳过。
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-bad-debt/provision", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(financialBadDebtProvisionSchema, request.body);
      const tenantId = tenantOf(request);
      const asOf = body.asOf ?? todayIsoDate();
      const facts = await platformStore.listFinancialFacts(tenantId, {
        legalEntityId: body.legalEntityId,
        recognitionStatus: "POSTED",
      });
      const invoices = facts.filter(
        (fact) =>
          fact.documentType === "INVOICE" &&
          (!body.currency || fact.currency === body.currency),
      );
      const related = facts.filter((fact) =>
        [
          "PAYMENT",
          "REFUND",
          "REVERSAL",
          "BAD_DEBT_WRITE_OFF",
        ].includes(fact.documentType ?? ""),
      );
      const aging = buildAging(invoices, related, asOf);
      const matrix: Record<FinancialAgingBucket, number> = {
        ...DEFAULT_PROVISION_MATRIX,
        ...(body.matrix ?? {}),
      };
      const existingByInvoice = new Map<string, FinancialFact>();
      for (const fact of facts) {
        if (fact.documentType !== "BAD_DEBT_PROVISION") continue;
        if (fact.accountingPeriod !== body.accountingPeriod) continue;
        if (fact.relatedFactId) {
          existingByInvoice.set(fact.relatedFactId, fact);
        }
      }
      const created: FinancialFact[] = [];
      const skipped: Array<{ invoiceFactId: string; provisionFactId: string }> =
        [];
      const totalsByCurrency = new Map<string, bigint>();
      for (const row of aging.rows) {
        const invoice = aging.invoiceById.get(row.invoiceFactId);
        if (!invoice) continue;
        const existing = existingByInvoice.get(invoice.id);
        if (existing) {
          skipped.push({
            invoiceFactId: invoice.id,
            provisionFactId: existing.id,
          });
          continue;
        }
        if (parseDecimal(row.openAmount) <= 0n) continue;
        const rate = matrix[row.bucket];
        if (rate <= 0) continue;
        const provisionAmount = percentOf(row.openAmount, rate);
        if (parseDecimal(provisionAmount) <= 0n) continue;
        const documentId = `PROV-${invoice.id}-${body.accountingPeriod}`;
        const functional = sameCurrencyFunctional(
          invoice.currency,
          invoice.functionalCurrency,
          provisionAmount,
        );
        const fact = await platformStore.createFinancialFact({
          tenantId,
          sourceSystem: SUBLEDGER_SOURCE,
          sourceRecordId: documentId,
          factType: "BAD_DEBT_PROVISION",
          amount: provisionAmount,
          currency: invoice.currency,
          qualityStatus: "VALID",
          payload: {
            documentType: "BAD_DEBT_PROVISION",
            documentId,
            relatedFactId: invoice.id,
            bucket: row.bucket,
            rate: normalizePercent(rate),
            openAmount: row.openAmount,
            asOf,
          },
          legalEntityId: body.legalEntityId,
          orderId: invoice.orderId,
          contractRef: invoice.contractRef,
          instrumentType: "INVOICE",
          recognitionStatus: "POSTED",
          accountingPeriod: body.accountingPeriod,
          sourceVersion: body.sourceVersion,
          documentType: "BAD_DEBT_PROVISION",
          documentId,
          relatedFactId: invoice.id,
          fxRate: functional.fxRate,
          functionalCurrency: functional.functionalCurrency,
          functionalAmount: functional.functionalAmount,
        });
        await postJournalForFact(
          platformStore,
          tenantId,
          fact,
          `Bad debt provision ${documentId}`,
        );
        created.push(fact);
        existingByInvoice.set(invoice.id, fact);
        totalsByCurrency.set(
          invoice.currency,
          (totalsByCurrency.get(invoice.currency) ?? 0n) +
            parseDecimal(provisionAmount),
        );
      }
      return reply.status(201).send(
        data(
          {
            legalEntityId: body.legalEntityId,
            accountingPeriod: body.accountingPeriod,
            asOf,
            matrix,
            invoices: aging.rows,
            provisions: created,
            skipped,
            totals: [...totalsByCurrency.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([currency, amount]) => ({
                currency,
                provisionAmount: formatDecimal(amount),
              })),
          },
          request,
        ),
      );
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-bad-debt/write-off
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-bad-debt/write-off", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(financialBadDebtWriteOffSchema, request.body);
      const tenantId = tenantOf(request);
      const invoice = await requireInvoice(
        platformStore,
        tenantId,
        body.invoiceFactId,
      );
      if (
        body.legalEntityId &&
        invoice.legalEntityId &&
        body.legalEntityId !== invoice.legalEntityId
      ) {
        throw new ConflictError(
          `LEGAL_ENTITY_MISMATCH: invoice ${invoice.id} belongs to ${invoice.legalEntityId}, not ${body.legalEntityId}`,
        );
      }
      const related = await platformStore.listFinancialFacts(tenantId, {
        relatedFactId: invoice.id,
      });
      if (related.some((fact) => fact.documentType === "BAD_DEBT_WRITE_OFF")) {
        throw new ConflictError(
          `INVOICE_ALREADY_WRITTEN_OFF: invoice ${invoice.id} already has a write-off`,
        );
      }
      const settlement = settleInvoice(invoice, related);
      if (settlement.open <= 0n) {
        throw new ConflictError(
          `NOTHING_TO_WRITE_OFF: invoice ${invoice.id} has open amount ${formatDecimal(settlement.open)}`,
        );
      }
      const amount = formatDecimal(settlement.open);
      const accountingPeriod =
        body.accountingPeriod ?? invoice.accountingPeriod;
      const documentId = `WO-${invoice.id}`;
      const functional = sameCurrencyFunctional(
        invoice.currency,
        invoice.functionalCurrency,
        amount,
      );
      const fact = await platformStore.createFinancialFact({
        tenantId,
        sourceSystem: SUBLEDGER_SOURCE,
        sourceRecordId: documentId,
        factType: "BAD_DEBT_WRITE_OFF",
        amount,
        currency: invoice.currency,
        qualityStatus: "VALID",
        payload: {
          documentType: "BAD_DEBT_WRITE_OFF",
          documentId,
          relatedFactId: invoice.id,
          openAmountBefore: amount,
          reason: body.reason,
        },
        legalEntityId: invoice.legalEntityId,
        orderId: invoice.orderId,
        contractRef: invoice.contractRef,
        instrumentType: "INVOICE",
        recognitionStatus: "POSTED",
        accountingPeriod,
        sourceVersion: body.sourceVersion,
        documentType: "BAD_DEBT_WRITE_OFF",
        documentId,
        relatedFactId: invoice.id,
        fxRate: functional.fxRate,
        functionalCurrency: functional.functionalCurrency,
        functionalAmount: functional.functionalAmount,
      });
      await postJournalForFact(
        platformStore,
        tenantId,
        fact,
        `Bad debt write-off ${documentId}`,
      );
      return reply.status(201).send(
        data(
          {
            ...fact,
            openAmountBefore: amount,
            openAmountAfter: "0",
          },
          request,
        ),
      );
    });

    // ------------------------------------------------------------------
    // GET /api/v1/financial-subledger/reconciliation
    // 子账（financial-subledger）vs ERP 来源事实，按 documentType + 币种。
    // ------------------------------------------------------------------
    app.get("/api/v1/financial-subledger/reconciliation", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = parse(financialReconciliationQuerySchema, request.query);
      const tenantId = tenantOf(request);
      const subledgerFacts = await platformStore.listFinancialFacts(tenantId, {
        legalEntityId: query.legalEntityId,
        accountingPeriod: query.period,
        sourceSystem: SUBLEDGER_SOURCE,
        recognitionStatus: "POSTED",
      });
      const erpFacts = await platformStore.listFinancialFacts(tenantId, {
        legalEntityId: query.legalEntityId,
        accountingPeriod: query.period,
        sourceSystem: query.sourceSystem,
        recognitionStatus: "POSTED",
      });
      const groupKey = (documentType: string, currency: string) =>
        `${documentType}|${currency}`;
      const subledger = new Map<string, bigint>();
      for (const fact of subledgerFacts) {
        const documentType = fact.documentType;
        if (!documentType || !RECONCILED_DOCUMENT_TYPES.has(documentType)) {
          continue;
        }
        const key = groupKey(documentType, fact.currency);
        subledger.set(key, (subledger.get(key) ?? 0n) + parseDecimal(fact.amount));
      }
      const erp = new Map<string, bigint>();
      for (const fact of erpFacts) {
        const documentType = fact.documentType ?? fact.factType;
        if (!RECONCILED_DOCUMENT_TYPES.has(documentType)) continue;
        const key = groupKey(documentType, fact.currency);
        erp.set(key, (erp.get(key) ?? 0n) + parseDecimal(fact.amount));
      }
      const keys = [...new Set([...subledger.keys(), ...erp.keys()])].sort();
      const rows = keys.map((key) => {
        const [documentType = "", currency = ""] = key.split("|");
        const subledgerAmount = subledger.get(key) ?? 0n;
        const erpAmount = erp.get(key) ?? 0n;
        const difference = subledgerAmount - erpAmount;
        return {
          documentType,
          currency,
          subledgerAmount: formatDecimal(subledgerAmount),
          erpAmount: formatDecimal(erpAmount),
          difference: formatDecimal(difference),
          status: difference === 0n ? "PASS" : "VARIANCE",
        };
      });
      const totalsByCurrency = new Map<
        string,
        { subledger: bigint; erp: bigint }
      >();
      for (const row of rows) {
        const total = totalsByCurrency.get(row.currency) ?? {
          subledger: 0n,
          erp: 0n,
        };
        total.subledger += parseDecimal(row.subledgerAmount);
        total.erp += parseDecimal(row.erpAmount);
        totalsByCurrency.set(row.currency, total);
      }
      const totals = [...totalsByCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, value]) => {
          const difference = value.subledger - value.erp;
          return {
            currency,
            subledgerAmount: formatDecimal(value.subledger),
            erpAmount: formatDecimal(value.erp),
            difference: formatDecimal(difference),
            status: difference === 0n ? "PASS" : "VARIANCE",
          };
        });
      const status = rows.every((row) => row.status === "PASS")
        ? "PASS"
        : "VARIANCE";
      return data(
        {
          period: query.period,
          legalEntityId: query.legalEntityId,
          sourceSystem: query.sourceSystem,
          rows,
          totals,
          status,
        },
        request,
      );
    });

    // ------------------------------------------------------------------
    // GET /api/v1/financial-journals?documentId=...
    // ------------------------------------------------------------------
    app.get("/api/v1/financial-journals", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = parse(financialJournalQuerySchema, request.query);
      const journals = await platformStore.listJournals(
        tenantOf(request),
        query,
      );
      return data({ journals }, request);
    });

    // ------------------------------------------------------------------
    // POST /api/v1/financial-journals
    // 手工复式凭证：期间关闭 → 409；借贷不等 → 409（store 层校验）。
    // ------------------------------------------------------------------
    app.post("/api/v1/financial-journals", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createGlJournalSchema, request.body);
      const tenantId = tenantOf(request);
      const existing = await platformStore.listJournals(tenantId, {
        documentType: body.documentType,
        documentId: body.documentId,
      });
      if (existing.length > 0) {
        throw new ConflictError(
          `DUPLICATE_JOURNAL: ${body.documentType}/${body.documentId} already has a journal`,
        );
      }
      const period = await platformStore.getAccountingPeriod(
        tenantId,
        body.legalEntityId,
        body.accountingPeriod,
      );
      if (period?.status === "CLOSED") {
        throw new ConflictError(
          `PERIOD_CLOSED: ${body.legalEntityId}/${body.accountingPeriod} is closed`,
        );
      }
      const journal = await platformStore.createJournalEntry({
        tenantId,
        documentType: body.documentType,
        documentId: body.documentId,
        legalEntityId: body.legalEntityId,
        accountingPeriod: body.accountingPeriod,
        currency: body.currency,
        description: body.description,
        sourceFactId: body.sourceFactId,
        lines: body.lines,
      });
      return reply.status(201).send(data(journal, request));
    });

    // ------------------------------------------------------------------
    // GET /api/v1/financial-gl-accounts
    // ------------------------------------------------------------------
    app.get("/api/v1/financial-gl-accounts", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listGlAccounts(tenantOf(request)),
        request,
      );
    });

    // ------------------------------------------------------------------
    // GET /api/v1/financial-subledger?orderId=... / contractRef=...
    // ------------------------------------------------------------------
    app.get("/api/v1/financial-subledger", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = parse(financialSubledgerQuerySchema, request.query);
      const facts = await platformStore.listFinancialFacts(tenantOf(request), {
        orderId: query.orderId,
        contractRef: query.contractRef,
      });
      const byType = (type: FinancialFact["documentType"]) =>
        facts.filter((fact) => fact.documentType === type);
      const invoices = byType("INVOICE");
      const payments = byType("PAYMENT");
      const refunds = byType("REFUND");
      const revaluations = byType("FX_REVALUATION");
      const reversals = byType("REVERSAL");
      const badDebtProvisions = byType("BAD_DEBT_PROVISION");
      const badDebtWriteOffs = byType("BAD_DEBT_WRITE_OFF");
      const documented = new Set([
        ...invoices,
        ...payments,
        ...refunds,
        ...revaluations,
        ...reversals,
        ...badDebtProvisions,
        ...badDebtWriteOffs,
      ]);
      const other = facts.filter((fact) => !documented.has(fact));
      const chain = [...facts].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.ingestedAt.localeCompare(right.ingestedAt),
      );

      const buckets = new Map<
        string,
        {
          invoiced: bigint;
          paid: bigint;
          refunded: bigint;
          revalued: bigint;
          reversed: bigint;
          provisioned: bigint;
          writtenOff: bigint;
          net: bigint;
        }
      >();
      const bucket = (currency: string) => {
        let value = buckets.get(currency);
        if (!value) {
          value = {
            invoiced: 0n,
            paid: 0n,
            refunded: 0n,
            revalued: 0n,
            reversed: 0n,
            provisioned: 0n,
            writtenOff: 0n,
            net: 0n,
          };
          buckets.set(currency, value);
        }
        return value;
      };
      for (const fact of facts) {
        const totals = bucket(fact.currency);
        const amount = parseDecimal(fact.amount);
        totals.net += amount;
        if (fact.documentType === "INVOICE") totals.invoiced += amount;
        if (fact.documentType === "PAYMENT") totals.paid += amount;
        if (fact.documentType === "REFUND") totals.refunded += amount;
        if (fact.documentType === "FX_REVALUATION") totals.revalued += amount;
        if (fact.documentType === "REVERSAL") totals.reversed += amount;
        if (fact.documentType === "BAD_DEBT_PROVISION") {
          totals.provisioned += amount;
        }
        if (fact.documentType === "BAD_DEBT_WRITE_OFF") {
          totals.writtenOff += amount;
        }
      }
      const totals = Object.fromEntries(
        [...buckets.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, value]) => [
            currency,
            {
              invoiced: formatDecimal(value.invoiced),
              paid: formatDecimal(value.paid),
              refunded: formatDecimal(value.refunded),
              revalued: formatDecimal(value.revalued),
              reversed: formatDecimal(value.reversed),
              provisioned: formatDecimal(value.provisioned),
              writtenOff: formatDecimal(value.writtenOff),
              net: formatDecimal(value.net),
            },
          ]),
      );

      return data(
        {
          orderId: query.orderId ?? null,
          contractRef: query.contractRef ?? null,
          invoices,
          payments,
          refunds,
          revaluations,
          reversals,
          badDebtProvisions,
          badDebtWriteOffs,
          other,
          chain,
          totals,
        },
        request,
      );
    });
  };
}
