import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHrLegalEntities,
  extractHrNextCursor,
  extractHrOrganizationUnits,
  extractHrPeople,
  HR_LEGAL_ENTITIES_PATH,
  HR_ORGANIZATION_UNITS_PATH,
  HR_PEOPLE_PATH,
  HR_SOURCE_SYSTEM,
  hrProvider,
  isIsoDate,
  isIsoDateTime,
  isUuid,
  parseHrLegalEntity,
  parseHrOrganizationUnit,
  parseHrPerson,
} from "../hr.js";

const fixtureDir = join(process.cwd(), "fixtures", "connectors");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as unknown;
}

function target(path: string) {
  const found = hrProvider.targets.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`provider target ${path} not found`);
  return found;
}

describe("anari-hr provider metadata", () => {
  it("declares the real service env vars and the three read endpoints", () => {
    expect(hrProvider.code).toBe("anari-hr");
    expect(hrProvider.sourceSystem).toBe(HR_SOURCE_SYSTEM);
    expect(hrProvider.sourceSystem).toBe("ANARI_HR");
    expect(hrProvider.baseUrlEnv).toBe("ANARI_HR_BASE_URL");
    expect(hrProvider.tokenEnv).toBe("ANARI_HR_TOKEN");
    expect(hrProvider.targets.map((entry) => entry.path)).toEqual([
      HR_PEOPLE_PATH,
      HR_LEGAL_ENTITIES_PATH,
      HR_ORGANIZATION_UNITS_PATH,
    ]);
    for (const entry of hrProvider.targets) expect(entry.method).toBe("GET");
  });

  it("uses the people cursor/limit contract and no page-number param", () => {
    const people = target("/api/v1/people");
    expect(people.pageParam).toBeUndefined();
    expect(people.cursorParam).toBe("cursor");
    expect(people.limitParam).toBe("limit");
    expect(people.pageSize).toBe(50);
    // legal-entities / organization-units are unpaginated in anari-hr.
    for (const path of ["/api/v1/legal-entities", "/api/v1/organization-units"]) {
      expect(target(path).cursorParam).toBeUndefined();
      expect(target(path).limitParam).toBeUndefined();
    }
  });
});

describe("anari-hr people", () => {
  it("extracts PersonOut records from the ADR-018 envelope", () => {
    const json = readJson("hr-people.sample.json");
    const people = extractHrPeople(json);
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({
      id: "3f2b7c9e-4d51-4a8e-9b3c-6f0d1e2a4b5c",
      display_name: "陈晓雯",
      primary_work_email: "xiaowen.chen@anari.example",
      person_status: "ACTIVE",
      legal_name: "陈晓雯",
    });
    // Nullable contact fields survive as null; dates are validated, not rewritten.
    expect(people[1]).toMatchObject({
      display_name: "Marcus Reed",
      primary_work_email: null,
      preferred_name: null,
      source_system: null,
      created_at: "2026-11-19T23:05:44.120000",
    });
    const meta = (json as { meta: { pagination: { next_cursor: string } } }).meta;
    expect(meta.pagination.next_cursor.length).toBeGreaterThan(0);
  });

  it("skips records with missing or invalid required fields", () => {
    const people = extractHrPeople(readJson("hr-people.malformed.sample.json"));
    expect(people.map((person) => person.display_name)).toEqual(["Valid survivor"]);
    // Missing optional legal_name on the survivor is normalized to null.
    expect(people[0]?.legal_name).toBeNull();
  });

  it("reads the opaque next_cursor from meta.pagination", () => {
    expect(extractHrNextCursor(readJson("hr-people.sample.json"))).toBe(
      "eyJjIjoiMjAyNi0xMS0xOVQyMzowNTo0NC4xMjAwMDAiLCJpIjoiYTkxZDRlNmYtMmMzOC00YjdhLThkMDUtMWU5ZjNhNmIyYzQ3In0",
    );
    expect(extractHrNextCursor(readJson("hr-people.malformed.sample.json"))).toBeNull();
    expect(extractHrNextCursor({ meta: { pagination: { next_cursor: "" } } })).toBeNull();
    expect(extractHrNextCursor({ data: [] })).toBeNull();
    expect(extractHrNextCursor(null)).toBeNull();
  });

  it("validates UUIDs and calendar dates instead of trusting the source", () => {
    expect(isUuid("3f2b7c9e-4d51-4a8e-9b3c-6f0d1e2a4b5c")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDateTime("2026-11-20T09:45:12")).toBe(true);
    expect(isIsoDateTime("2026-11-20T09:45:12.345678Z")).toBe(true);
    expect(isIsoDateTime("2026-11-20T09:45:12+08:00")).toBe(true);
    expect(isIsoDateTime("2026-11-20T25:00:00")).toBe(false);
    expect(isIsoDateTime("2026-11-20")).toBe(false);
    expect(parseHrPerson({ display_name: "No id" })).toBeNull();
    const survivor = (
      readJson("hr-people.malformed.sample.json") as {
        data: Array<Record<string, unknown>>;
      }
    ).data[6];
    const missingName = { ...(survivor ?? {}), display_name: "" };
    expect(parseHrPerson(missingName)).toBeNull();
  });

  it("maps people to the idempotent /people/import endpoint", () => {
    const people = extractHrPeople(readJson("hr-people.sample.json"));
    const peopleTarget = target("/api/v1/people");
    const writes = people.flatMap((person) => {
      const normalized = peopleTarget.normalize(person);
      return Array.isArray(normalized) ? normalized : [normalized];
    });
    expect(writes).toHaveLength(people.length);
    expect(writes[0]).toMatchObject({
      path: "/api/v1/people/import",
      externalId: people[0]!.id,
      body: {
        sourceSystem: "ANARI_HR",
        externalId: people[0]!.id,
        displayName: people[0]!.display_name,
      },
    });
  });
});

