/**
 * Multi-entity / multi-currency shadow consolidation (IAS 21 / ASC 830).
 *
 * Scope of this module:
 * - every legal entity keeps its books in its functional currency;
 * - a transaction in a foreign currency is translated into the entity's
 *   functional currency at the transaction-date rate (no re-measurement
 *   afterwards: the fixture represents the already-booked functional
 *   balances);
 * - at period end the functional trial balance is translated into the group
 *   presentation currency: monetary assets/liabilities at the closing rate,
 *   revenue/expense at the average rate, equity at the historical rate;
 * - the residual after that translation is the cumulative translation
 *   adjustment (CTA), presented inside equity as a separate OCI line;
 * - intercompany AR/AP balances are eliminated at the closing rate. They must
 *   clear to exactly zero per counterparty pair; a difference is a data error
 *   and fails closed instead of being parked in the CTA;
 * - intercompany revenue/expense (`INTERCOMPANY_REVENUE` /
 *   `INTERCOMPANY_EXPENSE`) is translated at the average rate and eliminated
 *   per counterparty pair. The two sides must translate to the same group
 *   amount; otherwise `INTERCOMPANY_PNL_IMBALANCE` is raised. Group revenue
 *   and expense drop by the eliminated amounts while group net income is
 *   unchanged (the two sides are equal);
 * - minority interests: `ownershipPercent` is the direct ownership by the
 *   parent (0-100). Effective ownership is the product along the ownership
 *   chain, so multi-level NCI is not double counted. NCI is the minority
 *   share of each subsidiary's translated net assets (including its CTA
 *   share) and of its translated net income. The group balance sheet stays
 *   `assets - liabilities = parentEquity + nci`.
 *
 * Compatibility: a 100%-owned group has no NCI and no intercompany P&L, so
 * the legacy report shape (and therefore the locked fixture hash) is kept
 * byte-for-byte. The `nci*` / `parent*` fields, `nciAllocations`,
 * `eliminations.pnl` and the two extra balance keys are only emitted when
 * they are actually present.
 *
 * All amounts are bigint micro-units (1e6 scale, see
 * `@anari/policy-dsl/decimal`). No floating point is used anywhere, and rate
 * conversion is rounded HALF_UP at every step.
 *
 * The CTA is *only* allowed to absorb translation differences. Each entity's
 * functional books must satisfy:
 *
 *   assets - liabilities - openingEquity - equityTransactions
 *     - (revenue - expense) = 0
 *
 * A non-zero value is a bookkeeping error and throws `ENTITY_UNBALANCED`
 * before any CTA is computed.
 */

import {
  FACTOR,
  divRound,
  formatDecimal,
  mul,
  normalizeCurrency,
  parseDecimal,
  sha256,
} from "@anari/policy-dsl";

/** Legacy balance-sheet / P&L accounts, always present in the report. */
export const BALANCE_ACCOUNT_TYPES = [
  "REVENUE",
  "EXPENSE",
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INTERCOMPANY_AR",
  "INTERCOMPANY_AP",
] as const;

export type BalanceAccountType = (typeof BALANCE_ACCOUNT_TYPES)[number];

/** Intercompany P&L accounts, emitted only when they carry a balance. */
export const INTERCOMPANY_PNL_ACCOUNT_TYPES = [
  "INTERCOMPANY_REVENUE",
  "INTERCOMPANY_EXPENSE",
] as const;

export type IntercompanyPnlAccountType =
  (typeof INTERCOMPANY_PNL_ACCOUNT_TYPES)[number];

