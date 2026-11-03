import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CORE_ENTITY_ACCESS,
  CORE_ENTITY_CONTRACTS,
} from "@anari/domain";

const manifest = JSON.parse(
  readFileSync(
    new URL("../docs/generated/access-contracts.json", import.meta.url),
    "utf8",
  ),
) as {
  entities: Record<
    string,
    {
      read: { self: boolean; roles: string[] };
      write: { self: boolean; roles: string[] };
      note?: string;
    }
  >;
};

const expected = Object.fromEntries(
  [...CORE_ENTITY_ACCESS]
    .sort((left, right) => left.entity.localeCompare(right.entity))
    .map((contract) => [
      contract.entity,
      {
        read: contract.read,
        write: contract.write,
        ...(contract.note ? { note: contract.note } : {}),
      },
    ]),
);

describe("entity access contracts", () => {
  it("keeps the generated manifest in sync", () => {
    expect(manifest.entities).toEqual(expected);
  });

  it("covers every persisted core entity exactly once", () => {
    const access = CORE_ENTITY_ACCESS.map((contract) => contract.entity);
    expect(new Set(access).size).toBe(access.length);
    for (const entity of CORE_ENTITY_CONTRACTS) {
      expect(access).toContain(entity.table);
    }
  });

  it("declares a non-empty read scope for every entity", () => {
    for (const contract of CORE_ENTITY_ACCESS) {
      expect(
        contract.read.self || contract.read.roles.length > 0,
        `${contract.entity} read scope`,
      ).toBe(true);
      expect(
        contract.write.self || contract.write.roles.length > 0,
        `${contract.entity} write scope`,
      ).toBe(true);
    }
  });

  it("keeps employee self-access and audit reads explicit", () => {
    const payroll = CORE_ENTITY_ACCESS.find(
      (contract) => contract.entity === "payroll_lines",
    );
    expect(payroll?.read.self).toBe(true);
    const audit = CORE_ENTITY_ACCESS.find(
      (contract) => contract.entity === "audit_events",
    );
    expect(audit?.read.self).toBe(false);
    expect(audit?.read.roles).toEqual(["admin", "finance"]);
  });
});
