import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Select,
  StatTile,
  Textarea,
  TextInput,
} from "../ui.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api, ApiError } from "../../lib/api.js";
import {
  displayName,
  formatDateTime,
  formatMoney,
  shortId,
  toNumber,
} from "../../lib/format.js";
import { useApiQuery } from "../../lib/hooks.js";
import { zhStatus } from "../../lib/zh.js";
import { usePeople } from "../PersonSelect.js";
import { PaymentCsvImport } from "./PaymentCsvImport.js";
import { PaymentEntryRow } from "./PaymentEntryRow.js";
import {
  GL_STATUS_LABELS,
  glStatusForLine,
  glStatusTone,
  glSummaryLabel,
  glSummaryTone,
  missingJournalLineIdSet,
} from "./gl.js";
import {
  CREDIT_ACCOUNT_LABELS,
  LINE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RECONCILIATION_LABELS,
  currentAccountingPeriod,
  decimalEquals,
  isValidAccountingPeriod,
  isValidPaymentAmount,
  lineStatusTone,
  paymentStatusTone,
  reconciliationTone,
  sumDecimalAmounts,
  type AwardBatchSummary,
  type AwardPaymentPayload,
  type AwardReconciliation,
  type AwardReconciliationLine,
  type AwardReconciliationPayment,
  type SubmitOutcome,
} from "./types.js";

/**
 * 批次详情里的「支付与对账」工作台。
 *
 * - 读取迁移 117 的对账投影，展示每行应付/已付/未付/差异/支付状态/GL 状态；
 * - 用对账响应里的 `payments` 展示该批次全部历史回执（成功/失败/退回），
 *   不再局限于当前页面会话；
 * - 未付行逐行录入支付回执（POST /payments）；
 * - 支持前端解析 CSV / 粘贴回执并逐行提交，逐行显示失败原因；
 * - ACK 只有在 reconciliation=RECONCILED 且 glComplete 时才启用；
 * - 已 ACKNOWLEDGED 的批次隐藏普通支付入口，但允许财务以新的
 *   paymentRef 登记 RETURNED（退回/冲正）留痕；该动作不修改历史 PAID、
 *   不冲减已付金额、不自动改变批次状态，需财务人工复核后做账务冲正。
 * - 退回记录及其对账影响来自对账接口的 `payments`，前端只做展示。
 *
 * GL 状态来自迁移 119 的对账投影（glComplete / missingJournalLineIds），
 * 与后端 ACK 门禁使用同一份事实，前端不再自行扫描凭证。
 */
