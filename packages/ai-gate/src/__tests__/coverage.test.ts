import { describe, expect, it } from "vitest";
import { assessEvidenceCoverage } from "../coverage.js";
import type { ScoringEvidence } from "../scoring.js";

const base = {
  subjectType: "PERSON",
  subjectId: "00000000-0000-4000-8000-000000000001",
  cycleId: "00000000-0000-4000-8000-000000000020",
  dimensions: ["QUALITY", "TIMELINESS"],
};

describe("assessEvidenceCoverage (NPV2-004)", () => {
  it("produces no numeric scores or overallScore", () => {
    const result = assessEvidenceCoverage({
      ...base,
      evidence: [
        { id: "e1", type: "DELIVERY", text: "a", dimension: "QUALITY", quality: "VALID", sourceSystem: "erp" },
        { id: "e2", type: "DELIVERY", text: "b", dimension: "TIMELINESS", quality: "VALID", sourceSystem: "crm" },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"overallScore"');
    expect(serialized).not.toContain('"scores"');
    expect(result.coverageBand).toBe("ADEQUATE");
    expect(result.missingDimensions).toEqual([]);
    expect(result.sourceSystemCount).toBe(2);
    expect(result.sourceDiversity).toBe(1);
    expect(result.evidenceSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("marks insufficient dimensions instead of scoring them zero", () => {
    const result = assessEvidenceCoverage({
      ...base,
      evidence: [
        { id: "e1", type: "DELIVERY", text: "weak", dimension: "QUALITY", quality: "UNVERIFIED" },
      ],
    });
    const timeliness = result.dimensions.find((d) => d.dimension === "TIMELINESS");
    expect(timeliness?.status).toBe("NO_EVIDENCE");
    const quality = result.dimensions.find((d) => d.dimension === "QUALITY");
    expect(quality?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.missingDimensions).toEqual(["QUALITY", "TIMELINESS"]);
    expect(result.coverageBand).toBe("NONE");
  });

  it("distinguishes conflicting evidence from plain coverage", () => {
    const result = assessEvidenceCoverage({
      ...base,
      evidence: [
        { id: "e1", type: "DELIVERY", text: "a", dimension: "QUALITY", quality: "CONFLICTED" },
        { id: "e2", type: "DELIVERY", text: "b", dimension: "TIMELINESS", quality: "VALID" },
      ],
    });
    const quality = result.dimensions.find((d) => d.dimension === "QUALITY");
    expect(quality?.conflictedCount).toBe(1);
    expect(quality?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.conflictedEvidenceIds).toEqual(["e1"]);
  });

  it("is deterministic for identical input and order-insensitive", () => {
    const evidence: ScoringEvidence[] = [
      { id: "e1", type: "DELIVERY", text: "a", dimension: "QUALITY", quality: "VALID", sourceSystem: "erp" },
      { id: "e2", type: "NOTES", text: "b", dimension: "TIMELINESS", quality: "VALID", sourceSystem: "crm" },
    ];
    const a = assessEvidenceCoverage({ ...base, evidence });
    const b = assessEvidenceCoverage({ ...base, evidence: [...evidence].reverse() });
    expect(a.evidenceSnapshotHash).toBe(b.evidenceSnapshotHash);
    expect(a.coverageBand).toBe(b.coverageBand);
  });

  it("respects explicit requirement counts", () => {
    const result = assessEvidenceCoverage({
      ...base,
      evidence: [
        { id: "e1", type: "DELIVERY", text: "a", dimension: "QUALITY", quality: "VALID" },
      ],
      requirements: [{ dimension: "QUALITY", minValidEvidence: 3 }],
    });
    const quality = result.dimensions.find((d) => d.dimension === "QUALITY");
    expect(quality?.requiredCount).toBe(3);
    expect(quality?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(quality?.weightedCoverage).toBeLessThan(1);
  });
});