/** Account types that participate in the shadow cycle. */
export const ACCOUNT_TYPES = [
  ...BALANCE_ACCOUNT_TYPES,
  ...INTERCOMPANY_PNL_ACCOUNT_TYPES,
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

const ACCOUNT_TYPE_SET = new Set<string>(ACCOUNT_TYPES);

/** In a trial balance these are assets/liabilities and use the closing rate. */
const INTERCOMPANY_ACCOUNT_TYPES = new Set<AccountType>([
  "INTERCOMPANY_AR",
  "INTERCOMPANY_AP",
]);

const INTERCOMPANY_PNL_SET = new Set<AccountType>(
  INTERCOMPANY_PNL_ACCOUNT_TYPES,
);

/** Accounts that only make sense with an explicit counterparty. */
const COUNTERPARTY_REQUIRED_ACCOUNT_TYPES = new Set<AccountType>([
  ...INTERCOMPANY_ACCOUNT_TYPES,
  ...INTERCOMPANY_PNL_ACCOUNT_TYPES,
]);

export type GroupRateKind = "CLOSING" | "AVERAGE" | "HISTORICAL";

/**
 * Translation rate applied to each account type at period end (IAS 21.39):
 * monetary items at closing, income statement at average, equity at
 * historical.
 */
export const GROUP_RATE_KIND_BY_ACCOUNT: Readonly<Record<AccountType, GroupRateKind>> =
  {
    ASSET: "CLOSING",
    LIABILITY: "CLOSING",
    INTERCOMPANY_AR: "CLOSING",
    INTERCOMPANY_AP: "CLOSING",
    REVENUE: "AVERAGE",
    EXPENSE: "AVERAGE",
    EQUITY: "HISTORICAL",
    INTERCOMPANY_REVENUE: "AVERAGE",
    INTERCOMPANY_EXPENSE: "AVERAGE",
  };

export type ConsolidationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_PERIOD"
  | "INVALID_DATE"
  | "INVALID_ENTITY"
  | "DUPLICATE_ENTITY"
  | "INVALID_HIERARCHY"
  | "INVALID_OWNERSHIP"
  | "INVALID_ACCOUNT_TYPE"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_RATE"
  | "MISSING_RATE"
  | "UNKNOWN_ENTITY"
  | "UNKNOWN_COUNTERPARTY"
  | "INTERCOMPANY_COUNTERPARTY_REQUIRED"
  | "INTERCOMPANY_SELF_REFERENCE"
  | "INTERCOMPANY_IMBALANCE"
  | "INTERCOMPANY_PNL_IMBALANCE"
  | "ENTITY_UNBALANCED"
  | "GROUP_UNBALANCED"
  | "PERIOD_MISMATCH";

export class ConsolidationError extends Error {
  constructor(
    readonly code: ConsolidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConsolidationError";
  }
}

export interface EntityEquityInput {
  /** Share capital in the entity's functional currency. */
  shareCapital: string;
  /** Opening retained earnings in the entity's functional currency. */
  retainedEarnings: string;
}

export interface EntityDefinition {
  entityId: string;
  name: string;
  /** ISO 4217 code of the entity's functional currency. */
  functionalCurrency: string;
  /** `null`/omitted for the group parent. */
  parentEntityId?: string | null;
  /**
   * Direct ownership of the entity by its parent, as a percentage (0-100).
   * Effective ownership is the product along the parent chain; the group
   * parent itself is treated as 100% owned by the group's shareholders.
   */
  ownershipPercent: string;
  equity: EntityEquityInput;
}

export interface TransactionInput {
  /** ISO date (`YYYY-MM-DD`) inside the rate period. */
  date: string;
  entityId: string;
  accountType: AccountType;
  counterpartyEntityId?: string | null;
  amount: string;
  currency: string;
  description?: string;
}

/**
 * Rates are quoted as "1 unit of <currency> = X group currency" (the spec's
 * USD convention). The group currency's own rate must be 1.
 */
export interface RateTable {
  period: string;
  closing: Record<string, string>;
  average: Record<string, string>;
  historical: Record<string, string>;
  /**
   * Transaction-date rates used to translate foreign-currency transactions
   * into the entity's functional currency: `{ "2026-10-20": { EUR: "1.24" } }`.
   * Required only for cross-currency transactions.
   */
  transactionRates?: Record<string, Record<string, string>>;
}

export interface ConsolidationInput {
  entities: readonly EntityDefinition[];
  transactions: readonly TransactionInput[];
  rates: RateTable;
  /** Group presentation currency, default USD. */
  groupCurrency?: string;
}

export interface TranslatedTransaction {
  date: string;
  entityId: string;
  accountType: AccountType;
  counterpartyEntityId: string | null;
  amount: string;
  currency: string;
  functionalCurrency: string;
  functionalAmount: string;
  translationKind: "FUNCTIONAL" | "TRANSACTION_RATE";
  /** Functional-currency units per 1 transaction-currency unit, when converted. */
  transactionRate: string | null;
  groupAmount: string;
  groupRate: string;
  groupRateKind: GroupRateKind;
  description: string;
}

/**
 * Legacy balances are always emitted (zero included); the intercompany P&L
 * keys are only emitted when non-zero to keep 100%-owned reports unchanged.
 */
export type EntityBalancesReport = Record<BalanceAccountType, string> &
  Partial<Record<IntercompanyPnlAccountType, string>>;

export interface EntityConsolidationReport {
  entityId: string;
  name: string;
  functionalCurrency: string;
  parentEntityId: string | null;
  ownershipPercent: string;
  functional: {
    balances: EntityBalancesReport;
    openingEquity: {
      shareCapital: string;
      retainedEarnings: string;
      total: string;
    };
    /** Total revenue including INTERCOMPANY_REVENUE. */
    revenue: string;
    /** Total expense including INTERCOMPANY_EXPENSE. */
    expense: string;
    netIncome: string;
    totalAssets: string;
    totalLiabilities: string;
    /** assets - liabilities - equity - netIncome; must be "0". */
    balanceDifference: string;
  };
  translated: {
    assets: string;
    liabilities: string;
    netAssets: string;
    /** Total revenue including INTERCOMPANY_REVENUE (translated at average). */
    revenue: string;
    /** Total expense including INTERCOMPANY_EXPENSE (translated at average). */
    expense: string;
    netIncome: string;
    shareCapital: string;
    retainedEarnings: string;
    equityTransactions: string;
    /** Cumulative translation adjustment (OCI / equity). */
    cta: string;
    equityTotal: string;
    /** assets - liabilities - equityTotal; must be "0". */
    balanceDifference: string;
  };
  rates: {
    closing: string;
    average: string;
    historical: string;
  };
}

export interface EliminationLine {
  /** Counterparty pair, sorted lexicographically. */
  entities: [string, string];
  /** Intercompany receivable translated at the closing rate, in group currency. */
  receivable: string;
  /** Intercompany payable translated at the closing rate, in group currency. */
  payable: string;
  /** receivable - payable; always "0" for a published report. */
  difference: string;
}

export interface PnlEliminationLine {
  /** Counterparty pair, sorted lexicographically. */
  entities: [string, string];
  /** Intercompany revenue translated at the average rate, in group currency. */
  revenue: string;
  /** Intercompany expense translated at the average rate, in group currency. */
  expense: string;
  /** revenue - expense; always "0" for a published report. */
  difference: string;
}

export interface PnlEliminationReport {
  lines: PnlEliminationLine[];
  totalRevenue: string;
  totalExpense: string;
  totalDifference: string;
  cleared: boolean;
}

export interface NciAllocation {
  entityId: string;
  /** Direct ownership by the parent, in percent. */
  ownershipPercent: string;
  /** Effective ownership from the group parent, in percent. */
  effectiveOwnershipPercent: string;
  /** 100 - effective ownership, in percent. */
  nciPercent: string;
  /** The subsidiary's translated net assets (including its CTA share). */
  netAssets: string;
  /** The subsidiary's translated net income. */
  netIncome: string;
  /** The subsidiary's CTA (already included in netAssets). */
  cta: string;
  /** nciPercent x netAssets. */
  nci: string;
  /** nciPercent x netIncome. */
  nciNetIncome: string;
}

export interface ConsolidatedTotals {
  assets: string;
  liabilities: string;
  netAssets: string;
  revenue: string;
  expense: string;
  netIncome: string;
  shareCapital: string;
  retainedEarnings: string;
  equityTransactions: string;
  cta: string;
  equityTotal: string;
  balanceDifference: string;
  /**
   * NCI attribution is only emitted when the group actually has minority
   * interests. A 100%-owned group keeps the legacy report shape (NCI = 0).
   */
  nci?: string;
  nciNetIncome?: string;
  parentNetIncome?: string;
  parentEquity?: string;
}

export interface ConsolidationChecks {
  entityFunctionalBalanced: boolean;
  intercompanyCleared: boolean;
  groupBalanced: boolean;
  /**
   * True when every entity's functional trial balance is exact, i.e. the CTA
   * is a pure translation residual and does not hide a bookkeeping error.
   */
  ctaTranslationOnly: boolean;
  /** Present only when the group has minority interests. */
  nciBalanced?: boolean;
  /** Present only when intercompany P&L balances were eliminated. */
  icPnlCleared?: boolean;
  balanced: boolean;
}

export interface ConsolidationReport {
  period: string;
  groupCurrency: string;
  entities: EntityConsolidationReport[];
  translatedTransactions: TranslatedTransaction[];
  eliminations: {
    lines: EliminationLine[];
    totalReceivable: string;
    totalPayable: string;
    totalDifference: string;
    cleared: boolean;
    /** Only present when intercompany P&L accounts carry a balance. */
    pnl?: PnlEliminationReport;
  };
  /** Only present when the group has minority interests. */
  nciAllocations?: NciAllocation[];
  /** Group totals after intercompany elimination. */
  group: ConsolidatedTotals;
  /** Group totals before intercompany elimination, for the elimination tie-out. */
  groupBeforeElimination: ConsolidatedTotals;
  checks: ConsolidationChecks;
  reportHash: string;
}

interface NormalizedEntity {
  entityId: string;
  name: string;
  functionalCurrency: string;
  parentEntityId: string | null;
  ownershipPercent: bigint;
  shareCapital: bigint;
  retainedEarnings: bigint;
}

interface NormalizedTransaction {
  date: string;
  entityId: string;
  accountType: AccountType;
  counterpartyEntityId: string | null;
  amount: bigint;
  currency: string;
  description: string;
}

interface ComputedLine {
  transaction: NormalizedTransaction;
  functionalAmount: bigint;
  transactionRate: bigint | null;
  groupRate: bigint;
  groupRateKind: GroupRateKind;
  groupAmount: bigint;
}

interface TotalsBig {
  assets: bigint;
  liabilities: bigint;
  netAssets: bigint;
  revenue: bigint;
  expense: bigint;
  netIncome: bigint;
  shareCapital: bigint;
  retainedEarnings: bigint;
  equityTransactions: bigint;
  cta: bigint;
  equityTotal: bigint;
  balanceDifference: bigint;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ensureString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConsolidationError(
      "INVALID_INPUT",
      `${label} must be a non-empty string`,
    );
  }
  return value.trim();
}

