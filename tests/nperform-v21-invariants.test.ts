import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDir = join(root, "db", "migrations");

describe("N-Perform V2.1 hardening invariants", () => {
  it("keeps the migration checksum manifest synchronized", () => {
    const manifest = JSON.parse(readFileSync(join(migrationDir, "manifest.json"), "utf8")) as {
      migrations: Array<{ file: string; bytes: number; sha256: string }>;
    };
    const files = readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort();
    expect(manifest.migrations.map((item) => item.file)).toEqual(files);
    for (const entry of manifest.migrations) {
      const data = readFileSync(join(migrationDir, entry.file));
      expect(entry.bytes).toBe(data.byteLength);
      expect(entry.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("protects metric snapshots at the database boundary", () => {
    const sql = readFileSync(join(migrationDir, "089_metric_snapshot_immutability.sql"), "utf8");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON metric_measurement_snapshots");
    expect(sql).toContain("BEFORE TRUNCATE ON metric_measurement_snapshots");
    expect(sql).toContain("linked_decision.person_id <> NEW.person_id");
    expect(sql).toContain("linked_decision.cycle_id <> NEW.cycle_id");
    expect(sql).toContain("linked_decision.rubric_version_id <> NEW.rubric_version_id");
    expect(sql).toContain("REFERENCES evaluation_decisions(tenant_id, id)");
  });
});
