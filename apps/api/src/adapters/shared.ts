/**
 * NPV2-013：Adapter 共享模块级助手（从 platform-store.ts 逐字平移，改为导出）。
 */
import type {
    ApprovalPort,
  AssessmentPort,
  BudgetPort,
  CommsPort,
  DatagovPort,
  DeliveryPort,
  DirectoryPort,
  IdentityPort,
  IncentivePort,
  IntegrationPort,
  ModelgovPort,
  PolicygovPort,
  SettlementPort,
  TenantPort
} from "../store-ports.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  divRound,
  formatDecimal,
  parseDecimal,
  sha256,
} from "@anari/policy-dsl";
import type {
  Acceptance,
  AdverseActionCase,
  AiScoreProposal,
  AiSuggestionLog,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  AuditRedaction,
  BudgetAllocation,
  BudgetPool,
  Bounty,
  BreakGlassGrant,
  CashGateInput,
  ClawbackCase,
  CompensationTemplate,
  ConsultationOutcome,
  ConflictDeclaration,
  ConsultationType,
  DataSource,
  DataSourceField,
  Deliverable,
  DpiaAssessmentType,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  EmploymentContract,
  ESignEnvelope,
  EmploymentContractAmendment,
  EquityExercise,
  EquityGrant,
  EquityVesting,
  ExternalIdentity,
  FairnessCommitment,
  FinancialFact,
  CalibrationSession,
  ManagerTrainingRecord,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
  ModelProviderPolicy,
  PolicyEngineRecord,
  IncentiveAwardBatch,
  IncentiveAwardType,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  SubscriptionPlan,
  TenantInvoice,
  TenantInvoiceLineItem,
  TenantInvoiceStatus,
  TenantSubscription,
  TenantSubscriptionStatus,
  PayrollLine,
  PayrollRun,
  PilotEnrollment,
  PolicyAcknowledgement,
  PolicyConsultation,
  PolicyNotice,
  PolicyTestCase,
  PolicyTestRun,
  RepresentationBodyType,
  AppealEvidenceDisclosure,
  RetentionDisposalRequest,
  RetentionPolicy,
  WorkforceSubgroupAttribute,
  WorkforceSubgroupDimension,
  RuleChangeOrder,
  SettlementAcknowledgement,
  SettlementExport,
  SyncSchedule,
  StrategicPoolCase,
  SyncRun,
  TrustSurveyQuestion,
  TrustSurveyReport,
  TrustSurveyResponse,
  TrustSurveyRun,
  WebhookInboxMessage,
  WorkflowRun,
} from "@anari/domain";
import { adverseActionTransitions, assertTransition } from "@anari/domain";
import { ConflictError, NotFoundError } from "../store.js";

export const formatInvoiceAmount = (value: bigint): string => {
  const rounded = divRound(value, 10_000n);
  const negative = rounded < 0n;
  const abs = (negative ? -rounded : rounded).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};

export function now(): string {
  return new Date().toISOString();
}

export function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

export function surveyAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function aggregateSurveyReport(
  survey: TrustSurveyRun,
  responses: TrustSurveyResponse[],
  baseline?: {
    survey: TrustSurveyRun;
    responses: TrustSurveyResponse[];
  },
): TrustSurveyReport {
  const averages: Record<string, number> = {};
  const distribution: Record<string, Record<string, number>> = {};
  for (const question of survey.questions) {
    const values = responses
      .map((response) => response.scores[question.code])
      .filter((value): value is number => typeof value === "number");
    averages[question.code] = surveyAverage(values);
    const buckets: Record<string, number> = {};
    for (const value of [1, 2, 3, 4, 5]) {
      buckets[String(value)] = values.filter((candidate) => candidate === value).length;
    }
    distribution[question.code] = buckets;
  }
  const dimensionValues: Record<string, number[]> = {};
  for (const question of survey.questions) {
    const values = dimensionValues[question.dimension] ?? [];
    const average = averages[question.code];
    if (average !== undefined) values.push(average);
    dimensionValues[question.dimension] = values;
  }
  const dimensions = Object.fromEntries(
    Object.entries(dimensionValues).map(([dimension, values]) => [
      dimension,
      surveyAverage(values),
    ]),
  );
  let baselineSummary: TrustSurveyReport["baseline"];
  if (baseline) {
    const baselineDimensions = aggregateSurveyReport(
      baseline.survey,
      baseline.responses,
    ).dimensions;
    baselineSummary = {
      surveyId: baseline.survey.id,
      period: baseline.survey.period,
      responseCount: baseline.responses.length,
      dimensions: baselineDimensions,
    };
  }
  return {
    survey,
    responseCount: responses.length,
    averages,
    dimensions,
    distribution,
    baseline: baselineSummary,
  };
}

export function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** NULL/undefined 计数列 → undefined（区别于真实的 0）。 */
export function optionalCount(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

export function isoDate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

export function decimalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  return text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
}

export function addUtcMonths(value: Date, months: number): string {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth() + months,
      value.getUTCDate(),
    ),
  ).toISOString();
}

export function computeEquityVesting(
  grant: EquityGrant,
  exercises: EquityExercise[],
  asOf: string,
): EquityVesting {
  const total = parseDecimal(grant.totalUnits);
  const asOfDate = new Date(asOf);
  const start = new Date(grant.vestingStart);
  let elapsedMonths =
    (asOfDate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (asOfDate.getUTCMonth() - start.getUTCMonth());
  if (asOfDate.getUTCDate() < start.getUTCDate()) elapsedMonths -= 1;
  elapsedMonths = Math.max(0, elapsedMonths);
  const vestedMonths =
    elapsedMonths < grant.cliffMonths
      ? 0
      : Math.min(grant.vestingMonths, elapsedMonths);
  const vested =
    grant.vestingMonths === 0
      ? 0n
      : (total * BigInt(vestedMonths)) / BigInt(grant.vestingMonths);
  const exercised = exercises
    .filter((exercise) => exercise.status !== "CANCELLED")
    .reduce((sum, exercise) => sum + parseDecimal(exercise.units), 0n);
  const available = vested > exercised ? vested - exercised : 0n;
  let nextVestAt: string | undefined;
  if (vestedMonths < grant.vestingMonths) {
    nextVestAt =
      vestedMonths === 0 && grant.cliffMonths > 0
        ? addUtcMonths(start, grant.cliffMonths)
        : addUtcMonths(start, vestedMonths + 1);
  }
  return {
    grantId: grant.id,
    asOf: asOfDate.toISOString(),
    vestedUnits: formatDecimal(vested),
    unvestedUnits: formatDecimal(total > vested ? total - vested : 0n),
    exercisedUnits: formatDecimal(exercised),
    availableUnits: formatDecimal(available),
    nextVestAt,
    fullyVested: vested === total,
  };
}

export function money(value: string): bigint {
  try {
    return parseDecimal(value);
  } catch {
    throw new ConflictError(`invalid amount ${value}`);
  }
}