function normalizeCurrencyCode(value: unknown, label: string): string {
  const text = ensureString(value, label);
  try {
    return normalizeCurrency(text);
  } catch (error) {
    throw new ConsolidationError(
      "INVALID_CURRENCY",
      `${label}: ${(error as Error).message}`,
    );
  }
}

function parseAmount(value: unknown, label: string): bigint {
  const text = ensureString(value, label);
  try {
    return parseDecimal(text);
  } catch (error) {
    throw new ConsolidationError(
      "INVALID_AMOUNT",
      `${label}: ${(error as Error).message}`,
    );
  }
}

function parseRate(value: unknown, label: string): bigint {
  const rate = parseAmount(value, label);
  if (rate <= 0n) {
    throw new ConsolidationError(
      "INVALID_RATE",
      `${label} must be positive (got ${formatDecimal(rate)})`,
    );
  }
  return rate;
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConsolidationError(
      "INVALID_DATE",
      `${label} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(value)}`,
    );
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ConsolidationError(
      "INVALID_DATE",
      `${label} is not a real calendar date: ${value}`,
    );
  }
}

function isAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPE_SET.has(value);
}

function parseRateMap(
  record: Record<string, string> | undefined,
  label: string,
): Map<string, bigint> {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new ConsolidationError(
      "INVALID_RATE",
      `${label} must be an object of currency -> rate`,
    );
  }
  const rates = new Map<string, bigint>();
  for (const [rawCode, rawRate] of Object.entries(record)) {
    const code = normalizeCurrencyCode(rawCode, `${label} currency`);
    if (rates.has(code)) {
      throw new ConsolidationError(
        "INVALID_RATE",
        `${label} defines ${code} more than once`,
      );
    }
    rates.set(code, parseRate(rawRate, `${label}.${code}`));
  }
  return rates;
}

/**
 * Parsed rate lookup. The group currency always has an implicit rate of 1;
 * if it is present in a table it must be exactly 1.
 */
class RateBook {
  readonly period: string;
  private readonly closingRates: Map<string, bigint>;
  private readonly averageRates: Map<string, bigint>;
  private readonly historicalRates: Map<string, bigint>;
  private readonly transactionRates: Map<string, Map<string, bigint>>;

  constructor(
    table: RateTable,
    private readonly groupCurrency: string,
  ) {
    this.period = ensureString(table.period, "rates.period");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.period)) {
      throw new ConsolidationError(
        "INVALID_PERIOD",
        `rates.period must be YYYY-MM, got ${JSON.stringify(this.period)}`,
      );
    }
    this.closingRates = parseRateMap(table.closing, "rates.closing");
    this.averageRates = parseRateMap(table.average, "rates.average");
    this.historicalRates = parseRateMap(table.historical, "rates.historical");
    this.transactionRates = new Map();
    const daily = table.transactionRates;
    if (daily !== undefined && daily !== null) {
      if (typeof daily !== "object" || Array.isArray(daily)) {
        throw new ConsolidationError(
          "INVALID_RATE",
          "rates.transactionRates must be an object of date -> rates",
        );
      }
      for (const [rawDate, rawRates] of Object.entries(daily)) {
        const date = ensureString(rawDate, "rates.transactionRates date");
        assertIsoDate(date, "rates.transactionRates date");
        this.transactionRates.set(
          date,
          parseRateMap(rawRates, `rates.transactionRates.${date}`),
        );
      }
    }
    this.assertGroupRateIsOne(this.closingRates, "rates.closing");
    this.assertGroupRateIsOne(this.averageRates, "rates.average");
    this.assertGroupRateIsOne(this.historicalRates, "rates.historical");
  }

  closing(currency: string): bigint {
    return this.resolve(this.closingRates, currency, "closing");
  }

  average(currency: string): bigint {
    return this.resolve(this.averageRates, currency, "average");
  }

  historical(currency: string): bigint {
    return this.resolve(this.historicalRates, currency, "historical");
  }

  transaction(date: string, currency: string): bigint {
    const rates = this.transactionRates.get(date);
    if (!rates) {
      throw new ConsolidationError(
        "MISSING_RATE",
        `rates.transactionRates has no entry for ${date}`,
      );
    }
    return this.resolve(rates, currency, `transaction ${date}`);
  }

  private resolve(
    rates: Map<string, bigint>,
    currency: string,
    label: string,
  ): bigint {
    if (currency === this.groupCurrency) {
      const explicit = rates.get(currency);
      if (explicit !== undefined && explicit !== FACTOR) {
        throw new ConsolidationError(
          "INVALID_RATE",
          `${label} rate for group currency ${currency} must be 1 (got ${formatDecimal(explicit)})`,
        );
      }
      return FACTOR;
    }
    const rate = rates.get(currency);
    if (rate === undefined) {
      throw new ConsolidationError(
        "MISSING_RATE",
        `${label} rate is missing for ${currency}`,
      );
    }
    return rate;
  }

  private assertGroupRateIsOne(rates: Map<string, bigint>, label: string): void {
    const rate = rates.get(this.groupCurrency);
    if (rate !== undefined && rate !== FACTOR) {
      throw new ConsolidationError(
        "INVALID_RATE",
        `${label} rate for group currency ${this.groupCurrency} must be 1 (got ${formatDecimal(rate)})`,
      );
    }
  }
}

