/**
 * 财务子账最小闭环（迁移 111）：发票 / 收款 / 退款 / 冲销 / FX 重估。
 *
 * 设计约束（与 Sprint 5 一致）：
 * - 所有写入都以 recognitionStatus=POSTED 落库，因此完整复用
 *   createFinancialFact 的会计期间门禁（关闭期间 / reopeningRef）；
 * - 原币与功能币双金额全部走 1e6 定点 BigInt，服务端重算并拒绝不一致；
 * - 业务文档 (document_type, document_id) 在租户内唯一，冲销/重估用
 *   relatedFactId 串起可追溯链。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { divRound, formatDecimal, parseDecimal } from "@anari/policy-dsl";
import type { FinancialFact } from "@anari/domain";
import {
  createFinancialInvoiceSchema,
  createFinancialPaymentSchema,
  createFinancialRevaluationSchema,
  financialSubledgerQuerySchema,
  reverseFinancialFactSchema,
} from "@anari/contracts";
import type { BudgetPort } from "../../store-ports.js";
import { ConflictError } from "../../store.js";
import { data, idOf, parse, requireRoles, tenantOf } from "../../http-helpers.js";

const SCALE = 1_000_000n;
const SUBLEDGER_SOURCE = "financial-subledger";

function normalizeAmount(value: string): string {
  return formatDecimal(parseDecimal(value));
}

function multiplyRound(amount: string, rate: string): string {
  return formatDecimal(
    divRound(parseDecimal(amount) * parseDecimal(rate), SCALE, "HALF_UP"),
  );
}

function negate(value: string): string {
  return formatDecimal(-parseDecimal(value));
}

interface FunctionalPlan {
  fxRate?: string;
  functionalCurrency?: string;
  functionalAmount?: string;
}

/**
 * 计算/补齐功能币金额。调用方传入的 functionalAmount 原样保留，交由
 * store 层重算比对（不一致 → 409 FUNCTIONAL_AMOUNT_INCONSISTENT）。
 */
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
      });
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
      return reply.status(201).send(data(fact, request));
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
      const documented = new Set([
        ...invoices,
        ...payments,
        ...refunds,
        ...revaluations,
        ...reversals,
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
          other,
          chain,
          totals,
        },
        request,
      );
    });
  };
}
