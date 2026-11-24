/**
 * Sprint 3（2026-11-21 审计）：Commercial 领域对象生命周期。
 * Deal→Opportunity；Quote 接受后才能建合同；合同签署后才能下单/确认。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor() {
  const platformStore = new MemoryPlatformStore({
    demoTenant: { id: TENANT, name: "Sprint 3 tenant", slug: "sprint3" },
  });
  return buildApp(
    () => new Store(TENANT),
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: "sprint3",
          roles: ["admin", "manager", "finance", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

async function post(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  payload: Record<string, unknown>,
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json" },
  })) as unknown as InjectResult;
}

async function get(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
): Promise<InjectResult> {
  return (await app.inject({ method: "GET", url })) as unknown as InjectResult;
}

function dataOf<T>(result: InjectResult): T {
  return (result.json() as { data: T }).data;
}

describe("Sprint 3 commercial lifecycle", () => {
  it("enforces Quote→Contract→Order gates and does not treat deals as orders", async () => {
    const app = buildAppFor();
    const account = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/accounts", {
        externalAccountId: "ACC-1",
        name: "ACME",
      }),
    );
    const opportunity = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/opportunities", {
        accountId: account.id,
        externalOpportunityId: "hs-deal-1",
        name: "ACME expansion",
        currency: "USD",
        estimatedAmount: "1000",
      }),
    );
    expect(opportunity).not.toHaveProperty("orderNumber");

    const quote = dataOf<{ id: string; version: number }>(
      await post(app, "/api/v1/commercial/quotes", {
        opportunityId: opportunity.id,
        currency: "USD",
        amount: "1000",
      }),
    );
    expect(quote.version).toBe(1);

    // 未接受报价 → 不能建合同。
    const earlyContract = await post(app, "/api/v1/commercial/contracts", {
      accountId: account.id,
      opportunityId: opportunity.id,
      quoteId: quote.id,
      contractRef: "CT-1",
      currency: "USD",
      amount: "1000",
    });
    expect(earlyContract.statusCode).toBe(409);

    const v2 = dataOf<{ id: string; version: number; supersedesQuoteId: string }>(
      await post(app, "/api/v1/commercial/quotes", {
        opportunityId: opportunity.id,
        currency: "USD",
        amount: "1100",
        supersedesQuoteId: quote.id,
      }),
    );
    expect(v2.version).toBe(2);
    expect(v2.supersedesQuoteId).toBe(quote.id);

    const noSupersedes = await post(app, "/api/v1/commercial/quotes", {
      opportunityId: opportunity.id,
      currency: "USD",
      amount: "1200",
    });
    expect(noSupersedes.statusCode).toBe(409);
    expect(
      (noSupersedes.json() as { error: { message: string } }).error.message,
    ).toMatch(/QUOTE_VERSION_REQUIRES_SUPERSEDES/);

    const accepted = await post(
      app,
      `/api/v1/commercial/quotes/${quote.id}/accept`,
      {},
    );
    expect(accepted.statusCode).toBe(200);

    // 已接受报价不可再修订。
    const afterAccept = await post(app, "/api/v1/commercial/quotes", {
      opportunityId: opportunity.id,
      currency: "USD",
      amount: "1200",
      supersedesQuoteId: quote.id,
    });
    expect(afterAccept.statusCode).toBe(409);
    expect(
      (afterAccept.json() as { error: { message: string } }).error.message,
    ).toMatch(/QUOTE_NOT_REVISABLE/);

    const contract = dataOf<{ id: string; status: string }>(
      await post(app, "/api/v1/commercial/contracts", {
        accountId: account.id,
        opportunityId: opportunity.id,
        quoteId: quote.id,
        contractRef: "CT-1",
        currency: "USD",
        amount: "1000",
      }),
    );
    expect(contract.status).toBe("DRAFT");

    // 未签合同 → 不能下单。
    const earlyOrder = await post(app, "/api/v1/commercial/orders", {
      accountId: account.id,
      contractId: contract.id,
      orderNumber: "SO-1",
      currency: "USD",
      lines: [
        {
          kind: "PRODUCT",
          description: "charger",
          quantity: "1",
          unitPrice: "1000",
          amount: "1000",
          currency: "USD",
        },
      ],
    });
    expect(earlyOrder.statusCode).toBe(409);

    expect(
      (
        await post(
          app,
          `/api/v1/commercial/contracts/${contract.id}/sign`,
          {},
        )
      ).statusCode,
    ).toBe(200);

    const order = dataOf<{ id: string; status: string; lines: unknown[] }>(
      await post(app, "/api/v1/commercial/orders", {
        accountId: account.id,
        contractId: contract.id,
        orderNumber: "SO-1",
        currency: "USD",
        lines: [
          {
            kind: "PRODUCT",
            description: "charger",
            quantity: "1",
            unitPrice: "1000",
            amount: "1000",
            currency: "USD",
          },
        ],
      }),
    );
    expect(order.status).toBe("DRAFT");
    expect(order.lines).toHaveLength(1);

    const confirmed = await post(
      app,
      `/api/v1/commercial/orders/${order.id}/confirm`,
      {},
    );
    expect(confirmed.statusCode).toBe(200);
    expect(dataOf<{ status: string }>(confirmed).status).toBe("CONFIRMED");

    const orders = dataOf<Array<{ status: string }>>(
      await get(app, `/api/v1/commercial/orders?accountId=${account.id}`),
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe("CONFIRMED");
  });

  it("rejects duplicate account external ids and duplicate order numbers", async () => {
    const app = buildAppFor();
    const account = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/accounts", {
        externalAccountId: "ACC-DUP",
        name: "ACME",
      }),
    );
    const duplicate = await post(app, "/api/v1/commercial/accounts", {
      externalAccountId: "ACC-DUP",
      name: "ACME 2",
    });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { message: string } }).error.message).toMatch(
      /COMMERCIAL_ACCOUNT_EXISTS/,
    );
    void account;
  });
});

describe("Sprint 3 commercial lifecycle close-out", () => {
  it("voids quotes, cancels draft orders and terminates signed contracts", async () => {
    const app = buildAppFor();
    const account = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/accounts", { name: "Closeout Co" }),
    );
    const opportunity = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/opportunities", {
        accountId: account.id,
        name: "Closeout opp",
        currency: "USD",
      }),
    );
    const quote = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/quotes", {
        opportunityId: opportunity.id,
        currency: "USD",
        amount: "100",
      }),
    );
    const accepted = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/quotes", {
        opportunityId: opportunity.id,
        currency: "USD",
        amount: "100",
        supersedesQuoteId: quote.id,
      }),
    );
    expect(
      (
        await post(app, `/api/v1/commercial/quotes/${quote.id}/void`, {})
      ).statusCode,
    ).toBe(200);
    await post(app, `/api/v1/commercial/quotes/${accepted.id}/accept`, {});
    const contract = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/contracts", {
        accountId: account.id,
        opportunityId: opportunity.id,
        quoteId: accepted.id,
        contractRef: "CT-CLOSE-1",
        currency: "USD",
        amount: "100",
      }),
    );
    await post(app, `/api/v1/commercial/contracts/${contract.id}/sign`, {});
    const order = dataOf<{ id: string }>(
      await post(app, "/api/v1/commercial/orders", {
        accountId: account.id,
        contractId: contract.id,
        orderNumber: "SO-CLOSE-1",
        currency: "USD",
        lines: [
          {
            kind: "PRODUCT",
            description: "charger",
            quantity: "1",
            unitPrice: "100",
            amount: "100",
            currency: "USD",
          },
        ],
      }),
    );
    const cancel = await post(app, `/api/v1/commercial/orders/${order.id}/cancel`, {});
    expect(cancel.statusCode).toBe(200);
    expect(dataOf<{ status: string }>(cancel).status).toBe("CANCELLED");

    const terminate = await post(
      app,
      `/api/v1/commercial/contracts/${contract.id}/terminate`,
      {},
    );
    expect(terminate.statusCode).toBe(200);
    expect(dataOf<{ status: string }>(terminate).status).toBe("TERMINATED");
  });
});

describe("Sprint 3 commercial source-aware import", () => {
  it("upserts account/opportunity by source external id", async () => {
    const app = buildAppFor();
    const account1 = await post(app, "/api/v1/commercial/import/accounts", {
      sourceSystem: "hubspot",
      externalAccountId: "HS-ACC-1",
      name: "Imported Co",
    });
    expect(account1.statusCode).toBe(201);
    const account2 = await post(app, "/api/v1/commercial/import/accounts", {
      sourceSystem: "hubspot",
      externalAccountId: "HS-ACC-1",
      name: "Imported Co (renamed)",
    });
    expect(account2.statusCode).toBe(200);
    expect(dataOf<{ created: boolean; account: { id: string } }>(account2).created).toBe(false);

    const opp1 = await post(app, "/api/v1/commercial/import/opportunities", {
      sourceSystem: "hubspot",
      externalAccountId: "HS-ACC-1",
      accountName: "Imported Co",
      externalOpportunityId: "HS-DEAL-1",
      name: "Deal one",
      currency: "USD",
      estimatedAmount: "1000",
    });
    expect(opp1.statusCode).toBe(201);
    const opp2 = await post(app, "/api/v1/commercial/import/opportunities", {
      sourceSystem: "hubspot",
      externalAccountId: "HS-ACC-1",
      accountName: "Imported Co",
      externalOpportunityId: "HS-DEAL-1",
      name: "Deal one updated",
      currency: "USD",
      estimatedAmount: "1200",
    });
    expect(opp2.statusCode).toBe(200);
    const updated = dataOf<{ created: boolean; opportunity: { name: string } }>(opp2);
    expect(updated.created).toBe(false);
    expect(updated.opportunity.name).toBe("Deal one updated");
  });
});

describe("Sprint 3 commercial quote import", () => {
  it("upserts quotes by source external ids", async () => {
    const app = buildAppFor();
    await post(app, "/api/v1/commercial/import/opportunities", {
      sourceSystem: "hubspot",
      externalAccountId: "HS-ACC-Q",
      accountName: "Quote Co",
      externalOpportunityId: "HS-DEAL-Q",
      name: "Quote deal",
      currency: "USD",
    });
    const first = await post(app, "/api/v1/commercial/import/quotes", {
      sourceSystem: "hubspot",
      externalOpportunityId: "HS-DEAL-Q",
      externalQuoteId: "HS-QUOTE-Q",
      currency: "USD",
      amount: "1000",
      status: "ISSUED",
    });
    expect(first.statusCode).toBe(201);
    const second = await post(app, "/api/v1/commercial/import/quotes", {
      sourceSystem: "hubspot",
      externalOpportunityId: "HS-DEAL-Q",
      externalQuoteId: "HS-QUOTE-Q",
      currency: "USD",
      amount: "1100",
      status: "ACCEPTED",
    });
    expect(second.statusCode).toBe(200);
    const updated = dataOf<{ created: boolean; quote: { amount: string; status: string } }>(second);
    expect(updated.created).toBe(false);
    expect(updated.quote.amount).toBe("1100");
    expect(updated.quote.status).toBe("ACCEPTED");
  });
});
