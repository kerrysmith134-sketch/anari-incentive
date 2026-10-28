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

export function createDefaultSkills(): Record<string, AgentSkill> {
  const skills = [
    new EvidenceGapSkill(),
    new SettlementReadinessSkill(),
    new ContributionAnomalySkill(),
  ];
  return Object.fromEntries(skills.map((skill) => [skill.name, skill]));
}
