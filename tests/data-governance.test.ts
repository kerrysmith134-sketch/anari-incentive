import { describe, expect, it } from "vitest";
import {
  RESOURCE_RETENTION_CATEGORY,
  dataGovernanceCoverage,
} from "@anari/domain";

describe("DATA-05 entity-contract retention coverage", () => {
  it("maps every core entity table to a retention category", () => {
    const coverage = dataGovernanceCoverage();
    expect(coverage.missingTableMappings).toEqual([]);
    expect(coverage.mappedTables).toBeGreaterThanOrEqual(coverage.tables);
  });

  it("exposes PII columns and their table mapping", () => {
    const coverage = dataGovernanceCoverage();
    expect(coverage.piiColumns).toBeGreaterThan(0);
    for (const table of Object.keys(coverage.piiColumnsByTable)) {
      expect(RESOURCE_RETENTION_CATEGORY[table]).toBeTruthy();
    }
  });
});
