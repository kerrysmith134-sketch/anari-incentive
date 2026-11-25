import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LOCAL_PROVIDERS,
  mapCrmStageToOpportunityStage,
  normalizeCommercialAccount,
  normalizeCommercialOrder,
  normalizeCommercialQuote,
  normalizeCrmCompany,
  normalizeCrmDeal,
  normalizeErpApPayment,
  normalizeErpArCollection,
  normalizeHrPerson,
  normalizeTicketRecord,
} from "../index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../../fixtures/connectors/${name}`, import.meta.url)), "utf8"));
const first = <T>(value: T[]): T => {
  if (!value[0]) throw new Error("fixture is empty");
  return value[0];
};
const writes = (value: unknown): Array<{ path: string; body: Record<string, unknown> }> => {
  const list = Array.isArray(value) ? value : [value];
  return list as Array<{ path: string; body: Record<string, unknown> }>;
};

const quote = first((fixture("commercial-quotes.sample.json") as { data: unknown[] }).data);
const order = first((fixture("commercial-orders.sample.json") as { data: unknown[] }).data);
const customer = first((fixture("commercial-customers.sample.json") as { data: unknown[] }).data);
const deal = first((fixture("crm-deals.page1.json") as { deals: unknown[] }).deals);
const company = first((fixture("crm-companies.page1.json") as { companies: unknown[] }).companies);
const ticket = first((fixture("ticketing-ticket-list-page1.json") as { items: unknown[] }).items);
const pingcode = first((fixture("pingcode-work-items.sample.json") as { values: unknown[] }).values);
const pingProvider = LOCAL_PROVIDERS.pingcode!;
const ap = first((fixture("erp-ap-payment-plan.sample.json") as { suggestions: unknown[] }).suggestions);
const ar = first((fixture("erp-ar-collection-plan.sample.json") as { suggestions: unknown[] }).suggestions);
const hrPerson = first((fixture("hr-people.sample.json") as { data: unknown[] }).data);

describe("TDD edge rounds", () => {
  it("round 4: commercial account maps id/name", () => {
    const write = writes(normalizeCommercialAccount(customer))[0]!;
    expect(write.path).toContain("/import/accounts");
    expect(write.body.externalAccountId).toBeTruthy();
    expect(write.body.name).toBeTruthy();
  });

  it("round 5: derived quote IDs are deterministic and prefixed", () => {
    const list = writes(normalizeCommercialQuote(quote));
    expect(list[2]!.body.externalOpportunityId).toMatch(/^CUST-/);
    const again = writes(normalizeCommercialQuote(quote));
    expect(again[2]!.body.externalOpportunityId).toBe(list[2]!.body.externalOpportunityId);
  });

  it("round 6: derived order contract matches order total", () => {
    const list = writes(normalizeCommercialOrder(order));
    const contract = list[3]!;
    const orderWrite = list[4]!;
    const orderLines = orderWrite.body.lines as Array<{ amount: string }>;
    const total = orderLines.reduce((sum, line) => sum + Number(line.amount), 0);
    expect(Number(contract.body.amount)).toBeCloseTo(total, 6);
  });

  it("round 7: order without quotation cannot derive parents", () => {
    const broken = { ...(order as Record<string, unknown>), quotation_id: undefined };
    expect(normalizeCommercialOrder(broken)).toEqual([]);
  });

  it("round 8: order line mismatch is skipped", () => {
    const broken = {
      ...(order as Record<string, unknown>),
      items: [{ product_name: "x", quantity: 3, discounted_price_usd: "33.33", total_usd: "100.00" }],
    };
    expect(normalizeCommercialOrder(broken)).toEqual([]);
  });

  it("round 9: CRM won stage maps to WON", () => {
    expect(mapCrmStageToOpportunityStage({ name: "Closed Won", isWon: true })).toBe("WON");
  });

  it("round 10: CRM unknown stage is omitted", () => {
    const write = normalizeCrmDeal({ ...(deal as Record<string, unknown>), stage: { name: "自定义阶段" } })[0]!;
    expect(write.body).not.toHaveProperty("stage");
  });

  it("round 11: CRM company maps account", () => {
    const write = normalizeCrmCompany(company)[0]!;
    expect(write.path).toContain("/import/accounts");
    expect(write.body.externalAccountId).toBeTruthy();
  });

  it("round 12: ticketing closed with resolved_at maps DONE", () => {
    const result = normalizeTicketRecord(
      { ...(ticket as Record<string, unknown>), status: "closed", resolved_at: "2026-11-21T11:00:00Z" },
      "BOARD-1",
    );
    expect(result.writes[0]!.body.status).toBe("DONE");
  });

  it("round 13: ticketing closed without resolved_at maps CANCELLED", () => {
    const result = normalizeTicketRecord(
      { ...(ticket as Record<string, unknown>), status: "closed", resolved_at: null },
      "BOARD-1",
    );
    expect(result.writes[0]!.body.status).toBe("CANCELLED");
  });

  it("round 14: ticketing unknown type is skipped", () => {
    const result = normalizeTicketRecord(
      { ...(ticket as Record<string, unknown>), ticket_type: "unknown-type" },
      "BOARD-1",
    );
    expect(result.writes).toEqual([]);
  });

  it("round 15: ticketing non-UUID assignee is omitted", () => {
    const result = normalizeTicketRecord(
      { ...(ticket as Record<string, unknown>), assigned_to: "not-a-uuid" },
      "BOARD-1",
    );
    expect(result.writes[0]!.body).not.toHaveProperty("assigneePersonId");
  });

  it("round 16: pingcode page index starts at zero", () => {
    const target = pingProvider.targets[0]!;
    expect(target.pageParam).toBe("page_index");
  });

  it("round 17: pingcode completed maps DONE", () => {
    const result = pingProvider.targets[0]!.normalize({
      ...(pingcode as Record<string, unknown>),
      state: { type: "completed" },
    });
    const body = (Array.isArray(result) ? result[0]! : result).body;
    expect(body.status).toBe("DONE");
  });

  it("round 18: pingcode unknown type is skipped", () => {
    expect(
      pingProvider.targets[0]!.normalize({
        ...(pingcode as Record<string, unknown>),
        type: { group: "unknown" },
      }),
    ).toEqual([]);
  });

  it("round 19: ERP AP keeps original amount, not suggested amount", () => {
    const body = normalizeErpApPayment(ap)[0]!.body;
    expect(body.amount).toBe("12800.5");
    expect(body.amount).not.toBe("12800");
  });

  it("round 20: ERP AR maps order reference and currency", () => {
    const body = normalizeErpArCollection(ar)[0]!.body;
    expect(body.currency).toBeTruthy();
    expect(body.orderId).toBeTruthy();
  });

  it("round 21: finance API key requires anari_ prefix", async () => {
    const { financeAuthHeaders } = await import("../finance.js");
    expect(financeAuthHeaders("anari_live_x")).toEqual({ Authorization: "Bearer anari_live_x" });
    expect(() => financeAuthHeaders("sk_test_example_x")).toThrow(/anari_/);
  });

  it("round 22: HR person maps to people import", () => {
    const write = normalizeHrPerson(hrPerson)[0]!;
    expect(write.path).toBe("/api/v1/people/import");
    expect(write.body.sourceSystem).toBe("ANARI_HR");
  });

  it("round 23: HR person without display name is skipped", () => {
    expect(normalizeHrPerson({ ...(hrPerson as Record<string, unknown>), display_name: "" })).toEqual([]);
  });

  it("round 24: provider registry contains all seven providers", () => {
    expect(Object.keys(LOCAL_PROVIDERS).sort()).toEqual([
      "anari-commercial",
      "anari-crm",
      "anari-erp",
      "anari-finance",
      "anari-hr",
      "anari-ticketing",
      "pingcode",
    ]);
  });
});

