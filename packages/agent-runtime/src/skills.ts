import { randomUUID } from "node:crypto";
import type {
  AgentAction,
  AgentContext,
  AgentFinding,
  AgentSkill,
} from "./types.js";

function action(
  input: Omit<AgentAction, "id" | "requiresApproval"> & {
    requiresApproval?: boolean;
  },
): AgentAction {
  return {
    id: randomUUID(),
    requiresApproval: input.requiresApproval ?? input.riskTier === "T3",
    ...input,
  };
}

export class EvidenceGapSkill implements AgentSkill {
  readonly name = "EVIDENCE_GAP";

  async observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]> {
    const workPackageId =
      typeof input.workPackageId === "string" ? input.workPackageId : undefined;
    const workPackages = (await context.listWorkPackages()).filter(
      (wp) => !workPackageId || wp.id === workPackageId,
    );
    const findings: AgentFinding[] = [];

    for (const wp of workPackages) {
      if (!wp.commitmentSnapshot) {
        findings.push({
          code: "WORK_PACKAGE_NOT_COMMITTED",
          severity: "BLOCKING",
          subjectType: "WORK_PACKAGE",
          subjectId: wp.id,
          message: "Work package has no frozen commitment snapshot.",
          suggestedAction: "Commit the package before contribution claims.",
        });
      }
      if (wp.status === "SUBMITTED") {
        findings.push({
          code: "PENDING_ACCEPTANCE",
          severity: "WARNING",
          subjectType: "WORK_PACKAGE",
          subjectId: wp.id,
          message: "Delivery is submitted but not yet accepted.",
          suggestedAction: "Ask the acceptance reviewer to decide.",
        });
      }
      const evidence = await context.listEvidence("WORK_PACKAGE", wp.id);
      if (evidence.length === 0) {
        findings.push({
          code: "NO_EVIDENCE",
          severity: "WARNING",
          subjectType: "WORK_PACKAGE",
          subjectId: wp.id,
          message: "No evidence is linked to this work package.",
          suggestedAction: "Request delivery/acceptance evidence from the owner.",
        });
      }
    }
    return findings;
  }

  plan(finding: AgentFinding): AgentAction[] {
    if (finding.severity === "BLOCKING") {
      return [
        action({
          tool: "escalate",
          riskTier: "T2",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: finding.suggestedAction ?? "Escalate blocking finding.",
          payload: { finding: finding.code },
          requiresApproval: true,
        }),
      ];
    }
    if (finding.code === "NO_EVIDENCE") {
      return [
        action({
          tool: "request_evidence",
          riskTier: "T1",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Request missing evidence.",
          payload: { finding: finding.code },
        }),
      ];
    }
    if (finding.code === "PENDING_ACCEPTANCE") {
      return [
        action({
          tool: "notify_owner",
          riskTier: "T1",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Notify owner about pending acceptance.",
          payload: { finding: finding.code },
        }),
      ];
    }
    return [
      action({
        tool: "record_finding",
        riskTier: "T0",
        targetType: finding.subjectType,
        targetId: finding.subjectId,
        description: "Record finding for review.",
        payload: { finding: finding.code },
      }),
    ];
  }
}

export class SettlementReadinessSkill implements AgentSkill {
  readonly name = "SETTLEMENT_READINESS";

