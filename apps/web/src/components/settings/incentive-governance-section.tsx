/**
 * NP-032 阶段 3（2026-11-21 审计）：治理域拆分——激励治理（追回/机动池/模型策略/审计脱敏）。
 * 自持查询与状态；页面容器仅传 session/governPath/people/canGovern。
 */
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Panel,
  Select,
  StatTile,
  TextInput,
  Textarea,
} from "../ui.js";
import { useApiQuery } from "../../lib/hooks.js";
import { api, ApiError } from "../../lib/api.js";
import { useToast } from "../../contexts/ToastContext.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatMoney,
  shortId,
  titleCase,
} from "../../lib/format.js";
import { zhClawbackReason, zhStatus } from "../../lib/zh.js";
import { PersonSelect } from "../PersonSelect.js";
import { Icon } from "../Icon.js";
import { BarChart } from "../charts.js";
import type {
  AuditRedaction,
  BudgetPool,
  CalibrationSession,
  ClawbackCase,
  ClawbackSchedule,
  DataClassification,
  DataMapReport,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  FairnessCommitment,
  FieldAccessPolicyMatrix,
  ManagerTrainingRecord,
  ModelProviderPolicy,
  PilotEnrollment,
  RetentionDisposalRequest,
  RetentionPolicy,
  RetentionRecommendation,
  RetentionRecommendationsReport,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../../lib/types.js";

export function IncentiveGovernanceSection({
  session,
  governPath,
  people,
  canGovern,
}: {
  session: { personId: string };
  governPath: (path: string) => string | null;
  /** 人员目录（展示名解析）。 */
  people: Array<{ id: string; displayName: string }>;
  canGovern: boolean;
}) {
  const toast = useToast();
  const clawbacks = useApiQuery<ClawbackCase[]>(
    governPath("/api/v1/clawback-cases"),
  );
  const pools = useApiQuery<BudgetPool[]>(governPath("/api/v1/budget-pools"));
  const poolReviews = useApiQuery<DiscretionaryPoolReview[]>(
    governPath("/api/v1/discretionary-pool-reviews"),
  );
  const providerPolicies = useApiQuery<ModelProviderPolicy[]>(
    governPath("/api/v1/model-provider-policies"),
  );
  const redactions = useApiQuery<AuditRedaction[]>(
    governPath("/api/v1/audit-redactions"),
  );


  const [clawbackOpen, setClawbackOpen] = useState(false);
  const [clawbackSaving, setClawbackSaving] = useState(false);
  const [clawbackError, setClawbackError] = useState<string | null>(null);
  const [clawbackPerson, setClawbackPerson] = useState(session.personId);
  const [clawbackAmount, setClawbackAmount] = useState("");
  const [clawbackReasonCode, setClawbackReasonCode] = useState("OVERPAYMENT");
  const [clawbackExplanation, setClawbackExplanation] = useState("");
  const [clawbackConsent, setClawbackConsent] = useState("");
  const [clawbackInstallments, setClawbackInstallments] = useState("1");
  const [clawbackHardship, setClawbackHardship] = useState(false);
  const [clawbackHardshipReason, setClawbackHardshipReason] = useState("");
  const [clawbackRequester, setClawbackRequester] = useState(
    session.personId,
  );
  const [waiveTarget, setWaiveTarget] = useState<ClawbackCase | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ClawbackCase | null>(
    null,
  );
  const [schedule, setSchedule] = useState<ClawbackSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [poolReviewOpen, setPoolReviewOpen] = useState(false);
  const [poolReviewSaving, setPoolReviewSaving] = useState(false);
  const [poolReviewError, setPoolReviewError] = useState<string | null>(null);
  const [poolReviewPool, setPoolReviewPool] = useState("");
  const [poolReviewCommittee, setPoolReviewCommittee] = useState<string[]>(
    [],
  );
  const [poolReviewObserver, setPoolReviewObserver] = useState("");
  const [poolReviewCriteria, setPoolReviewCriteria] = useState("");
  const [poolReviewNotes, setPoolReviewNotes] = useState("");
  const [poolReviewReviewer, setPoolReviewReviewer] = useState(
    session.personId,
  );
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyProvider, setPolicyProvider] = useState("anthropic");
  const [policyZeroRetention, setPolicyZeroRetention] = useState(true);
  const [policyDpa, setPolicyDpa] = useState("");
  const [policyRegion, setPolicyRegion] = useState("cn-shanghai");
  const [policyEgress, setPolicyEgress] = useState("api.anthropic.com");
  const [policyApprover, setPolicyApprover] = useState(session.personId);
  const [redactionOpen, setRedactionOpen] = useState(false);
  const [redactionSaving, setRedactionSaving] = useState(false);
  const [redactionError, setRedactionError] = useState<string | null>(null);
  const [redactionEventId, setRedactionEventId] = useState("");
  const [redactionReason, setRedactionReason] = useState("");
  const [redactionRequester, setRedactionRequester] = useState(
    session.personId,
  );
  const [redactionApprover, setRedactionApprover] = useState("");
  const [recoveryTarget, setRecoveryTarget] = useState<ClawbackCase | null>(
    null,
  );
  const [recoveryCycleId, setRecoveryCycleId] = useState("");
  const [recoveryCycles, setRecoveryCycles] = useState("");
  const [recoveryLedgerId, setRecoveryLedgerId] = useState("");
  const [recoveryCreateBatch, setRecoveryCreateBatch] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  function openRedactionForm() {
    setRedactionEventId("");
    setRedactionReason("");
    setRedactionRequester(session.personId);
    setRedactionApprover("");
    setRedactionError(null);
    setRedactionOpen(true);
  }

  async function saveRedaction(event: FormEvent) {
    event.preventDefault();
    setRedactionSaving(true);
    setRedactionError(null);
    try {
      await api(`/api/v1/audit-events/${redactionEventId.trim()}/redactions`, {
        method: "POST",
        body: {
          reason: redactionReason.trim(),
          requestedBy: redactionRequester,
          approvedBy: redactionApprover,
        },
      });
      toast.success("审计脱敏已记录");
      setRedactionOpen(false);
      redactions.reload();
    } catch (error) {
      setRedactionError(
        error instanceof Error
          ? error.message
          : "Could not record the redaction.",
      );
    } finally {
      setRedactionSaving(false);
    }
  }

  function openPolicyForm() {
    setPolicyProvider("anthropic");
    setPolicyZeroRetention(true);
    setPolicyDpa("");
    setPolicyRegion("cn-shanghai");
    setPolicyEgress("api.anthropic.com");
    setPolicyApprover(session.personId);
    setPolicyError(null);
    setPolicyOpen(true);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setPolicySaving(true);
    setPolicyError(null);
    try {
      await api("/api/v1/model-provider-policies", {
        method: "POST",
        body: {
          provider: policyProvider.trim(),
          zeroRetentionConfirmed: policyZeroRetention,
          dpaRef: policyDpa.trim(),
          inferenceRegion: policyRegion.trim(),
          egressAllowlist: policyEgress
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          approvedBy: policyApprover,
        },
      });
      toast.success("模型供应商政策已记录");
      setPolicyOpen(false);
      providerPolicies.reload();
    } catch (error) {
      setPolicyError(
        error instanceof Error
          ? error.message
          : "Could not record the policy.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function retirePolicy(policy: ModelProviderPolicy) {
    setPolicySaving(true);
    try {
      await api(`/api/v1/model-provider-policies/${policy.id}/retire`, {
        method: "POST",
      });
      toast.success("模型供应商政策已停用");
      providerPolicies.reload();
    } catch (error) {
      toast.error(
        "停用保留策略失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function openPoolReviewForm() {
    const poolList = pools.data ?? [];
    if (poolList.length === 0) {
      toast.error("暂无预算池", "Create a pool before reviewing it.");
      return;
    }
    setPoolReviewPool(poolList[0]?.id ?? "");
    setPoolReviewCommittee([]);
    setPoolReviewObserver("");
    setPoolReviewCriteria("");
    setPoolReviewNotes("");
    setPoolReviewReviewer(session.personId);
    setPoolReviewError(null);
    setPoolReviewOpen(true);
  }

  async function savePoolReview(event: FormEvent) {
    event.preventDefault();
    setPoolReviewSaving(true);
    setPoolReviewError(null);
    try {
      await api(
        `/api/v1/budget-pools/${poolReviewPool}/discretionary-reviews`,
        {
          method: "POST",
          body: {
            committeePersonIds: poolReviewCommittee,
            employeeObserverPersonId:
              poolReviewObserver || undefined,
            selectionCriteria: poolReviewCriteria.trim(),
            decisionNotes: poolReviewNotes.trim(),
            reviewedBy: poolReviewReviewer,
          },
        },
      );
      toast.success("酌情评审已记录");
      setPoolReviewOpen(false);
      poolReviews.reload();
    } catch (error) {
      setPoolReviewError(
        error instanceof Error
          ? error.message
          : "Could not record the review.",
      );
    } finally {
      setPoolReviewSaving(false);
    }
  }

  function openClawbackForm() {
    setClawbackPerson(session.personId);
    setClawbackAmount("");
    setClawbackReasonCode("OVERPAYMENT");
    setClawbackExplanation("");
    setClawbackConsent("");
    setClawbackInstallments("1");
    setClawbackHardship(false);
    setClawbackHardshipReason("");
    setClawbackRequester(session.personId);
    setClawbackError(null);
    setClawbackOpen(true);
  }

  async function saveClawback(event: FormEvent) {
    event.preventDefault();
    setClawbackSaving(true);
    setClawbackError(null);
    try {
      await api("/api/v1/clawback-cases", {
        method: "POST",
        body: {
          personId: clawbackPerson,
          amount: clawbackAmount,
          currency: "CNY",
          reasonCode: clawbackReasonCode.trim(),
          explanation: clawbackExplanation.trim(),
          consentSignatureRef: clawbackConsent.trim(),
          installmentMonths: Number(clawbackInstallments),
          hardshipWaiver: clawbackHardship,
          hardshipReason: clawbackHardship
            ? clawbackHardshipReason.trim()
            : undefined,
          requestedBy: clawbackRequester,
        },
      });
      toast.success("追回案例已记录");
      setClawbackOpen(false);
      clawbacks.reload();
    } catch (error) {
      setClawbackError(
        error instanceof Error
          ? error.message
          : "Could not record the clawback.",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  async function generateRecovery(event: FormEvent) {
    event.preventDefault();
    if (!recoveryTarget) return;
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      await api(
        `/api/v1/clawback-cases/${recoveryTarget.id}/generate-recovery`,
        {
          method: "POST",
          body: {
            cycleId: recoveryCycleId.trim(),
            ledgerEntryId: recoveryLedgerId.trim(),
            createBatch: recoveryCreateBatch,
            installmentCycles: recoveryCycles.trim()
              ? recoveryCycles
                  .split(/[,，\s]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined,
          },
        },
      );
      toast.success(
        "追回已生成",
        recoveryCreateBatch
          ? "已创建 RECOVERY 结算批次；受影响人员须确认后才能锁定。"
          : "已追加锁定账本调整分录。",
      );
      setRecoveryTarget(null);
      clawbacks.reload();
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setRecoveryBusy(false);
    }
  }


  async function approveClawback(clawback: ClawbackCase) {
    setClawbackSaving(true);
    try {
      await api(`/api/v1/clawback-cases/${clawback.id}/approve`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success("追回已批准");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "批准追回失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  async function openSchedule(clawback: ClawbackCase) {
    setScheduleTarget(clawback);
    setSchedule(null);
    setScheduleError(null);
    setScheduleLoading(true);
    try {
      setSchedule(
        await api<ClawbackSchedule>(
          `/api/v1/clawback-cases/${clawback.id}/schedule`,
        ),
      );
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setScheduleLoading(false);
    }
  }

  async function waiveClawback(event: FormEvent) {
    event.preventDefault();
    if (!waiveTarget) return;
    setClawbackSaving(true);
    try {
      await api(`/api/v1/clawback-cases/${waiveTarget.id}/waive`, {
        method: "POST",
        body: {
          reason: waiveReason.trim(),
          actorPersonId: session.personId,
        },
      });
      toast.success("追回已豁免");
      setWaiveTarget(null);
      setWaiveReason("");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "豁免追回失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setClawbackSaving(false);
    }
  }


  return (
    <>
      {canGovern ? (<>
      <Panel
        title="追回案例"
        subtitle="追回结算前的同意、分期与困难条款"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openClawbackForm}
          >
            记录追回
          </Button>
        }
        flush
      >
        {clawbacks.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={clawbacks.error} onRetry={clawbacks.reload} />
          </div>
        ) : clawbacks.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (clawbacks.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="wallet"
            title="暂无追回案例"
            description="追回激励前先记录书面同意、分期或困难条款。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th className="cell-num">金额</th>
                  <th>原因</th>
                  <th className="cell-num">分期</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clawbacks.data?.map((clawback) => (
                  <tr key={clawback.id}>
                    <td>{displayName(clawback.personId, people)}</td>
                    <td className="cell-num">
                      {formatMoney(clawback.amount, clawback.currency)}
                    </td>
                    <td>
                      <span className="cell-primary">
                        {zhClawbackReason(clawback.reasonCode)}
                      </span>
                      <span className="cell-sub">
                        {clawback.reasonCode} · {clawback.explanation}
                      </span>
                    </td>
                    <td className="cell-num">{clawback.installmentMonths}</td>
                    <td>
                      <Badge status={clawback.status} />
                      {clawback.recovery?.batchNo ? (
                        <span className="cell-sub">
                          {clawback.recovery.batchNo} ·{" "}
                          {clawback.recovery.batchStatus
                            ? zhStatus(clawback.recovery.batchStatus)
                            : "待分批"}
                        </span>
                      ) : null}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        {clawback.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void approveClawback(clawback)}
                            loading={clawbackSaving}
                          >
                            批准
                          </Button>
                        ) : null}
                        {clawback.status === "APPROVED" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void openSchedule(clawback)}
                            >
                              计划
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setRecoveryTarget(clawback);
                                setRecoveryCycleId("");
                                setRecoveryCycles("");
                                setRecoveryLedgerId("");
                                setRecoveryCreateBatch(true);
                                setRecoveryError(null);
                              }}
                            >
                              生成追回
                            </Button>
                          </>
                        ) : null}
                        {clawback.status === "DRAFT" ||
                        clawback.status === "APPROVED" ||
                        clawback.status === "RECOVERY_GENERATED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setWaiveTarget(clawback);
                              setWaiveReason("");
                            }}
                          >
                            豁免
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
      </>) : null}

      <Modal
        open={clawbackOpen}
        title="记录追回条款"
        description="书面同意必填；追回仍需单独的 RECOVERY 结算批次。"
        onClose={() => setClawbackOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClawbackOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="clawback-form"
              loading={clawbackSaving}
            >
              记录
            </Button>
          </>
        }
      >
        <form id="clawback-form" className="stack" onSubmit={saveClawback}>
          {clawbackError ? (
            <InfoNotice tone="warning">{clawbackError}</InfoNotice>
          ) : null}
          <FormField label="人员" htmlFor="clawback-person">
            <PersonSelect
              id="clawback-person"
              value={clawbackPerson}
              onChange={setClawbackPerson}
            />
          </FormField>
          <div className="form-grid">
            <FormField label="金额（元）" htmlFor="clawback-amount">
              <TextInput
                id="clawback-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={clawbackAmount}
                onChange={(event) => setClawbackAmount(event.target.value)}
                required
              />
            </FormField>
            <FormField label="原因码" htmlFor="clawback-reason-code">
              <TextInput
                id="clawback-reason-code"
                value={clawbackReasonCode}
                onChange={(event) =>
                  setClawbackReasonCode(event.target.value)
                }
                required
              />
            </FormField>
            <FormField
              label="分期（1–12）"
              htmlFor="clawback-installments"
            >
              <TextInput
                id="clawback-installments"
                type="number"
                min={1}
                max={12}
                value={clawbackInstallments}
                onChange={(event) =>
                  setClawbackInstallments(event.target.value)
                }
                required
              />
            </FormField>
            <FormField label="发起人" htmlFor="clawback-requester">
              <PersonSelect
                id="clawback-requester"
                value={clawbackRequester}
                onChange={setClawbackRequester}
              />
            </FormField>
          </div>
          <FormField label="说明" htmlFor="clawback-explanation">
            <Textarea
              id="clawback-explanation"
              value={clawbackExplanation}
              onChange={(event) => setClawbackExplanation(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="同意/电子签引用"
            htmlFor="clawback-consent"
          >
            <TextInput
              id="clawback-consent"
              value={clawbackConsent}
              onChange={(event) => setClawbackConsent(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clawbackHardship}
              onChange={(event) => setClawbackHardship(event.target.checked)}
            />
            <span>困难豁免</span>
          </label>
          {clawbackHardship ? (
            <FormField
              label="困难原因"
              htmlFor="clawback-hardship"
            >
              <TextInput
                id="clawback-hardship"
                value={clawbackHardshipReason}
                onChange={(event) =>
                  setClawbackHardshipReason(event.target.value)
                }
                required
              />
            </FormField>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(waiveTarget)}
        title="豁免追回"
        description={
          waiveTarget?.recovery
            ? `该案已生成追回（${waiveTarget.recovery.installments?.length ?? 1} 笔，批次 ${waiveTarget.recovery.batchNo ?? "未分批"}，状态 ${waiveTarget.recovery.batchStatus ? zhStatus(waiveTarget.recovery.batchStatus) : "待分批"}）。豁免将逐笔冲销合计 +${waiveTarget.amount} ${waiveTarget.currency} 并取消对应结算批次；批次已锁定或追回已并入标准批次时会被拒绝。`
            : "该案尚未生成追回；豁免只关闭案件，不影响账本。"
        }
        onClose={() => setWaiveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWaiveTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="waive-form"
              loading={clawbackSaving}
            >
              豁免
            </Button>
          </>
        }
      >
        <form id="waive-form" className="stack" onSubmit={waiveClawback}>
          <FormField label="豁免理由" htmlFor="waive-reason">
            <TextInput
              id="waive-reason"
              value={waiveReason}
              onChange={(event) => setWaiveReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(scheduleTarget)}
        title="追回分期排期"
        description="逐期校验生效合同的扣款上限与最低工资下限。"
        onClose={() => {
          setScheduleTarget(null);
          setSchedule(null);
          setScheduleError(null);
        }}
        wide
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setScheduleTarget(null);
              setSchedule(null);
              setScheduleError(null);
            }}
          >
            关闭
          </Button>
        }
      >
        {scheduleLoading ? (
          <LoadingRows rows={3} />
        ) : scheduleError ? (
          <ErrorNotice
            error={new Error(scheduleError)}
            onRetry={
              scheduleTarget
                ? () => void openSchedule(scheduleTarget)
                : undefined
            }
          />
        ) : !schedule ? null : !schedule.available ? (
          <InfoNotice tone="warning">
            No active contract in {scheduleTarget?.currency} is available for
            this person, so the minimum-wage and deduction-cap checks cannot be
            completed. Do not collect before an authorised review.
          </InfoNotice>
        ) : (
          <div className="stack">
            <InfoNotice
              tone={
                schedule.blockedCount && schedule.blockedCount > 0
                  ? "warning"
                  : "success"
              }
            >
              {schedule.blockedCount} blocked installment(s) · cap{" "}
              {formatMoney(
                schedule.deductionCapAmount ?? "0",
                schedule.currency ?? "CNY",
              )}{" "}
              · minimum wage{" "}
              {formatMoney(
                schedule.minimumMonthlyWage ?? "0",
                schedule.currency ?? "CNY",
              )}
            </InfoNotice>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cell-num">#</th>
                    <th>截止</th>
                    <th className="cell-num">金额</th>
                    <th className="cell-num">剩余工资</th>
                    <th>检查</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.installments.map((installment) => (
                    <tr key={installment.sequence}>
                      <td className="cell-num">{installment.sequence}</td>
                      <td>{formatDate(installment.dueDate)}</td>
                      <td className="cell-num">
                        {formatMoney(
                          installment.amount,
                          schedule.currency ?? "CNY",
                        )}
                      </td>
                      <td className="cell-num">
                        {formatMoney(
                          installment.remainingWage,
                          schedule.currency ?? "CNY",
                        )}
                      </td>
                      <td>
                        <Badge
                          status={
                            installment.minimumWagePassed &&
                            installment.deductionCapPassed
                              ? "PASSED"
                              : "BLOCKED"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedule.scheduleHash ? (
              <p className="subtle" style={{ fontSize: 12 }}>
                Schedule hash {schedule.scheduleHash.slice(0, 24)}…
              </p>
            ) : null}
          </div>
        )}
      </Modal>

      {canGovern ? (<>
      <Panel
        title="机动池评审"
        subtitle="委员会决策 + 独立员工观察员"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => void openPoolReviewForm()}
          >
            记录复核
          </Button>
        }
        flush
      >
        {poolReviews.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={poolReviews.error}
              onRetry={poolReviews.reload}
            />
          </div>
        ) : poolReviews.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (poolReviews.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="wallet"
            title="暂无机动池评审"
            description="记录机动池的评审委员会、员工观察员与评选标准。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>资金池</th>
                  <th>评审委员会</th>
                  <th>员工观察员</th>
                  <th>评选标准</th>
                  <th>已复核</th>
                </tr>
              </thead>
              <tbody>
                {poolReviews.data?.map((review) => {
                  const pool = pools.data?.find(
                    (candidate) => candidate.id === review.poolId,
                  );
                  return (
                    <tr key={review.id}>
                      <td>
                        <span className="cell-primary">
                          {pool?.name ?? shortId(review.poolId, 10)}
                        </span>
                        <span className="cell-sub mono">
                          {pool?.code ?? ""}
                        </span>
                      </td>
                      <td>{review.committeePersonIds.length} members</td>
                      <td>
                        {review.employeeObserverPersonId
                          ? displayName(
                              review.employeeObserverPersonId,
                              people,
                            )
                          : "无"}
                      </td>
                      <td>{review.selectionCriteria}</td>
                      <td className="nowrap">
                        {formatDate(review.reviewedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </>) : null}

      <Modal
        open={poolReviewOpen}
        title="记录机动池评审"
        description="至少两名委员会成员与可选的独立员工观察员。"
        onClose={() => setPoolReviewOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPoolReviewOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="pool-review-form"
              loading={poolReviewSaving}
            >
              记录复核
            </Button>
          </>
        }
      >
        <form
          id="pool-review-form"
          className="stack"
          onSubmit={savePoolReview}
        >
          {poolReviewError ? (
            <InfoNotice tone="warning">{poolReviewError}</InfoNotice>
          ) : null}
          <FormField label="预算池" htmlFor="pool-review-pool">
            <Select
              id="pool-review-pool"
              value={poolReviewPool}
              onChange={(event) => setPoolReviewPool(event.target.value)}
              required
            >
              <option value="">Select a pool…</option>
              {pools.data?.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} · {pool.code}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="detail-section">
            <div className="detail-section__title">
              评审委员会（至少选两人）
            </div>
            <div className="stack">
              {people.map((person) => (
                <label className="checkbox" key={person.id}>
                  <input
                    type="checkbox"
                    checked={poolReviewCommittee.includes(person.id)}
                    onChange={(event) =>
                      setPoolReviewCommittee((current) =>
                        event.target.checked
                          ? [...current, person.id]
                          : current.filter((id) => id !== person.id),
                      )
                    }
                  />
                  <span>{person.displayName}</span>
                </label>
              ))}
            </div>
          </div>
          <FormField
            label="员工观察员（独立，可选）"
            htmlFor="pool-review-observer"
          >
            <Select
              id="pool-review-observer"
              value={poolReviewObserver}
              onChange={(event) => setPoolReviewObserver(event.target.value)}
            >
              <option value="">无观察员</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="评审人" htmlFor="pool-review-reviewer">
            <PersonSelect
              id="pool-review-reviewer"
              value={poolReviewReviewer}
              onChange={setPoolReviewReviewer}
            />
          </FormField>
          <FormField
            label="评选标准"
            htmlFor="pool-review-criteria"
          >
            <Textarea
              id="pool-review-criteria"
              value={poolReviewCriteria}
              onChange={(event) => setPoolReviewCriteria(event.target.value)}
              required
            />
          </FormField>
          <FormField label="决策说明" htmlFor="pool-review-notes">
            <Textarea
              id="pool-review-notes"
              value={poolReviewNotes}
              onChange={(event) => setPoolReviewNotes(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {canGovern ? (<>
      <Panel
        title="模型供应商策略"
        subtitle="每个供应商的零留存、DPA、推理区域与出口白名单"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openPolicyForm}
          >
            记录策略
          </Button>
        }
        flush
      >
        {providerPolicies.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={providerPolicies.error}
              onRetry={providerPolicies.reload}
            />
          </div>
        ) : providerPolicies.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (providerPolicies.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="ai"
            title="暂无供应商策略"
            description="启用供应商策略强制前，登记零留存确认、DPA 引用、区域与出口白名单。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>零留存</th>
                  <th>DPA</th>
                  <th>推理区域</th>
                  <th>出口白名单</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {providerPolicies.data?.map((policy) => (
                  <tr key={policy.id}>
                    <td className="mono">{policy.provider}</td>
                    <td>
                      <Badge
                        tone={
                          policy.zeroRetentionConfirmed ? "success" : "danger"
                        }
                      >
                        {policy.zeroRetentionConfirmed ? "Confirmed" : "缺失"}
                      </Badge>
                    </td>
                    <td className="mono">{policy.dpaRef}</td>
                    <td>{policy.inferenceRegion}</td>
                    <td>{policy.egressAllowlist.join(", ")}</td>
                    <td>
                      <Badge status={policy.status} />
                    </td>
                    <td className="cell-actions">
                      {policy.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void retirePolicy(policy)}
                          loading={policySaving}
                        >
                          退役
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </>) : null}

      <Modal
        open={policyOpen}
        title="记录供应商策略"
        description="租户通过 requireModelProviderPolicy 启用强制。"
        onClose={() => setPolicyOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPolicyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="provider-policy-form"
              loading={policySaving}
            >
              记录策略
            </Button>
          </>
        }
      >
        <form
          id="provider-policy-form"
          className="stack"
          onSubmit={savePolicy}
        >
          {policyError ? (
            <InfoNotice tone="warning">{policyError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="供应商" htmlFor="policy-provider">
              <TextInput
                id="policy-provider"
                value={policyProvider}
                onChange={(event) => setPolicyProvider(event.target.value)}
                required
              />
            </FormField>
            <FormField label="推理区域" htmlFor="policy-region">
              <TextInput
                id="policy-region"
                value={policyRegion}
                onChange={(event) => setPolicyRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="DPA 引用" htmlFor="policy-dpa">
              <TextInput
                id="policy-dpa"
                value={policyDpa}
                onChange={(event) => setPolicyDpa(event.target.value)}
                required
              />
            </FormField>
            <FormField label="审批人" htmlFor="policy-approver">
              <PersonSelect
                id="policy-approver"
                value={policyApprover}
                onChange={setPolicyApprover}
              />
            </FormField>
          </div>
          <FormField
            label="出口白名单（逗号分隔）"
            htmlFor="policy-egress"
          >
            <TextInput
              id="policy-egress"
              value={policyEgress}
              onChange={(event) => setPolicyEgress(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={policyZeroRetention}
              onChange={(event) =>
                setPolicyZeroRetention(event.target.checked)
              }
            />
            <span>供应商合同确认零留存。</span>
          </label>
        </form>
      </Modal>

      {canGovern ? (<>
      <Panel
        title="审计脱敏"
        subtitle="敏感自由文本原因的双人脱敏；哈希链不变"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openRedactionForm}
          >
            脱敏事件
          </Button>
        }
        flush
      >
        {redactions.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={redactions.error} onRetry={redactions.reload} />
          </div>
        ) : redactions.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (redactions.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="lock"
            title="暂无审计脱敏"
            description="仅当自由文本原因含无关个人/敏感数据时脱敏；原事件哈希保持不变。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>审计事件</th>
                  <th>替换文本</th>
                  <th>原因</th>
                  <th>申请 / 批准</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {redactions.data?.map((redaction) => (
                  <tr key={redaction.id}>
                    <td className="mono">
                      {shortId(redaction.auditEventId, 12)}
                    </td>
                    <td className="mono">{redaction.replacement}</td>
                    <td>{redaction.reason}</td>
                    <td className="mono">
                      {shortId(redaction.requestedBy, 8)} /{" "}
                      {shortId(redaction.approvedBy, 8)}
                    </td>
                    <td className="nowrap">
                      {formatDateTime(redaction.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </>) : null}

      <Modal
        open={redactionOpen}
        title="脱敏审计原因"
        description="请求与批准脱敏必须为不同两人。"
        onClose={() => setRedactionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedactionOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="redaction-form"
              loading={redactionSaving}
            >
              脱敏
            </Button>
          </>
        }
      >
        <form id="redaction-form" className="stack" onSubmit={saveRedaction}>
          {redactionError ? (
            <InfoNotice tone="warning">{redactionError}</InfoNotice>
          ) : null}
          <FormField label="审计事件 ID" htmlFor="redaction-event">
            <TextInput
              id="redaction-event"
              value={redactionEventId}
              onChange={(event) => setRedactionEventId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="原因" htmlFor="redaction-reason">
            <TextInput
              id="redaction-reason"
              value={redactionReason}
              onChange={(event) => setRedactionReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="发起人" htmlFor="redaction-requester">
            <PersonSelect
              id="redaction-requester"
              value={redactionRequester}
              onChange={setRedactionRequester}
            />
          </FormField>
          <FormField label="批准人" htmlFor="redaction-approver">
            <PersonSelect
              id="redaction-approver"
              value={redactionApprover}
              onChange={setRedactionApprover}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(recoveryTarget)}
        title="生成追回"
        onClose={() => setRecoveryTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecoveryTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="generate-recovery-form"
              loading={recoveryBusy}
              disabled={
                !recoveryCycleId.trim() || !recoveryLedgerId.trim()
              }
            >
              生成追回
            </Button>
          </>
        }
      >
        <form id="generate-recovery-form" onSubmit={generateRecovery}>
          {recoveryError ? (
            <div className="section-gap">
              <InfoNotice tone="warning">{recoveryError}</InfoNotice>
            </div>
          ) : null}
          <DefinitionList
            items={[
              {
                label: "案件",
                value: `${recoveryTarget?.amount ?? ""} ${recoveryTarget?.currency ?? ""} · ${recoveryTarget?.reasonCode ?? ""}`,
              },
              {
                label: "影响",
                value:
                  "追加锁定负向账本调整（按案例幂等）。填写分期周期时按月在各自周期生成；已确认的结算周期拒绝追溯调整。",
              },
            ]}
          />
          <FormField
            label="周期 ID"
            htmlFor="recovery-cycle"
            hint="承载调整的 RECOVERY 结算批次所属周期。"
          >
            <TextInput
              id="recovery-cycle"
              value={recoveryCycleId}
              onChange={(event) => setRecoveryCycleId(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="分期周期 ID（可选）"
            htmlFor="recovery-cycles"
            hint={`按月追回时填写，数量须等于案件期数（${recoveryTarget?.installmentMonths ?? "?"} 期），用逗号分隔。留空则一次性生成。`}
          >
            <TextInput
              id="recovery-cycles"
              value={recoveryCycles}
              onChange={(event) => setRecoveryCycles(event.target.value)}
              placeholder="周期1ID, 周期2ID, …"
            />
          </FormField>
          <FormField
            label="账本条目 ID"
            htmlFor="recovery-ledger"
            hint="要调整的原锁定激励条目（在「结算」账本视图查找）。"
          >
            <TextInput
              id="recovery-ledger"
              value={recoveryLedgerId}
              onChange={(event) => setRecoveryLedgerId(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={recoveryCreateBatch}
              onChange={(event) => setRecoveryCreateBatch(event.target.checked)}
            />{" "}
            同时创建 RECOVERY 结算批次（受影响人员确认后才能锁定）
          </label>
        </form>
      </Modal>

    </>
  );
}