function normalizeEntities(
  entities: readonly EntityDefinition[],
): Map<string, NormalizedEntity> {
  if (!Array.isArray(entities) || entities.length === 0) {
    throw new ConsolidationError(
      "INVALID_ENTITY",
      "at least one legal entity is required",
    );
  }
  const byId = new Map<string, NormalizedEntity>();
  for (const [index, entity] of entities.entries()) {
    if (entity === null || typeof entity !== "object") {
      throw new ConsolidationError(
        "INVALID_ENTITY",
        `entities[${index}] must be an object`,
      );
    }
    const entityId = ensureString(entity.entityId, `entities[${index}].entityId`);
    if (byId.has(entityId)) {
      throw new ConsolidationError(
        "DUPLICATE_ENTITY",
        `duplicate entityId ${entityId}`,
      );
    }
    const functionalCurrency = normalizeCurrencyCode(
      entity.functionalCurrency,
      `${entityId}.functionalCurrency`,
    );
    const parentRaw = entity.parentEntityId;
    const parentEntityId =
      parentRaw === undefined || parentRaw === null
        ? null
        : ensureString(parentRaw, `${entityId}.parentEntityId`);
    const ownershipPercent = parseAmount(
      entity.ownershipPercent,
      `${entityId}.ownershipPercent`,
    );
    if (ownershipPercent < 0n || ownershipPercent > 100n * FACTOR) {
      throw new ConsolidationError(
        "INVALID_OWNERSHIP",
        `${entityId}: ownershipPercent must be between 0 and 100, ` +
          `got ${formatDecimal(ownershipPercent)}`,
      );
    }
    const equity = entity.equity;
    if (equity === null || typeof equity !== "object") {
      throw new ConsolidationError(
        "INVALID_ENTITY",
        `${entityId}.equity must be an object`,
      );
    }
    const shareCapital = parseAmount(
      equity.shareCapital,
      `${entityId}.equity.shareCapital`,
    );
    const retainedEarnings = parseAmount(
      equity.retainedEarnings,
      `${entityId}.equity.retainedEarnings`,
    );
    byId.set(entityId, {
      entityId,
      name: ensureString(entity.name, `${entityId}.name`),
      functionalCurrency,
      parentEntityId,
      ownershipPercent,
      shareCapital,
      retainedEarnings,
    });
  }

  let roots = 0;
  for (const entity of byId.values()) {
    if (entity.parentEntityId === null) roots += 1;
    const path = new Set<string>();
    let current: NormalizedEntity | undefined = entity;
    while (current) {
      if (path.has(current.entityId)) {
        throw new ConsolidationError(
          "INVALID_HIERARCHY",
          `ownership cycle detected at ${current.entityId}`,
        );
      }
      path.add(current.entityId);
      if (current.parentEntityId === null) break;
      const parent = byId.get(current.parentEntityId);
      if (!parent) {
        throw new ConsolidationError(
          "INVALID_HIERARCHY",
          `${current.entityId} references unknown parent ${current.parentEntityId}`,
        );
      }
      current = parent;
    }
  }
  if (roots !== 1) {
    throw new ConsolidationError(
      "INVALID_HIERARCHY",
      `exactly one group parent is required, found ${roots}`,
    );
  }
  return byId;
}

/**
 * Effective ownership from the group parent, in percent (1e6 scale).
 * The parent itself is 100%; each step multiplies by the direct percentage.
 * Multi-level minorities therefore do not get double counted:
 * 80% x 100% = 80%, not 100%.
 */
function computeEffectiveOwnership(
  entities: Map<string, NormalizedEntity>,
): Map<string, bigint> {
  const memo = new Map<string, bigint>();
  const visiting = new Set<string>();
  const visit = (entityId: string): bigint => {
    const cached = memo.get(entityId);
    if (cached !== undefined) return cached;
    const entity = entities.get(entityId);
    if (!entity) {
      throw new ConsolidationError(
        "UNKNOWN_ENTITY",
        `effective ownership requested for unknown entity ${entityId}`,
      );
    }
    if (entity.parentEntityId === null) {
      const root = 100n * FACTOR;
      memo.set(entityId, root);
      return root;
    }
    if (visiting.has(entityId)) {
      throw new ConsolidationError(
        "INVALID_HIERARCHY",
        `ownership cycle detected at ${entityId}`,
      );
    }
    visiting.add(entityId);
    const parentEffective = visit(entity.parentEntityId);
    visiting.delete(entityId);
    const effective = divRound(
      parentEffective * entity.ownershipPercent,
      100n * FACTOR,
      "HALF_UP",
    );
    memo.set(entityId, effective);
    return effective;
  };
  for (const entityId of entities.keys()) visit(entityId);
  return memo;
}

function normalizeTransactions(
  transactions: readonly TransactionInput[],
  period: string,
  entities: Map<string, NormalizedEntity>,
): NormalizedTransaction[] {
  if (!Array.isArray(transactions)) {
    throw new ConsolidationError(
      "INVALID_INPUT",
      "transactions must be an array",
    );
  }
  return transactions.map((transaction, index) => {
    const label = `transactions[${index}]`;
    if (transaction === null || typeof transaction !== "object") {
      throw new ConsolidationError(
        "INVALID_INPUT",
        `${label} must be an object`,
      );
    }
    const date = ensureString(transaction.date, `${label}.date`);
    assertIsoDate(date, `${label}.date`);
    if (date.slice(0, 7) !== period) {
      throw new ConsolidationError(
        "PERIOD_MISMATCH",
        `${label}.date ${date} is outside period ${period}`,
      );
    }
    const entityId = ensureString(transaction.entityId, `${label}.entityId`);
    if (!entities.has(entityId)) {
      throw new ConsolidationError(
        "UNKNOWN_ENTITY",
        `${label}.entityId ${entityId} is not defined in entities.json`,
      );
    }
    const accountTypeText = ensureString(
      transaction.accountType,
      `${label}.accountType`,
    ).toUpperCase();
    if (!isAccountType(accountTypeText)) {
      throw new ConsolidationError(
        "INVALID_ACCOUNT_TYPE",
        `${label}.accountType must be one of ${ACCOUNT_TYPES.join("/")}, ` +
          `got ${JSON.stringify(transaction.accountType)}`,
      );
    }
    const currency = normalizeCurrencyCode(
      transaction.currency,
      `${label}.currency`,
    );
    const amount = parseAmount(transaction.amount, `${label}.amount`);
    const counterpartyRaw = transaction.counterpartyEntityId;
    const counterpartyEntityId =
      counterpartyRaw === undefined ||
      counterpartyRaw === null ||
      (typeof counterpartyRaw === "string" && counterpartyRaw.trim() === "")
        ? null
        : ensureString(counterpartyRaw, `${label}.counterpartyEntityId`);
    if (COUNTERPARTY_REQUIRED_ACCOUNT_TYPES.has(accountTypeText)) {
      if (counterpartyEntityId === null) {
        throw new ConsolidationError(
          "INTERCOMPANY_COUNTERPARTY_REQUIRED",
          `${label}: ${accountTypeText} requires counterpartyEntityId`,
        );
      }
      if (counterpartyEntityId === entityId) {
        throw new ConsolidationError(
          "INTERCOMPANY_SELF_REFERENCE",
          `${label}: ${accountTypeText} cannot reference the same entity`,
        );
      }
    }
    if (counterpartyEntityId !== null && !entities.has(counterpartyEntityId)) {
      throw new ConsolidationError(
        "UNKNOWN_COUNTERPARTY",
        `${label}.counterpartyEntityId ${counterpartyEntityId} is not defined in entities.json`,
      );
    }
    return {
      date,
      entityId,
      accountType: accountTypeText,
      counterpartyEntityId,
      amount,
      currency,
      description:
        typeof transaction.description === "string"
          ? transaction.description.trim()
          : "",
    };
  });
}

