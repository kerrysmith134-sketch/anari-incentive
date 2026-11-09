import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  TextInput,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDateTime } from "../lib/format.js";
import { zhStatus } from "../lib/zh.js";

interface AwardLine {
  personId: string;
  amount: string;
  sourceRecordId?: string;
  sourceLineRef?: string;
  note?: string;
}

interface AwardBatchView {
  id: string;
  batchNo: string;
  awardType: string;
  period: string;
  currency: string;
  status: string;
  totalAmount: string;
  lineCount: number;
  approvedBy?: string;
  paymentRef?: string;
  lines: AwardLine[];
  createdAt: string;
}

const AWARD_TYPES = [
  ["BUSINESS_UNIT_COMMISSION", "业务中心季度提成"],
  ["FUNCTIONAL_QUARTERLY_BONUS", "职能部门季度奖金"],
  ["ANNUAL_PROFIT_SHARING", "职能部门年度利润分享"],
  ["MONTHLY_STAR", "月明星奖励"],
  ["TECH_CENTER_AWARD", "产品技术中心专项奖励"],
  ["OVERSEAS_SALES_AWARD", "海外销售激励"],
  ["BOUNTY_SETTLEMENT", "专项悬赏核定"],
  ["MANUAL", "其他人工核定"],
] as const;

const STATUS_ACTIONS: Record<string, Array<[string, string]>> = {
  DRAFT: [["SUBMIT", "提交审批"]],
  PENDING_APPROVAL: [["APPROVE", "批准"]],
  APPROVED: [["LOCK", "锁定"]],
  LOCKED: [["EXPORT", "导出"]],
  EXPORTED: [],
  ACKNOWLEDGED: [],
  CANCELLED: [],
};

