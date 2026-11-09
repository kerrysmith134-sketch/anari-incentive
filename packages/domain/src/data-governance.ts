import { CORE_ENTITY_CONTRACTS } from "./entity-contracts.js";

/**
 * DATA-05：核心实体表 → 保留期类别的静态映射。新增受策略保护的表时
 * 必须同时补此映射，否则 data-governance 测试失败。
 */
export const RESOURCE_RETENTION_CATEGORY: Record<string, string> = {
  employment_contracts: "PAYROLL_RECORDS",
  payroll_runs: "PAYROLL_RECORDS",
  payroll_lines: "PAYROLL_RECORDS",
  calculation_runs: "INCENTIVE_CALCULATIONS",
  calculation_lines: "INCENTIVE_CALCULATIONS",
  amount_ledger: "LEDGER",
  settlement_batches: "SETTLEMENT",
  settlement_lines: "SETTLEMENT",
  audit_events: "AUDIT",
};

export interface DataGovernanceCoverage {
  tables: number;
  mappedTables: number;
  piiColumns: number;
  missingTableMappings: string[];
  piiColumnsByTable: Record<string, string[]>;
}

export function dataGovernanceCoverage(): DataGovernanceCoverage {
  const missingTableMappings: string[] = [];
  const piiColumnsByTable: Record<string, string[]> = {};
  let piiColumns = 0;
  for (const contract of CORE_ENTITY_CONTRACTS) {
    if (!RESOURCE_RETENTION_CATEGORY[contract.table]) {
      missingTableMappings.push(contract.table);
    }
    const columns = contract.columns
      .filter((column) => column.classification === "PII")
      .map((column) => column.column);
    piiColumns += columns.length;
    if (columns.length > 0) piiColumnsByTable[contract.table] = columns;
  }
  return {
    tables: CORE_ENTITY_CONTRACTS.length,
    mappedTables: Object.keys(RESOURCE_RETENTION_CATEGORY).length,
    piiColumns,
    missingTableMappings,
    piiColumnsByTable,
  };
}
