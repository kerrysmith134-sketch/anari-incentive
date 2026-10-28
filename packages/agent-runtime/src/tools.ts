import { randomUUID } from "node:crypto";
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
      description: "Publish a policy version. Must be approved by an authorized human.",
      async execute(input) {
        return {
          published: true,
          policyVersionId: input.policyVersionId ?? null,
        };
      },
    },
  ];
}