/** 制度激励发放：计算 → 提交 → 审批 → 锁定 → 导出 → 回执。 */
export function AwardBatchPage() {
  useDocumentTitle("奖励发放");
  const toast = useToast();
  const identity = useApiQuery<{ roles: string[] }>("/api/v1/platform/identity");
  const roles = identity.data?.roles ?? [];
  const canCreate = roles.some((role) =>
    ["admin", "manager", "finance"].includes(role),
  );
  const canFinance = roles.some((role) =>
    ["admin", "finance"].includes(role),
  );
  const batches = useApiQuery<AwardBatchView[]>(
    "/api/v1/incentive-award-batches",
  );
  const [lines, setLines] = useState<AwardLine[]>([
    { personId: "", amount: "", sourceRecordId: "", sourceLineRef: "line-1" },
  ]);
  const [batchNo, setBatchNo] = useState(
    `AWARD-${new Date().toISOString().slice(0, 10)}-${String(
      Date.now() % 10000,
    ).padStart(4, "0")}`,
  );
  const [awardType, setAwardType] = useState("BUSINESS_UNIT_COMMISSION");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [currency, setCurrency] = useState("CNY");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ackTarget, setAckTarget] = useState<AwardBatchView | null>(null);
  const [ackRef, setAckRef] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<AwardLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  async function createBatch(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const validLines = lines.filter(
        (line) => line.personId.trim() && line.amount.trim(),
      );
      if (validLines.length === 0) {
        throw new Error("至少需要一条人员与金额明细");
      }
      await api("/api/v1/incentive-award-batches", {
        method: "POST",
        body: {
          batchNo: batchNo.trim(),
          awardType,
          period,
          currency: currency.toUpperCase(),
          sourceRecordIds: validLines
            .map((line) => line.sourceRecordId?.trim())
            .filter(Boolean),
          lines: validLines.map((line) => ({
            personId: line.personId.trim(),
            amount: line.amount,
            sourceRecordId: line.sourceRecordId?.trim() || undefined,
            sourceLineRef: line.sourceLineRef?.trim() || undefined,
            note: line.note?.trim() || undefined,
          })),
        },
      });
      toast.success("发放批次已创建", "下一步：提交审批");
      batches.reload();
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "创建失败",
      );
    } finally {
      setSaving(false);
    }
  }

  async function command(batch: AwardBatchView, action: string) {
    setBusyId(batch.id);
    try {
      if (action === "ACKNOWLEDGE") {
        setAckTarget(batch);
        setAckRef("");
        setAckError(null);
        return;
      }
      await api(`/api/v1/incentive-award-batches/${batch.id}/commands`, {
        method: "POST",
        body: { command: action },
      });
      if (action === "EXPORT") {
        window.open(
          `/api/v1/incentive-award-batches/${batch.id}/export`,
          "_blank",
        );
      }
      toast.success("批次状态已更新", zhStatus(action));
      batches.reload();
    } catch (caught) {
      toast.error(
        "操作失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function submitAck(event: FormEvent) {
    event.preventDefault();
    if (!ackTarget) return;
    setAckError(null);
    try {
      await api(`/api/v1/incentive-award-batches/${ackTarget.id}/commands`, {
        method: "POST",
        body: { command: "ACKNOWLEDGE", paymentRef: ackRef.trim() },
      });
      toast.success("回执已记录", ackRef.trim());
      setAckTarget(null);
      batches.reload();
    } catch (caught) {
      setAckError(caught instanceof ApiError ? caught.message : "回执失败");
    }
  }

  const list = batches.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="奖励发放"
        description="把 DBCP 提成、职能季度奖金、年度利润分享、月明星、技术中心、海外销售与悬赏核定变成可审批、可锁定、可导出、可回执的发放批次。"
        actions={
          <Button variant="secondary" onClick={() => batches.reload()}>
            刷新
          </Button>
        }
      />

      <div className="stack">
        {canCreate ? (
      <Panel title="新建发放批次">
          <form onSubmit={createBatch}>
            <div className="form-grid">
              <FormField label="批次号">
                <TextInput
                  value={batchNo}
                  onChange={(event) => setBatchNo(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="奖项类型">
                <Select
                  value={awardType}
                  onChange={(event) => setAwardType(event.target.value)}
                >
                  {AWARD_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="周期" hint="例如 2026-11 / 2026-Q4 / 2026">
                <TextInput
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="币种">
                <TextInput
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  required
                />
              </FormField>
            </div>

            <div className="stack">
              {lines.map((line, index) => (
                <div className="panel" key={index}>
                  <div className="form-grid">
                    <FormField label={`人员 ${index + 1}`}>
                      <PersonSelect
                        value={line.personId}
                        onChange={(value) => updateLine(index, { personId: value })}
                      />
                    </FormField>
                    <FormField label="金额">
                      <TextInput
                        value={line.amount}
                        onChange={(event) =>
                          updateLine(index, { amount: event.target.value })
                        }
                        required
                      />
                    </FormField>
                    <FormField label="来源计算记录 ID" hint="同一记录只能进入一个非取消批次，防止重复发放">
                      <TextInput
                        value={line.sourceRecordId ?? ""}
                        onChange={(event) =>
                          updateLine(index, { sourceRecordId: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="来源行标识">
                      <TextInput
                        value={line.sourceLineRef ?? ""}
                        onChange={(event) =>
                          updateLine(index, { sourceLineRef: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="备注">
                      <TextInput
                        value={line.note ?? ""}
                        onChange={(event) =>
                          updateLine(index, { note: event.target.value })
                        }
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
            {formError ? <InfoNotice tone="warning">{formError}</InfoNotice> : null}
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      personId: "",
                      amount: "",
                      sourceRecordId: "",
                      sourceLineRef: `line-${current.length + 1}`,
                    },
                  ])
                }
              >
                增加明细
              </Button>
              <Button type="submit" loading={saving}>
                创建批次
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

        <Panel title="发放批次台账" flush>
          {batches.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={4} />
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon="wallet"
              title="暂无发放批次"
              description="先在制度中心完成计算，再把人员与金额录入批次，提交财务审批。"
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>批次号</th>
                    <th>奖项 / 周期</th>
                    <th>明细</th>
                    <th className="cell-num">总额</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((batch) => (
                    <tr key={batch.id}>
                      <td>
                        <span className="cell-primary">{batch.batchNo}</span>
                        <span className="cell-sub">
                          {batch.paymentRef ? `回执 ${batch.paymentRef}` : ""}
                        </span>
                      </td>
                      <td>
                        {AWARD_TYPES.find(([value]) => value === batch.awardType)?.[1] ??
                          batch.awardType}
                        <span className="cell-sub">{batch.period}</span>
                      </td>
                      <td className="mono">{batch.lineCount}</td>
                      <td className="cell-num mono">
                        {batch.totalAmount} {batch.currency}
                      </td>
                      <td>
                        <Badge status={batch.status} />
                      </td>
                      <td className="nowrap">{formatDateTime(batch.createdAt)}</td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {canFinance &&
                            (STATUS_ACTIONS[batch.status] ?? []).map(
                            ([action, label]) => (
                              <Button
                                key={action}
                                size="sm"
                                variant="secondary"
                                loading={busyId === batch.id}
                                onClick={() => void command(batch, action)}
                              >
                                {label}
                              </Button>
                            ),
                          )}
                          {canFinance && batch.status === "EXPORTED" ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  window.open(
                                    `/api/v1/incentive-award-batches/${batch.id}/export`,
                                    "_blank",
                                  );
                                }}
                              >
                                下载
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => void command(batch, "ACKNOWLEDGE")}
                              >
                                回执
                              </Button>
                            </>
                          ) : null}
                          {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(
                            batch.status,
                          ) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void command(batch, "CANCEL")}
                            >
                              取消
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Modal
        open={Boolean(ackTarget)}
        title={`发放回执 · ${ackTarget?.batchNo ?? ""}`}
        onClose={() => setAckTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAckTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="award-ack-form">
              确认回执
            </Button>
          </>
        }
      >
        <form id="award-ack-form" onSubmit={submitAck} className="form-grid">
          {ackError ? (
            <div className="field--full">
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
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
