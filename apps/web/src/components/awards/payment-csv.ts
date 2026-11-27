/**
 * 前端解析支付回执 CSV / 粘贴表格（纯函数，无副作用）。
 *
 * 支持逗号分隔 CSV 与从 Excel 复制的制表符数据；表头支持中英文别名。
 * 目标行可通过「行ID」「人员ID」「工号」任一列定位；同一批次内若同一人员
 * 有多行，则必须提供行ID，避免把钱记到错的行上。
 */
import {
  currentAccountingPeriod,
  decimalEquals,
  isValidAccountingPeriod,
  isValidPaymentAmount,
  type AwardCreditAccount,
  type AwardLineReconciliationStatus,
  type AwardPaymentStatus,
} from "./types.js";

export interface PaymentCsvPerson {
  id: string;
  employeeCode: string;
  displayName: string;
}

export interface PaymentCsvLineSource {
  lineId: string;
  personId: string;
  amount: string;
  currency: string;
  status: AwardLineReconciliationStatus;
}

export interface PaymentCsvPreviewRow {
  /** 在 CSV 中的物理行号（表头为第 1 行）。 */
  row: number;
  lineId?: string;
  personId?: string;
  personName?: string;
  paymentRef: string;
  amount: string;
  currency: string;
  status: AwardPaymentStatus;
  creditAccount: AwardCreditAccount;
  legalEntityId?: string;
  accountingPeriod?: string;
  failureCode?: string;
  /** 行级校验失败原因；有值时不会提交。 */
  error?: string;
}

export interface PaymentCsvParseResult {
  rows: PaymentCsvPreviewRow[];
  /** 表头/整体错误，此时 rows 为空。 */
  error?: string;
}

const NORMALIZED_ALIASES = {
  lineId: ["lineid", "行id", "明细id", "行标识", "line"],
  personId: ["personid", "人员id", "员工id", "person"],
  employeeCode: ["employeecode", "工号", "员工编号", "empno"],
  paymentRef: [
    "paymentref",
    "流水号",
    "回执号",
    "支付引用",
    "支付流水号",
    "ref",
    "transactionref",
  ],
  amount: ["amount", "金额", "支付金额"],
  status: ["status", "状态", "支付状态"],
  creditAccount: ["creditaccount", "贷方科目", "科目", "credit"],
  legalEntityId: ["legalentityid", "法人主体", "会计主体", "法人id"],
  accountingPeriod: ["accountingperiod", "会计期间", "期间"],
  failureCode: ["failurecode", "失败代码", "失败原因", "退回原因", "原因"],
} as const;

const PAYMENT_STATUS_ALIASES: Record<string, AwardPaymentStatus> = {
  PAID: "PAID",
  已支付: "PAID",
  已付款: "PAID",
  成功: "PAID",
  FAILED: "FAILED",
  失败: "FAILED",
  支付失败: "FAILED",
  RETURNED: "RETURNED",
  退回: "RETURNED",
  已退回: "RETURNED",
  退款: "RETURNED",
  退票: "RETURNED",
};

const CREDIT_ACCOUNT_ALIASES: Record<string, AwardCreditAccount> = {
  CASH: "CASH",
  现金: "CASH",
  银行存款: "CASH",
  PAYABLE: "PAYABLE",
  应付: "PAYABLE",
  应付账款: "PAYABLE",
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** 简单状态机 CSV 解析：支持引号、转义引号与字段内换行。 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
}

function normalizeStatus(value: string): AwardPaymentStatus | null {
  const text = value.trim();
  return PAYMENT_STATUS_ALIASES[text.toUpperCase()] ?? PAYMENT_STATUS_ALIASES[text] ?? null;
}

function normalizeCreditAccount(value: string): AwardCreditAccount | null {
  const text = value.trim();
  return (
    CREDIT_ACCOUNT_ALIASES[text.toUpperCase()] ??
    CREDIT_ACCOUNT_ALIASES[text] ??
    null
  );
}

function findColumn(
  headerIndex: ReadonlyMap<string, number>,
  aliases: ReadonlyArray<string>,
): number | undefined {
  for (const alias of aliases) {
    const found = headerIndex.get(normalizeHeader(alias));
    if (found !== undefined) return found;
  }
  return undefined;
}

function resolveTarget(
  lines: ReadonlyArray<PaymentCsvLineSource>,
  people: ReadonlyArray<PaymentCsvPerson>,
  keys: { lineId: string; personId: string; employeeCode: string },
): { line?: PaymentCsvLineSource; error?: string } {
  if (keys.lineId) {
    const line = lines.find((candidate) => candidate.lineId === keys.lineId);
    return line
      ? { line }
      : { error: `行ID「${keys.lineId}」不在本批次` };
  }
  let personId = keys.personId;
  if (!personId && keys.employeeCode) {
    const employeeCode = keys.employeeCode.toLowerCase();
    const person = people.find(
      (candidate) => candidate.employeeCode.toLowerCase() === employeeCode,
    );
    if (!person) {
      return { error: `工号「${keys.employeeCode}」没有匹配人员` };
    }
    personId = person.id;
  }
  if (!personId) {
    return { error: "缺少行ID、人员ID或工号" };
  }
  const matches = lines.filter((candidate) => candidate.personId === personId);
  if (matches.length === 0) {
    return { error: `人员不在本批次：${personId}` };
  }
  if (matches.length > 1) {
    return {
      error: `该人员在本批次有 ${matches.length} 行，请改用行ID定位`,
    };
  }
  return { line: matches[0] };
}

