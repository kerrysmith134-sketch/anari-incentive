import { randomUUID } from "node:crypto";
import {
  appealCaseTransitions,
  assertTransition,
  type AppealCase,
  type RecalculationRequest,
} from "@anari/domain";
import type {
  ResolveAppealInput,
} from "../store-interface.js";
import {
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type AppealsApi = Pick<
  IncentiveStore,
  | "createAppeal"
  | "getAppeal"
  | "listAppeals"
  | "triageAppeal"
  | "reviewAppeal"
  | "resolveAppeal"
  | "createRecalculationRequest"
  | "getRecalculationRequest"
  | "listRecalculationRequests"
  | "approveRecalculationRequest"
  | "rejectRecalculationRequest"
  | "completeRecalculationRequest"
>;

/**
 * Mixes the appeals domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withAppeals<TBase extends StoreCtor<StoreBase>>(Base: TBase) {
  const Mixin = class AppealsMixin extends Base implements AppealsApi {

  async createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
    targetId: string;
    reasonCode: string;
    statement: string;
    evidenceRefs?: string[];
    dueAt?: string;
  }): Promise<AppealCase> {
    const appeal: AppealCase = {
      id: randomUUID(),
      tenantId: this.tenantId,
      appellantPersonId: input.appellantPersonId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      statement: input.statement,
      evidenceRefs: input.evidenceRefs ?? [],
      status: "OPEN",
      dueAt: input.dueAt,
      createdAt: now(),
    };
    this.appeals.set(appeal.id, appeal);
    return appeal;
  }

  async getAppeal(id: string): Promise<AppealCase> {
    return this.appeals.get(id) ?? notFound("AppealCase", id);
  }

  async listAppeals(): Promise<AppealCase[]> {
    return [...this.appeals.values()];
  }

  async triageAppeal(
    id: string,
    reviewerPersonId: string,
  ): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
    if (reviewerPersonId === appeal.appellantPersonId) {
      throw new ConflictError("the appellant cannot triage their own appeal");
    }
    assertTransition(
      appealCaseTransitions,
      "AppealCase",
      appeal.status,
      "TRIAGED",
    );
    appeal.status = "TRIAGED";
    appeal.reviewerPersonId = reviewerPersonId;
    return appeal;
  }

  async reviewAppeal(id: string): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
    assertTransition(
      appealCaseTransitions,
      "AppealCase",
      appeal.status,
      "UNDER_REVIEW",
    );
    appeal.status = "UNDER_REVIEW";
    return appeal;
  }

  async resolveAppeal(
    id: string,
    input: ResolveAppealInput,
  ): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
    if (
      input.reviewerPersonId === appeal.appellantPersonId ||
      (appeal.reviewerPersonId &&
        input.reviewerPersonId !== appeal.reviewerPersonId)
    ) {
      throw new ConflictError(
        "the appellant or a different reviewer cannot resolve this appeal",
      );
    }
    assertTransition(
      appealCaseTransitions,
      "AppealCase",
      appeal.status,
      "DECIDED",
    );
    appeal.status = "DECIDED";
    appeal.resolution = `${input.resolution}: ${input.rationale}`;
    appeal.resolvedAt = now();
    if (input.resolution === "CHANGE") {
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "RECALCULATION_REQUIRED",
      );
      appeal.status = "RECALCULATION_REQUIRED";
    } else {
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "CLOSED",
      );
      appeal.status = "CLOSED";
    }
    return appeal;
  }

  async createRecalculationRequest(input: {
    targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    explanation: string;
    requestedBy: string;
  }): Promise<RecalculationRequest> {
    const request: RecalculationRequest = {
      id: randomUUID(),
      tenantId: this.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      requestedBy: input.requestedBy,
      status: "OPEN",
      createdAt: now(),
    };
    this.recalculations.set(request.id, request);
    return request;
  }

  async getRecalculationRequest(id: string): Promise<RecalculationRequest> {
    const request = this.recalculations.get(id);
    if (!request) notFound("RecalculationRequest", id);
    return request;
  }

  async listRecalculationRequests(filter?: {
    status?: "OPEN" | "APPROVED" | "REJECTED" | "COMPLETED";
    targetType?: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
  }): Promise<RecalculationRequest[]> {
    return [...this.recalculations.values()]
      .filter(
        (request) =>
          (!filter?.status || request.status === filter.status) &&
          (!filter?.targetType || request.targetType === filter.targetType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveRecalculationRequest(
    id: string,
    approvedBy: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "OPEN") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "APPROVED";
    request.approvedBy = approvedBy;
    request.approvedAt = now();
    return request;
  }

  async rejectRecalculationRequest(
    id: string,
    reviewedBy: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "OPEN") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "REJECTED";
    request.approvedBy = reviewedBy;
    request.approvedAt = now();
    return request;
  }

  async completeRecalculationRequest(
    id: string,
    newCalculationRunId: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "APPROVED") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "COMPLETED";
    request.newCalculationRunId = newCalculationRunId;
    return request;
  }
  };
  return Mixin as unknown as TBase & StoreCtor<AppealsApi>;
}