  async observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]> {
    const runId = typeof input.runId === "string" ? input.runId : undefined;
    if (!runId) {
      return [
        {
          code: "RUN_ID_REQUIRED",
          severity: "BLOCKING",
          subjectType: "CALCULATION_RUN",
          subjectId: "unknown",
          message: "settlement-readiness requires a runId.",
        },
      ];
    }
    const run = (await context.listRuns()).find((candidate) => candidate.id === runId);
    if (!run) {
      return [
        {
          code: "RUN_NOT_FOUND",
          severity: "BLOCKING",
          subjectType: "CALCULATION_RUN",
          subjectId: runId,
          message: "Calculation run was not found.",
        },
      ];
    }

    const findings: AgentFinding[] = [];
    if (run.mode === "FORMAL") {
      const gate = await context.getLegalGate(run.policyVersionId);
      if (!gate) {
        findings.push({
          code: "LEGAL_GATE_MISSING",
          severity: "BLOCKING",
          subjectType: "POLICY_VERSION",
          subjectId: run.policyVersionId,
          message: "Formal run has no server-side legal gate.",
          suggestedAction: "Escalate to legal/finance before settlement.",
        });
      }
      const confirmations = await context.listConfirmations();
      for (const line of run.lines) {
        const confirmation = confirmations.find(
          (candidate) =>
            candidate.personId === line.personId &&
            candidate.targetType === "CALCULATION" &&
            candidate.targetId === run.id,
        );
        if (!confirmation || confirmation.decision === "VIEWED") {
          findings.push({
            code: "MISSING_EMPLOYEE_CONFIRMATION",
            severity: "BLOCKING",
            subjectType: "CALCULATION_RUN",
            subjectId: run.id,
            message: `Employee ${line.personId} has not confirmed the calculation.`,
            suggestedAction: "Ask the employee to confirm or object.",
          });
        } else if (confirmation.decision === "OBJECTED") {
          findings.push({
            code: "EMPLOYEE_OBJECTION",
            severity: "BLOCKING",
            subjectType: "CALCULATION_RUN",
            subjectId: run.id,
            message: `Employee ${line.personId} objected to the calculation.`,
            suggestedAction: "Route to appeal/recalculation; do not lock.",
          });
        }
      }
    }
    if (run.status === "CALCULATED") {
      findings.push({
        code: "RUN_NOT_APPROVED",
        severity: "WARNING",
        subjectType: "CALCULATION_RUN",
        subjectId: run.id,
        message: "Calculation is calculated but not approved.",
        suggestedAction: "Notify the approver.",
      });
    }
    return findings;
  }

  plan(finding: AgentFinding): AgentAction[] {
    if (
      finding.code === "LEGAL_GATE_MISSING" ||
      finding.code === "RUN_NOT_FOUND" ||
      finding.code === "EMPLOYEE_OBJECTION"
    ) {
      return [
        action({
          tool: "escalate",
          riskTier: "T2",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: finding.suggestedAction ?? "Escalate settlement blocker.",
          payload: { finding: finding.code },
          requiresApproval: true,
        }),
      ];
    }
    if (finding.code === "MISSING_EMPLOYEE_CONFIRMATION") {
      return [
        action({
          tool: "notify_owner",
          riskTier: "T1",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Remind employee/owner to confirm.",
          payload: { finding: finding.code },
        }),
      ];
    }
    return [
      action({
        tool: "notify_finance",
        riskTier: "T1",
        targetType: finding.subjectType,
        targetId: finding.subjectId,
        description: "Notify finance about settlement readiness.",
        payload: { finding: finding.code },
      }),
    ];
  }
}

export class ContributionAnomalySkill implements AgentSkill {
  readonly name = "CONTRIBUTION_ANOMALY";

  async observe(
    context: AgentContext,
    _input: Record<string, unknown>,
  ): Promise<AgentFinding[]> {
    const claims = await context.listClaims();
    const findings: AgentFinding[] = [];
    for (const claim of claims) {
      const decisions = await context.listDecisions(claim.id);
      for (const decision of decisions) {
        if (decision.adjudicatorPersonId === claim.claimantPersonId) {
          findings.push({
            code: "SELF_ADJUDICATION",
            severity: "BLOCKING",
            subjectType: "CONTRIBUTION_CLAIM",
            subjectId: claim.id,
            message: "Claimant adjudicated their own contribution claim.",
            suggestedAction: "Escalate for independent review.",
          });
        }
      }
      if (claim.evidenceRefs.length === 0) {
        findings.push({
          code: "CLAIM_WITHOUT_EVIDENCE",
          severity: "WARNING",
          subjectType: "CONTRIBUTION_CLAIM",
          subjectId: claim.id,
          message: "Contribution claim has no evidence references.",
          suggestedAction: "Request evidence from the claimant.",
        });
      }
    }
    return findings;
  }

