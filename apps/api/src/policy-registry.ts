import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PolicyDefinition } from "@anari/domain";

/**
 * Generic policy registry.
 *
 * The API core does not contain industry policy definitions. It ships one
 * generic reference policy and loads tenant policy packs from
 * `examples/verticals/<pack>/pack.json` + `policy.json`. A pack supplies a
 * policyVersionId, a PolicyDefinition and fixtures; the core selects a
 * calculator by `policy.calculator`, not by industry code.
 */
export const REFERENCE_POLICY_ID = "00000000-0000-4000-8000-000000000100";

export const referencePolicy: PolicyDefinition = {
  code: "GENERIC_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
  calculator: "SIMPLE_POOL",
  minimumWage: { monthlyMinimum: "2690", checked: false },
};

interface PackManifest {
  policyVersionId?: string;
  policy?: string;
}

export function loadPolicyPacks(
  root = process.cwd(),
): Map<string, PolicyDefinition> {
  const policies = new Map<string, PolicyDefinition>([
    [REFERENCE_POLICY_ID, referencePolicy],
  ]);
  const packsDir = join(root, "examples", "verticals");
  if (!existsSync(packsDir)) return policies;

  for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packsDir, entry.name, "pack.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as PackManifest;
    if (!manifest.policyVersionId || !manifest.policy) continue;
    const policyPath = join(packsDir, entry.name, manifest.policy);
    if (!existsSync(policyPath)) continue;
    const policy = JSON.parse(
      readFileSync(policyPath, "utf8"),
    ) as PolicyDefinition;
    policies.set(manifest.policyVersionId, policy);
  }
  return policies;
}

export const policies = loadPolicyPacks();