describe("anari-hr legal entities", () => {
  it("extracts id/code/name for mapping and validation", () => {
    const entities = extractHrLegalEntities(readJson("hr-legal-entities.sample.json"));
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
      entity_code: "ANARI-CN",
      legal_name: "Anari Energy Technology (Shanghai) Co., Ltd.",
      country_code: "CN",
      currency_code: "CNY",
      status: "ACTIVE",
    });
    expect(entities[1]?.jurisdiction_code).toBeNull();
  });

  it("drops entities without a usable UUID/code/name", () => {
    expect(parseHrLegalEntity({ entity_code: "X", legal_name: "No id" })).toBeNull();
    expect(
      parseHrLegalEntity({
        id: "c4e8a1f2-7b3d-4c69-8a20-5d1e9f3b7c48",
        entity_code: " ",
        legal_name: "Blank code",
        country_code: "CN",
        currency_code: "CNY",
        status: "ACTIVE",
        version: 1,
      }),
    ).toBeNull();
  });

  it("returns no writes: N-Perform has no legal-entity endpoint", () => {
    const entities = extractHrLegalEntities(readJson("hr-legal-entities.sample.json"));
    const entityTarget = target("/api/v1/legal-entities");
    for (const entity of entities) {
      expect(entityTarget.normalize(entity)).toEqual([]);
    }
  });
});

describe("anari-hr organization units", () => {
  it("extracts versioned units with UUID keys and effective dates", () => {
    const units = extractHrOrganizationUnits(readJson("hr-organization-units.sample.json"));
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      org_key: "2d4f6a8c-1e3b-4d5f-9a70-3c5e7b9d1f42",
      legal_entity_id: "c4e8a1f2-7b3d-4c69-8a20-5d1e9f3b7c48",
      unit_name: "Commercial",
      unit_type: "DIVISION",
      effective_from: "2026-01-01",
      effective_to: null,
      supersedes_id: "0b9e7d5c-3a1f-4e2d-8c6b-4a2f0d8e6c31",
    });
    expect(units[1]).toMatchObject({
      parent_org_key: "2d4f6a8c-1e3b-4d5f-9a70-3c5e7b9d1f42",
      effective_from: "2025-07-01",
      effective_to: "2025-12-31",
    });
  });

  it("skips units with broken keys, missing dates or impossible dates", () => {
    const units = extractHrOrganizationUnits(
      readJson("hr-organization-units.malformed.sample.json"),
    );
    expect(units.map((unit) => unit.unit_name)).toEqual(["Valid survivor"]);
  });

  it("rejects a null legal_entity_id (OrgUnitOut requires a UUID)", () => {
    const firstUnit = (
      readJson("hr-organization-units.sample.json") as {
        data: Array<Record<string, unknown>>;
      }
    ).data[0];
    expect(
      parseHrOrganizationUnit({ ...(firstUnit ?? {}), legal_entity_id: null }),
    ).toBeNull();
  });

  it("returns no writes: N-Perform has no org-unit endpoint", () => {
    const units = extractHrOrganizationUnits(
      readJson("hr-organization-units.sample.json"),
    );
    const unitTarget = target("/api/v1/organization-units");
    for (const unit of units) {
      expect(unitTarget.normalize(unit)).toEqual([]);
    }
  });
});

describe("anari-hr envelope handling", () => {
  it("fails loud when the documented data envelope is missing", () => {
    expect(() => extractHrPeople({ error: { code: "UNAUTHENTICATED" }, meta: {} })).toThrow(
      /missing a data array/,
    );
    expect(() => extractHrPeople({ data: { id: "x" } })).toThrow(/missing a data array/);
    expect(() => extractHrPeople([])).toThrow(/not a JSON object/);
    expect(() => extractHrPeople(null)).toThrow(/not a JSON object/);
  });

  it("does not normalize malformed records into writes", () => {
    const peopleTarget = target("/api/v1/people");
    expect(peopleTarget.normalize({ id: "not-a-uuid" })).toEqual([]);
    expect(peopleTarget.normalize(undefined)).toEqual([]);
  });
});