function convertToFunctional(
  amount: bigint,
  currency: string,
  functionalCurrency: string,
  date: string,
  rateBook: RateBook,
): { functionalAmount: bigint; transactionRate: bigint | null } {
  if (currency === functionalCurrency) {
    return { functionalAmount: amount, transactionRate: null };
  }
  const currencyRate = rateBook.transaction(date, currency);
  const functionalRate = rateBook.transaction(date, functionalCurrency);
  // amount is in transaction-currency micro-units; dividing the two USD rates
  // gives the functional-currency amount with a single HALF_UP rounding.
  const functionalAmount = divRound(
    amount * currencyRate,
    functionalRate,
    "HALF_UP",
  );
  const transactionRate = divRound(
    currencyRate * FACTOR,
    functionalRate,
    "HALF_UP",
  );
  return { functionalAmount, transactionRate };
}

function computeTotals(input: {
  assets: bigint;
  liabilities: bigint;
  revenue: bigint;
  expense: bigint;
  shareCapital: bigint;
  retainedEarnings: bigint;
  equityTransactions: bigint;
  cta: bigint;
}): TotalsBig {
  const netIncome = input.revenue - input.expense;
  const equityTotal =
    input.shareCapital +
    input.retainedEarnings +
    input.equityTransactions +
    netIncome +
    input.cta;
  return {
    assets: input.assets,
    liabilities: input.liabilities,
    netAssets: input.assets - input.liabilities,
    revenue: input.revenue,
    expense: input.expense,
    netIncome,
    shareCapital: input.shareCapital,
    retainedEarnings: input.retainedEarnings,
    equityTransactions: input.equityTransactions,
    cta: input.cta,
    equityTotal,
    balanceDifference: input.assets - input.liabilities - equityTotal,
  };
}

interface NciSummary {
  nci: bigint;
  nciNetIncome: bigint;
  parentNetIncome: bigint;
  parentEquity: bigint;
}

function formatTotals(
  totals: TotalsBig,
  nci?: NciSummary,
): ConsolidatedTotals {
  const formatted: ConsolidatedTotals = {
    assets: formatDecimal(totals.assets),
    liabilities: formatDecimal(totals.liabilities),
    netAssets: formatDecimal(totals.netAssets),
    revenue: formatDecimal(totals.revenue),
    expense: formatDecimal(totals.expense),
    netIncome: formatDecimal(totals.netIncome),
    shareCapital: formatDecimal(totals.shareCapital),
    retainedEarnings: formatDecimal(totals.retainedEarnings),
    equityTransactions: formatDecimal(totals.equityTransactions),
    cta: formatDecimal(totals.cta),
    equityTotal: formatDecimal(totals.equityTotal),
    balanceDifference: formatDecimal(totals.balanceDifference),
  };
  if (nci) {
    formatted.nci = formatDecimal(nci.nci);
    formatted.nciNetIncome = formatDecimal(nci.nciNetIncome);
    formatted.parentNetIncome = formatDecimal(nci.parentNetIncome);
    formatted.parentEquity = formatDecimal(nci.parentEquity);
  }
  return formatted;
}

interface PnlEliminationResult {
  lines: PnlEliminationLine[];
  totalRevenue: bigint;
  totalExpense: bigint;
  totalDifference: bigint;
}

interface EliminationResult {
  lines: EliminationLine[];
  totalReceivable: bigint;
  totalPayable: bigint;
  totalDifference: bigint;
  pnl?: PnlEliminationResult;
}

function buildEliminations(lines: readonly ComputedLine[]): EliminationResult {
  const balanceBuckets = new Map<
    string,
    { entities: [string, string]; receivable: bigint; payable: bigint }
  >();
  const pnlBuckets = new Map<
    string,
    { entities: [string, string]; revenue: bigint; expense: bigint }
  >();
  for (const line of lines) {
    const { accountType, entityId, counterpartyEntityId } = line.transaction;
    const isBalance = INTERCOMPANY_ACCOUNT_TYPES.has(accountType);
    const isPnl = INTERCOMPANY_PNL_SET.has(accountType);
    if (!isBalance && !isPnl) continue;
    if (counterpartyEntityId === null) {
      // normalizeTransactions already rejects this; keep the guard defensive.
      throw new ConsolidationError(
        "INTERCOMPANY_COUNTERPARTY_REQUIRED",
        `${entityId}: ${accountType} requires counterpartyEntityId`,
      );
    }
    const [first, second] =
      entityId < counterpartyEntityId
        ? [entityId, counterpartyEntityId]
        : [counterpartyEntityId, entityId];
    const key = `${first}|${second}`;
    if (isBalance) {
      let bucket = balanceBuckets.get(key);
      if (!bucket) {
        bucket = { entities: [first, second], receivable: 0n, payable: 0n };
        balanceBuckets.set(key, bucket);
      }
      if (accountType === "INTERCOMPANY_AR") {
        bucket.receivable += line.groupAmount;
      } else {
        bucket.payable += line.groupAmount;
      }
      continue;
    }
    let bucket = pnlBuckets.get(key);
    if (!bucket) {
      bucket = { entities: [first, second], revenue: 0n, expense: 0n };
      pnlBuckets.set(key, bucket);
    }
    if (accountType === "INTERCOMPANY_REVENUE") {
      bucket.revenue += line.groupAmount;
    } else {
      bucket.expense += line.groupAmount;
    }
  }

  const linesOut: EliminationLine[] = [];
  const imbalances: string[] = [];
  let totalReceivable = 0n;
  let totalPayable = 0n;
  for (const key of [...balanceBuckets.keys()].sort(compareStrings)) {
    const bucket = balanceBuckets.get(key);
    if (!bucket) continue;
    const difference = bucket.receivable - bucket.payable;
    totalReceivable += bucket.receivable;
    totalPayable += bucket.payable;
    linesOut.push({
      entities: bucket.entities,
      receivable: formatDecimal(bucket.receivable),
      payable: formatDecimal(bucket.payable),
      difference: formatDecimal(difference),
    });
    if (difference !== 0n) {
      imbalances.push(
        `${key} receivable=${formatDecimal(bucket.receivable)} ` +
          `payable=${formatDecimal(bucket.payable)} ` +
          `difference=${formatDecimal(difference)}`,
      );
    }
  }
  if (imbalances.length > 0) {
    throw new ConsolidationError(
      "INTERCOMPANY_IMBALANCE",
      "intercompany AR/AP do not clear after closing-rate translation " +
        `(difference must be 0): ${imbalances.join("; ")}`,
    );
  }

  let pnl: PnlEliminationResult | undefined;
  if (pnlBuckets.size > 0) {
    const pnlLines: PnlEliminationLine[] = [];
    const pnlImbalances: string[] = [];
    let totalRevenue = 0n;
    let totalExpense = 0n;
    for (const key of [...pnlBuckets.keys()].sort(compareStrings)) {
      const bucket = pnlBuckets.get(key);
      if (!bucket) continue;
      const difference = bucket.revenue - bucket.expense;
      totalRevenue += bucket.revenue;
      totalExpense += bucket.expense;
      pnlLines.push({
        entities: bucket.entities,
        revenue: formatDecimal(bucket.revenue),
        expense: formatDecimal(bucket.expense),
        difference: formatDecimal(difference),
      });
      if (difference !== 0n) {
        pnlImbalances.push(
          `${key} revenue=${formatDecimal(bucket.revenue)} ` +
            `expense=${formatDecimal(bucket.expense)} ` +
            `difference=${formatDecimal(difference)}`,
        );
      }
    }
    if (pnlImbalances.length > 0) {
      throw new ConsolidationError(
        "INTERCOMPANY_PNL_IMBALANCE",
        "intercompany revenue/expense do not clear after average-rate " +
          `translation (difference must be 0): ${pnlImbalances.join("; ")}`,
      );
    }
    pnl = {
      lines: pnlLines,
      totalRevenue,
      totalExpense,
      totalDifference: totalRevenue - totalExpense,
    };
  }

  return {
    lines: linesOut,
    totalReceivable,
    totalPayable,
    totalDifference: totalReceivable - totalPayable,
    ...(pnl ? { pnl } : {}),
  };
}

