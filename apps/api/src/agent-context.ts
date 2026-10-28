import type { AgentContext } from "@anari/agent-runtime";
import type { IncentiveStore } from "./store-interface.js";

export function createAgentContext(store: IncentiveStore): AgentContext {
  return {
    listWorkPackages: () => store.listWorkPackages(),
    listClaims: () => store.listClaims(),
    listDecisions: (claimId) => store.listDecisions(claimId),
    listRuns: () => store.listRuns(),
    listConfirmations: (personId) => store.listConfirmations(personId),
    getLegalGate: (policyVersionId) => store.getLegalGate(policyVersionId),
    listEvidence: (subjectType, subjectId) =>
      store.listEvidence(subjectType, subjectId),
  };
}
