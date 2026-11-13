import type { AgentContext } from "@anari/agent-runtime";
import type { IncentiveStore } from "./store-interface.js";

export function createAgentContext(store: IncentiveStore): AgentContext {
  return {
    listWorkPackages: () => store.listWorkPackages(),
    listClaims: () => store.listClaims(),
    listEvaluationCycles: () => store.listEvaluationCycles(),
    advanceEvaluationCycle: (id, status, reason) =>
      store.advanceEvaluationCycle(id, { status, reason }),
    listDecisions: (claimId) => store.listDecisions(claimId),
    listRuns: () => store.listRuns(),
    listConfirmations: (personId) => store.listConfirmations(personId),
    listAppeals: () => store.listAppeals(),
    getLegalGate: (policyVersionId) => store.getLegalGate(policyVersionId),
    listEvidence: (subjectType, subjectId) =>
      store.listEvidence(subjectType, subjectId),
    publishPolicy: (input) => store.publishPolicy(input),
    createDataQualityIssue: (input) => store.createDataQualityIssue(input),
    createEvaluationDraft: (input) => store.createEvaluationDraft(input),
    createNotification: (input) => store.createNotification(input),
    upsertAgentTodo: (input) => store.upsertAgentTodo(input),
    listAgentTodos: (filter) => store.listAgentTodos(filter),
    completeAgentTodo: (id, completedByPersonId) =>
      store.completeAgentTodo(id, completedByPersonId),
    listDataQualityIssues: (filter) => store.listDataQualityIssues(filter),
    listEvaluationDecisions: (filter) => store.listEvaluationDecisions(filter),
    listPolicyVersions: () => store.listPolicyVersions(),
    getPolicy: (policyVersionId) => store.getPolicy(policyVersionId),
    listEvaluationDrafts: (filter) => store.listEvaluationDrafts(filter),
  };
}