function transactionSortKey(line: ComputedLine): string {
  const tx = line.transaction;
  return [
    tx.date,
    tx.entityId,
    tx.accountType,
    tx.counterpartyEntityId ?? "",
    tx.currency,
    formatDecimal(tx.amount),
    tx.description,
  ].join("\u001f");
}

/**
 * Run the shadow consolidation. Throws `ConsolidationError` when the input is
 * invalid, an entity's functional books do not balance, intercompany balances
 * do not clear, or the group balance sheet fails its tie-out. A returned
 * report is therefore always balanced by construction and by verification.
 */
export function consolidateEntities(
  input: ConsolidationInput,
): ConsolidationReport {
  if (input === null || typeof input !== "object") {
    throw new ConsolidationError(
      "INVALID_INPUT",
      "consolidation input must be an object",
    );
  }
  const groupCurrency = normalizeCurrencyCode(
    input.groupCurrency ?? "USD",
    "groupCurrency",
  );
  const rates = input.rates;
  if (rates === null || typeof rates !== "object") {
    throw new ConsolidationError("INVALID_INPUT", "rates must be an object");
  }
  const rateBook = new RateBook(rates, groupCurrency);
  const period = rateBook.period;
  const entities = normalizeEntities(input.entities);
  const transactions = normalizeTransactions(input.transactions, period, entities);
  const effectiveOwnership = computeEffectiveOwnership(entities);

  interface Accumulator {
    entity: NormalizedEntity;
    balances: Map<AccountType, bigint>;
    lines: ComputedLine[];
  }

  const accumulators = new Map<string, Accumulator>();
  for (const entity of entities.values()) {
    accumulators.set(entity.entityId, {
      entity,
      balances: new Map(
        ACCOUNT_TYPES.map((accountType) => [accountType, 0n] as const),
      ),
      lines: [],
    });
  }

  for (const transaction of transactions) {
    const accumulator = accumulators.get(transaction.entityId);
    if (!accumulator) {
      throw new ConsolidationError(
        "UNKNOWN_ENTITY",
        `transaction references unknown entity ${transaction.entityId}`,
      );
    }
    const entity = accumulator.entity;
    const { functionalAmount, transactionRate } = convertToFunctional(
      transaction.amount,
      transaction.currency,
      entity.functionalCurrency,
      transaction.date,
      rateBook,
    );
    const rateKind = GROUP_RATE_KIND_BY_ACCOUNT[transaction.accountType];
    const groupRate =
      rateKind === "CLOSING"
        ? rateBook.closing(entity.functionalCurrency)
        : rateKind === "AVERAGE"
          ? rateBook.average(entity.functionalCurrency)
          : rateBook.historical(entity.functionalCurrency);
    const groupAmount = mul(functionalAmount, groupRate, "HALF_UP");
    accumulator.balances.set(
      transaction.accountType,
      (accumulator.balances.get(transaction.accountType) ?? 0n) +
        functionalAmount,
    );
    accumulator.lines.push({
      transaction,
      functionalAmount,
      transactionRate,
      groupRate,
      groupRateKind: rateKind,
      groupAmount,
    });
  }

  const orderedEntities = [...entities.values()].sort((a, b) =>
    compareStrings(a.entityId, b.entityId),
  );
  const entityReports: EntityConsolidationReport[] = [];
  const allLines: ComputedLine[] = [];

  let sumAssets = 0n;
  let sumLiabilities = 0n;
  let sumRevenue = 0n;
  let sumExpense = 0n;
  let sumShareCapital = 0n;
  let sumRetainedEarnings = 0n;
  let sumEquityTransactions = 0n;
  let sumCta = 0n;
  const nciAllocations: NciAllocation[] = [];
  let nciTotal = 0n;
  let nciNetIncomeTotal = 0n;

  for (const entity of orderedEntities) {
    const accumulator = accumulators.get(entity.entityId);
    if (!accumulator) {
      throw new ConsolidationError(
        "UNKNOWN_ENTITY",
        `missing accumulator for ${entity.entityId}`,
      );
    }
    allLines.push(...accumulator.lines);
    const balances = accumulator.balances;
    const balanceOf = (accountType: AccountType): bigint =>
      balances.get(accountType) ?? 0n;

    const functionalAssets =
      balanceOf("ASSET") + balanceOf("INTERCOMPANY_AR");
    const functionalLiabilities =
      balanceOf("LIABILITY") + balanceOf("INTERCOMPANY_AP");
    const openingEquity = entity.shareCapital + entity.retainedEarnings;
    const equityTransactions = balanceOf("EQUITY");
    const functionalRevenue =
      balanceOf("REVENUE") + balanceOf("INTERCOMPANY_REVENUE");
    const functionalExpense =
      balanceOf("EXPENSE") + balanceOf("INTERCOMPANY_EXPENSE");
    const functionalNetIncome = functionalRevenue - functionalExpense;
    const functionalDifference =
      functionalAssets -
      functionalLiabilities -
      openingEquity -
      equityTransactions -
      functionalNetIncome;
    if (functionalDifference !== 0n) {
      throw new ConsolidationError(
        "ENTITY_UNBALANCED",
        `${entity.entityId} functional books do not balance: ` +
          `assets=${formatDecimal(functionalAssets)} ` +
          `liabilities=${formatDecimal(functionalLiabilities)} ` +
          `equity=${formatDecimal(openingEquity + equityTransactions)} ` +
          `netIncome=${formatDecimal(functionalNetIncome)} ` +
          `difference=${formatDecimal(functionalDifference)}`,
      );
    }

    let assetsUsd = 0n;
    let liabilitiesUsd = 0n;
    let revenueUsd = 0n;
    let expenseUsd = 0n;
    let equityTransactionsUsd = 0n;
    for (const line of accumulator.lines) {
      switch (line.transaction.accountType) {
        case "ASSET":
        case "INTERCOMPANY_AR":
          assetsUsd += line.groupAmount;
          break;
        case "LIABILITY":
        case "INTERCOMPANY_AP":
          liabilitiesUsd += line.groupAmount;
          break;
        case "REVENUE":
        case "INTERCOMPANY_REVENUE":
          revenueUsd += line.groupAmount;
          break;
        case "EXPENSE":
        case "INTERCOMPANY_EXPENSE":
          expenseUsd += line.groupAmount;
          break;
        case "EQUITY":
          equityTransactionsUsd += line.groupAmount;
          break;
      }
    }
    const shareCapitalUsd = mul(
      entity.shareCapital,
      rateBook.historical(entity.functionalCurrency),
      "HALF_UP",
    );
    const retainedEarningsUsd = mul(
      entity.retainedEarnings,
      rateBook.historical(entity.functionalCurrency),
      "HALF_UP",
    );
    const netIncomeUsd = revenueUsd - expenseUsd;
    const cta =
      assetsUsd -
      liabilitiesUsd -
      shareCapitalUsd -
      retainedEarningsUsd -
      equityTransactionsUsd -
      netIncomeUsd;
    const equityTotal =
      shareCapitalUsd +
      retainedEarningsUsd +
      equityTransactionsUsd +
      netIncomeUsd +
      cta;
    const translatedDifference =
      assetsUsd - liabilitiesUsd - equityTotal;
    if (translatedDifference !== 0n) {
      // Defensive: allocated CTA makes this impossible unless the engine is
      // broken. Never publish an unbalanced group balance sheet.
      throw new ConsolidationError(
        "GROUP_UNBALANCED",
        `${entity.entityId} translated balance sheet does not balance: ` +
          `difference=${formatDecimal(translatedDifference)}`,
      );
    }

    const balancesReport = Object.fromEntries(
      BALANCE_ACCOUNT_TYPES.map((accountType) => [
        accountType,
        formatDecimal(balanceOf(accountType)),
      ]),
    ) as EntityBalancesReport;
    for (const accountType of INTERCOMPANY_PNL_ACCOUNT_TYPES) {
      const value = balanceOf(accountType);
      // Emit only non-zero IC P&L balances so 100%-owned reports keep their
      // legacy shape.
      if (value !== 0n) balancesReport[accountType] = formatDecimal(value);
    }

    entityReports.push({
      entityId: entity.entityId,
      name: entity.name,
      functionalCurrency: entity.functionalCurrency,
      parentEntityId: entity.parentEntityId,
      ownershipPercent: formatDecimal(entity.ownershipPercent),
      functional: {
        balances: balancesReport,
        openingEquity: {
          shareCapital: formatDecimal(entity.shareCapital),
          retainedEarnings: formatDecimal(entity.retainedEarnings),
          total: formatDecimal(openingEquity),
        },
        revenue: formatDecimal(functionalRevenue),
        expense: formatDecimal(functionalExpense),
        netIncome: formatDecimal(functionalNetIncome),
        totalAssets: formatDecimal(functionalAssets),
        totalLiabilities: formatDecimal(functionalLiabilities),
        balanceDifference: formatDecimal(functionalDifference),
      },
      translated: {
        assets: formatDecimal(assetsUsd),
        liabilities: formatDecimal(liabilitiesUsd),
        netAssets: formatDecimal(assetsUsd - liabilitiesUsd),
        revenue: formatDecimal(revenueUsd),
        expense: formatDecimal(expenseUsd),
        netIncome: formatDecimal(netIncomeUsd),
        shareCapital: formatDecimal(shareCapitalUsd),
        retainedEarnings: formatDecimal(retainedEarningsUsd),
        equityTransactions: formatDecimal(equityTransactionsUsd),
        cta: formatDecimal(cta),
        equityTotal: formatDecimal(equityTotal),
        balanceDifference: formatDecimal(translatedDifference),
      },
      rates: {
        closing: formatDecimal(rateBook.closing(entity.functionalCurrency)),
        average: formatDecimal(rateBook.average(entity.functionalCurrency)),
        historical: formatDecimal(
          rateBook.historical(entity.functionalCurrency),
        ),
      },
    });

    sumAssets += assetsUsd;
    sumLiabilities += liabilitiesUsd;
    sumRevenue += revenueUsd;
    sumExpense += expenseUsd;
    sumShareCapital += shareCapitalUsd;
    sumRetainedEarnings += retainedEarningsUsd;
    sumEquityTransactions += equityTransactionsUsd;
    sumCta += cta;

    // NCI uses effective ownership, so a chain such as 80% -> 100% attributes
    // only the outside 20% slice once.
    const effectivePercent =
      effectiveOwnership.get(entity.entityId) ?? 100n * FACTOR;
    const nciPercent = 100n * FACTOR - effectivePercent;
    if (nciPercent > 0n) {
      const entityNetAssets = assetsUsd - liabilitiesUsd;
      const entityNci = divRound(
        entityNetAssets * nciPercent,
        100n * FACTOR,
        "HALF_UP",
      );
      const entityNciNetIncome = divRound(
        netIncomeUsd * nciPercent,
        100n * FACTOR,
        "HALF_UP",
      );
      nciTotal += entityNci;
      nciNetIncomeTotal += entityNciNetIncome;
      nciAllocations.push({
        entityId: entity.entityId,
        ownershipPercent: formatDecimal(entity.ownershipPercent),
        effectiveOwnershipPercent: formatDecimal(effectivePercent),
        nciPercent: formatDecimal(nciPercent),
        netAssets: formatDecimal(entityNetAssets),
        netIncome: formatDecimal(netIncomeUsd),
        cta: formatDecimal(cta),
        nci: formatDecimal(entityNci),
        nciNetIncome: formatDecimal(entityNciNetIncome),
      });
    }
  }

  const eliminations = buildEliminations(allLines);
  const eliminatedPnlRevenue = eliminations.pnl?.totalRevenue ?? 0n;
  const eliminatedPnlExpense = eliminations.pnl?.totalExpense ?? 0n;
  const groupBeforeEliminationBig = computeTotals({
    assets: sumAssets,
    liabilities: sumLiabilities,
    revenue: sumRevenue,
    expense: sumExpense,
    shareCapital: sumShareCapital,
    retainedEarnings: sumRetainedEarnings,
    equityTransactions: sumEquityTransactions,
    cta: sumCta,
  });
  const groupBig = computeTotals({
    assets: sumAssets - eliminations.totalReceivable,
    liabilities: sumLiabilities - eliminations.totalPayable,
    revenue: sumRevenue - eliminatedPnlRevenue,
    expense: sumExpense - eliminatedPnlExpense,
    shareCapital: sumShareCapital,
    retainedEarnings: sumRetainedEarnings,
    equityTransactions: sumEquityTransactions,
    cta: sumCta,
  });
  if (
    groupBeforeEliminationBig.balanceDifference !== 0n ||
    groupBig.balanceDifference !== 0n
  ) {
    throw new ConsolidationError(
      "GROUP_UNBALANCED",
      "group USD balance sheet does not balance: " +
        `beforeElimination=${formatDecimal(groupBeforeEliminationBig.balanceDifference)} ` +
        `afterElimination=${formatDecimal(groupBig.balanceDifference)}`,
    );
  }
  if (groupBig.netIncome !== groupBeforeEliminationBig.netIncome) {
    // Equal IC P&L elimination leaves group net income unchanged; anything
    // else would mean the elimination was not a pure offset.
    throw new ConsolidationError(
      "GROUP_UNBALANCED",
      "intercompany P&L elimination changed group net income: " +
        `beforeElimination=${formatDecimal(groupBeforeEliminationBig.netIncome)} ` +
        `afterElimination=${formatDecimal(groupBig.netIncome)}`,
    );
  }

  const hasMinorities = nciAllocations.length > 0;
  let nciSummary: NciSummary | undefined;
  let nciBalanced: boolean | undefined;
  if (hasMinorities) {
    const parentNetIncome = groupBig.netIncome - nciNetIncomeTotal;
    const parentEquity = groupBig.equityTotal - nciTotal;
    nciSummary = {
      nci: nciTotal,
      nciNetIncome: nciNetIncomeTotal,
      parentNetIncome,
      parentEquity,
    };
    nciBalanced =
      nciTotal + parentEquity === groupBig.equityTotal &&
      groupBig.assets - groupBig.liabilities === nciTotal + parentEquity;
  }

  const translatedTransactions: TranslatedTransaction[] = allLines
    .slice()
    .sort((a, b) => compareStrings(transactionSortKey(a), transactionSortKey(b)))
    .map((line) => {
      const tx = line.transaction;
      const entity = entities.get(tx.entityId);
      if (!entity) {
        throw new ConsolidationError(
          "UNKNOWN_ENTITY",
          `transaction references unknown entity ${tx.entityId}`,
        );
      }
      return {
        date: tx.date,
        entityId: tx.entityId,
        accountType: tx.accountType,
        counterpartyEntityId: tx.counterpartyEntityId,
        amount: formatDecimal(tx.amount),
        currency: tx.currency,
        functionalCurrency: entity.functionalCurrency,
        functionalAmount: formatDecimal(line.functionalAmount),
        translationKind:
          line.transactionRate === null
            ? "FUNCTIONAL"
            : "TRANSACTION_RATE",
        transactionRate:
          line.transactionRate === null
            ? null
            : formatDecimal(line.transactionRate),
        groupAmount: formatDecimal(line.groupAmount),
        groupRate: formatDecimal(line.groupRate),
        groupRateKind: line.groupRateKind,
        description: tx.description,
      };
    });

  const checks: ConsolidationChecks = {
    // Both are guaranteed by the throws above; a published report is balanced.
    entityFunctionalBalanced: true,
    intercompanyCleared: eliminations.totalDifference === 0n,
    groupBalanced:
      groupBeforeEliminationBig.balanceDifference === 0n &&
      groupBig.balanceDifference === 0n,
    // A balanced functional trial balance means every USD residual comes from
    // applying different rates to the same functional amounts.
    ctaTranslationOnly: true,
    balanced: true,
  };
  if (nciBalanced !== undefined) checks.nciBalanced = nciBalanced;
  if (eliminations.pnl) {
    checks.icPnlCleared = eliminations.pnl.totalDifference === 0n;
  }
  checks.balanced =
    checks.entityFunctionalBalanced &&
    checks.intercompanyCleared &&
    checks.groupBalanced &&
    checks.ctaTranslationOnly &&
    (checks.nciBalanced ?? true) &&
    (checks.icPnlCleared ?? true);

  const reportBase = {
    period,
    groupCurrency,
    entities: entityReports,
    translatedTransactions,
    eliminations: {
      lines: eliminations.lines,
      totalReceivable: formatDecimal(eliminations.totalReceivable),
      totalPayable: formatDecimal(eliminations.totalPayable),
      totalDifference: formatDecimal(eliminations.totalDifference),
      cleared: eliminations.totalDifference === 0n,
      ...(eliminations.pnl
        ? {
            pnl: {
              lines: eliminations.pnl.lines,
              totalRevenue: formatDecimal(eliminations.pnl.totalRevenue),
              totalExpense: formatDecimal(eliminations.pnl.totalExpense),
              totalDifference: formatDecimal(
                eliminations.pnl.totalDifference,
              ),
              cleared: eliminations.pnl.totalDifference === 0n,
            },
          }
        : {}),
    },
    ...(hasMinorities ? { nciAllocations } : {}),
    group: formatTotals(groupBig, nciSummary),
    groupBeforeElimination: formatTotals(groupBeforeEliminationBig),
    checks,
  };
  return {
    ...reportBase,
    reportHash: sha256(reportBase),
  };
}

