/**
 * 2026-11-25 审计：多法人多币种影子周期必须锁定 IAS 21 / ASC 830 的折算口径，
 * 而不是用一个“平衡差”把记账错误吞掉。本文件锁定：
 * - fixture 的合并结果（expected.json，含 CTA 与内部往来对冲）；
 * - EUR / JPY 的期末、平均、历史汇率差异；
 * - 内部往来按 closing 折算后必须清零，否则抛 INTERCOMPANY_IMBALANCE；
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
