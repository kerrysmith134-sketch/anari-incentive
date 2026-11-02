import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import type { IncentiveStore } from "./store-interface.js";
import { createAgentContext } from "./agent-context.js";

export function createAgentRuntime(store: IncentiveStore): AgentRuntime {
  return new AgentRuntime(
    createAgentContext(store),
    createDefaultTools(),
    createDefaultSkills(),
    {
      requireApprovalAtOrAbove: "T3",
      actor: "agent-runtime",
      role:
        process.env.AGENT_ROLE === "READER" ||
        process.env.AGENT_ROLE === "ACTOR"
          ? process.env.AGENT_ROLE
          : "BOTH",
    },
  );
}
