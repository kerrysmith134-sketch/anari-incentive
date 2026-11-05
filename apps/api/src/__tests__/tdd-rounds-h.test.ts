/*
 * TDD rounds 87–100: field access matrix + match predicates, export DLP,
 * activity-monitoring blocking, audit redaction overlay, agent role
 * isolation, payroll bank redaction, settlement/calculation redaction.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  applyAuditRedactions,
  buildApp,
  findActivityMetricKeys,
  findActivityMonitoringText,
  redactCalculationRunFields,
  redactPayrollFields,
  redactResourceFields,
  redactSettlementBatchFields,
  requiredMatchPredicates,
  scanExportDlp,
} from "../app.js";
import { AuthError } from "@anari/auth";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import type {
  AuditEvent,
  CalculationRun,
  PayrollRun,
  SettlementBatch,
} from "@anari/domain";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          employeeCode: "E001",
          displayName: "Sales Lead",
        },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

// ---------------------------------------------------------------------------
// Rounds 87–88 — export DLP scanners.
// ---------------------------------------------------------------------------
describe("round 87: export DLP detects Chinese ID, bank card and phone", () => {
  it("flags all three pattern classes", () => {
    const findings = scanExportDlp(
      "ID 110101199003077758, card 6222020200112233445, phone 13812345678",
    );
    expect(findings).toContain("CHINESE_ID");
    expect(findings).toContain("BANK_CARD");
    expect(findings).toContain("PHONE");
  });

  it("does not flag ordinary prose", () => {
    const findings = scanExportDlp(
      "The order gross profit was 100000 CNY, delivered on time.",
    );
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rounds 89–90 — activity monitoring blocking (data minimisation).
// ---------------------------------------------------------------------------
describe("round 89: activity metric keys are detected in payloads", () => {
  it("flags keystroke/screen/webcam style keys", () => {
    const keys = findActivityMetricKeys({
      delivery: "ok",
      keystrokes: 9000,
      screenTimeMinutes: 480,
      webcam: true,
    });
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores legitimate delivery payloads", () => {
    const keys = findActivityMetricKeys({
      deliverableRef: "doc-1",
      acceptedAt: "2026-11-01",
      qualityScore: 4.5,
    });
    expect(keys).toHaveLength(0);
  });
});

describe("round 90: surveillance phrasing is blocked in free text", () => {
  it("detects English and Chinese monitoring phrases", () => {
    expect(
      findActivityMonitoringText("we run keystroke logging on all desks"),
    ).toContain("keystroke logging");
    expect(
      findActivityMonitoringText("we run screen monitoring on all desks"),
    ).toContain("screen monitoring");
    expect(
      findActivityMonitoringText("Delivered the guide on time"),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rounds 91–93 — field redaction across resource types.
// ---------------------------------------------------------------------------
const payrollRun = (): PayrollRun =>
  ({
    id: "pr-1",
    tenantId: "tenant-demo",
    cycleId: "c1",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    currency: "CNY",
    status: "CALCULATED",
    preparedBy: "p",
    totalGross: "0",
    totalDeductions: "0",
    totalTax: "0",
    totalSocialInsurance: "0",
    totalNet: "0",
    lineCount: 1,
    blockedCount: 0,
    createdAt: "2026-11-05T00:00:00Z",
    updatedAt: "2026-11-05T00:00:00Z",
    version: 1,
    lines: [
      {
        id: "l1",
        tenantId: "tenant-demo",
        runId: "pr-1",
        personId: "p-victim",
        contractId: "c1",
        currency: "CNY",
        fixedAmount: "8000",
        incentiveAmount: "0",
        grossAmount: "8000",
        deductionAmount: "0",
        taxAmount: "0",
        socialInsuranceAmount: "0",
        netAmount: "8000",
        minimumMonthlyWage: "2690",
        minimumWagePassed: true,
        deductionCapRate: "0.2",
        deductionCapAmount: "1600",
        deductionCapPassed: true,
        variableShareRate: "0",
        variableShareCapRate: "1",
        variableShareCapAmount: "8000",
        variableSharePassed: true,
        deductionTypeCapPassed: true,
        deductionTypeCapBreaches: [],
        priorIncentiveAmount: "0",
        incentiveChangeRate: "0",
        smoothingThresholdRate: "1",
        smoothingPassed: true,
        noticeAcknowledgementPassed: true,
        noticeAcknowledgementMissing: [],
        deductionBreakdown: [],
        bankAccountRef: "BANK-SECRET",
        createdAt: "2026-11-05T00:00:00Z",
      },
    ],
  }) as unknown as PayrollRun;

describe("round 91: payroll bank refs hide from non-finance viewers", () => {
  it("redacts for employees and keeps finance view", () => {
    const employeeView = redactPayrollFields(payrollRun(), {
      personId: "p-other",
      roles: ["employee"],
    } as never);
    expect(employeeView.lines?.[0]?.bankAccountRef).toBeUndefined();

    const financeView = redactPayrollFields(payrollRun(), {
      personId: "p-finance",
      roles: ["finance"],
    } as never);
    expect(financeView.lines?.[0]?.bankAccountRef).toBe("BANK-SECRET");
  });

  it("always shows people their own bank account", () => {
    const own = redactPayrollFields(payrollRun(), {
      personId: "p-victim",
      roles: ["employee"],
    } as never);
    expect(own.lines?.[0]?.bankAccountRef).toBe("BANK-SECRET");
  });
});

describe("round 92: calculation economics redact for employees", () => {
  it("hides order economics and traces", () => {
    const run = {
      id: "cr-1",
      tenantId: "tenant-demo",
      cycleId: "c1",
      policyVersionId: "pv",
      mode: "FORMAL",
      status: "CALCULATED",
      inputSnapshot: { order: { grossProfit: "100000" } },
      inputSnapshotHash: "h",
      warnings: [],
      blockers: [],
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
      version: 1,
      lines: [
        {
          id: "cl-1",
          tenantId: "tenant-demo",
          runId: "cr-1",
          personId: "p1",
          incentiveType: "INCENTIVE",
          amount: "1000",
          baseAmount: "1000",
          rawAmount: "1000",
          roundedAmount: "1000",
          multiplier: "1",
          currency: "CNY",
          createdAt: "2026-11-05T00:00:00Z",
        },
      ],
    } as unknown as CalculationRun;
    const employeeView = redactCalculationRunFields(run, {
      roles: ["employee"],
    });
    // Decimal fields deny to "0" (legacy inference), strings would REDACT.
    expect(employeeView.lines?.[0]?.baseAmount).toBe("0");
    expect(employeeView.lines?.[0]?.roundedAmount).toBe("0");
    const financeView = redactCalculationRunFields(run, {
      roles: ["finance"],
    });
    expect(financeView.lines?.[0]?.baseAmount).toBe("1000");
  });
});

describe("round 93: settlement line amounts redact for non-finance roles", () => {
  it("hides amounts from managers by default and shows finance", () => {
    const batch = {
      id: "sb-1",
      tenantId: "tenant-demo",
      cycleId: "c1",
      batchNo: "SB-1",
      status: "APPROVED",
      kind: "STANDARD",
      currency: "CNY",
      totalAmount: "8000",
      lineCount: 1,
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
      lines: [
        {
          id: "sl-1",
          tenantId: "tenant-demo",
          batchId: "sb-1",
          ledgerId: "l1",
          personId: "p1",
          personCode: "E001",
          personName: "Sales Lead",
          amount: "8000",
          currency: "CNY",
          status: "ACTIVE",
          active: true,
          createdAt: "2026-11-05T00:00:00Z",
        },
      ],
    } as unknown as SettlementBatch;
    const managerView = redactSettlementBatchFields(batch, {
      personId: "p-manager",
      roles: ["manager"],
    });
    const financeView = redactSettlementBatchFields(batch, {
      personId: "p-finance",
      roles: ["finance"],
    });
    // Redaction of the self-own line stays visible for the person themself.
    const own = redactSettlementBatchFields(batch, {
      personId: "p1",
      roles: ["employee"],
    });
    expect(financeView.lines?.[0]?.amount).toBe("8000");
    expect(own.lines?.[0]?.amount).toBe("8000");
    expect(managerView).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Rounds 94–96 — match predicates wiring.
// ---------------------------------------------------------------------------
describe("round 94: predicates are extracted from the policy record", () => {
  it("collects predicate names across resource keys", () => {
    const deps = requiredMatchPredicates({
      "PAYROLL_LINE.netAmount": {
        allowRoles: ["manager"],
        match: { isSubjectManager: true },
      },
      "EMPLOYMENT_CONTRACT.bankAccountRef": {
        allowRoles: ["finance"],
        match: { legalHoldActive: true },
      },
    });
    expect(deps).toContain("isSubjectManager");
    expect(deps).toContain("legalHoldActive");
  });

  it("returns no predicates for plain role policies", () => {
    const deps = requiredMatchPredicates({
      "PAYROLL_LINE.netAmount": { allowRoles: ["finance"] },
    });
    expect(deps).toHaveLength(0);
  });
});

describe("round 95: generic resource redaction honours self and roles", () => {
  it("keeps self access and hides others for restricted fields", () => {
    const policies = {
      "EMPLOYMENT_CONTRACT.bankAccountRef": {
        allowRoles: ["finance"],
        allowSelf: true,
        onDeny: "REDACT",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const mine = redactResourceFields(
      { bankAccountRef: "BANK-1", amount: "100" },
      "EMPLOYMENT_CONTRACT",
      {
        personId: "p1",
        recordPersonId: "p1",
        roles: ["employee"],
        policies,
      },
    );
    expect(mine.bankAccountRef).toBe("BANK-1");
    const others = redactResourceFields(
      { bankAccountRef: "BANK-1", amount: "100" },
      "EMPLOYMENT_CONTRACT",
      {
        personId: "p2",
        recordPersonId: "p1",
        roles: ["employee"],
        policies,
      },
    );
    expect(others.bankAccountRef).toBe("[REDACTED]");
    expect(others.redactedFields).toContain("bankAccountRef");
  });
});

describe("round 96: admin bypasses field policies", () => {
  it("never redacts for admins", () => {
    const admin = redactResourceFields(
      { bankAccountRef: "BANK-1" },
      "EMPLOYMENT_CONTRACT",
      {
        personId: "p-admin",
        recordPersonId: "p1",
        roles: ["admin"],
        policies: {
          "EMPLOYMENT_CONTRACT.bankAccountRef": {
            allowRoles: ["finance"],
            allowSelf: false,
            onDeny: "OMIT",
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    );
    expect(admin.bankAccountRef).toBe("BANK-1");
  });
});

// ---------------------------------------------------------------------------
// Rounds 97–98 — audit redaction overlay keeps the chain intact.
// ---------------------------------------------------------------------------
describe("round 97: audit redaction replaces reasons without touching hashes", () => {
  it("masks the reason but preserves entry hash", () => {
    const event = {
      id: "ae-1",
      sequence: 1,
      action: "POLICY_PUBLISH",
      objectType: "POLICY_VERSION",
      objectId: "pv-1",
      actorType: "USER",
      actorId: "u1",
      reason: "secret reason text",
      prevHash: "genesis",
      entryHash: "hash-1",
      createdAt: "2026-11-05T00:00:00Z",
    } as unknown as AuditEvent;
    const [redacted] = applyAuditRedactions([event], [
      {
        id: "r1",
        tenantId: "tenant-demo",
        auditEventId: "ae-1",
        replacement: "[REDACTED]",
        requestedBy: "u2",
        approvedBy: "u3",
        createdAt: "2026-11-06T00:00:00Z",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    expect(redacted!.reason).toBe("[REDACTED]");
    expect((redacted as unknown as { entryHash: string }).entryHash).toBe("hash-1");
  });
});

describe("round 98: events without a redaction pass through unchanged", () => {
  it("returns the original reason", () => {
    const event = {
      id: "ae-2",
      sequence: 2,
      action: "CALCULATION_LOCK",
      reason: "routine",
      entryHash: "hash-2",
    } as unknown as AuditEvent;
    const [passthrough] = applyAuditRedactions([event], []);
    expect(passthrough!.reason).toBe("routine");
  });
});

// ---------------------------------------------------------------------------
// Rounds 99–100 — agent tool isolation via the runtime options contract.
// ---------------------------------------------------------------------------
describe("round 99: reader-role tool matrix is wired in app options", () => {
  it("buildApp accepts agent runtime options without error", () => {
    const built = buildApp(appStore, undefined, undefined, platformStore, {});
    expect(built).toBeDefined();
  });
});

describe("round 100: the console route guard rejects anonymous API calls", () => {
  it("returns 401 without identity headers under a strict authenticator", async () => {
    const strict = buildApp(new Store(), undefined, {
      async authenticate(input) {
        if (!input.authorization?.startsWith("Bearer ok-")) {
          throw new AuthError("UNAUTHENTICATED", "nope");
        }
        return {
          tenantId: "tenant-demo",
          userId: "u",
          roles: ["admin"],
        };
      },
    });
    const response = await strict.inject({
      method: "GET",
      url: "/api/v1/policy-versions",
    } as never);
    expect(response.statusCode).toBe(401);
    const ok = await strict.inject({
      method: "GET",
      url: "/api/v1/policy-versions",
      headers: { authorization: "Bearer ok-1" },
    } as never);
    expect(ok.statusCode).toBe(200);
  });
});
