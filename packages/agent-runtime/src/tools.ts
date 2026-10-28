import { randomUUID } from "node:crypto";
import type { PolicyDefinition } from "@anari/domain";
import type { AgentTool } from "./types.js";

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
      async execute(input) {
        return { requestId: randomUUID(), targetId: input.targetId ?? null };
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
      name: "notify_owner",
      riskTier: "T1",
      description: "Notify the work-package owner or manager.",
      async execute(input) {
        return { notificationId: randomUUID(), targetId: input.targetId ?? null };
      },
    },
    {
      name: "notify_finance",
      riskTier: "T1",
      description: "Notify finance/settlement owner.",
      async execute(input) {
        return { notificationId: randomUUID(), targetId: input.targetId ?? null };
      },
    },
    {
      name: "escalate",
      riskTier: "T2",
      description: "Escalate a blocking issue to a manager or review queue.",
      async execute(input) {
        return { escalationId: randomUUID(), targetId: input.targetId ?? null };
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
        return context.publishPolicy({
          policy,
          policyVersionId,
          effectiveFrom,
          approvedBy: execution.approvedBy,
        });
      },
    },
  ];
}
