import type { PolicyDefinition } from "@anari/domain";

export interface PolicyChange {
  path: string;
  before: unknown;
  after: unknown;
}

function flatten(
  value: unknown,
  prefix: string,
  output: Map<string, unknown>,
): void {
  if (Array.isArray(value)) {
    output.set(prefix, value);
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      output.set(prefix, value);
      return;
    }
    for (const [key, child] of entries) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return;
  }
  output.set(prefix, value);
}

/** Structural diff of two policy definitions; arrays are compared atomically. */
export function diffPolicyDefinitions(
  base: PolicyDefinition,
  target: PolicyDefinition,
): PolicyChange[] {
  const before = new Map<string, unknown>();
  const after = new Map<string, unknown>();
  flatten(base, "", before);
  flatten(target, "", after);
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changes: PolicyChange[] = [];
  for (const path of [...paths].sort()) {
    const left = before.get(path);
    const right = after.get(path);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      changes.push({ path, before: left, after: right });
    }
  }
  return changes;
}
