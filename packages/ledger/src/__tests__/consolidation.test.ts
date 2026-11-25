/**
 * 2026-11-25 审计：多法人多币种影子周期必须锁定 IAS 21 / ASC 830 的折算口径，
 * 而不是用一个“平衡差”把记账错误吞掉。本文件锁定：
 * - fixture 的合并结果（expected.json，含 CTA 与内部往来对冲）；
 * - EUR / JPY 的期末、平均、历史汇率差异；
 * - 内部往来按 closing 折算后必须清零，否则抛 INTERCOMPANY_IMBALANCE；
 * - IC 收入/费用按 average 折算后必须相等，否则抛 INTERCOMPANY_PNL_IMBALANCE；
 * - NCI（含多级持股的有效比例）与母公司权益/净利的拆分，且资产负债表仍平衡；
 * - 单法人折算与 CTA 方向（升值为正、贬值为负、无汇率变动为零）；
 * - 功能币账簿本身不平时抛 ENTITY_UNBALANCED（CTA 只吸收折算差）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecimal } from "@anari/policy-dsl";
import { describe, expect, it } from "vitest";
import {
  ConsolidationError,
  consolidateEntities,
  parseTransactionsCsv,
  type ConsolidationChecks,
  type ConsolidationInput,
  type ConsolidationReport,
  type ConsolidatedTotals,
  type EliminationLine,
  type EntityConsolidationReport,
  type EntityDefinition,
  type RateTable,
  type TransactionInput,
} from "../consolidation.js";

const FIXTURE_DIR = fileURLToPath(
  new URL(
    "../../../../fixtures/reconciliation/multi-entity-consolidation/",
    import.meta.url,
  ),
);

interface EntitiesDocument {
  groupCurrency?: string;
  entities: EntityDefinition[];
}

interface ExpectedEntityFigures {
  functional: EntityConsolidationReport["functional"];
  translated: EntityConsolidationReport["translated"];
  rates: EntityConsolidationReport["rates"];
}

interface ExpectedFixture {
  period: string;
  groupCurrency: string;
  entities: Record<string, ExpectedEntityFigures>;
  group: ConsolidatedTotals;
  groupBeforeElimination: ConsolidatedTotals;
  eliminations: {
    lines: EliminationLine[];
    totalReceivable: string;
    totalPayable: string;
    totalDifference: string;
    cleared: boolean;
  };
  checks: ConsolidationChecks;
  reportHash: string;
}

function readJson<T>(fileName: string): T {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIR, fileName), "utf8"),
  ) as T;
}

function fixtureInput(): ConsolidationInput {
  const document = readJson<EntitiesDocument>("entities.json");
  return {
    entities: document.entities,
    transactions: parseTransactionsCsv(
      readFileSync(join(FIXTURE_DIR, "transactions.csv"), "utf8"),
    ),
    rates: readJson<RateTable>("rates.json"),
    groupCurrency: document.groupCurrency ?? "USD",
  };
}

function entityOf(
  report: ConsolidationReport,
  entityId: string,
): EntityConsolidationReport {
  const entity = report.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity) throw new Error(`entity ${entityId} missing from report`);
  return entity;
}

function captureError(run: () => unknown): {
  code: string;
  message: string;
} {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConsolidationError);
    const consolidationError = error as ConsolidationError;
    return { code: consolidationError.code, message: consolidationError.message };
  }
  throw new Error("expected consolidation to throw");
}

const DE_ENTITY: EntityDefinition = {
  entityId: "DE-1",
  name: "ANARI Deutschland GmbH",
  functionalCurrency: "EUR",
  parentEntityId: null,
  ownershipPercent: "100",
  equity: { shareCapital: "100000", retainedEarnings: "50000" },
};

const DE_TRANSACTIONS: TransactionInput[] = [
  {
    date: "2026-10-01",
    entityId: "DE-1",
    accountType: "ASSET",
    counterpartyEntityId: null,
    amount: "180000",
    currency: "EUR",
    description: "Opening cash",
  },
  {
    date: "2026-10-01",
    entityId: "DE-1",
    accountType: "LIABILITY",
    counterpartyEntityId: null,
    amount: "30000",
    currency: "EUR",
    description: "Opening bank loan",
  },
  {
    date: "2026-10-10",
    entityId: "DE-1",
    accountType: "REVENUE",
    counterpartyEntityId: null,
    amount: "20000",
    currency: "EUR",
    description: "DE revenue",
  },
  {
    date: "2026-10-10",
    entityId: "DE-1",
    accountType: "ASSET",
    counterpartyEntityId: null,
    amount: "20000",
    currency: "EUR",
    description: "Cash received",
  },
  {
    date: "2026-10-12",
    entityId: "DE-1",
    accountType: "EXPENSE",
    counterpartyEntityId: null,
    amount: "5000",
    currency: "EUR",
    description: "DE expense",
  },
  {
    date: "2026-10-12",
    entityId: "DE-1",
    accountType: "LIABILITY",
    counterpartyEntityId: null,
    amount: "5000",
    currency: "EUR",
    description: "Accrued expense",
  },
  // Cross-currency: a USD invoice booked by a EUR-functional entity.
  {
    date: "2026-10-15",
    entityId: "DE-1",
    accountType: "REVENUE",
    counterpartyEntityId: null,
    amount: "12500",
    currency: "USD",
    description: "USD revenue",
  },
  {
    date: "2026-10-15",
    entityId: "DE-1",
    accountType: "ASSET",
    counterpartyEntityId: null,
    amount: "12500",
    currency: "USD",
    description: "USD cash received",
  },
];

const DE_RATES: RateTable = {
  period: "2026-10",
  closing: { USD: "1", EUR: "1.25" },
  average: { USD: "1", EUR: "1.2" },
  historical: { USD: "1", EUR: "1.1" },
  transactionRates: { "2026-10-15": { USD: "1", EUR: "1.25" } },
};

function singleEntityInput(rates: RateTable): ConsolidationInput {
  return {
    groupCurrency: "USD",
    entities: [DE_ENTITY],
    transactions: DE_TRANSACTIONS,
    rates,
  };
}

/** Parent US (USD) owns 80% of DE (EUR); 20% NCI. */
function nciInput(): ConsolidationInput {
  return {
    groupCurrency: "USD",
    entities: [
      {
        entityId: "US-PARENT",
        name: "ANARI Inc. (US)",
        functionalCurrency: "USD",
        parentEntityId: null,
        ownershipPercent: "100",
        equity: { shareCapital: "1000000", retainedEarnings: "0" },
      },
      {
        entityId: "DE-SUB",
        name: "ANARI GmbH (DE)",
        functionalCurrency: "EUR",
        parentEntityId: "US-PARENT",
        ownershipPercent: "80",
        equity: { shareCapital: "500000", retainedEarnings: "100000" },
      },
    ],
    transactions: [
      {
        date: "2026-10-01",
        entityId: "US-PARENT",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "1000000",
        currency: "USD",
        description: "US opening cash",
      },
      {
        date: "2026-10-01",
        entityId: "DE-SUB",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "600000",
        currency: "EUR",
        description: "DE opening cash",
      },
      {
        date: "2026-10-10",
        entityId: "DE-SUB",
        accountType: "REVENUE",
        counterpartyEntityId: null,
        amount: "200000",
        currency: "EUR",
        description: "DE revenue",
      },
      {
        date: "2026-10-10",
        entityId: "DE-SUB",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "200000",
        currency: "EUR",
        description: "DE cash received",
      },
      {
        date: "2026-10-12",
        entityId: "DE-SUB",
        accountType: "EXPENSE",
        counterpartyEntityId: null,
        amount: "50000",
        currency: "EUR",
        description: "DE expense",
      },
      {
        date: "2026-10-12",
        entityId: "DE-SUB",
        accountType: "LIABILITY",
        counterpartyEntityId: null,
        amount: "50000",
        currency: "EUR",
        description: "DE accrued expense",
      },
    ],
    rates: {
      period: "2026-10",
      closing: { USD: "1", EUR: "1.25" },
      average: { USD: "1", EUR: "1.2" },
      historical: { USD: "1", EUR: "1.1" },
    },
  };
}

