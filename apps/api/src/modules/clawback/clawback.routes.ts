/**
 * 追回（clawback）域路由（NPV2-011）：
 * 追回条款生命周期（创建/列表/批准/豁免/取消/生成追回/分期排期）。
 * 会话身份绑定、金额上限校验、审批人校验全部保留。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DirectoryPort, IncentivePort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  approveClawbackCaseSchema,
  closeClawbackCaseSchema,
  createClawbackCaseSchema,
  generateClawbackRecoverySchema,
} from "@anari/contracts";
import { parseDecimal, formatDecimal, sha256 } from "@anari/policy-dsl";
import {
  data,
  idOf,
  isPlatformAdmin,
  ownPersonId,
  parse,
  requireRoles,
  tenantOf,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ClawbackDeps {
  platformStore: DirectoryPort & IncentivePort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  notifyBestEffort: (
    store: IncentiveStore,
    input: {
      recipientPersonId?: string;
      audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
      title: string;
      body: string;
      sourceType?: string;
      sourceId?: string;
    },
  ) => Promise<void>;
}

export function registerClawbackRoutes(deps: ClawbackDeps): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, notifyBestEffort } = deps;
  return async (app: FastifyInstance) => {

    app.post("/api/v1/clawback-cases", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createClawbackCaseSchema, request.body);
      // One written consent authorises one debt. Re-submitting the same consent
      // used to create a second case that could be recovered again.
      const existingCases = await platformStore.listClawbackCases(
        tenantOf(request),
        body.personId,
      );
      const duplicate = existingCases.find(
        (candidate) =>
          candidate.currency === body.currency &&
          candidate.consentSignatureRef.trim().toLowerCase() ===
            body.consentSignatureRef.trim().toLowerCase() &&
          !["CANCELLED", "WAIVED"].includes(candidate.status),
      );
      if (duplicate) {
        throw new ConflictError(
          `CLAWBACK_CONSENT_ALREADY_USED: consent ${body.consentSignatureRef} already backs case ${duplicate.id}`,
        );
      }
      return reply.status(201).send(
        data(
          await platformStore.createClawbackCase({
            tenantId: tenantOf(request),
            personId: body.personId,
            amount: body.amount,
            currency: body.currency,
            reasonCode: body.reasonCode,
            explanation: body.explanation,
            consentSignatureRef: body.consentSignatureRef,
            installmentMonths: body.installmentMonths ?? 1,
            hardshipWaiver: body.hardshipWaiver ?? false,
            hardshipReason: body.hardshipReason,
            requestedBy: requireActorRequired(request, body.requestedBy, "request"),
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/clawback-cases", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as { personId?: string };
      const cases = await platformStore.listClawbackCases(
        tenantOf(request),
        query.personId,
      );
      // Reviewers need to see whether a case already produced a recovery and
      // where that deduction currently sits before waiving anything.
      const store = storeFor(request);
      const ledger = await store.listLedger();
      const batches = await store.listSettlementBatches();
      const linesByBatch = new Map(
        await Promise.all(
          batches.map(
            async (batch) =>
              [batch.id, await store.listSettlementLines(batch.id)] as const,
          ),
        ),
      );
      const enriched = cases.map((clawback) => {
        const recoveryKey = `clawback-recovery:${clawback.id}`;
        const waiveKey = `clawback-waive:${clawback.id}`;
        const recoveries = ledger
          .filter(
            (entry) =>
              entry.idempotencyKey === recoveryKey ||
              entry.idempotencyKey.startsWith(`${recoveryKey}:`),
          )
          .sort((left, right) =>
            left.idempotencyKey.localeCompare(right.idempotencyKey, undefined, {
              numeric: true,
            }),
          );
        if (recoveries.length === 0) return clawback;
        const batchFor = (ledgerId: string) =>
          batches.find((candidate) =>
            (linesByBatch.get(candidate.id) ?? []).some(
              (line) => line.ledgerId === ledgerId,
            ),
          );
        const batch = batchFor(recoveries[0]!.id);
        const total = recoveries.reduce(
          (sum, entry) => sum + parseDecimal(entry.amount),
          0n,
        );
        return {
          ...clawback,
          recovery: {
            ledgerEntryId: recoveries[0]!.id,
            amount: formatDecimal(total),
            batchId: batch?.id ?? null,
            batchNo: batch?.batchNo ?? null,
            batchStatus: batch?.status ?? null,
            waivedReversalEntryId:
              ledger.find(
                (entry) =>
                  entry.idempotencyKey === waiveKey ||
                  entry.idempotencyKey.startsWith(`${waiveKey}:`),
              )?.id ?? null,
            installments: recoveries.map((entry, index) => {
              const entryBatch = batchFor(entry.id);
              return {
                sequence: index + 1,
                ledgerEntryId: entry.id,
                cycleId: entry.cycleId,
                amount: entry.amount,
                batchId: entryBatch?.id ?? null,
                batchNo: entryBatch?.batchNo ?? null,
                batchStatus: entryBatch?.status ?? null,
              };
            }),
          },
        };
      });
      return data(enriched, request);
    });

    app.post("/api/v1/clawback-cases/:id/approve", async (request) => {
      requireRoles(request, "finance");
      const body = parse(approveClawbackCaseSchema, request.body);
      // PostgreSQL does not check the approver row, and the waiver path writes
      // ledger entries before closing the case; validate the person up front so a
      // typo cannot leave a reversal behind without an audit trail entry.
      const persons = await platformStore.listPersons(tenantOf(request));
      if (!persons.some((person) => person.id === requireActor(request, body.approvedBy, "approve"))) {
        throw new NotFoundError(`Person ${requireActor(request, body.approvedBy, "approve")} not found`);
      }
      return data(
        await platformStore.approveClawbackCase({
          tenantId: tenantOf(request),
          caseId: idOf(request),
          approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
        }),
        request,
      );
    });

    app.post("/api/v1/clawback-cases/:id/waive", async (request) => {
      requireRoles(request, "finance");
      const body = parse(closeClawbackCaseSchema, request.body);
      const tenantId = tenantOf(request);
      const store = storeFor(request);
      const cases = await platformStore.listClawbackCases(tenantId);
      const clawback = cases.find((candidate) => candidate.id === idOf(request));
      if (!clawback) {
        throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
      }
      const persons = await platformStore.listPersons(tenantId);
      if (!persons.some((person) => person.id === body.actorPersonId)) {
        throw new NotFoundError(`Person ${body.actorPersonId} not found`);
      }
      // A waiver must undo every generated recovery (one lump sum or all
      // installments), otherwise the negative entries and their batches keep
      // running after the case closes.
      const recoveryKey = `clawback-recovery:${clawback.id}`;
      const waiveKey = `clawback-waive:${clawback.id}`;
      const ledger = await store.listLedger();
      const sequenceOf = (entry: { idempotencyKey: string }): number => {
        const suffix = entry.idempotencyKey.slice(recoveryKey.length);
        return suffix.startsWith(":") ? Number(suffix.slice(1)) : 0;
      };
      const recoveries = ledger
        .filter(
          (entry) =>
            entry.idempotencyKey === recoveryKey ||
            entry.idempotencyKey.startsWith(`${recoveryKey}:`),
        )
        .sort((left, right) => sequenceOf(left) - sequenceOf(right));
      const reversalEntryIds: string[] = [];
      const cancelledBatchIds: string[] = [];
      if (recoveries.length > 0) {
        // Validate every batch before writing anything: a locked recovery can no
        // longer be cancelled, so the waiver must be refused while the case is
        // still open (no half-applied reversal).
        const carrying: Array<{
          id: string;
          batchNo: string;
          status: string;
          kind: string;
        }> = [];
        const recoveryIdsForBatches = new Set(
          recoveries.map((entry) => entry.id),
        );
        for (const batch of await store.listSettlementBatches()) {
          if (batch.status === "CANCELLED") continue;
          const lines = await store.listSettlementLines(batch.id);
          if (
            lines.some(
              (line) =>
                line.active && recoveryIdsForBatches.has(line.ledgerId),
            )
          ) {
            carrying.push({
              id: batch.id,
              batchNo: batch.batchNo,
              status: batch.status,
              kind: batch.kind,
            });
          }
        }
        // A standard payroll batch cannot be cancelled here without voiding
        // everyone else's pay, so the waiver must not touch the ledger at all.
        const standard = carrying.find((batch) => batch.kind !== "RECOVERY");
        if (standard) {
          throw new ConflictError(
            `CLAWBACK_RECOVERY_IN_STANDARD_BATCH: recovery sits in batch ${standard.batchNo}; cancel that batch or reverse its line before waiving`,
          );
        }
        const locked = carrying.find((batch) =>
          ["LOCKED", "EXPORTED", "ACKNOWLEDGED", "ADJUSTMENT_REQUIRED"].includes(
            batch.status,
          ),
        );
        if (locked) {
          throw new ConflictError(
            `CLAWBACK_RECOVERY_ALREADY_LOCKED: batch ${locked.batchNo} is ${locked.status}; settle the reversal through payroll instead`,
          );
        }
        for (const recovery of recoveries) {
          const sequence = sequenceOf(recovery);
          const recoveryWaiveKey =
            sequence === 0 ? waiveKey : `${waiveKey}:${sequence}`;
          const existing = ledger.find(
            (entry) => entry.idempotencyKey === recoveryWaiveKey,
          );
          if (existing) {
            reversalEntryIds.push(existing.id);
            continue;
          }
          const reversal = await store.adjustLedgerEntry(recovery.id, {
            amount: formatDecimal(-parseDecimal(recovery.amount)),
            entryType: "REVERSAL",
            reasonCode: "CLAWBACK_WAIVED",
            explanation: `Clawback case ${clawback.id} waived: ${body.reason}`,
            approvedBy: body.actorPersonId,
            idempotencyKey: recoveryWaiveKey,
          });
          reversalEntryIds.push(reversal.entry.id);
          countEvent("clawback_waiver_reversal");
        }
        for (const batch of carrying) {
          await store.commandSettlementBatch(batch.id, {
            command: "CANCEL",
            actorPersonId: body.actorPersonId,
            reason: `Clawback case ${clawback.id} waived: ${body.reason}`,
          });
          cancelledBatchIds.push(batch.id);
          countEvent("clawback_recovery_batch_cancelled");
        }
        // The recovery notices are obsolete once the case is waived: retire them
        // so employees are not prompted to confirm deductions that no longer exist.
        try {
          // A recovery batch can carry other people's deductions, so their
          // notices must be retired too when the whole batch is cancelled.
          const notices = await store.listNotifications({ status: "UNREAD" });
          for (const notice of notices) {
            if (
              notice.sourceType === "SETTLEMENT_BATCH" &&
              carrying.some((batch) => batch.id === notice.sourceId)
            ) {
              await store.markNotificationRead(notice.id);
            }
          }
        } catch {
          // Notification hygiene must not block the waiver itself.
        }
        // Keep every reversed pair out of later sweeps: otherwise the next sweep
        // collects the positive reversal on its own and pays the employee the
        // amount that was just waived.
        const excludedIds = [
          ...recoveries.map((entry) => entry.id),
          ...reversalEntryIds,
        ];
        await platformStore.excludeLedgerFromSettlement({
          tenantId,
          ledgerIds: excludedIds,
          reason: `clawback case ${clawback.id} waived`,
          actorPersonId: body.actorPersonId,
        });
        // The in-memory store keeps its own exclusion set; PostgreSQL reads the
        // shared ledger_exclusions table written above.
        await store.excludeFromSettlement?.(excludedIds);
        await notifyBestEffort(store, {
          recipientPersonId: clawback.personId,
          audience: "PERSON",
          title: "Clawback waived",
          body: `Clawback case ${clawback.id} was waived after review: ${body.reason}. The recovery deduction no longer applies.`,
          sourceType: "CLAWBACK_CASE",
          sourceId: clawback.id,
        });
      }
      const updated = await platformStore.closeClawbackCase({
        tenantId,
        caseId: idOf(request),
        action: "WAIVE",
        reason: body.reason,
        actorPersonId: body.actorPersonId,
      });
      countEvent("clawback_waived");
      return data(
        {
          ...updated,
          reversalEntryId: reversalEntryIds[0],
          reversalEntryIds,
          cancelledBatchId: cancelledBatchIds[0],
          cancelledBatchIds,
        },
        request,
      );
    });

    app.post("/api/v1/clawback-cases/:id/cancel", async (request) => {
      requireRoles(request, "finance");
      const body = parse(closeClawbackCaseSchema, request.body);
      const tenantId = tenantOf(request);
      const cases = await platformStore.listClawbackCases(tenantId);
      const clawback = cases.find((candidate) => candidate.id === idOf(request));
      if (!clawback) {
        throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
      }
      // Cancelling after the recovery was posted would leave the deduction in the
      // ledger and in any settlement batch with no case pointing at it.
      const recoveryExists = (await storeFor(request).listLedger()).some(
        (entry) => entry.idempotencyKey === `clawback-recovery:${clawback.id}`,
      );
      if (recoveryExists) {
        throw new ConflictError(
          "CLAWBACK_RECOVERY_ALREADY_GENERATED: waive the case instead so the recovery is reversed",
        );
      }
      return data(
        await platformStore.closeClawbackCase({
          tenantId,
          caseId: idOf(request),
          action: "CANCEL",
          reason: body.reason,
          actorPersonId: body.actorPersonId,
        }),
        request,
      );
    });

  app.post("/api/v1/clawback-cases/:id/generate-recovery", async (request) => {
    requireRoles(request, "finance");
    const body = parse(generateClawbackRecoverySchema, request.body);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const cases = await platformStore.listClawbackCases(tenantId);
    const clawback = cases.find((candidate) => candidate.id === idOf(request));
    if (!clawback) {
      throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
    }
    if (clawback.status !== "APPROVED") {
      throw new ConflictError(
        `CLAWBACK_NOT_APPROVED: case is ${clawback.status}`,
      );
    }
    // Idempotency: one recovery adjustment per case (or one per installment).
    const idempotencyKey = `clawback-recovery:${clawback.id}`;
    const ledger = await store.listLedger();
    const duplicate = ledger.some(
      (entry) =>
        entry.idempotencyKey === idempotencyKey ||
        entry.idempotencyKey.startsWith(`${idempotencyKey}:`),
    );
    const hasLegacyRecovery = ledger.some(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    // Multi-installment generation is resumable (per-installment keys), but a
    // legacy lump sum already posted must never be topped up with installments.
    if (hasLegacyRecovery || (duplicate && !body.installmentCycles?.length)) {
      throw new ConflictError(
        "CLAWBACK_RECOVERY_ALREADY_GENERATED: this case already has a recovery adjustment",
      );
    }
    // A recovery is a negative adjustment on the debtor's own award entry.
    // Validating the source up front keeps the deduction off someone else's
    // payslip and out of the wrong cycle/currency.
    const source = ledger.find((entry) => entry.id === body.ledgerEntryId);
    if (!source) {
      throw new NotFoundError(`LedgerEntry ${body.ledgerEntryId} not found`);
    }
    if (source.personId !== clawback.personId) {
      throw new ConflictError(
        "CLAWBACK_ENTRY_PERSON_MISMATCH: the source entry belongs to another person",
      );
    }
    if (source.currency !== clawback.currency) {
      throw new ConflictError(
        `CLAWBACK_CURRENCY_MISMATCH: case is ${clawback.currency}, entry is ${source.currency}`,
      );
    }
    if (parseDecimal(source.amount) <= 0n) {
      throw new ConflictError(
        "CLAWBACK_ENTRY_NOT_POSITIVE: the source entry must be a positive award",
      );
    }
    if (source.cycleId !== body.cycleId) {
      throw new ConflictError(
        `CLAWBACK_CYCLE_MISMATCH: entry belongs to cycle ${source.cycleId}, not ${body.cycleId}`,
      );
    }
    // Never recover more than the award still holds. Waived recoveries are
    // netted out through their reversal entries.
    const recoveryEntries = ledger.filter(
      (entry) =>
        entry.entryType === "RECOVERY" &&
        entry.sourceEntryId === source.id,
    );
    let alreadyRecovered = 0n;
    for (const entry of recoveryEntries) {
      alreadyRecovered += -parseDecimal(entry.amount);
    }
    const recoveryIds = new Set(recoveryEntries.map((entry) => entry.id));
    for (const entry of ledger) {
      if (
        entry.entryType === "REVERSAL" &&
        entry.sourceEntryId &&
        recoveryIds.has(entry.sourceEntryId)
      ) {
        alreadyRecovered -= parseDecimal(entry.amount);
      }
    }
    const remaining = parseDecimal(source.amount) -
      (alreadyRecovered > 0n ? alreadyRecovered : 0n);
    if (!duplicate && parseDecimal(clawback.amount) > remaining) {
      throw new ConflictError(
        `CLAWBACK_EXCEEDS_REMAINING: case is ${clawback.amount}, only ${formatDecimal(remaining > 0n ? remaining : 0n)} remains recoverable on this entry`,
      );
    }

    // Optional cross-cycle installments. Each installment is posted into its
    // own cycle so payroll withholds only that month's share.
    const cycles = body.installmentCycles;
    if (cycles && cycles.length > 0) {
      if (cycles.length !== clawback.installmentMonths) {
        throw new BadRequestError(
          "CLAWBACK_INSTALLMENT_COUNT_MISMATCH",
          `installmentCycles must contain ${clawback.installmentMonths} entries`,
        );
      }
      if (new Set(cycles).size !== cycles.length) {
        throw new BadRequestError(
          "CLAWBACK_INSTALLMENT_CYCLE_DUPLICATED",
          "each installment must target a distinct cycle",
        );
      }
      for (const cycleId of cycles) {
        try {
          await store.getEvaluationCycle(cycleId);
        } catch {
          throw new NotFoundError(`EvaluationCycle ${cycleId} not found`);
        }
      }
      const total = parseDecimal(clawback.amount);
      const months = BigInt(cycles.length);
      const base = total / months;
      let allocated = 0n;
      const installments: Array<{
        sequence: number;
        cycleId: string;
        ledgerEntryId: string;
        adjustmentRecordId: string;
        amount: string;
      }> = [];
      const excluded = new Set<string>();
      for (let index = 0; index < cycles.length; index += 1) {
        const amount =
          index === cycles.length - 1 ? total - allocated : base;
        allocated += amount;
        const result = await store.adjustLedgerEntry(body.ledgerEntryId, {
          amount: `-${formatDecimal(amount)}`,
          reasonCode: "CLAWBACK_RECOVERY",
          explanation: `Clawback case ${clawback.id} installment ${index + 1}/${cycles.length}: ${clawback.reasonCode}`,
          approvedBy: clawback.approvedBy ?? request.authContext!.userId,
          idempotencyKey: `${idempotencyKey}:${index + 1}`,
          entryType: "RECOVERY",
          cycleId: cycles[index],
        });
        installments.push({
          sequence: index + 1,
          cycleId: cycles[index]!,
          ledgerEntryId: result.entry.id,
          adjustmentRecordId: result.record.id,
          amount: formatDecimal(amount),
        });
        excluded.add(result.entry.id);
      }
      let batch = null;
      if (body.createBatch !== false) {
        // Only the first cycle gets an automatic batch; later cycles create
        // theirs through the settlement page when they become current.
        batch = await store.createSettlementBatch({
          cycleId: cycles[0]!,
          kind: "RECOVERY",
        });
        const lines = await store.listSettlementLines(batch.id);
        const affected = [
          ...new Set(
            lines
              .filter((line) => Number(line.amount) < 0)
              .map((line) => line.personId),
          ),
        ];
        for (const personId of affected) {
          await notifyBestEffort(store, {
            recipientPersonId: personId,
            audience: "PERSON",
            title: "Clawback recovery requires confirmation",
            body: `Batch ${batch.batchNo} carries a clawback recovery; please review and confirm or object.`,
            sourceType: "SETTLEMENT_BATCH",
            sourceId: batch.id,
          });
        }
      }
      const stamped = await platformStore.markClawbackRecoveryGenerated({
        tenantId,
        caseId: clawback.id,
      });
      countEvent("clawback_recovery_generated");
      return data(
        {
          caseId: clawback.id,
          caseStatus: stamped.status,
          adjustmentRecordId: installments[0]!.adjustmentRecordId,
          ledgerEntryId: installments[0]!.ledgerEntryId,
          ledgerEntryIds: installments.map((row) => row.ledgerEntryId),
          installments,
          recoveryBatch: batch,
        },
        request,
      );
    }

    const { entry, record } = await store.adjustLedgerEntry(
      body.ledgerEntryId,
      {
        amount: `-${clawback.amount}`,
        reasonCode: "CLAWBACK_RECOVERY",
        explanation: `Clawback case ${clawback.id}: ${clawback.reasonCode}`,
        approvedBy: clawback.approvedBy ?? request.authContext!.userId,
        idempotencyKey,
        // Typed RECOVERY, not ADJUSTMENT: payslips must label it as a clawback
        // and RECOVERY-specific priority/cap rules must bind.
        entryType: "RECOVERY",
      },
    );
    let batch = null;
    if (body.createBatch !== false) {
      batch = await store.createSettlementBatch({
        cycleId: body.cycleId,
        kind: "RECOVERY",
      });
      const lines = await store.listSettlementLines(batch.id);
      const affected = [
        ...new Set(
          lines
            .filter((line) => Number(line.amount) < 0)
            .map((line) => line.personId),
        ),
      ];
      for (const personId of affected) {
        await notifyBestEffort(store, {
          recipientPersonId: personId,
          audience: "PERSON",
          title: "Clawback recovery requires confirmation",
          body: `Batch ${batch.batchNo} carries a clawback recovery; please review and confirm or object.`,
          sourceType: "SETTLEMENT_BATCH",
          sourceId: batch.id,
        });
      }
    }
    const stamped = await platformStore.markClawbackRecoveryGenerated({
      tenantId,
      caseId: clawback.id,
    });
    countEvent("clawback_recovery_generated");
    return data(
      {
        caseId: clawback.id,
        caseStatus: stamped.status,
        adjustmentRecordId: record.id,
        ledgerEntryId: entry.id,
        recoveryBatch: batch,
      },
      request,
    );
  });

  app.get("/api/v1/clawback-cases/:id/schedule", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const cases = await platformStore.listClawbackCases(tenantId);
    const clawback = cases.find((candidate) => candidate.id === idOf(request));
    if (!clawback) {
      throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
    }
    const contracts = await platformStore.listEmploymentContracts(
      tenantId,
      clawback.personId,
    );
    const contract = contracts.find(
      (candidate) =>
        candidate.status === "ACTIVE" &&
        candidate.currency === clawback.currency &&
        Date.parse(candidate.startDate) <= Date.now() &&
        (!candidate.endDate ||
          Date.parse(candidate.endDate) >= Date.now()),
    );
    if (!contract) {
      return data(
        {
          caseId: clawback.id,
          caseStatus: clawback.status,
          available: false,
          reason: "NO_ACTIVE_CONTRACT_FOR_CURRENCY",
          installments: [],
        },
        request,
      );
    }
    const fixed = parseDecimal(contract.fixedMonthlySalary);
    const minimum = parseDecimal(contract.minimumMonthlyWage);
    const capRate = parseDecimal(contract.deductionCapRate || "0.2");
    const capByRate = (fixed * capRate) / 1_000_000n;
    const capByMinimum = fixed - minimum;
    const capCandidate = capByRate < capByMinimum ? capByRate : capByMinimum;
    const capAmount = capCandidate > 0n ? capCandidate : 0n;
    const total = parseDecimal(clawback.amount);
    const months = BigInt(clawback.installmentMonths);
    const base = total / months;
    const anchor = new Date(clawback.approvedAt ?? clawback.createdAt);
    let allocated = 0n;
    let blockedCount = 0;
    const installments = Array.from(
      { length: clawback.installmentMonths },
      (_, index) => {
        const amount =
          index === clawback.installmentMonths - 1
            ? total - allocated
            : base;
        allocated += amount;
        const remainingWage = fixed - amount;
        const minimumWagePassed = remainingWage >= minimum;
        const deductionCapPassed = amount <= capAmount;
        if (!minimumWagePassed || !deductionCapPassed) blockedCount += 1;
        const dueDate = new Date(anchor);
        dueDate.setUTCMonth(dueDate.getUTCMonth() + index);
        return {
          sequence: index + 1,
          dueDate: dueDate.toISOString().slice(0, 10),
          amount: formatDecimal(amount),
          remainingWage: formatDecimal(remainingWage),
          deductionCapAmount: formatDecimal(capAmount),
          minimumWagePassed,
          deductionCapPassed,
        };
      },
    );
    return data(
      {
        caseId: clawback.id,
        caseStatus: clawback.status,
        available: true,
        contractId: contract.id,
        currency: clawback.currency,
        totalAmount: formatDecimal(total),
        installmentMonths: clawback.installmentMonths,
        fixedMonthlySalary: contract.fixedMonthlySalary,
        minimumMonthlyWage: contract.minimumMonthlyWage,
        deductionCapRate: formatDecimal(capRate),
        deductionCapAmount: formatDecimal(capAmount),
        minimumWagePassed: installments.every(
          (installment) => installment.minimumWagePassed,
        ),
        deductionCapPassed: installments.every(
          (installment) => installment.deductionCapPassed,
        ),
        blockedCount,
        scheduleHash: sha256({
          caseId: clawback.id,
          contractId: contract.id,
          total: formatDecimal(total),
          months: clawback.installmentMonths,
          installments,
        }),
        installments,
      },
      request,
    );
  });
  };
}