export function AwardPaymentWorkbench({
  batch,
  canPay,
  onClose,
  onChanged,
}: {
  batch: AwardBatchSummary;
  canPay: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { people } = usePeople();
  const sectionRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const ackHelpId = `${headingId}-ack-help`;
  const ackErrorId = `${headingId}-ack-error`;
  const ackFormId = `${headingId}-ack-form`;

  const [ackOpen, setAckOpen] = useState(false);
  const [ackRef, setAckRef] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);

  const reconciliationQuery = useApiQuery<AwardReconciliation>(
    `/api/v1/incentive-award-batches/${batch.id}/reconciliation`,
    batch.id,
  );
  const reconciliation = reconciliationQuery.data;

  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({
      block: "start",
      behavior: "smooth",
    });
    sectionRef.current?.focus?.({ preventScroll: true });
  }, [batch.id]);

  const missingGlLineIds = useMemo(
    () => missingJournalLineIdSet(reconciliation),
    [reconciliation],
  );
  const glMissingLines = reconciliation?.missingJournalLineIds.length ?? 0;

  const receiptsByLine = useMemo(() => {
    const map = new Map<string, AwardReconciliationPayment[]>();
    for (const receipt of reconciliation?.payments ?? []) {
      const list = map.get(receipt.lineId) ?? [];
      list.push(receipt);
      map.set(receipt.lineId, list);
    }
    return map;
  }, [reconciliation]);

  const historicalPayments = reconciliation?.payments ?? [];

  const lineById = useMemo(
    () =>
      new Map(
        (reconciliation?.lines ?? []).map((line) => [line.lineId, line]),
      ),
    [reconciliation],
  );

  /** 已足额支付、可以登记退回/冲正的行（ACK 后对账仍按 PAID 计算）。 */
  const paidLines = useMemo(
    () =>
      reconciliation?.lines.filter((line) => line.status === "PAID") ?? [],
    [reconciliation],
  );

  const returnedPayments = useMemo(
    () =>
      (reconciliation?.payments ?? []).filter(
        (receipt) => receipt.status === "RETURNED",
      ),
    [reconciliation],
  );

  const returnedTotal = useMemo(
    () => sumDecimalAmounts(returnedPayments.map((receipt) => receipt.amount)),
    [returnedPayments],
  );

  const acknowledged = batch.status === "ACKNOWLEDGED";
  const payableStatus = ["LOCKED", "EXPORTED"].includes(batch.status);
  const paymentEditable = canPay && payableStatus && !acknowledged;

  const unpaidLines =
    reconciliation?.lines.filter((line) => line.status === "UNPAID") ?? [];
  const adjustmentLines =
    reconciliation?.lines.filter(
      (line) => line.status === "PARTIAL" || line.status === "OVERPAID",
    ) ?? [];

  const variance = reconciliation ? toNumber(reconciliation.variance) : 0;

  async function submitPayment(
    payment: AwardPaymentPayload,
  ): Promise<SubmitOutcome> {
    try {
      // 回执落库后由调用方 refresh() 重新拉取对账，历史回执统一来自
      // reconciliation.payments，避免前端会话状态与后端事实分叉。
      await api(`/api/v1/incentive-award-batches/${batch.id}/payments`, {
        method: "POST",
        body: { payments: [payment] },
      });
      return { ok: true };
    } catch (caught) {
      return {
        ok: false,
        error:
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "支付回执提交失败",
      };
    }
  }

  function refresh(): void {
    reconciliationQuery.reload();
    onChanged();
  }

  async function submitAck(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAckError(null);
    const ref = ackRef.trim();
    if (!ref) {
      setAckError("请填写银行/财务回执引用");
      return;
    }
    setAcking(true);
    try {
      await api(`/api/v1/incentive-award-batches/${batch.id}/commands`, {
        method: "POST",
        body: { command: "ACKNOWLEDGE", paymentRef: ref },
      });
      toast.success("回执已记录", ref);
      setAckOpen(false);
      reconciliationQuery.reload();
      onChanged();
    } catch (caught) {
      setAckError(caught instanceof ApiError ? caught.message : "回执失败");
    } finally {
      setAcking(false);
    }
  }

  const ackBlockers: string[] = [];
  if (reconciliation) {
    if (!canPay) ackBlockers.push("仅财务/管理员可确认回执");
    if (batch.status !== "EXPORTED") {
      ackBlockers.push(
        `批次状态需为「已导出」（当前 ${zhStatus(batch.status)}）`,
      );
    }
    if (
      reconciliation.status !== "RECONCILED" &&
      reconciliation.status !== "GL_INCOMPLETE"
    ) {
      ackBlockers.push(
        `对账未平（${RECONCILIATION_LABELS[reconciliation.status]}：已付 ${formatMoney(
          reconciliation.paidAmount,
          reconciliation.currency,
        )} / 应付 ${formatMoney(
          reconciliation.totalAmount,
          reconciliation.currency,
        )}，差异 ${formatMoney(
          reconciliation.variance,
          reconciliation.currency,
        )}）`,
      );
    }
    if (!reconciliation.glComplete) {
      ackBlockers.push(
        `GL 凭证不完整（${glMissingLines} 行缺少平衡凭证）`,
      );
    }
  }
  const ackEnabled =
    reconciliation !== undefined &&
    reconciliation.status === "RECONCILED" &&
    reconciliation.glComplete &&
    canPay &&
    batch.status === "EXPORTED";
  const ackHelp = ackEnabled
    ? "对账已对平，且每笔已付回执都能核验到借贷平衡的 GL 凭证，可以确认回执。"
    : `暂不可回执：${
        ackBlockers.length > 0 ? ackBlockers.join("；") : "对账数据加载中"
      }。`;

  const glBadgeLabel = reconciliation
    ? glSummaryLabel(reconciliation)
    : "GL 待核验";
  const glBadgeTone = reconciliation ? glSummaryTone(reconciliation) : "neutral";

  return (
    <section
      ref={sectionRef}
      id={`award-payment-${batch.id}`}
      className="panel"
      aria-labelledby={headingId}
      tabIndex={-1}
      style={{ scrollMarginTop: 90 }}
    >
      <header className="panel__header">
        <div>
          <h2 className="panel__title" id={headingId}>
            支付与对账 · {batch.batchNo}
          </h2>
          <p className="panel__subtitle">
            批次状态 {zhStatus(batch.status)} · 币种 {batch.currency}
            {acknowledged && batch.paymentRef
              ? ` · 原回执引用 ${batch.paymentRef}`
              : ""}
          </p>
        </div>
        <div className="panel__action">
          <Button variant="ghost" size="sm" onClick={onClose}>
            收起
          </Button>
        </div>
      </header>
      <div className="panel__body">
        {reconciliationQuery.loading && !reconciliation ? (
          <LoadingRows rows={4} />
        ) : null}
        {reconciliationQuery.error && !reconciliation ? (
          <ErrorNotice
            title="对账数据加载失败"
            error={reconciliationQuery.error}
            onRetry={reconciliationQuery.reload}
          />
        ) : null}

        {reconciliation ? (
          <>
            <div className="stat-grid">
              <StatTile
                label="应付"
                value={formatMoney(
                  reconciliation.totalAmount,
                  reconciliation.currency,
                )}
                detail={`${reconciliation.totalLines} 行`}
                icon="wallet"
              />
              <StatTile
                label="已付"
                value={formatMoney(
                  reconciliation.paidAmount,
                  reconciliation.currency,
                )}
                detail={`${reconciliation.paidLines} 行足额`}
                icon="check-circle"
                tone="good"
              />
              <StatTile
                label="未付"
                value={formatMoney(
                  reconciliation.unpaidAmount,
                  reconciliation.currency,
                )}
                detail={
                  reconciliation.unpaidLines > 0
                    ? `${reconciliation.unpaidLines} 行未付`
                    : "无未付行"
                }
                icon="clock"
                tone={toNumber(reconciliation.unpaidAmount) > 0 ? "warning" : "good"}
              />
              <StatTile
                label="差异"
                value={formatMoney(
                  reconciliation.variance,
                  reconciliation.currency,
                )}
                detail={
                  variance === 0 ? "账实一致" : variance > 0 ? "多付" : "少付"
                }
                icon={variance === 0 ? "check" : "alert-circle"}
                tone={variance === 0 ? "neutral" : "critical"}
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Badge
                tone={reconciliationTone(reconciliation.status)}
                dot
              >
                {RECONCILIATION_LABELS[reconciliation.status]}
              </Badge>
              <Badge tone={glBadgeTone} dot={false}>
                {glBadgeLabel}
              </Badge>
              <span className="field__hint">
                已付 {reconciliation.paidLines} 行 · 未付{" "}
                {reconciliation.unpaidLines} 行
                {reconciliation.partialLines > 0
                  ? ` · 部分 ${reconciliation.partialLines} 行`
                  : ""}
                {reconciliation.overpaidLines > 0
                  ? ` · 多付 ${reconciliation.overpaidLines} 行`
                  : ""}
              </span>
            </div>

            {acknowledged ? (
              <div style={{ marginBottom: 16 }}>
                <InfoNotice tone="success">
                  该批次已回执
                  {batch.paymentRef ? `（回执引用 ${batch.paymentRef}）` : ""}
                  。已回执批次不再接受普通支付录入；如需退回/冲正，请在下方「退回 /
                  冲正」中以新的银行流水号登记退回回执。退回只新增留痕，不修改历史
                  PAID、不冲减已付金额，也不会自动改变批次状态；账务冲正与批次调整需财务人工复核。
                </InfoNotice>
              </div>
            ) : null}
            {!acknowledged && !canPay ? (
              <div style={{ marginBottom: 16 }}>
                <InfoNotice tone="info">
                  只读视图：支付回执录入与批次回执需要财务/管理员权限。
                </InfoNotice>
              </div>
            ) : null}
            {!acknowledged && canPay && !payableStatus ? (
              <div style={{ marginBottom: 16 }}>
                <InfoNotice tone="info">
                  批次需先提交审批并锁定/导出后才能录入支付回执（当前{" "}
                  {zhStatus(batch.status)}）。
                </InfoNotice>
              </div>
            ) : null}

            <section aria-labelledby={`${headingId}-detail`}>
              <SectionHeading
                id={`${headingId}-detail`}
                title="对账明细"
                hint="差异 = 已付 - 应付；负数为少付，正数为多付。GL 状态按最近 PAYMENT 凭证核验。"
              />
              {reconciliation.lines.length === 0 ? (
                <EmptyState
                  icon="wallet"
                  title="暂无对账明细"
                  description="批次还没有可对账的人员明细。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">
                      批次 {reconciliation.batchNo} 的支付对账明细，共{" "}
                      {reconciliation.totalLines} 行，包含应付、已付、未付、差异、
                      支付状态、回执号与 GL 状态
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">人员</th>
                        <th scope="col" className="cell-num">
                          应付
                        </th>
                        <th scope="col" className="cell-num">
                          已付
                        </th>
                        <th scope="col" className="cell-num">
                          未付
                        </th>
                        <th scope="col" className="cell-num">
                          差异
                        </th>
                        <th scope="col">支付状态</th>
                        <th scope="col">回执号</th>
                        <th scope="col">GL 状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.lines.map((line) => {
                        const gl = glStatusForLine(
                          line,
                          missingGlLineIds,
                        );
                        const lineReceipts = receiptsByLine.get(line.lineId) ?? [];
                        const problems = lineReceipts.filter(
                          (receipt) => receipt.status !== "PAID",
                        );
                        return (
                          <tr key={line.lineId}>
                            <th scope="row" className="cell-primary">
                              {displayName(line.personId, people)}
                              <span className="cell-sub mono">
                                {shortId(line.personId)}
                              </span>
                            </th>
                            <td className="cell-num mono">
                              {formatMoney(line.amount, line.currency)}
                            </td>
                            <td className="cell-num mono">
                              {formatMoney(line.paidAmount, line.currency)}
                            </td>
                            <td className="cell-num mono">
                              {formatMoney(line.unpaidAmount, line.currency)}
                            </td>
                            <td className="cell-num mono">
                              {formatMoney(line.variance, line.currency)}
                            </td>
                            <td>
                              <Badge tone={lineStatusTone(line.status)}>
                                {LINE_STATUS_LABELS[line.status]}
                              </Badge>
                              {problems.map((receipt) => (
                                <span
                                  key={receipt.id}
                                  className="cell-sub"
                                >
                                  {PAYMENT_STATUS_LABELS[receipt.status]} ·{" "}
                                  {receipt.paymentRef}
                                  {receipt.failureCode
                                    ? ` · ${receipt.failureCode}`
                                    : ""}
                                </span>
                              ))}
                            </td>
                            <td className="mono" style={{ whiteSpace: "normal" }}>
                              {line.paymentRefs.length > 0
                                ? line.paymentRefs.join("、")
                                : "—"}
                            </td>
                            <td>
                              <Badge tone={glStatusTone(gl)} dot={false}>
                                {GL_STATUS_LABELS[gl]}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {paymentEditable ? (
              <>
                {adjustmentLines.length > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <InfoNotice tone="warning">
                      存在{" "}
                      {adjustmentLines
                        .map((line) => LINE_STATUS_LABELS[line.status])
                        .join(" / ")}{" "}
                      的行（{adjustmentLines.length} 行），不能直接再次支付；请先走冲正/
                      调整流程，避免把差异放大。
                    </InfoNotice>
                  </div>
                ) : null}
                <section
                  aria-labelledby={`${headingId}-entry`}
                  style={{ marginTop: 22 }}
                >
                  <SectionHeading
                    id={`${headingId}-entry`}
                    title="逐行录入支付回执"
                    hint="金额默认应付金额，且必须与应付一致；每行单独提交，保存成功后自动刷新对账。"
                  />
                  {unpaidLines.length === 0 ? (
                    <InfoNotice
                      tone={adjustmentLines.length > 0 ? "warning" : "success"}
                    >
                      {adjustmentLines.length > 0
                        ? "没有可录入的未付行；请先处理部分支付/多付行。"
                        : "所有行已足额支付，无需再录入回执。"}
                    </InfoNotice>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table">
                        <caption className="sr-only">
                          批次 {reconciliation.batchNo} 的未付行支付录入，共{" "}
                          {unpaidLines.length} 行；每行填写流水号、金额、状态、贷方科目、
                          法人主体与会计期间后单独提交
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">人员 / 应付</th>
                            <th scope="col">支付流水号</th>
                            <th scope="col">金额</th>
                            <th scope="col">状态 / 失败原因</th>
                            <th scope="col">贷方科目</th>
                            <th scope="col">法人主体</th>
                            <th scope="col">会计期间</th>
                            <th scope="col" className="cell-actions">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {unpaidLines.map((line) => (
                            <PaymentEntryRow
                              key={line.lineId}
                              line={line}
                              personName={displayName(line.personId, people)}
                              onSubmit={submitPayment}
                              onRefresh={refresh}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {unpaidLines.length > 0 ? (
                  <PaymentCsvImport
                    reconciliation={reconciliation}
                    people={people}
                    onSubmit={submitPayment}
                    onRefresh={refresh}
                  />
                ) : null}
              </>
            ) : null}

            {acknowledged || returnedPayments.length > 0 ? (
              <section
                aria-labelledby={`${headingId}-returns`}
                style={{ marginTop: 22 }}
              >
                <SectionHeading
                  id={`${headingId}-returns`}
                  title="退回 / 冲正"
                  hint="退回回执只新增 RETURNED 留痕：不修改历史 PAID、不冲减已付金额，也不自动改变批次状态；账务冲正需财务人工复核后处理。"
                />

                {acknowledged ? (
                  canPay ? (
                    paidLines.length > 0 ? (
                      <ReturnEntryForm
                        reconciliation={reconciliation}
                        paidLines={paidLines}
                        people={people}
                        onSubmit={submitPayment}
                        onRefresh={refresh}
                      />
                    ) : (
                      <InfoNotice tone="warning">
                        没有可登记退回的「已付足额」行；请先核对对账明细与历史回执。
                      </InfoNotice>
                    )
                  ) : (
                    <InfoNotice tone="info">
                      只读视图：登记退回/冲正需要财务/管理员权限。
                    </InfoNotice>
                  )
                ) : null}

                {returnedPayments.length > 0 ? (
                  <div style={{ marginTop: acknowledged ? 18 : 0 }}>
                    <InfoNotice tone="warning">
                      已登记 {returnedPayments.length} 笔退回/冲正，合计{" "}
                      {formatMoney(returnedTotal, reconciliation.currency)}。
                      这些回执不参与已付计算：已付仍为{" "}
                      {formatMoney(
                        reconciliation.paidAmount,
                        reconciliation.currency,
                      )}
                      ，差异仍为{" "}
                      {formatMoney(
                        reconciliation.variance,
                        reconciliation.currency,
                      )}
                      ，批次状态仍为 {zhStatus(batch.status)}。请由财务人工复核，
                      并在总账生成冲正（反向）凭证；前端不会自动修改批次状态。
                    </InfoNotice>
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table className="data-table">
                        <caption className="sr-only">
                          批次 {reconciliation.batchNo} 的退回/冲正回执，共{" "}
                          {returnedPayments.length} 笔；全部为 RETURNED
                          留痕，不冲减已付金额
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">人员</th>
                            <th scope="col">退回流水号</th>
                            <th scope="col" className="cell-num">
                              金额
                            </th>
                            <th scope="col">退回 / 冲正原因</th>
                            <th scope="col">法人主体</th>
                            <th scope="col">会计期间</th>
                            <th scope="col">原已付回执</th>
                          </tr>
                        </thead>
                        <tbody>
                          {returnedPayments.map((receipt) => {
                            const line = lineById.get(receipt.lineId);
                            return (
                              <tr key={receipt.id}>
                                <th scope="row" className="cell-primary">
                                  {displayName(receipt.personId, people)}
                                  <span className="cell-sub mono">
                                    {shortId(receipt.personId)}
                                  </span>
                                </th>
                                <td className="mono">{receipt.paymentRef}</td>
                                <td className="cell-num mono">
                                  {formatMoney(
                                    receipt.amount,
                                    receipt.currency,
                                  )}
                                </td>
                                <td>{receipt.failureCode ?? "—"}</td>
                                <td className="mono">
                                  {receipt.legalEntityId}
                                </td>
                                <td className="mono">
                                  {receipt.accountingPeriod ?? "—"}
                                </td>
                                <td
                                  className="mono"
                                  style={{ whiteSpace: "normal" }}
                                >
                                  {line && line.paymentRefs.length > 0
                                    ? line.paymentRefs.join("、")
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {historicalPayments.length > 0 ? (
              <section
                aria-labelledby={`${headingId}-history`}
                style={{ marginTop: 22 }}
              >
                <SectionHeading
                  id={`${headingId}-history`}
                  title="历史支付回执"
                  hint={
                    acknowledged
                      ? "批次已回执：以下历史回执（含失败/退回）为只读留痕，不可修改；如需调整请在「退回 / 冲正」登记，并由财务人工冲正。"
                      : "来自对账接口 payments 的全部历史回执（成功/失败/退回），只读留痕，不会改变已付金额。"
                  }
                />
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">
                      批次 {reconciliation.batchNo} 的历史支付回执，共{" "}
                      {historicalPayments.length} 笔，包含已支付、支付失败与
                      已退回；按支付时间倒序
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">人员</th>
                        <th scope="col">支付流水号</th>
                        <th scope="col" className="cell-num">
                          金额
                        </th>
                        <th scope="col">状态</th>
                        <th scope="col">失败 / 退回原因</th>
                        <th scope="col">法人主体</th>
                        <th scope="col">会计期间</th>
                        <th scope="col">贷方科目</th>
                        <th scope="col">支付时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalPayments.map((receipt) => (
                        <tr key={receipt.id}>
                          <th scope="row" className="cell-primary">
                            {displayName(receipt.personId, people)}
                            <span className="cell-sub mono">
                              {shortId(receipt.personId)}
                            </span>
                          </th>
                          <td className="mono">{receipt.paymentRef}</td>
                          <td className="cell-num mono">
                            {formatMoney(receipt.amount, receipt.currency)}
                          </td>
                          <td>
                            <Badge tone={paymentStatusTone(receipt.status)}>
                              {PAYMENT_STATUS_LABELS[receipt.status]}
                            </Badge>
                          </td>
                          <td>{receipt.failureCode ?? "—"}</td>
                          <td className="mono">{receipt.legalEntityId}</td>
                          <td className="mono">
                            {receipt.accountingPeriod ?? "—"}
                          </td>
                          <td>
                            {CREDIT_ACCOUNT_LABELS[receipt.creditAccount]}
                          </td>
                          <td className="nowrap">
                            {receipt.paidAt
                              ? formatDateTime(receipt.paidAt)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {!acknowledged ? (
              <section
                aria-labelledby={`${headingId}-ack`}
                style={{ marginTop: 22 }}
              >
                <SectionHeading
                  id={`${headingId}-ack`}
                  title="回执确认"
                  hint="回执是财务确认动作：必须对账 RECONCILED，并且每笔已付回执都有完整 GL 凭证。"
                />
                <p id={ackHelpId} className="field__hint">
                  {ackHelp}
                </p>
                <div style={{ marginTop: 10 }}>
                  <Button
                    variant="primary"
                    disabled={!ackEnabled}
                    aria-describedby={ackHelpId}
                    onClick={() => {
                      setAckError(null);
                      setAckRef("");
                      setAckOpen(true);
                    }}
                  >
                    确认回执
                  </Button>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <Modal
        open={ackOpen}
        title={`发放回执 · ${batch.batchNo}`}
        onClose={() => setAckOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAckOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={ackFormId}
              loading={acking}
            >
              确认回执
            </Button>
          </>
        }
      >
        <form
          id={ackFormId}
          onSubmit={(event) => void submitAck(event)}
          className="form-grid"
        >
          {ackError ? (
            <div className="field--full" id={ackErrorId} role="alert">
              <InfoNotice tone="warning">{ackError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="银行/财务回执引用"
            className="field--full"
            hint="例如银行批次号、付款流水号"
          >
            <TextInput
              value={ackRef}
              onChange={(event) => setAckRef(event.target.value)}
              required
              aria-required="true"
              aria-invalid={
                ackError?.includes("引用") ? true : undefined
              }
              aria-describedby={ackError ? ackErrorId : undefined}
            />
          </FormField>
        </form>
      </Modal>
    </section>
  );
}

function SectionHeading({
  id,
  title,
  hint,
}: {
  id: string;
  title: string;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h3 id={id} style={{ fontSize: 14, fontWeight: 650, margin: 0 }}>
        {title}
      </h3>
      {hint ? (
        <p className="field__hint" style={{ marginTop: 4 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * ACK 后的退回/冲正登记：调用现有 POST /payments，status=RETURNED。
 *
 * - 只新增 RETURNED 回执留痕，绝不修改历史 PAID，也不改批次状态；
 * - 必须使用新的 paymentRef（同一行的历史流水号会被后端按幂等冲突 409）；
 * - 金额必须等于原应付金额（后端按整行核对，不支持部分退回）；
 * - 原因写入回执 failureCode，供财务人工复核与后续冲正。
 */
function ReturnEntryForm({
  reconciliation,
  paidLines,
  people,
  onSubmit,
  onRefresh,
}: {
  reconciliation: AwardReconciliation;
  paidLines: AwardReconciliationLine[];
  people: Array<{ id: string; displayName: string }>;
  onSubmit: (payment: AwardPaymentPayload) => Promise<SubmitOutcome>;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const baseId = useId();
  const [lineId, setLineId] = useState(paidLines[0]?.lineId ?? "");
  const selectedLine =
    paidLines.find((line) => line.lineId === lineId) ?? paidLines[0];
  const selectedLineId = selectedLine?.lineId ?? "";
  const originalPaid = reconciliation.payments.find(
    (receipt) =>
      receipt.lineId === selectedLineId && receipt.status === "PAID",
  );
  const existingForLine = reconciliation.payments.filter(
    (receipt) => receipt.lineId === selectedLineId,
  );
  const existingReturns = existingForLine.filter(
    (receipt) => receipt.status === "RETURNED",
  );
  const existingRefs = new Set(
    existingForLine.map((receipt) => receipt.paymentRef.trim()),
  );

  const [paymentRef, setPaymentRef] = useState("");
  const [amount, setAmount] = useState(selectedLine?.amount ?? "");
  const [reason, setReason] = useState("");
  const [legalEntityId, setLegalEntityId] = useState(
    originalPaid?.legalEntityId ?? "",
  );
  const [accountingPeriod, setAccountingPeriod] = useState(
    currentAccountingPeriod(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    // 切换已付行时回到「原金额 + 新流水号」的初始状态，避免把上一行的
    // 流水号/原因带到另一行造成误登记；对账刷新（行不变）不重置输入。
    setAmount(selectedLine?.amount ?? "");
    setLegalEntityId(originalPaid?.legalEntityId ?? "");
    setPaymentRef("");
    setReason("");
    setError(null);
    setSuccess(null);
    setInvalidFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId]);

  const errorId = `${baseId}-error`;
  const successId = `${baseId}-success`;

  function invalid(name: string): true | undefined {
    return invalidFields.has(name) ? true : undefined;
  }

  function describedBy(name: string): string | undefined {
    return invalidFields.has(name) ? errorId : undefined;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const line = selectedLine;
    if (!line) return;

    const issues: string[] = [];
    const invalidFieldNames = new Set<string>();

    const ref = paymentRef.trim();
    if (!ref) {
      issues.push("请填写新的支付流水号");
      invalidFieldNames.add("paymentRef");
    } else if (ref.length > 200) {
      issues.push("支付流水号最多 200 字");
      invalidFieldNames.add("paymentRef");
    } else if (existingRefs.has(ref)) {
      issues.push(
        "该流水号已用于该行历史回执：退回/冲正必须使用新的银行流水号，历史回执不可覆盖",
      );
      invalidFieldNames.add("paymentRef");
    }

    const rawAmount = amount.trim();
    if (!isValidPaymentAmount(rawAmount)) {
      issues.push("退回金额必须是大于 0、最多 6 位小数的十进制数");
      invalidFieldNames.add("amount");
    } else if (!decimalEquals(rawAmount, line.amount)) {
      issues.push(
        `退回金额必须与原应付金额 ${line.amount} 一致（后端按整行核对，不支持部分退回）`,
      );
      invalidFieldNames.add("amount");
    }

    const reasonText = reason.trim();
    if (!reasonText) {
      issues.push("请填写退回/冲正原因");
      invalidFieldNames.add("reason");
    } else if (reasonText.length > 100) {
      issues.push("退回/冲正原因最多 100 字");
      invalidFieldNames.add("reason");
    }

    const entity = legalEntityId.trim();
    if (entity.length > 64) {
      issues.push("法人主体最多 64 字");
      invalidFieldNames.add("legalEntityId");
    }

    const period = accountingPeriod.trim();
    if (!period) {
      issues.push("请填写会计期间");
      invalidFieldNames.add("accountingPeriod");
    } else if (!isValidAccountingPeriod(period)) {
      issues.push("会计期间格式需为 YYYY-MM，例如 2026-11");
      invalidFieldNames.add("accountingPeriod");
    }

    setInvalidFields(invalidFieldNames);
    if (issues.length > 0) {
      setSuccess(null);
      setError(issues.join("；"));
      return;
    }

    setError(null);
    setSuccess(null);
    setBusy(true);
    const outcome = await onSubmit({
      lineId: line.lineId,
      paymentRef: ref,
      status: "RETURNED",
      amount: rawAmount,
      currency: line.currency,
      failureCode: reasonText,
      legalEntityId: entity || undefined,
      accountingPeriod: period,
      // RETURNED 不生成 GL 凭证；沿用原 PAID 回执的贷方科目仅作留痕。
      creditAccount: originalPaid?.creditAccount ?? "CASH",
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(friendlyReturnError(outcome.error));
      return;
    }

    setPaymentRef("");
    setReason("");
    setSuccess(
      `已登记退回回执 ${ref}。已付金额、差异与批次状态均未改变；请财务人工复核并生成冲正凭证。`,
    );
    toast.success("退回回执已登记", `${ref} · 待财务人工复核冲正`);
    onRefresh();
  }

  return (
    <form
      className="form-grid"
      aria-label="登记退回或冲正"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <FormField
        label="选择已付行"
        htmlFor={`${baseId}-line`}
        className="field--full"
        hint="仅列出「已付足额」的行；退回记录不会修改该行历史 PAID 回执。"
      >
        <Select
          id={`${baseId}-line`}
          value={selectedLineId}
          onChange={(event) => setLineId(event.target.value)}
          aria-required="true"
        >
          {paidLines.map((line) => {
            const returns = reconciliation.payments.filter(
              (receipt) =>
                receipt.lineId === line.lineId &&
                receipt.status === "RETURNED",
            ).length;
            return (
              <option key={line.lineId} value={line.lineId}>
                {displayName(line.personId, people)} · 应付{" "}
                {formatMoney(line.amount, line.currency)}
                {returns > 0 ? ` · 已登记退回 ${returns} 笔` : ""}
              </option>
            );
          })}
        </Select>
      </FormField>

      {selectedLine ? (
        <div className="field--full">
          <InfoNotice tone="info">
            原已付回执：{selectedLine.paymentRefs.join("、") || "—"} · 原金额{" "}
            {formatMoney(selectedLine.amount, selectedLine.currency)}
            {originalPaid ? (
              <>
                {" "}
                · 法人主体 {originalPaid.legalEntityId} · 会计期间{" "}
                {originalPaid.accountingPeriod ?? "—"} · 贷方科目{" "}
                {CREDIT_ACCOUNT_LABELS[originalPaid.creditAccount]}
              </>
            ) : null}
            。退回只新增留痕，原 PAID 回执不会被修改。
          </InfoNotice>
        </div>
      ) : null}

      {existingReturns.length > 0 ? (
        <div className="field--full">
          <InfoNotice tone="warning">
            该行已登记 {existingReturns.length} 笔退回/冲正（
            {existingReturns.map((receipt) => receipt.paymentRef).join("、")}
            ）。再次登记会新增一条留痕，不会覆盖旧记录；请确认不是重复操作。
          </InfoNotice>
        </div>
      ) : null}

      <FormField
        label="新支付流水号"
        htmlFor={`${baseId}-ref`}
        hint="必填：不能复用该行已有回执号，原 PAID 回执不可覆盖。"
      >
        <TextInput
          id={`${baseId}-ref`}
          value={paymentRef}
          onChange={(event) => setPaymentRef(event.target.value)}
          placeholder="例如银行退回流水号"
          autoComplete="off"
          aria-required="true"
          aria-invalid={invalid("paymentRef")}
          aria-describedby={describedBy("paymentRef")}
        />
      </FormField>

      <FormField
        label="退回金额"
        htmlFor={`${baseId}-amount`}
        hint="默认原应付金额；必须与之一致，不支持部分退回。"
      >
        <TextInput
          id={`${baseId}-amount`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          aria-required="true"
          aria-invalid={invalid("amount")}
          aria-describedby={describedBy("amount")}
        />
      </FormField>

      <FormField
        label="退回 / 冲正原因"
        htmlFor={`${baseId}-reason`}
        className="field--full"
        hint="必填，最多 100 字；写入回执 failureCode，供财务复核与后续冲正。"
      >
        <Textarea
          id={`${baseId}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={100}
          placeholder="例如：银行退票、收款账户错误、重复发放退回"
          aria-required="true"
          aria-invalid={invalid("reason")}
          aria-describedby={describedBy("reason")}
        />
      </FormField>

      <FormField
        label="法人主体"
        htmlFor={`${baseId}-entity`}
        hint="可留空，服务端缺省 DEFAULT；建议与原回执一致。"
      >
        <TextInput
          id={`${baseId}-entity`}
          value={legalEntityId}
          onChange={(event) => setLegalEntityId(event.target.value)}
          placeholder="缺省 DEFAULT"
          aria-invalid={invalid("legalEntityId")}
          aria-describedby={describedBy("legalEntityId")}
        />
      </FormField>

      <FormField
        label="会计期间"
        htmlFor={`${baseId}-period`}
        hint="格式 YYYY-MM；冲正凭证按该期间由财务处理。"
      >
        <TextInput
          id={`${baseId}-period`}
          value={accountingPeriod}
          onChange={(event) => setAccountingPeriod(event.target.value)}
          placeholder="2026-11"
          aria-required="true"
          aria-invalid={invalid("accountingPeriod")}
          aria-describedby={describedBy("accountingPeriod")}
        />
      </FormField>

      {error ? (
        <div className="field--full" id={errorId} role="alert">
          <InfoNotice tone="warning">{error}</InfoNotice>
        </div>
      ) : null}
      {success ? (
        <div className="field--full" id={successId} role="status">
          <InfoNotice tone="success">{success}</InfoNotice>
        </div>
      ) : null}

      <div className="field--full form-actions">
        <p className="field__hint" style={{ marginRight: "auto" }}>
          登记后不回写批次状态；财务复核后到总账做冲正。
        </p>
        <Button type="submit" variant="primary" loading={busy}>
          登记退回 / 冲正
        </Button>
      </div>
    </form>
  );
}

/** 把后端 409 的英文错误码转成可执行的中文提示，其余原样透出。 */
function friendlyReturnError(message: string): string {
  if (message.includes("AWARD_PAYMENT_IDEMPOTENCY_CONFLICT")) {
    return "该流水号已存在且载荷不同：退回/冲正必须使用新的银行流水号，历史回执不可覆盖。";
  }
  if (message.includes("AWARD_PAYMENT_AMOUNT_MISMATCH")) {
    return "退回金额必须与原应付金额一致。";
  }
  if (message.includes("AWARD_PAYMENT_REF_REQUIRED")) {
    return "请填写新的支付流水号。";
  }
  if (message.includes("AWARD_PAYMENT_LINE_NOT_IN_BATCH")) {
    return "所选行不属于该批次，请刷新后重试。";
  }
  if (message.includes("AWARD_BATCH_ALREADY_ACKNOWLEDGED")) {
    return "批次状态已变化：已回执批次只接受 RETURNED 回执，请刷新后重试。";
  }
  if (message.includes("AWARD_BATCH_NOT_PAYABLE")) {
    return "批次当前状态不允许登记支付回执，请刷新后重试。";
  }
  return message || "退回/冲正回执提交失败";
}