/** 80% DE -> 100% JP: effective NCI in JP must still be 20%, not 0%. */
function nciChainInput(): ConsolidationInput {
  return {
    groupCurrency: "USD",
    entities: [
      {
        entityId: "US-PARENT",
        name: "ANARI Inc. (US)",
        functionalCurrency: "USD",
        parentEntityId: null,
        ownershipPercent: "100",
        equity: { shareCapital: "1000000", retainedEarnings: "0" },
      },
      {
        entityId: "DE-HOLDING",
        name: "ANARI GmbH (DE)",
        functionalCurrency: "EUR",
        parentEntityId: "US-PARENT",
        ownershipPercent: "80",
        equity: { shareCapital: "500000", retainedEarnings: "0" },
      },
      {
        entityId: "JP-SUB",
        name: "ANARI Japan K.K.",
        functionalCurrency: "JPY",
        parentEntityId: "DE-HOLDING",
        ownershipPercent: "100",
        equity: { shareCapital: "100000000", retainedEarnings: "0" },
      },
    ],
    transactions: [
      {
        date: "2026-10-01",
        entityId: "US-PARENT",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "1000000",
        currency: "USD",
        description: "US opening cash",
      },
      {
        date: "2026-10-01",
        entityId: "DE-HOLDING",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "500000",
        currency: "EUR",
        description: "DE opening cash",
      },
      {
        date: "2026-10-01",
        entityId: "JP-SUB",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "100000000",
        currency: "JPY",
        description: "JP opening cash",
      },
    ],
    rates: {
      period: "2026-10",
      closing: { USD: "1", EUR: "1.25", JPY: "0.00625" },
      average: { USD: "1", EUR: "1.2", JPY: "0.006" },
      historical: { USD: "1", EUR: "1.1", JPY: "0.0058" },
    },
  };
}

