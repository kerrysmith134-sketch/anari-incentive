import { randomUUID } from "node:crypto";
import type { PolicyApplicability, PolicyDefinition } from "@anari/domain";
import type { AgentContext, AgentTool } from "./types.js";

async function notify(
  context: AgentContext,
  input: Record<string, unknown>,
  kind: "EVIDENCE" | "OWNER" | "FINANCE" | "MANAGER",
) {
  const targetId =
    typeof input.targetId === "string" ? input.targetId : undefined;
  const targetType =
    typeof input.targetType === "string" ? input.targetType : undefined;
  let recipientPersonId: string | undefined;
  if (kind === "OWNER" || kind === "EVIDENCE") {
    if (targetType === "PERSON" && targetId) {
      recipientPersonId = targetId;
    } else if (targetId) {
      const workPackage = (await context.listWorkPackages()).find(
        (candidate) => candidate.id === targetId,
      );
      recipientPersonId = workPackage?.ownerPersonId;
    }
  }
  const audience =
    kind === "FINANCE"
      ? "FINANCE"
      : kind === "MANAGER" || !recipientPersonId
        ? "MANAGER"
        : "PERSON";
  const title =
    kind === "FINANCE"
      ? "Finance action required"
      : kind === "MANAGER"
        ? "Agent escalation"
        : kind === "EVIDENCE"
          ? "Evidence requested"
          : "Action required";
  const finding =
    typeof input.finding === "string" ? input.finding : "agent follow-up";
  return context.createNotification({
    recipientPersonId,
    audience,
    title,
    body:
      typeof input.message === "string"
        ? input.message
        : `Agent follow-up: ${finding}`,
    sourceType: targetType,
    sourceId: targetId,
  });
}

export function createDefaultTools(): AgentTool[] {
  return [
    {
      name: "record_finding",
      riskTier: "T0",
      description: "Record a read-only finding for review.",
      async execute(input) {
        return { recorded: true, finding: input.finding };
      },
    },
    {
      name: "create_todo",
      riskTier: "T1",
      description: "Create a low-risk follow-up todo for a responsible person.",
      async execute(input) {
        return { todoId: randomUUID(), targetId: input.targetId ?? null };
      },
    },
    {
      name: "request_evidence",
      riskTier: "T1",
      description: "Ask the responsible person to supply missing evidence.",
      async execute(input, context) {
        return notify(context, input, "EVIDENCE");
      },
    },
    {
      name: "record_data_quality_issue",
      riskTier: "T1",
      description: "Persist a data-quality issue for follow-up.",
      async execute(input, context) {
        const objectType = input.objectType;
        const objectId = input.objectId;
        const issueCode = input.issueCode;
        const severity = input.severity;
        if (
          typeof objectType !== "string" ||
          typeof objectId !== "string" ||
          typeof issueCode !== "string" ||
          (severity !== "INFO" &&
            severity !== "WARNING" &&
            severity !== "BLOCKING")
        ) {
          throw new Error("DATA_QUALITY_ISSUE_FIELDS_REQUIRED");
        }
        return context.createDataQualityIssue({
          objectType,
          objectId,
          issueCode,
          severity,
          details:
            input.details && typeof input.details === "object"
              ? (input.details as Record<string, unknown>)
              : {},
        });
      },
    },
    {
      name: "create_evaluation_draft",
      riskTier: "T1",
      description:
        "Create an evidence-bound evaluation draft for human review; never a decision.",
      async execute(input, context, execution) {
        const cycleId = input.cycleId;
        const personId = input.personId;
        const evidenceSnapshotHash = input.evidenceSnapshotHash;
        if (
          typeof cycleId !== "string" ||
          typeof personId !== "string" ||
          typeof evidenceSnapshotHash !== "string"
        ) {
          throw new Error("EVALUATION_DRAFT_FIELDS_REQUIRED");
        }
        return context.createEvaluationDraft({
          cycleId,
          personId,
          generatedByType: "AGENT",
          agentTaskId: execution?.taskId,
          evidenceSnapshotHash,
          draftPayload:
            input.draftPayload && typeof input.draftPayload === "object"
              ? (input.draftPayload as Record<string, unknown>)
              : {},
          strengths: Array.isArray(input.strengths)
            ? input.strengths.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          counterEvidence: Array.isArray(input.counterEvidence)
            ? input.counterEvidence.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          missingInformation: Array.isArray(input.missingInformation)
            ? input.missingInformation.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          uncertainty:
            input.uncertainty && typeof input.uncertainty === "object"
              ? (input.uncertainty as Record<string, unknown>)
              : {},
        });
      },
    },
    {
      name: "notify_owner",
      riskTier: "T1",
      description: "Notify the work-package owner or manager.",
      async execute(input, context) {
        return notify(context, input, "OWNER");
      },
    },
    {
      name: "notify_finance",
      riskTier: "T1",
      description: "Notify finance/settlement owner.",
      async execute(input, context) {
        return notify(context, input, "FINANCE");
      },
    },
    {
      name: "escalate",
      riskTier: "T2",
      description: "Escalate a blocking issue to a manager or review queue.",
      async execute(input, context) {
        return notify(context, input, "MANAGER");
      },
    },
    {
      name: "publish_policy",
      riskTier: "T3",
      description:
        "Publish a policy version. Must be approved by an authorized human.",
      async execute(input, context, execution) {
        if (!execution?.approvedBy) {
          throw new Error(
            "POLICY_PUBLISH_REQUIRES_HUMAN_APPROVAL: publish_policy can only run through an approved T3 action",
          );
        }
        const policy = input.policy as PolicyDefinition | undefined;
        if (!policy || typeof policy !== "object" || !policy.code) {
          throw new Error("POLICY_DEFINITION_REQUIRED");
        }
        const policyVersionId =
          typeof input.policyVersionId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.policyVersionId,
          )
            ? input.policyVersionId
            : undefined;
        const effectiveFrom =
          typeof input.effectiveFrom === "string"
            ? input.effectiveFrom
            : new Date().toISOString();
        const applicability = input.applicability;
        if (!applicability || typeof applicability !== "object") {
          throw new Error("POLICY_APPLICABILITY_REQUIRED");
        }
        return context.publishPolicy({
          policy,
          policyVersionId,
          effectiveFrom,
          approvedBy: execution.approvedBy,
          applicability: applicability as PolicyApplicability,
        });
      },
    },
  ];
}