function targetBlockReason(
  status: AwardLineReconciliationStatus,
): string | null {
  switch (status) {
    case "PAID":
      return "该行已足额支付，如需调整请走冲正流程";
    case "OVERPAID":
      return "该行多付，需先冲正后再处理";
    case "PARTIAL":
      return "该行部分支付，需先调整/冲正后再处理";
    default:
      return null;
  }
}

export function parseAwardPaymentCsv(options: {
  text: string;
  lines: ReadonlyArray<PaymentCsvLineSource>;
  people: ReadonlyArray<PaymentCsvPerson>;
  currency: string;
}): PaymentCsvParseResult {
  const text = options.text.replace(/^\uFEFF/, "");
  if (!text.trim()) {
    return { rows: [], error: "请粘贴 CSV 内容或选择文件" };
  }
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);
  const header = table[0];
  if (!header) {
    return { rows: [], error: "CSV 为空" };
  }
  const headerIndex = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key && !headerIndex.has(key)) headerIndex.set(key, index);
  });
  const paymentRefColumn = findColumn(headerIndex, NORMALIZED_ALIASES.paymentRef);
  if (paymentRefColumn === undefined) {
    return {
      rows: [],
      error: "CSV 表头缺少「流水号 / payment_ref」列",
    };
  }
  const lineIdColumn = findColumn(headerIndex, NORMALIZED_ALIASES.lineId);
  const personIdColumn = findColumn(headerIndex, NORMALIZED_ALIASES.personId);
  const employeeCodeColumn = findColumn(
    headerIndex,
    NORMALIZED_ALIASES.employeeCode,
  );
  if (
    lineIdColumn === undefined &&
    personIdColumn === undefined &&
    employeeCodeColumn === undefined
  ) {
    return {
      rows: [],
      error: "CSV 表头需要「行ID」「人员ID」或「工号」列之一",
    };
  }
  const amountColumn = findColumn(headerIndex, NORMALIZED_ALIASES.amount);
  const statusColumn = findColumn(headerIndex, NORMALIZED_ALIASES.status);
  const creditAccountColumn = findColumn(
    headerIndex,
    NORMALIZED_ALIASES.creditAccount,
  );
  const legalEntityColumn = findColumn(
    headerIndex,
    NORMALIZED_ALIASES.legalEntityId,
  );
  const accountingPeriodColumn = findColumn(
    headerIndex,
    NORMALIZED_ALIASES.accountingPeriod,
  );
  const failureCodeColumn = findColumn(
    headerIndex,
    NORMALIZED_ALIASES.failureCode,
  );

  const defaultPeriod = currentAccountingPeriod();
  const seenLineIds = new Set<string>();
  const rows: PaymentCsvPreviewRow[] = [];

  table.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.every((cell) => !cell.trim())) return;
    const read = (column: number | undefined): string =>
      column === undefined ? "" : (cells[column] ?? "").trim();

    const keys = {
      lineId: read(lineIdColumn),
      personId: read(personIdColumn),
      employeeCode: read(employeeCodeColumn),
    };
    const { line, error: targetError } = resolveTarget(
      options.lines,
      options.people,
      keys,
    );
    const issues: string[] = [];
    if (targetError) issues.push(targetError);

    if (line) {
      const blocked = targetBlockReason(line.status);
      if (blocked) issues.push(blocked);
      if (seenLineIds.has(line.lineId)) {
        issues.push("同一行在本批导入中重复出现");
      } else {
        seenLineIds.add(line.lineId);
      }
    }

    const paymentRef = read(paymentRefColumn);
    if (!paymentRef) issues.push("缺少支付流水号");
    else if (paymentRef.length > 200) issues.push("支付流水号最多 200 字");

    const rawAmount = read(amountColumn) || line?.amount || "";
    if (!isValidPaymentAmount(rawAmount)) {
      issues.push("金额无效（需大于 0，最多 6 位小数）");
    } else if (line && !decimalEquals(rawAmount, line.amount)) {
      issues.push(`金额需与应付金额一致（${line.amount}）`);
    }

    const rawStatus = read(statusColumn);
    const status = normalizeStatus(rawStatus || "PAID");
    if (!status) issues.push("状态需为 PAID / FAILED / RETURNED");

    const rawCreditAccount = read(creditAccountColumn);
    const creditAccount = normalizeCreditAccount(
      rawCreditAccount || "CASH",
    );
    if (!creditAccount) issues.push("贷方科目需为 CASH / PAYABLE");

    const legalEntityId = read(legalEntityColumn);
    if (legalEntityId.length > 64) issues.push("法人主体最多 64 字");

    const accountingPeriod =
      read(accountingPeriodColumn) || defaultPeriod;
    if (!isValidAccountingPeriod(accountingPeriod)) {
      issues.push("会计期间格式需为 YYYY-MM");
    }

    const failureCode = read(failureCodeColumn);
    if (failureCode.length > 100) issues.push("失败原因最多 100 字");

    rows.push({
      row: rowNumber,
      lineId: line?.lineId,
      personId: line?.personId,
      personName: line
        ? options.people.find((person) => person.id === line.personId)
            ?.displayName
        : undefined,
      paymentRef,
      amount: rawAmount,
      currency: line?.currency ?? options.currency,
      status: status ?? "PAID",
      creditAccount: creditAccount ?? "CASH",
      legalEntityId: legalEntityId || undefined,
      accountingPeriod,
      failureCode:
        status === "PAID" ? undefined : failureCode || undefined,
      error: issues.length > 0 ? issues.join("；") : undefined,
    });
  });

  if (rows.length === 0) {
    return { rows: [], error: "CSV 没有可导入的数据行" };
  }
  return { rows };
}