  plan(finding: AgentFinding): AgentAction[] {
    if (finding.code === "SELF_ADJUDICATION") {
      return [
        action({
          tool: "escalate",
          riskTier: "T2",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Escalate self-adjudication for independent review.",
          payload: { finding: finding.code },
          requiresApproval: true,
        }),
      ];
    }
    return [
      action({
        tool: "request_evidence",
        riskTier: "T1",
        targetType: finding.subjectType,
        targetId: finding.subjectId,
        description: "Request evidence for the claim.",
        payload: { finding: finding.code },
      }),
    ];
  }
}


import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { simulatePolicyChange } from "@anari/policy-dsl";

interface PolicyProposalInput {
  currentPolicy?: PolicyDefinition;
  proposedPolicy?: PolicyDefinition;
  samples?: Array<{ personId: string; input: CalculationInput }>;
  rationale?: string;
  policyVersionId?: string;
  effectiveFrom?: string;
}

/**
 * Proposes a policy change from a simulation, never publishes it. The
 * `publish_policy` action is T3 and always waits for a human.
 */
export class PolicyProposalSkill implements AgentSkill {
  readonly name = "POLICY_PROPOSAL";

  async observe(
    _context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]> {
    const proposal = input as PolicyProposalInput;
    if (
      !proposal.currentPolicy ||
      !proposal.proposedPolicy ||
      !proposal.samples ||
      proposal.samples.length === 0
    ) {
      return [
        {
          code: "POLICY_INPUT_REQUIRED",
          severity: "WARNING",
          subjectType: "POLICY",
          subjectId: proposal.proposedPolicy?.code ?? "unknown",
          message: "Policy proposal needs current policy, proposed policy and samples.",
        },
      ];
    }
    const simulation = simulatePolicyChange(
      proposal.currentPolicy,
      proposal.proposedPolicy,
      proposal.samples,
    );
    const findings: AgentFinding[] = [];
    if (simulation.blockers.length > 0) {
      findings.push({
        code: "POLICY_SIMULATION_BLOCKED",
        severity: "BLOCKING",
        subjectType: "POLICY",
        subjectId: proposal.proposedPolicy.code,
        message: `Policy simulation has ${simulation.blockers.length} blockers.`,
        suggestedAction: "Fix simulation inputs before proposing a policy.",
      });
    } else {
      findings.push({
        code: "POLICY_PROPOSAL_READY",
        severity: "INFO",
        subjectType: "POLICY",
        subjectId: proposal.proposedPolicy.code,
        message: `Simulation delta total ${simulation.deltaTotal}; affected ${simulation.affectedPeople}.`,
        suggestedAction: "Review the simulation and approve or reject the policy.",
      });
    }
    if (Number(simulation.deltaTotal) > 0) {
      findings.push({
        code: "POLICY_BUDGET_INCREASE",
        severity: "WARNING",
        subjectType: "POLICY",
        subjectId: proposal.proposedPolicy.code,
        message: `Proposed policy increases total payout by ${simulation.deltaTotal}.`,
      });
    }
    if (simulation.lines.some((line) => Number(line.delta) < 0)) {
      findings.push({
        code: "POLICY_NEGATIVE_IMPACT",
        severity: "WARNING",
        subjectType: "POLICY",
        subjectId: proposal.proposedPolicy.code,
        message: "At least one person would receive less under the proposal.",
      });
    }
    return findings;
  }

  plan(
    finding: AgentFinding,
    input: Record<string, unknown> = {},
  ): AgentAction[] {
    if (finding.code === "POLICY_PROPOSAL_READY") {
      const proposal = input as PolicyProposalInput;
      if (!proposal.proposedPolicy) {
        return [
          action({
            tool: "escalate",
            riskTier: "T2",
            targetType: finding.subjectType,
            targetId: finding.subjectId,
            description:
              "Escalate: policy proposal is missing the proposed policy definition.",
            payload: { finding: finding.code },
            requiresApproval: true,
          }),
        ];
      }
      return [
        action({
          tool: "publish_policy",
          riskTier: "T3",
          targetType: "POLICY",
          targetId: finding.subjectId,
          description: "Publish the simulated policy after human approval.",
          payload: {
            policy: proposal.proposedPolicy,
            policyVersionId: proposal.policyVersionId,
            effectiveFrom:
              proposal.effectiveFrom ?? new Date().toISOString(),
          },
          requiresApproval: true,
        }),
      ];
    }
    if (finding.code === "POLICY_SIMULATION_BLOCKED") {
      return [
        action({
          tool: "escalate",
          riskTier: "T2",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Escalate policy simulation blocker.",
          payload: { finding: finding.code },
          requiresApproval: true,
        }),
      ];
    }
    return [
      action({
        tool: "record_finding",
        riskTier: "T0",
        targetType: finding.subjectType,
        targetId: finding.subjectId,
        description: "Record policy proposal finding.",
        payload: { finding: finding.code },
      }),
    ];
  }
}

