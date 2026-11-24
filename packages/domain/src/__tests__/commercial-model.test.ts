import { describe, expect, it } from "vitest";
import {
  assertFinancialFactTraceable,
  assertOrderMayBeConfirmed,
  CommercialLifecycleError,
  opportunityFromCrmDeal,
  reviseQuote,
  type CommercialOrder,
  type Contract,
  type Quote,
} from "../commercial.js";

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: "quote-1",
  tenantId: "tenant-1",
  opportunityId: "opp-1",
  version: 1,
  status: "ACCEPTED",
  currency: "USD",
  amount: "1000",
  issuedAt: "2026-10-01T00:00:00.000Z",
  acceptedAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});

const contract = (overrides: Partial<Contract> = {}): Contract => ({
  id: "contract-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  opportunityId: "opp-1",
  quoteId: "quote-1",
  contractRef: "CT-2026-001",
  status: "SIGNED",
  signedAt: "2026-10-03T00:00:00.000Z",
  currency: "USD",
  amount: "1000",
  ...overrides,
});

const order = (overrides: Partial<CommercialOrder> = {}): CommercialOrder => ({
  id: "order-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  contractId: "contract-1",
  orderNumber: "SO-2026-001",
  status: "DRAFT",
  currency: "USD",
  lines: [
    {
      id: "line-1",
      orderId: "order-1",
      kind: "PRODUCT",
      description: "charger",
      quantity: "2",
      unitPrice: "500",
      amount: "1000",
      currency: "USD",
    },
  ],
  ...overrides,
});

describe("commercial lifecycle", () => {
  it("maps a CRM deal to OPPORTUNITY, never to ORDER", () => {
    const opportunity = opportunityFromCrmDeal({
      tenantId: "tenant-1",
      id: "opp-1",
      accountId: "account-1",
      externalDealId: "hs-123",
      name: "ACME expansion",
      currency: "usd",
    });
    expect(opportunity.stage).toBe("QUALIFIED");
    expect(opportunity.currency).toBe("USD");
    expect(opportunity).not.toHaveProperty("orderNumber");
  });

  it("requires an accepted quote and signed contract before confirming an order", () => {
    expect(() =>
      assertOrderMayBeConfirmed({ order: order(), contract: contract(), quote: quote() }),
    ).not.toThrow();

    expect(() =>
      assertOrderMayBeConfirmed({
        order: order(),
        contract: contract(),
        quote: quote({ status: "ISSUED", acceptedAt: undefined }),
      }),
    ).toThrow(/QUOTE_NOT_ACCEPTED/);

    expect(() =>
      assertOrderMayBeConfirmed({
        order: order(),
        contract: contract({ status: "DRAFT", signedAt: undefined }),
        quote: quote(),
      }),
    ).toThrow(/CONTRACT_NOT_SIGNED/);
  });

  it("rejects orders with no lines or mixed currencies", () => {
    expect(() =>
      assertOrderMayBeConfirmed({
        order: order({ lines: [] }),
        contract: contract(),
        quote: quote(),
      }),
    ).toThrow(/ORDER_LINES_REQUIRED/);

    expect(() =>
      assertOrderMayBeConfirmed({
        order: order({
          lines: [
            {
              id: "line-1",
              orderId: "order-1",
              kind: "PRODUCT",
              description: "charger",
              quantity: "1",
              unitPrice: "500",
              amount: "500",
              currency: "EUR",
            },
          ],
        }),
        contract: contract(),
        quote: quote(),
      }),
    ).toThrow(/ORDER_CURRENCY_MISMATCH/);
  });

  it("keeps quote revisions immutable and versioned", () => {
    const v2 = reviseQuote(quote({ status: "ISSUED", acceptedAt: undefined }), {
      id: "quote-2",
      amount: "1100",
    });
    expect(v2.version).toBe(2);
    expect(v2.supersedesQuoteId).toBe("quote-1");
    expect(() =>
      reviseQuote(quote({ status: "ACCEPTED" }), { id: "quote-3", amount: "1" }),
    ).toThrow(/QUOTE_NOT_REVISABLE/);
  });

  it("requires POSTED financial facts to be traceable to order/contract", () => {
    expect(() =>
      assertFinancialFactTraceable({
        recognitionStatus: "POSTED",
        orderId: "order-1",
        legalEntityId: "LE-1",
        accountingPeriod: "2026-10",
      }),
    ).not.toThrow();
    expect(() =>
      assertFinancialFactTraceable({
        recognitionStatus: "POSTED",
        legalEntityId: "LE-1",
        accountingPeriod: "2026-10",
      }),
    ).toThrow(/FACT_NOT_TRACEABLE/);
    expect(() =>
      assertFinancialFactTraceable({ recognitionStatus: "DRAFT" }),
    ).not.toThrow();
    expect(() => {
      try {
        assertFinancialFactTraceable({ recognitionStatus: "POSTED" });
      } catch (error) {
        expect(error).toBeInstanceOf(CommercialLifecycleError);
        expect((error as CommercialLifecycleError).code).toBe("FACT_NOT_TRACEABLE");
        throw error;
      }
    }).toThrow();
  });
});
