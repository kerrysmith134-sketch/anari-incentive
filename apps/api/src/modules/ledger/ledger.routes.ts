/**
 * 台账与奖励批次域路由（账本/冲销/调整/奖励批次生命周期+CSV 导入）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { parseCsv } from "@anari/connectors";
import { columnIndexFor } from "../../http-helpers.js";
import type { DirectoryPort, IncentivePort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import {
  adjustLedgerEntrySchema,
  createIncentiveAwardBatchSchema,
  importIncentiveAwardBatchSchema,
  reverseLedgerEntrySchema,
} from "@anari/contracts";
import {
  data,
  errorBody,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
  ownPersonId,
  policyBody,
  requireString,
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


export function registerLedgerRoutes(deps: {
  platformStore: DirectoryPort & IncentivePort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  ensureApproval: (
    request: FastifyRequest,
    actionType: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  consumeApprovalForAction: (
    request: FastifyRequest,
    input: {
      approvalRequestId: string;
      actionType: string;
      targetType: string;
      targetId: string;
    },
  ) => Promise<void>;
  assertNoRetroactiveAdjustment: (
    request: FastifyRequest,
    ledgerEntryId: string,
  ) => Promise<void>;
  assertExportAllowed: (request: FastifyRequest) => void;
  assertExportDlp: (
    request: FastifyRequest,
    text: string,
    targetType: string,
    targetId: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  auditExport: (
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ) => Promise<void>;
  exportHeaders: (
    request: FastifyRequest,
    csv: string,
    classification: string,
  ) => Record<string, string>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, ensureApproval, consumeApprovalForAction, assertNoRetroactiveAdjustment, assertExportAllowed, assertExportDlp, auditExport, exportHeaders } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/ledger/:id/adjustments", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(adjustLedgerEntrySchema, request.body);
    await assertNoRetroactiveAdjustment(request, idOf(request));
    await ensureApproval(request, "LEDGER_ADJUSTMENT", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEDGER_ADJUSTMENT",
        targetType: "LEDGER_ENTRY",
        targetId: idOf(request),
      });
    }
    const adjustment = await storeFor(request).adjustLedgerEntry(
      idOf(request),
      {
        amount: body.amount,
        reasonCode: body.reasonCode,
        explanation: body.explanation,
        approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
        idempotencyKey: body.idempotencyKey,
      },
    );
    countEvent("ledger_adjustment");
    return reply.status(201).send(data(adjustment, request));
  });

  app.get("/api/v1/adjustment-records", async (request) => {
    requireRoles(request, "finance");
    return data(
      await storeFor(request).listAdjustmentRecords(),
      request,
    );
  });
  app.get("/api/v1/ledger", async (request) => {
    const entries = await storeFor(request).listLedger();
    const person = personFilter(request);
    return data(
      person
        ? entries.filter((entry) => entry.personId === person)
        : entries,
      request,
    );
  });

  app.post("/api/v1/ledger/:id/reverse", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(reverseLedgerEntrySchema, request.body);
    await assertNoRetroactiveAdjustment(request, idOf(request));
    await ensureApproval(request, "LEDGER_REVERSAL", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEDGER_REVERSAL",
        targetType: "LEDGER_ENTRY",
        targetId: idOf(request),
      });
    }
    const reversal = await storeFor(request).reverseLedgerEntry(
      idOf(request),
      body,
    );
    countEvent("ledger_reversal");
    return reply.status(201).send(data(reversal, request));
  });

  app.get("/api/v1/ledger/verify", async (request) => {
    requireRoles(request, "manager", "finance");
    return data({ valid: await storeFor(request).verifyLedger() }, request);
  });

  app.post("/api/v1/incentive-award-batches", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createIncentiveAwardBatchSchema, request.body);
    const createdBy = requireActor(request, body.createdBy, "create") ?? ownPersonId(request) ?? "system";
    const batch = await platformStore.createIncentiveAwardBatch({
      tenantId: tenantOf(request),
      batchNo: body.batchNo,
      awardType: body.awardType,
      period: body.period,
      cycleId: body.cycleId,
      currency: body.currency,
      createdBy,
      sourceRecordIds: body.sourceRecordIds,
      lines: body.lines,
    });
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? createdBy,
        action: "INCENTIVE_AWARD_BATCH_CREATED",
        objectType: "INCENTIVE_AWARD_BATCH",
        objectId: batch.id,
        reason: `${batch.awardType}:${batch.batchNo}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    return reply.status(201).send(data(batch, request));
  });

  // 批量导入：CSV（工号/人员ID + 金额）一次生成整个发放批次。
  app.post("/api/v1/incentive-award-batches:import", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(importIncentiveAwardBatchSchema, request.body);
    const rows = parseCsv(body.csv);
    if (rows.length < 2) {
      throw new BadRequestError(
        "CSV_NO_DATA_ROWS",
        "CSV 需要表头和至少一行数据",
      );
    }
    const header = rows[0]!;
    const col = {
      personId: columnIndexFor(header, ["person_id", "personid", "人员id"]),
      employeeCode: columnIndexFor(header, [
        "employee_code",
        "employeecode",
        "工号",
        "员工编号",
        "empno",
      ]),
      amount: columnIndexFor(header, ["amount", "金额", "奖金"]),
      note: columnIndexFor(header, ["note", "备注"]),
      sourceRecordId: columnIndexFor(header, [
        "source_record_id",
        "来源标识",
        "来源记录",
        "来源记录id",
      ]),
      sourceLineRef: columnIndexFor(header, [
        "source_line_ref",
        "来源行",
        "来源行标识",
      ]),
    };
    if (col.amount === -1 || (col.personId === -1 && col.employeeCode === -1)) {
      throw new BadRequestError(
        "CSV_COLUMNS_REQUIRED",
        "CSV 必须包含「金额」列，以及「工号/员工编号」或「人员ID」列",
      );
    }
    const persons = await platformStore.listPersons(tenantOf(request));
    const byCode = new Map(
      persons.map((person) => [person.employeeCode.toLowerCase(), person.id]),
    );
    const rowErrors: string[] = [];
    const lines: Array<{
      personId: string;
      amount: string;
      sourceRecordId?: string;
      sourceLineRef?: string;
      note?: string;
    }> = [];
    const seenLines = new Set<string>();
    rows.slice(1).forEach((cells, rowIndex) => {
      const lineNumber = rowIndex + 2;
      if (cells.every((cell) => !cell.trim())) return;
      const rawAmount = (col.amount >= 0 ? cells[col.amount] : "")?.trim() ?? "";
      if (!/^\d+(\.\d{1,6})?$/.test(rawAmount) || Number(rawAmount) <= 0) {
        rowErrors.push(`第 ${lineNumber} 行：金额「${rawAmount}」无效`);
        return;
      }
      let personId: string | undefined;
      if (col.personId >= 0 && cells[col.personId]?.trim()) {
        personId = cells[col.personId]!.trim();
        if (!persons.some((person) => person.id === personId)) {
          rowErrors.push(`第 ${lineNumber} 行：人员 ${personId} 不存在`);
          return;
        }
      } else if (col.employeeCode >= 0) {
        const code = cells[col.employeeCode]?.trim().toLowerCase() ?? "";
        personId = byCode.get(code);
        if (!personId) {
          rowErrors.push(`第 ${lineNumber} 行：工号「${code}」没有匹配的员工`);
          return;
        }
      } else {
        rowErrors.push(`第 ${lineNumber} 行：缺少人员标识`);
        return;
      }
      const sourceLineRef =
        col.sourceLineRef >= 0 ? cells[col.sourceLineRef]?.trim() : undefined;
      const sourceRecordId =
        col.sourceRecordId >= 0 ? cells[col.sourceRecordId]?.trim() : undefined;
      const dedupeKey = `${personId}:${sourceLineRef ?? ""}`;
      if (seenLines.has(dedupeKey)) {
        rowErrors.push(
          `第 ${lineNumber} 行：同一人员的来源行标识重复（${sourceLineRef ?? "空"}）`,
        );
        return;
      }
      seenLines.add(dedupeKey);
      lines.push({
        personId,
        amount: rawAmount,
        sourceRecordId: sourceRecordId || undefined,
        sourceLineRef: sourceLineRef || undefined,
        note: col.note >= 0 ? cells[col.note]?.trim() || undefined : undefined,
      });
    });
    if (rowErrors.length > 0 || lines.length === 0) {
      return reply.status(400).send({
        ...errorBody(
          "CSV_ROWS_INVALID",
          `CSV 校验失败：${rowErrors.length} 行有问题${rowErrors.length === 0 ? "（没有有效数据行）" : ""}`,
          rowErrors.slice(0, 50),
        ),
        meta: { correlation_id: request.id },
      });
    }
    const createdBy = requireActor(request, body.createdBy, "create") ?? ownPersonId(request) ?? "system";
    const batch = await platformStore.createIncentiveAwardBatch({
      tenantId: tenantOf(request),
      batchNo: body.batchNo,
      awardType: body.awardType,
      period: body.period,
      cycleId: body.cycleId,
      currency: body.currency,
      createdBy,
      sourceRecordIds: lines
        .map((line) => line.sourceRecordId)
        .filter((value): value is string => Boolean(value)),
      lines,
    });
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? createdBy,
        action: "INCENTIVE_AWARD_BATCH_IMPORTED",
        objectType: "INCENTIVE_AWARD_BATCH",
        objectId: batch.id,
        reason: `${batch.awardType}:${batch.batchNo}:csv rows=${lines.length}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    countEvent("award_batch_csv_imported");
    return reply
      .status(201)
      .send(data({ batch, imported: lines.length }, request));
  });

  app.get("/api/v1/incentive-award-batches", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      awardType?: string;
      period?: string;
      status?: string;
    };
    return data(
      await platformStore.listIncentiveAwardBatches(tenantOf(request), query),
      request,
    );
  });

  app.get("/api/v1/incentive-award-batches/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getIncentiveAwardBatch(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/incentive-award-batches/:id/commands", async (request) => {
      requireRoles(request, "finance");
      const body = policyBody(request);
      const command = requireString(body, "command") as Parameters<
        typeof platformStore.commandIncentiveAwardBatch
      >[0]["command"];
      if (
        ![
          "SUBMIT",
          "APPROVE",
          "LOCK",
          "EXPORT",
          "ACKNOWLEDGE",
          "CANCEL",
        ].includes(command)
      ) {
        throw new BadRequestError("INVALID_COMMAND", `不支持的命令 ${command}`);
      }
      const batch = await platformStore.commandIncentiveAwardBatch({
        tenantId: tenantOf(request),
        batchId: idOf(request),
        command,
        actorPersonId: ownPersonId(request) ?? "system",
        paymentRef:
          typeof body.paymentRef === "string" ? body.paymentRef : undefined,
      });
      try {
        await storeFor(request).recordAuditEvent({
          actorType: "USER",
          actorId: ownPersonId(request),
          action: `INCENTIVE_AWARD_BATCH_${command}`,
          objectType: "INCENTIVE_AWARD_BATCH",
          objectId: batch.id,
          reason: `${batch.batchNo}:${batch.status}`,
        });
      } catch {
        /* audit is best-effort */
      }
      return data(batch, request);
    },
  );

  app.get("/api/v1/incentive-award-batches/:id/export", async (request, reply) => {
    requireRoles(request, "finance");
    const batch = await platformStore.getIncentiveAwardBatch(
      tenantOf(request),
      idOf(request),
    );
    if (!["EXPORTED", "ACKNOWLEDGED"].includes(batch.status)) {
      throw new ConflictError(
        `award batch must be EXPORTED before downloading (current ${batch.status})`,
      );
    }
    assertExportAllowed(request);
    const escape = (value: unknown): string => {
      const text = String(value ?? "");
      const guarded = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)
        ? `'${text}`
        : text;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["批次号", "奖项类型", "周期", "币种", "人员ID", "金额", "来源记录", "来源行", "备注"],
      ...batch.lines.map((line) => [
        batch.batchNo,
        batch.awardType,
        batch.period,
        batch.currency,
        line.personId,
        line.amount,
        line.sourceRecordId ?? "",
        line.sourceLineRef ?? "",
        line.note ?? "",
      ]),
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map(escape).join(","))
      .join("\r\n")}\r\n`;
    const query = request.query as { approvalRequestId?: string };
    await assertExportDlp(
      request,
      csv,
      "INCENTIVE_AWARD_BATCH",
      batch.id,
      query.approvalRequestId,
    );
    await auditExport(
      request,
      "AWARD_BATCH_EXPORTED",
      "INCENTIVE_AWARD_BATCH",
      batch.id,
      `lines=${batch.lineCount}`,
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${batch.batchNo}.csv"`)
      .headers(exportHeaders(request, csv, "CONFIDENTIAL_PAYROLL"))
      .send(csv);
  });
  };
}
