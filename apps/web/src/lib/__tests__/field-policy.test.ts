import { describe, expect, it } from "vitest";
import {
  buildConfiguredPolicies,
  isValidPolicyKey,
  normalizePolicyValue,
  type PolicyEditorRow,
} from "../field-policy.js";

function row(overrides: Partial<PolicyEditorRow> = {}): PolicyEditorRow {
  return {
    key: "EMPLOYMENT_CONTRACT.bankAccountRef",
    roles: "finance, admin",
    allowSelf: true,
    onDeny: "",
    match: {},
    overridden: true,
    ...overrides,
  };
}

describe("field policy editor logic", () => {
  it("normalizes the legacy role array", () => {
    expect(normalizePolicyValue(["finance", "admin"])).toEqual({
      roles: "finance, admin",
      allowSelf: true,
      onDeny: "",
      match: {},
    });
  });

  it("normalizes the object form", () => {
    expect(
      normalizePolicyValue({
        allowRoles: ["manager"],
        allowSelf: false,
        onDeny: "ZERO",
        match: { isSubjectManager: true },
      }),
    ).toEqual({
      roles: "manager",
      allowSelf: false,
      onDeny: "ZERO",
      match: { isSubjectManager: true },
    });
  });

  it("defaults self access to true when the object omits it", () => {
    expect(normalizePolicyValue({ allowRoles: ["finance"] }).allowSelf).toBe(
      true,
    );
  });

  it("only sends overridden rows and trims the role list", () => {
    const policies = buildConfiguredPolicies([
      row({ roles: " finance ,  admin " }),
      row({
        key: "EVIDENCE.normalizedPayload",
        overridden: false,
      }),
    ]);
    expect(Object.keys(policies)).toEqual([
      "EMPLOYMENT_CONTRACT.bankAccountRef",
    ]);
    expect(policies["EMPLOYMENT_CONTRACT.bankAccountRef"]).toEqual({
      allowRoles: ["finance", "admin"],
      allowSelf: true,
    });
  });

  it("supports self-only and explicit denial modes", () => {
    expect(
      buildConfiguredPolicies([
        row({ roles: "", allowSelf: true, onDeny: "OMIT" }),
      ]),
    ).toEqual({
      "EMPLOYMENT_CONTRACT.bankAccountRef": {
        allowSelf: true,
        onDeny: "OMIT",
      },
    });
  });

  it("drops predicates set to false", () => {
    expect(
      buildConfiguredPolicies([
        row({
          match: { isSubjectManager: true, sameOrgNode: false },
        }),
      ])["EMPLOYMENT_CONTRACT.bankAccountRef"],
    ).toEqual({
      allowRoles: ["finance", "admin"],
      allowSelf: true,
      match: { isSubjectManager: true },
    });
  });

  it("omits an empty match object", () => {
    const value = buildConfiguredPolicies([
      row({ match: { sameOrgNode: false } }),
    ])["EMPLOYMENT_CONTRACT.bankAccountRef"] as { match?: unknown };
    expect(value.match).toBeUndefined();
  });

  it("validates resource.field keys", () => {
    expect(isValidPolicyKey("EVIDENCE.normalizedPayload")).toBe(true);
    expect(isValidPolicyKey("PAYROLL_LINE.bankAccountRef")).toBe(true);
    expect(isValidPolicyKey("evidence.normalizedPayload")).toBe(false);
    expect(isValidPolicyKey("EVIDENCE")).toBe(false);
    expect(isValidPolicyKey("EVIDENCE.1bad")).toBe(false);
  });
});