/**
 * US (USD) bills DE (EUR) 60,000 USD on credit and both sides book it as
 * intercompany P&L. At the transaction date 60,000 USD = 48,000 EUR. The
 * closing rate is 1.25, so the AR/AP clears at 60,000 USD either way; the
 * average rate decides whether the P&L elimination also clears.
 */
function icPnlInput(averageEur: string): ConsolidationInput {
  return {
    groupCurrency: "USD",
    entities: [
      {
        entityId: "US-A",
        name: "ANARI Inc. (US)",
        functionalCurrency: "USD",
        parentEntityId: null,
        ownershipPercent: "100",
        equity: { shareCapital: "1000000", retainedEarnings: "0" },
      },
      {
        entityId: "DE-B",
        name: "ANARI GmbH (DE)",
        functionalCurrency: "EUR",
        parentEntityId: "US-A",
        ownershipPercent: "100",
        equity: { shareCapital: "500000", retainedEarnings: "0" },
      },
    ],
    transactions: [
      {
        date: "2026-10-01",
        entityId: "US-A",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "1000000",
        currency: "USD",
        description: "US opening cash",
      },
      {
        date: "2026-10-01",
        entityId: "DE-B",
        accountType: "ASSET",
        counterpartyEntityId: null,
        amount: "500000",
        currency: "EUR",
        description: "DE opening cash",
      },
      {
        date: "2026-10-20",
        entityId: "US-A",
        accountType: "INTERCOMPANY_REVENUE",
        counterpartyEntityId: "DE-B",
        amount: "60000",
        currency: "USD",
        description: "Intercompany management fee revenue",
      },
      {
        date: "2026-10-20",
        entityId: "US-A",
        accountType: "INTERCOMPANY_AR",
        counterpartyEntityId: "DE-B",
        amount: "60000",
        currency: "USD",
        description: "Intercompany receivable from DE",
      },
      {
        date: "2026-10-20",
        entityId: "DE-B",
        accountType: "INTERCOMPANY_EXPENSE",
        counterpartyEntityId: "US-A",
        amount: "60000",
        currency: "USD",
        description: "Intercompany management fee expense",
      },
      {
        date: "2026-10-20",
        entityId: "DE-B",
        accountType: "INTERCOMPANY_AP",
        counterpartyEntityId: "US-A",
        amount: "60000",
        currency: "USD",
        description: "Intercompany payable to US",
      },
    ],
    rates: {
      period: "2026-10",
      closing: { USD: "1", EUR: "1.25" },
      average: { USD: "1", EUR: averageEur },
      historical: { USD: "1", EUR: "1.1" },
      transactionRates: { "2026-10-20": { USD: "1", EUR: "1.25" } },
    },
  };
}