/**
 * Minimal RFC 4180 CSV reader used by the fixture/CLI. Kept in this module so
 * the engine's fixture parser has no additional package dependency.
 */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (character === "\r") {
      continue;
    }
    field += character;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) =>
    candidate.some((cell) => cell.trim() !== ""),
  );
}

/** Parse the transactions.csv fixture into typed transaction inputs. */
export function parseTransactionsCsv(text: string): TransactionInput[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new ConsolidationError(
      "INVALID_INPUT",
      "transactions.csv is empty",
    );
  }
  const header = (rows[0] ?? []).map((cell) => cell.trim());
  const required = [
    "date",
    "entityId",
    "accountType",
    "counterpartyEntityId",
    "amount",
    "currency",
    "description",
  ];
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new ConsolidationError(
      "INVALID_INPUT",
      `transactions.csv is missing column(s): ${missing.join(", ")}`,
    );
  }
  const indexOf = new Map(header.map((column, index) => [column, index]));
  const cell = (row: readonly string[], column: string): string => {
    const index = indexOf.get(column);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  return rows.slice(1).map((row) => {
    const counterparty = cell(row, "counterpartyEntityId");
    return {
      date: cell(row, "date"),
      entityId: cell(row, "entityId"),
      accountType: cell(row, "accountType").toUpperCase() as AccountType,
      counterpartyEntityId: counterparty === "" ? null : counterparty,
      amount: cell(row, "amount"),
      currency: cell(row, "currency").toUpperCase(),
      description: cell(row, "description"),
    };
  });
}