/**
 * Generic data-quality skill: flags evidence that is not VALID. A CONFLICTED
 * or INVALID evidence node is blocking and escalates; lesser issues create a
 * low-risk follow-up.
 */
export class DataQualitySkill implements AgentSkill {
  readonly name = "DATA_QUALITY";

  async observe(context: AgentContext): Promise<AgentFinding[]> {
    const evidence = await context.listEvidence();
    return evidence
      .filter((node) => node.qualityStatus !== "VALID")
      .map((node) => ({
        code: "EVIDENCE_QUALITY_ISSUE",
        severity:
          node.qualityStatus === "CONFLICTED" || node.qualityStatus === "INVALID"
            ? ("BLOCKING" as const)
            : ("WARNING" as const),
        subjectType: "EVIDENCE",
        subjectId: node.id,
        message: `Evidence quality is ${node.qualityStatus}.`,
        suggestedAction: "Assign a data-quality owner and resolve the issue.",
      }));
  }

  plan(finding: AgentFinding): AgentAction[] {
    const issue = action({
      tool: "record_data_quality_issue",
      riskTier: "T1",
      targetType: finding.subjectType,
      targetId: finding.subjectId,
      description: "Persist a data-quality issue for follow-up.",
      payload: {
        objectType: finding.subjectType,
        objectId: finding.subjectId,
        issueCode: finding.code,
        severity: finding.severity,
        details: {
          message: finding.message,
          suggestedAction: finding.suggestedAction,
        },
      },
    });
    if (finding.severity === "BLOCKING") {
      return [
        issue,
        action({
          tool: "escalate",
          riskTier: "T2",
          targetType: finding.subjectType,
          targetId: finding.subjectId,
          description: "Escalate blocking evidence-quality issue.",
          payload: { finding: finding.code },
          requiresApproval: true,
        }),
      ];
    }
    return [issue];
  }
}

/**
 * Generic appeal-SLA skill: flags open appeals older than the configured SLA.
 * A breach escalates for human review.
 */
export class AppealSlaSkill implements AgentSkill {
  readonly name = "APPEAL_SLA";

  async observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]> {
    const slaDays = typeof input.slaDays === "number" ? input.slaDays : 3;
    const now = Date.now();
    const appeals = await context.listAppeals();
    return appeals
      .filter(
        (appeal) =>
          appeal.status !== "CLOSED" && appeal.status !== "DECIDED",
      )
      .filter(
        (appeal) =>
          now - Date.parse(appeal.createdAt) > slaDays * 24 * 60 * 60 * 1000,
      )
      .map((appeal) => ({
        code: "APPEAL_SLA_BREACH",
        severity: "WARNING" as const,
        subjectType: "APPEAL",
        subjectId: appeal.id,
        message: `Appeal has been open longer than ${slaDays} days.`,
        suggestedAction: "Escalate to the appeal reviewer.",
      }));
  }

  plan(finding: AgentFinding): AgentAction[] {
    return [
      action({
        tool: "escalate",
        riskTier: "T2",
        targetType: finding.subjectType,
        targetId: finding.subjectId,
        description: "Escalate appeal SLA breach.",
        payload: { finding: finding.code },
        requiresApproval: true,
      }),
    ];
  }
}

export function createDefaultSkills(): Record<string, AgentSkill> {
  const skills = [
    new EvidenceGapSkill(),
    new SettlementReadinessSkill(),
    new ContributionAnomalySkill(),
    new PolicyProposalSkill(),
    new DataQualitySkill(),
    new AppealSlaSkill(),
  ];
  return Object.fromEntries(skills.map((skill) => [skill.name, skill]));
}
