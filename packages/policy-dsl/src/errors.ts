export class PolicyGateError extends Error {
  readonly code = "POLICY_GATE_BLOCKED";
  constructor(readonly blockers: string[]) {
    super(`Policy gate blocked: ${blockers.join(", ")}`);
    this.name = "PolicyGateError";
  }
}
