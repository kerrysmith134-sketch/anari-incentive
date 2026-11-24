import { randomUUID } from "node:crypto";
import {
  assertTransition,
  calculationRunTransitions,
  confirmationBlockers,
  legalGateBlockers,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type EmployeeConfirmation,
} from "@anari/domain";
import type {
  CreateCalculationRunInput,
} from "@anari/contracts";
import {
  PolicyGateError,
  calculateByPolicy,
  deriveEvaluationMultiplier,
} from "@anari/policy-dsl";
import type {
  RecordConfirmationInput,
} from "../store-interface.js";
import {
  ConflictError,
  CalculationBlockedError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import type { PolicyApi } from "./policy.js";
import type { ContributionApi } from "./contribution.js";
import type { SettlementApi } from "./settlement.js";
import type { LedgerApi } from "./ledger.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type CalculationApi = Pick<
  IncentiveStore,
  | "createCalculationRun"
  | "createCalculationRunsBatch"
  | "getRun"
  | "listRuns"
  | "approveRun"
  | "lockRun"
  | "recordConfirmation"
  | "listConfirmations"
>;

/**
 * Mixes the calculation domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withCalculation<TBase extends StoreCtor<StoreBase & PolicyApi & ContributionApi & SettlementApi & LedgerApi>>(Base: TBase) {
  const Mixin = class CalculationMixin extends Base implements CalculationApi {

  async createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun> {
    const policy = await this.getPolicy(input.policyVersionId);
    const gate = await this.getLegalGate(input.policyVersionId);
    const blockers = legalGateBlockers(input.mode, gate);
    const effectiveParticipants: CalculationInput["participants"] =
      input.participants.map((participant) => ({ ...participant }));

    if (policy.evaluation) {
      for (const participant of effectiveParticipants) {
        const decisionId = participant.evaluationDecisionId;
        if (!decisionId) {
          blockers.push(`EVALUATION_DECISION_MISSING:${participant.personId}`);
          continue;
        }
        const decision = this.evaluationDecisions.get(decisionId);
        if (!decision) {
          blockers.push(
            `EVALUATION_DECISION_NOT_FOUND:${participant.personId}`,
          );
          continue;
        }
        if (decision.status !== "APPROVED") {
          blockers.push(
            `EVALUATION_DECISION_NOT_APPROVED:${participant.personId}`,
          );
          continue;
        }
        if (decision.personId !== participant.personId) {
          blockers.push(
            `EVALUATION_DECISION_PERSON_MISMATCH:${participant.personId}`,
          );
          continue;
        }
        if (decision.cycleId !== input.cycleId) {
          blockers.push(
            `EVALUATION_DECISION_CYCLE_MISMATCH:${participant.personId}`,
          );
          continue;
        }
        const derived = deriveEvaluationMultiplier(
          policy.evaluation,
          decision.scores,
          participant.personId,
        );
        if (derived.blockers.length > 0 || !derived.multiplier) {
          blockers.push(...derived.blockers);
          continue;
        }
        participant.evaluationMultiplier = derived.multiplier;
      }
    }

    if (input.mode === "FORMAL") {
      for (const participant of input.participants) {
        if (
          !this.hasConfirmedAttribution(
            participant.workPackageId,
            participant.personId,
          )
        ) {
          blockers.push(
            `MISSING_CONFIRMED_ATTRIBUTION:${participant.personId}`,
          );
        }
      }
      const workPackageIds = new Set(
        input.participants.map((participant) => participant.workPackageId),
      );
      for (const issue of this.dataQualityIssues.values()) {
        if (
          issue.severity === "BLOCKING" &&
          issue.objectType === "WORK_PACKAGE" &&
          workPackageIds.has(issue.objectId) &&
          ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"].includes(
            issue.status,
          )
        ) {
          blockers.push(`BLOCKING_DATA_QUALITY_ISSUE:${issue.id}`);
        }
      }
    }

    if (blockers.length > 0) {
      throw new CalculationBlockedError(blockers);
    }

    const calculationInput: CalculationInput = {
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      policyVersionId: input.policyVersionId,
      mode: input.mode,
      order: input.order,
      participants: effectiveParticipants,
      legalGate: gate,
    };

    let result;
    try {
      result = calculateByPolicy(policy, calculationInput);
    } catch (error) {
      if (error instanceof PolicyGateError) {
        throw new CalculationBlockedError(error.blockers);
      }
      throw error;
    }
    const run: CalculationRun = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      mode: input.mode,
      policyVersionId: input.policyVersionId,
      engineVersion: result.engineVersion,
      inputSnapshotHash: result.inputSnapshotHash,
      inputSnapshot: calculationInput,
      status: "CALCULATED",
      lines: result.lines,
      resultHash: result.resultHash,
      blockers: [],
      warnings:
        input.mode === "FORMAL"
          ? []
          : [
              "SHADOW run: no payment effect and no ledger entries were created",
            ],
      createdAt: now(),
      calculatedAt: now(),
    };

    if (input.mode === "FORMAL") {
      for (const line of result.lines) {
        this.ledger.append({
          tenantId: run.tenantId,
          personId: line.personId,
          cycleId: run.cycleId,
          calculationRunId: run.id,
          calculationLineId: `${run.id}:${line.lineKey}`,
          entryType: "INCENTIVE",
          amount: line.roundedAmount,
          currency: line.currency,
          idempotencyKey: `${run.id}:${line.lineKey}:INCENTIVE`,
        });
      }
    }

    this.runs.set(run.id, run);
    return run;
  }

  async createCalculationRunsBatch(
    inputs: CreateCalculationRunInput[],
  ): Promise<CalculationRun[]> {
    const runSnapshot = new Map(this.runs);
    const ledgerSnapshot = this.ledger.snapshot();
    try {
      const runs: CalculationRun[] = [];
      for (const input of inputs) {
        runs.push(await this.createCalculationRun(input));
      }
      return runs;
    } catch (error) {
      this.runs.clear();
      for (const [id, run] of runSnapshot) this.runs.set(id, run);
      this.ledger.restore(ledgerSnapshot);
      throw error;
    }
  }

  async getRun(id: string): Promise<CalculationRun> {
    return this.runs.get(id) ?? notFound("CalculationRun", id);
  }

  async listRuns(): Promise<CalculationRun[]> {
    return [...this.runs.values()];
  }

  async approveRun(id: string): Promise<CalculationRun> {
    const run = await this.getRun(id);
    assertTransition(
      calculationRunTransitions,
      "CalculationRun",
      run.status,
      "APPROVED",
    );
    run.status = "APPROVED";
    return run;
  }

  async lockRun(id: string, confirmation: string): Promise<CalculationRun> {
    if (confirmation !== "LOCK_CALCULATION") {
      throw new ConflictError("invalid lock confirmation");
    }
    const run = await this.getRun(id);
    const blockers = confirmationBlockers(run, [
      ...this.confirmations.values(),
    ]);
    if (blockers.length > 0) {
      throw new CalculationBlockedError(blockers);
    }
    assertTransition(
      calculationRunTransitions,
      "CalculationRun",
      run.status,
      "LOCKED",
    );
    for (const entry of this.ledger
      .list(run.tenantId)
      .filter((candidate) => candidate.calculationRunId === run.id)) {
      this.ledger.lock(entry.id);
    }
    run.status = "LOCKED";
    run.lockedAt = now();
    return run;
  }

  async recordConfirmation(
    input: RecordConfirmationInput,
  ): Promise<EmployeeConfirmation> {
    await this.assertConfirmationTarget(input);
    const key = `${input.personId}:${input.targetType}:${input.targetId}`;
    const existing = this.confirmations.get(key);
    const timestamp = now();
    const record: EmployeeConfirmation = existing ?? {
      id: randomUUID(),
      tenantId: this.tenantId,
      personId: input.personId,
      targetType: input.targetType,
      targetId: input.targetId,
      decision: "VIEWED",
      createdAt: timestamp,
    };
    record.decision = input.decision;
    if (input.decision === "VIEWED") record.viewedAt = timestamp;
    if (input.decision === "CONFIRMED") record.confirmedAt = timestamp;
    if (input.decision === "OBJECTED") {
      record.objectedAt = timestamp;
      record.reason = input.reason;
    }
    this.confirmations.set(key, record);
    return record;
  }

  async listConfirmations(
    personId?: string,
  ): Promise<EmployeeConfirmation[]> {
    return [...this.confirmations.values()].filter(
      (confirmation) => !personId || confirmation.personId === personId,
    );
  }

  private async assertConfirmationTarget(
    input: RecordConfirmationInput,
  ): Promise<void> {
    if (input.targetType === "CALCULATION") {
      await this.getRun(input.targetId);
    } else if (input.targetType === "ATTRIBUTION") {
      if (!this.decisions.has(input.targetId)) {
        notFound("AttributionDecision", input.targetId);
      }
    } else if (input.targetType === "LEDGER") {
      this.ledger.get(input.targetId);
    } else if (input.targetType === "SETTLEMENT") {
      await this.getSettlementBatch(input.targetId);
    }
  }
  };
  return Mixin as unknown as TBase & StoreCtor<CalculationApi>;
}
