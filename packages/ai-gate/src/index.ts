/**
 * AI evaluation gate and a deliberately non-scoring evidence assistant.
 *
 * AI-derived numeric evaluation is retired. This package exposes evidence
 * summarisation and coverage analysis only; formal numeric evaluation belongs
 * to the versioned deterministic rubric and authorized human decision flow.
 */

export interface EvaluationGate {
  passed: boolean;
  sampleSize: number;
  metrics: {
    interRaterReliability?: number;
    subgroupMaxErrorGap?: number;
    counterfactualStability?: number;
    promptInjectionPassRate?: number;
    humanAiAgreement?: number;
    humanHumanAgreement?: number;
    holdoutSampleSize?: number;
    harnessVersion?: string;
    subgroupErrors?: Record<string, number>;
    subgroupSizes?: Record<string, number>;
    smallSubgroups?: string[];
  };
  blockers: string[];
}

export class AiGateError extends Error {
  readonly code = "AI_EVALUATION_GATE_NOT_PASSED";
  constructor(readonly blockers: string[]) {
    super(`AI scoring is blocked: ${blockers.join(", ")}`);
    this.name = "AiGateError";
  }
}

export function assertScoringAllowed(gate: EvaluationGate | undefined): void {
  if (!gate) throw new AiGateError(["EVALUATION_GATE_MISSING"]);
  if (!gate.passed) throw new AiGateError(gate.blockers);
}

export interface EvidenceItem {
  id: string;
  source: string;
  type: string;
  text: string;
}

export interface EvidenceSummary {
  summary: string;
  citations: string[];
  gaps: string[];
}

/**
 * Deterministic, non-LLM evidence assistant used to prove the workflow.
 * A production implementation may call a model behind the same interface,
 * but the result must remain qualitative and evidence-cited.
 */
export class EvidenceAssistant {
  summarize(
    evidence: EvidenceItem[],
    requiredTypes: string[] = [],
  ): EvidenceSummary {
    const citations = evidence.map((item) => `${item.id}@${item.source}`);
    const presentTypes = new Set(evidence.map((item) => item.type));
    const gaps = requiredTypes.filter((type) => !presentTypes.has(type));
    const summary =
      evidence.length === 0
        ? "No evidence was provided."
        : evidence
            .map((item) => `${item.type}: ${item.text}`)
            .join(" | ");
    return { summary, citations, gaps };
  }

  detectGaps(
    requiredTypes: string[],
    evidence: EvidenceItem[],
  ): string[] {
    const present = new Set(evidence.map((item) => item.type));
    return requiredTypes.filter((type) => !present.has(type));
  }
}
export * from "./evaluate.js";
export * from "./scoring.js";
export * from "./risk.js";
export * from "./model-provider.js";
export * from "./coverage.js";
export * from "./usage.js";
