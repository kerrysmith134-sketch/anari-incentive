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
  StatTile,
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
  LINE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RECONCILIATION_LABELS,
  lineStatusTone,
  paymentStatusTone,
  reconciliationTone,
  type AwardBatchSummary,
  type AwardPaymentPayload,
  type AwardPaymentReceipt,
  type AwardReconciliation,
  type RecordAwardPaymentsResult,
  type SubmitOutcome,
} from "./types.js";

/**
 * 批次详情里的「支付与对账」工作台。
 *
 * - 读取迁移 117 的对账投影，展示每行应付/已付/未付/差异/支付状态/GL 状态；
 * - 未付行逐行录入支付回执（POST /payments）；
 * - 支持前端解析 CSV / 粘贴回执并逐行提交，逐行显示失败原因；
 * - ACK 只有在 reconciliation=RECONCILED 且 glComplete 时才启用；
 * - 已 ACKNOWLEDGED 的批次隐藏普通支付入口，提示走冲正流程。
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

  const [receipts, setReceipts] = useState<
    Record<string, AwardPaymentReceipt>
  >({});
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
    const map = new Map<string, AwardPaymentReceipt[]>();
    for (const receipt of Object.values(receipts)) {
      const list = map.get(receipt.lineId) ?? [];
      list.push(receipt);
      map.set(receipt.lineId, list);
    }
    return map;
  }, [receipts]);

  const problemReceipts = useMemo(
    () =>
      Object.values(receipts)
        .filter((receipt) => receipt.status !== "PAID")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [receipts],
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
      const result = await api<RecordAwardPaymentsResult>(
        `/api/v1/incentive-award-batches/${batch.id}/payments`,
        { method: "POST", body: { payments: [payment] } },
      );
      setReceipts((current) => {
        const next = { ...current };
        for (const receipt of result.payments) {
          next[receipt.id] = receipt;
        }
        return next;
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
                  。已回执批次不再接受普通支付录入；如需调整已付款项，请走冲正流程：
                  由财务生成冲正凭证后再重新生成发放批次。
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

            {problemReceipts.length > 0 ? (
              <section
                aria-labelledby={`${headingId}-problems`}
                style={{ marginTop: 22 }}
              >
                <SectionHeading
                  id={`${headingId}-problems`}
                  title="本次会话的失败 / 退回回执"
                  hint="仅显示当前页面会话内记录的回执；对账接口不返回历史失败/退回明细。"
                />
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">
                      当前会话记录的失败或退回支付回执，共{" "}
                      {problemReceipts.length} 笔
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">人员</th>
                        <th scope="col">支付流水号</th>
                        <th scope="col" className="cell-num">
                          金额
                        </th>
                        <th scope="col">状态</th>
                        <th scope="col">失败原因</th>
                        <th scope="col">记录时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemReceipts.map((receipt) => (
                        <tr key={receipt.id}>
                          <th scope="row" className="cell-primary">
                            {displayName(receipt.personId, people)}
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
                          <td className="nowrap">
                            {formatDateTime(receipt.createdAt)}
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
