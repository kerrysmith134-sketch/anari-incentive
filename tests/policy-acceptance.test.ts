import { describe, expect, it } from "vitest";
import {
  POLICY_ACCEPTANCE_CASES,
  renderAcceptanceMarkdown,
  runPolicyAcceptance,
} from "../scripts/policy-acceptance.js";

describe("2026 policy acceptance dataset", () => {
  it("covers every policy document and calculation family", () => {
    expect(POLICY_ACCEPTANCE_CASES.length).toBeGreaterThanOrEqual(30);
    const policies = new Set(POLICY_ACCEPTANCE_CASES.map((item) => item.policy));
    expect([...policies].some((policy) => policy.includes("017"))).toBe(true);
    expect([...policies].some((policy) => policy.includes("016"))).toBe(true);
    expect([...policies].some((policy) => policy.includes("008"))).toBe(true);
    expect([...policies].some((policy) => policy.includes("003"))).toBe(true);
    expect([...policies].some((policy) => policy.includes("011"))).toBe(true);
  });

  it("all acceptance calculations match independent expected values", () => {
    const report = runPolicyAcceptance();
    const failures = report.results.filter((result) => !result.passed);
    expect(
      failures.map((failure) => ({
        id: failure.id,
        mismatches: failure.mismatches,
      })),
    ).toEqual([]);
    expect(report.passed).toBe(POLICY_ACCEPTANCE_CASES.length);
  });

  it("renders a readable markdown report", () => {
    const report = runPolicyAcceptance();
    const markdown = renderAcceptanceMarkdown(report.results, "2026-11-09T00:00:00Z");
    expect(markdown).toContain("# 2026 制度验收报告");
    expect(markdown).toContain("| M-001 |");
  });
});
