/**
 * 评价决定 × JEV 的前端视图类型（只读投影，不复制后端契约）。
 *
 * 后端把 evaluation_decisions 与 JEV decision case 组合成
 * `EvaluationDecision & { jev }`；这里显式声明用到的字段，避免为了几个
 * 只读字段去改全局类型文件。
 */
import type { Uuid } from "../../lib/types.js";

export interface DecisionJudgmentView {
  id: Uuid;
  caseId: Uuid;
  actorType: "HUMAN" | "AI_MODEL";
  actorId: string;
  modelRef?: string;
  independentScores: Record<string, unknown>;
  independentRationale: string;
  dimensionStates: Record<string, unknown>;
  confidence?: number;
  createdAt: string;
}

export interface DecisionEvidenceView {
  id: Uuid;
  caseId: Uuid;
  sourceType: string;
  sourceId: string;
  contentHash: string;
  supports: "FOR" | "AGAINST" | "NEUTRAL";
  weight?: string;
  createdAt: string;
}

export interface DecisionVerificationView {
  id: Uuid;
  caseId: Uuid;
  checks: Record<string, unknown>;
  findings: Array<{
    checker?: string;
    code?: string;
    severity?: string;
    message?: string;
  }>;
  passed: boolean;
  verifiedBy: string;
  verifiedCaseVersion: number;
  evidenceHash: string;
  judgmentsHash: string;
  stale?: boolean;
  verifiedAt: string;
}

export interface DecisionRecordView {
  id: Uuid;
  caseId: Uuid;
  finalJudgmentId: string;
  decidedBy: string;
  rationale: string;
  evidenceHash: string;
  version: number;
  decidedAt: string;
}

export interface DecisionCaseView {
  id: Uuid;
  kind: string;
  subjectType: string;
  subjectId: string;
  status: string;
  version: number;
  context: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface EvaluationDecisionJevView {
  required: boolean;
  caseId: Uuid | null;
  caseStatus: string;
  recordId: Uuid | null;
  decided: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** `GET /api/v1/evaluation-decisions/:id/decision-case` 的响应体。 */
export interface DecisionCaseDetailView {
  case: DecisionCaseView | null;
  evidence: DecisionEvidenceView[];
  judgments: {
    human: DecisionJudgmentView[];
    ai: DecisionJudgmentView[];
  };
  verifications: DecisionVerificationView[];
  links?: Array<{
    id: string;
    resourceType: string;
    resourceId: string;
    linkedBy: string;
  }>;
  record?: DecisionRecordView;
  decision: {
    id: Uuid;
    personId: Uuid;
    cycleId: Uuid;
    decisionVersion: number;
    status: string;
    jev: EvaluationDecisionJevView;
  };
}