describe("multi-entity consolidation", () => {
  it("fixture 结果与 expected.json 锁定一致", () => {
    const report = consolidateEntities(fixtureInput());
    const expected = readJson<ExpectedFixture>("expected.json");

    expect(report.period).toBe(expected.period);
    expect(report.groupCurrency).toBe(expected.groupCurrency);
    expect(report.group).toEqual(expected.group);
    expect(report.groupBeforeElimination).toEqual(
      expected.groupBeforeElimination,
    );
    expect(report.eliminations).toEqual(expected.eliminations);
    expect(report.checks).toEqual(expected.checks);
    expect(report.reportHash).toBe(expected.reportHash);

    for (const [entityId, figures] of Object.entries(expected.entities)) {
      const actual = entityOf(report, entityId);
      expect(actual.functional).toEqual(figures.functional);
      expect(actual.translated).toEqual(figures.translated);
      expect(actual.rates).toEqual(figures.rates);
    }
  });

  it("合并平衡：功能币与 USD 合并报表差额均为 0", () => {
    const report = consolidateEntities(fixtureInput());
    expect(report.checks.balanced).toBe(true);
    expect(report.checks.groupBalanced).toBe(true);
    expect(report.group.balanceDifference).toBe("0");
    expect(report.groupBeforeElimination.balanceDifference).toBe("0");

    for (const entity of report.entities) {
      expect(entity.functional.balanceDifference).toBe("0");
      expect(entity.translated.balanceDifference).toBe("0");
      const difference =
        parseDecimal(entity.translated.assets) -
        parseDecimal(entity.translated.liabilities) -
        parseDecimal(entity.translated.equityTotal);
      expect(difference).toBe(0n);
    }
    const groupDifference =
      parseDecimal(report.group.assets) -
      parseDecimal(report.group.liabilities) -
      parseDecimal(report.group.equityTotal);
    expect(groupDifference).toBe(0n);
  });

  it("CTA 非零且方向正确：EUR/JPY 升值对应正 CTA", () => {
    const report = consolidateEntities(fixtureInput());
    const de = entityOf(report, "ANARI-DE");
    const jp = entityOf(report, "ANARI-JP");
    const us = entityOf(report, "ANARI-US");

    // 手算核对（CTA 只包含折算差）：
    // DE: 期初净资产 850000 EUR × (1.25 - 1.10) = 127500
    //   + 本期利润 100000 EUR × (1.25 - 1.20) = 5000 -> 132500
    // JP: 期初净资产 120000000 JPY × (0.00625 - 0.0058) = 54000
    //   + 本期利润 12000000 JPY × (0.00625 - 0.006) = 3000 -> 57000
    expect(de.translated.cta).toBe("132500");
    expect(jp.translated.cta).toBe("57000");
    expect(us.translated.cta).toBe("0");
    expect(report.group.cta).toBe("189500");
    expect(parseDecimal(de.translated.cta) > 0n).toBe(true);
    expect(parseDecimal(jp.translated.cta) > 0n).toBe(true);
    // CTA is an equity line, not a P&L item.
    expect(report.group.equityTotal).toBe("3737500");
    expect(report.group.netAssets).toBe(report.group.equityTotal);
  });

  it("内部往来按 closing 折算后清零，并从合并资产负债表剔除", () => {
    const report = consolidateEntities(fixtureInput());
    expect(report.checks.intercompanyCleared).toBe(true);
    expect(report.eliminations.cleared).toBe(true);
    expect(report.eliminations.lines).toHaveLength(2);
    for (const line of report.eliminations.lines) {
      expect(line.receivable).toBe(line.payable);
      expect(line.difference).toBe("0");
    }
    expect(report.eliminations.totalReceivable).toBe("225000");
    expect(report.eliminations.totalPayable).toBe("225000");
    expect(report.eliminations.totalDifference).toBe("0");

    const groupAssets = parseDecimal(report.group.assets);
    const groupLiabilities = parseDecimal(report.group.liabilities);
    expect(groupAssets).toBe(
      parseDecimal(report.groupBeforeElimination.assets) -
        parseDecimal("225000"),
    );
    expect(groupLiabilities).toBe(
      parseDecimal(report.groupBeforeElimination.liabilities) -
        parseDecimal("225000"),
    );

    const intercompanyAssets = report.translatedTransactions
      .filter((line) => line.accountType === "INTERCOMPANY_AR")
      .reduce((total, line) => total + parseDecimal(line.groupAmount), 0n);
    const intercompanyLiabilities = report.translatedTransactions
      .filter((line) => line.accountType === "INTERCOMPANY_AP")
      .reduce((total, line) => total + parseDecimal(line.groupAmount), 0n);
    expect(intercompanyAssets).toBe(parseDecimal("225000"));
    expect(intercompanyLiabilities).toBe(parseDecimal("225000"));
  });

  it("单法人折算：交易日汇率入账、closing/average/historical 分别折算", () => {
    const report = consolidateEntities(singleEntityInput(DE_RATES));
    const entity = entityOf(report, "DE-1");

    expect(entity.functional.balances.REVENUE).toBe("30000");
    expect(entity.functional.balances.EXPENSE).toBe("5000");
    expect(entity.functional.totalAssets).toBe("210000");
    expect(entity.functional.netIncome).toBe("25000");
    expect(entity.functional.balanceDifference).toBe("0");

    expect(entity.translated.assets).toBe("262500");
    expect(entity.translated.liabilities).toBe("43750");
    expect(entity.translated.revenue).toBe("36000");
    expect(entity.translated.expense).toBe("6000");
    expect(entity.translated.netIncome).toBe("30000");
    expect(entity.translated.shareCapital).toBe("110000");
    expect(entity.translated.retainedEarnings).toBe("55000");
    expect(entity.translated.cta).toBe("23750");
    expect(entity.translated.equityTotal).toBe("218750");
    expect(entity.translated.balanceDifference).toBe("0");

    const crossCurrency = report.translatedTransactions.find(
      (line) => line.currency === "USD" && line.accountType === "REVENUE",
    );
    expect(crossCurrency?.translationKind).toBe("TRANSACTION_RATE");
    expect(crossCurrency?.functionalAmount).toBe("10000");
    expect(crossCurrency?.transactionRate).toBe("0.8");

    // 没有汇率变动时，CTA 必须为 0：它不是兜底平衡项。
    const flatRates: RateTable = {
      period: "2026-10",
      closing: { USD: "1", EUR: "1.25" },
      average: { USD: "1", EUR: "1.25" },
      historical: { USD: "1", EUR: "1.25" },
      transactionRates: { "2026-10-15": { USD: "1", EUR: "1.25" } },
    };
    const flatReport = consolidateEntities(singleEntityInput(flatRates));
    const flatEntity = entityOf(flatReport, "DE-1");
    expect(flatEntity.translated.cta).toBe("0");
    expect(flatEntity.translated.assets).toBe("262500");
    expect(flatEntity.translated.equityTotal).toBe("218750");
  });

  it("CTA 方向：功能币贬值时 CTA 为负", () => {
    const report = consolidateEntities({
      groupCurrency: "USD",
      entities: [
        {
          entityId: "JP-1",
          name: "ANARI Japan K.K.",
          functionalCurrency: "JPY",
          parentEntityId: null,
          ownershipPercent: "100",
          equity: {
            shareCapital: "100000000",
            retainedEarnings: "20000000",
          },
        },
      ],
      transactions: [
        {
          date: "2026-10-01",
          entityId: "JP-1",
          accountType: "ASSET",
          counterpartyEntityId: null,
          amount: "120000000",
          currency: "JPY",
          description: "Opening cash",
        },
      ],
      rates: {
        period: "2026-10",
        closing: { USD: "1", JPY: "0.0056" },
        average: { USD: "1", JPY: "0.0057" },
        historical: { USD: "1", JPY: "0.0058" },
      },
    });
    const entity = entityOf(report, "JP-1");
    expect(entity.translated.cta).toBe("-24000");
    expect(parseDecimal(entity.translated.cta) < 0n).toBe(true);
    expect(entity.translated.balanceDifference).toBe("0");
  });

  it("NCI 80%：少数股东权益与损益按有效持股比例拆分", () => {
    const report = consolidateEntities(nciInput());
    const de = entityOf(report, "DE-SUB");
    expect(de.ownershipPercent).toBe("80");
    expect(de.translated.cta).toBe("97500");
    expect(de.translated.netIncome).toBe("180000");
    expect(de.translated.equityTotal).toBe("937500");

    expect(report.group.assets).toBe("2000000");
    expect(report.group.liabilities).toBe("62500");
    expect(report.group.equityTotal).toBe("1937500");
    expect(report.group.netIncome).toBe("180000");
    expect(report.group.nci).toBe("187500");
    expect(report.group.nciNetIncome).toBe("36000");
    expect(report.group.parentNetIncome).toBe("144000");
    expect(report.group.parentEquity).toBe("1750000");
    expect(report.checks.nciBalanced).toBe(true);
    expect(report.checks.balanced).toBe(true);

    const allocations = report.nciAllocations ?? [];
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      entityId: "DE-SUB",
      ownershipPercent: "80",
      effectiveOwnershipPercent: "80",
      nciPercent: "20",
      netAssets: "937500",
      netIncome: "180000",
      cta: "97500",
      nci: "187500",
      nciNetIncome: "36000",
    });
    // NCI includes its 20% share of the subsidiary's CTA (19,500).
    expect(
      (parseDecimal(allocations[0]?.cta ?? "0") * 20n) / 100n,
    ).toBe(parseDecimal("19500"));

    const assets = parseDecimal(report.group.assets);
    const liabilities = parseDecimal(report.group.liabilities);
    const nci = parseDecimal(report.group.nci ?? "0");
    const parentEquity = parseDecimal(report.group.parentEquity ?? "0");
    expect(assets - liabilities).toBe(parentEquity + nci);
    expect(parentEquity + nci).toBe(parseDecimal(report.group.equityTotal));
  });

  it("NCI 多级持股：80% -> 100% 的有效 NCI 仍为 20%，不重复计算", () => {
    const report = consolidateEntities(nciChainInput());
    expect(report.group.nci).toBe("250000");
    expect(report.group.parentEquity).toBe("2000000");
    expect(report.group.nciNetIncome).toBe("0");
    expect(report.group.parentNetIncome).toBe("0");

    const allocations = report.nciAllocations ?? [];
    expect(allocations).toHaveLength(2);
    const holding = allocations.find(
      (allocation) => allocation.entityId === "DE-HOLDING",
    );
    const japan = allocations.find(
      (allocation) => allocation.entityId === "JP-SUB",
    );
    expect(holding).toMatchObject({
      effectiveOwnershipPercent: "80",
      nciPercent: "20",
      nci: "125000",
    });
    expect(japan).toMatchObject({
      effectiveOwnershipPercent: "80",
      nciPercent: "20",
      nci: "125000",
    });
    expect(
      parseDecimal(report.group.assets) -
        parseDecimal(report.group.liabilities),
    ).toBe(
      parseDecimal(report.group.parentEquity ?? "0") +
        parseDecimal(report.group.nci ?? "0"),
    );
  });

  it("IC 损益抵消：平均汇率匹配时 revenue/expense 扣除且 net income 不变", () => {
    const report = consolidateEntities(icPnlInput("1.25"));
    const us = entityOf(report, "US-A");
    const de = entityOf(report, "DE-B");
    expect(us.functional.balances.INTERCOMPANY_REVENUE).toBe("60000");
    expect(de.functional.balances.INTERCOMPANY_EXPENSE).toBe("48000");
    expect(us.translated.revenue).toBe("60000");
    expect(de.translated.expense).toBe("60000");
    expect(de.translated.cta).toBe("75000");

    expect(report.groupBeforeElimination.revenue).toBe("60000");
    expect(report.groupBeforeElimination.expense).toBe("60000");
    expect(report.group.revenue).toBe("0");
    expect(report.group.expense).toBe("0");
    expect(report.group.netIncome).toBe("0");
    expect(report.group.assets).toBe("1625000");
    expect(report.group.liabilities).toBe("0");
    expect(report.group.balanceDifference).toBe("0");
    expect(report.checks.icPnlCleared).toBe(true);
    expect(report.checks.balanced).toBe(true);

    const pnl = report.eliminations.pnl;
    expect(pnl).toBeDefined();
    expect(pnl?.lines).toHaveLength(1);
    expect(pnl?.lines[0]).toMatchObject({
      revenue: "60000",
      expense: "60000",
      difference: "0",
    });
    expect(pnl?.totalRevenue).toBe("60000");
    expect(pnl?.totalExpense).toBe("60000");
    expect(pnl?.totalDifference).toBe("0");
  });

  it("IC 损益不匹配（average 1.20）时抛 INTERCOMPANY_PNL_IMBALANCE", () => {
    const error = captureError(() => consolidateEntities(icPnlInput("1.2")));
    expect(error.code).toBe("INTERCOMPANY_PNL_IMBALANCE");
    expect(error.message).toContain("DE-B|US-A");
    expect(error.message).toContain("difference=2400");
  });

  it("内部往来不平（USD 侧多计 10000）时抛 INTERCOMPANY_IMBALANCE", () => {
    const input = fixtureInput();
    const extra: TransactionInput[] = [
      {
        date: "2026-10-31",
        entityId: "ANARI-US",
        accountType: "REVENUE",
        counterpartyEntityId: "ANARI-DE",
        amount: "10000",
        currency: "USD",
        description: "Unbilled intercompany fee",
      },
      {
        date: "2026-10-31",
        entityId: "ANARI-US",
        accountType: "INTERCOMPANY_AR",
        counterpartyEntityId: "ANARI-DE",
        amount: "10000",
        currency: "USD",
        description: "Receivable not mirrored by DE",
      },
    ];
    const error = captureError(() =>
      consolidateEntities({
        ...input,
        transactions: [...input.transactions, ...extra],
      }),
    );
    expect(error.code).toBe("INTERCOMPANY_IMBALANCE");
    expect(error.message).toContain("ANARI-DE|ANARI-US");
    expect(error.message).toContain("difference=10000");
  });

  it("功能币账簿本身不平时抛 ENTITY_UNBALANCED，不把差额塞进 CTA", () => {
    const input = fixtureInput();
    const error = captureError(() =>
      consolidateEntities({
        ...input,
        transactions: [
          ...input.transactions,
          {
            date: "2026-10-31",
            entityId: "ANARI-US",
            accountType: "ASSET",
            counterpartyEntityId: null,
            amount: "1",
            currency: "USD",
            description: "Unposted cash",
          },
        ],
      }),
    );
    expect(error.code).toBe("ENTITY_UNBALANCED");
    expect(error.message).toContain("ANARI-US");
    expect(error.message).toContain("difference=1");
  });

  it("缺少交易日汇率时 fail-closed（MISSING_RATE）", () => {
    const input = fixtureInput();
    const error = captureError(() =>
      consolidateEntities({
        ...input,
        transactions: [
          ...input.transactions,
          {
            date: "2026-10-25",
            entityId: "ANARI-JP",
            accountType: "EXPENSE",
            counterpartyEntityId: "ANARI-DE",
            amount: "1000",
            currency: "EUR",
            description: "EUR expense without a transaction-date rate",
          },
        ],
      }),
    );
    expect(error.code).toBe("MISSING_RATE");
    expect(error.message).toContain("2026-10-25");
  });
});