describe("TDD edge rounds (continued)", () => {
  it("round 25: quote without customer_name uses deterministic fallback name", () => {
    const list = writes(normalizeCommercialQuote({ ...(quote as Record<string, unknown>), customer_name: null }));
    expect(list[0]!.body.name).toBe(`Customer ${String((quote as Record<string, unknown>).customer_id)}`);
  });

  it("round 26: order without customer_name uses deterministic fallback name", () => {
    const list = writes(normalizeCommercialOrder({ ...(order as Record<string, unknown>), customer_name: null }));
    expect(list[0]!.body.name).toContain("Customer ");
  });

  it("round 27: default ticketing registry uses the stable project bucket", () => {
    const result = LOCAL_PROVIDERS["anari-ticketing"]!.targets[0]!.normalize(ticket);
    const list = Array.isArray(result) ? result : [result];
    expect(list[0]!.body.projectId).toBe("ANARI-TICKETING");
  });

  it("round 28: HR legal entities remain read-only", () => {
    const target = LOCAL_PROVIDERS["anari-hr"]!.targets.find((entry) => entry.path.includes("legal-entities"))!;
    expect(target.normalize(first((fixture("hr-legal-entities.sample.json") as { data: unknown[] }).data))).toEqual([]);
  });

  it("round 29: CRM contacts remain read-only", () => {
    const contact = first((fixture("crm-contacts.page1.json") as { contacts: unknown[] }).contacts);
    expect(LOCAL_PROVIDERS["anari-crm"]!.targets.find((entry) => entry.path.includes("contacts"))!.normalize(contact)).toEqual([]);
  });

  it("round 30: PingCode second-based completed_at becomes ISO", () => {
    const result = pingProvider.targets[0]!.normalize({
      ...(pingcode as Record<string, unknown>),
      state: { type: "completed" },
      completed_at: 1790000000,
    });
    const body = (Array.isArray(result) ? result[0]! : result).body;
    expect(body.completedAt).toBe("2026-09-21T14:13:20.000Z");
  });

  it("round 31: finance voucher maps period to periodStart", () => {
    const target = LOCAL_PROVIDERS["anari-finance"]!.targets.find((entry) => entry.path.includes("vouchers"))!;
    const voucher = first((fixture("finance-vouchers.sample.json") as { data: unknown[] }).data);
    const normalized = target.normalize(voucher);
    const write = Array.isArray(normalized) ? normalized[0]! : normalized;
    const body = write.body;
    expect(body.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
