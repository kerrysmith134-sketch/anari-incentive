/**
 * AI 保障 · 评分提案 tab：提案列表、状态筛选与人工复核模态。
 * 查询由页面容器持有（props 传入）；仅自持筛选与复核表单状态。
 */
import { useState } from "react";
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
  Textarea,
  TextInput,
} from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import { useToast } from "../../contexts/ToastContext.js";
import { ApiError, api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";
import {
  displayName,
  formatDateTime,
  formatPercent,
  formatRelative,
  shortId,
  titleCase,
} from "../../lib/format.js";
import type {
  AiReviewMetrics,
  AiScoreProposal,
  PlatformPerson,
} from "../../lib/types.js";

const STATUS_FILTERS = [
  { id: "PENDING", label: "待处理" },
  { id: "ACCEPTED", label: "Accepted" },
  { id: "REJECTED", label: "已驳回" },
  { id: "ALL", label: "全部" },
];

export function AiProposalsTab({
  proposals,
  reviewMetrics,
  people,
  personId,
}: {
  proposals: QueryState<AiScoreProposal[]>;
  reviewMetrics?: AiReviewMetrics;
  people: PlatformPerson[];
  personId: string;
}) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selected, setSelected] = useState<AiScoreProposal | null>(null);
  const [decision, setDecision] = useState<"ACCEPT" | "REJECT">("ACCEPT");
  const [decidedBy, setDecidedBy] = useState(personId);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reviewStartedAt, setReviewStartedAt] = useState("");
  const [independentScores, setIndependentScores] = useState<
    Record<string, string>
  >({});
  const [independentRationale, setIndependentRationale] = useState("");
  const [evidenceOpened, setEvidenceOpened] = useState(0);
  const [blindReview, setBlindReview] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [secondReviewer, setSecondReviewer] = useState("");
  const [secondScores, setSecondScores] = useState<Record<string, string>>({});
  const [secondRationale, setSecondRationale] = useState("");
  const [secondStartedAt, setSecondStartedAt] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const proposalList = proposals.data ?? [];
  const visible =
    statusFilter === "ALL"
      ? proposalList
      : proposalList.filter((proposal) => proposal.status === statusFilter);

  function openReview(proposal: AiScoreProposal) {
    setSelected(proposal);
    setDecision("ACCEPT");
    setDecidedBy(personId);
    setNote("");
    setActionError(null);
    setRevealed(proposal.status !== "PENDING");
    setReviewStartedAt(
      proposal.reviewStartedAt ?? new Date().toISOString(),
    );
    setIndependentScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [
          dimension,
          proposal.independentScores?.[dimension] !== undefined
            ? String(proposal.independentScores[dimension])
            : "",
        ]),
      ),
    );
    setIndependentRationale(proposal.independentRationale ?? "");
    setSecondReviewer(proposal.secondReviewerPersonId ?? "");
    setSecondScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [
          dimension,
          proposal.secondIndependentScores?.[dimension] !== undefined
            ? String(proposal.secondIndependentScores[dimension])
            : "",
        ]),
      ),
    );
    setSecondRationale(proposal.secondIndependentRationale ?? "");
    setSecondStartedAt(
      proposal.secondReviewStartedAt ?? new Date().toISOString(),
    );
    setEvidenceOpened(proposal.evidenceOpened ?? 0);
    setBlindReview(proposal.blindReview ?? true);
    setOverrideReason(proposal.overrideReason ?? "");
  }

  function currentOverride(proposal: AiScoreProposal): boolean {
    return proposal.dimensions.some(
      (dimension) =>
        Math.abs(
          Number(independentScores[dimension] ?? 0) -
            (proposal.scores[dimension] ?? 0),
        ) > 0.05,
    );
  }

  function revealAiProposal() {
    if (!selected) return;
    const missing = selected.dimensions.some(
      (dimension) =>
        independentScores[dimension]?.trim() === "" ||
        !Number.isFinite(Number(independentScores[dimension])) ||
        Number(independentScores[dimension]) < 0 ||
        Number(independentScores[dimension]) > 5,
    );
    if (missing) {
      setActionError("在查看 AI 输出前，请先为每个维度打 0–5 分。");
      return;
    }
    if (independentRationale.trim().length < 3) {
      setActionError("在查看 AI 输出前，请先记录你的独立判断理由。");
      return;
    }
    setActionError(null);
    setRevealed(true);
  }

  async function submitDecision() {
    if (!selected) return;
    if (!revealed) {
      setActionError("Reveal the AI proposal only after recording your independent judgment.");
      return;
    }
    if (decision === "REJECT" && !note.trim()) {
      setActionError("驳回评分提案时必须填写备注。");
      return;
    }
    if (currentOverride(selected) && !overrideReason.trim()) {
      setActionError("请说明独立评分与 AI 提案不同的原因。");
      return;
    }
    if (selected.secondReviewRequired) {
      if (!secondReviewer) {
        setActionError("高风险提案必须选择第二位复核人。");
        return;
      }
      if (secondRationale.trim().length < 3) {
        setActionError("必须填写第二复核理由。");
        return;
      }
      for (const dimension of selected.dimensions) {
        const value = Number(secondScores[dimension]);
        if (!Number.isFinite(value) || value < 0 || value > 5) {
          setActionError(
            `Enter a second-review score for ${titleCase(dimension)}.`,
          );
          return;
        }
      }
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await api(`/api/v1/ai-score-proposals/${selected.id}/decide`, {
        method: "POST",
        body: {
          decision,
          decidedBy,
          note: note.trim() || undefined,
          independentScores: Object.fromEntries(
            selected.dimensions.map((dimension) => [
              dimension,
              Number(independentScores[dimension]),
            ]),
          ),
          independentRationale: independentRationale.trim() || undefined,
          reviewStartedAt,
          evidenceOpened,
          overrideReason: overrideReason.trim() || undefined,
          blindReview,
          ...(selected.secondReviewRequired
            ? {
                secondReviewerPersonId: secondReviewer,
                secondIndependentScores: Object.fromEntries(
                  selected.dimensions.map((dimension) => [
                    dimension,
                    Number(secondScores[dimension]),
                  ]),
                ),
                secondIndependentRationale: secondRationale.trim(),
                secondReviewStartedAt: secondStartedAt,
              }
            : {}),
        },
      });
      toast.success(
        decision === "ACCEPT" ? "Score accepted" : "Score rejected",
        `${shortId(selected.id)} · 旧提案（数值评分已退役）`,
      );
      setSelected(null);
      proposals.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "无法记录决策。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Panel
        title="评分提案"
        subtitle="数值评分在人工采纳前始终只是提案"
        action={
          <div className="toolbar__group">
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="筛选提案状态"
              style={{ width: 140, height: 34 }}
            >
              {STATUS_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
        }
        flush
      >
        {reviewMetrics?.rubberStampAlert ? (
          <div style={{ padding: "14px 20px 0" }}>
            <InfoNotice tone="warning">
              Adoption exceeds 95% across {reviewMetrics.decided}{" "}
              decisions. Sample and review the queue for rubber-stamping
              before accepting more proposals.
            </InfoNotice>
          </div>
        ) : null}
        {proposals.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={proposals.error} onRetry={proposals.reload} />
          </div>
        ) : proposals.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="ai"
            title={statusFilter === "PENDING" ? "暂无待处理提案" : "当前视图暂无提案"}
            description="提案仅在模型评测通过后创建；采纳的评分归属到人工复核人。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>模型</th>
                  <th className="cell-num">得分</th>
                  <th className="cell-num">置信度</th>
                  <th>证据</th>
                  <th>创建时间</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>
                      <span className="cell-primary">
                        {displayName(proposal.personId, people)}
                      </span>
                      <span className="cell-sub mono">
                        cycle {shortId(proposal.cycleId, 10)}
                      </span>
                    </td>
                    <td>
                      <span>{proposal.modelName}</span>
                      <span className="cell-sub">
                        {proposal.modelProvider} · {proposal.promptVersion}
                      </span>
                    </td>
                    <td className="cell-num">
                      旧提案（数值评分已退役）
                    </td>
                    <td className="cell-num">
                      {formatPercent(proposal.confidence)}
                    </td>
                    <td>{proposal.evidenceRefs.length} refs</td>
                    <td className="nowrap">
                      {formatRelative(proposal.createdAt)}
                    </td>
                    <td>
                      <Badge status={proposal.status} />
                    </td>
                    <td className="cell-actions">
                      {proposal.status === "PENDING" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openReview(proposal)}
                        >
                          复核
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openReview(proposal)}
                        >
                          查看
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(selected)}
        title="评分提案"
        description={
          selected
            ? selected.status === "PENDING" && !revealed
              ? `${displayName(selected.personId, people)} · record your independent judgment first`
              : `${displayName(selected.personId, people)} · ${selected.modelProvider} ${selected.modelName}`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          selected?.status === "PENDING" ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                取消
              </Button>
              {!revealed ? (
                <Button variant="primary" onClick={revealAiProposal}>
                  揭示 AI 提案
                </Button>
              ) : (
                <Button
                  variant={decision === "REJECT" ? "danger" : "primary"}
                  onClick={submitDecision}
                  loading={submitting}
                >
                  {decision === "REJECT" ? "Reject score" : "采纳评分"}
                </Button>
              )}
            </>
          ) : (
            <Button variant="secondary" onClick={() => setSelected(null)}>
              关闭
            </Button>
          )
        }
      >
        {selected ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                {
                  label: "人员",
                  value: displayName(selected.personId, people),
                },
                { label: "状态", value: <Badge status={selected.status} /> },
                {
                  label: "证据",
                  value: `${selected.evidenceRefs.length} cited references`,
                },
              ]}
            />

            {!revealed ? (
              <>
                <InfoNotice>
                  <strong>先独立判断。</strong> Enter your own
                  dimension scores and rationale before the AI proposal is
                  revealed. The backend records the review duration and evidence
                  count, and requires a reason for each override.
                </InfoNotice>
                <div className="form-grid">
                  {selected.dimensions.map((dimension) => (
                    <FormField
                      key={dimension}
                      label={`${titleCase(dimension)} score (0–5)`}
                      htmlFor={`independent-${dimension}`}
                    >
                      <TextInput
                        id={`independent-${dimension}`}
                        type="number"
                        min="0"
                        max="5"
                        step="0.01"
                        value={independentScores[dimension] ?? ""}
                        onChange={(event) =>
                          setIndependentScores((current) => ({
                            ...current,
                            [dimension]: event.target.value,
                          }))
                        }
                      />
                    </FormField>
                  ))}
                  <FormField
                    label="独立判断理由"
                    htmlFor="independent-rationale"
                    className="field--full"
                    hint="至少 3 个字符；在展示 AI 输出前记录。"
                  >
                    <Textarea
                      id="independent-rationale"
                      value={independentRationale}
                      onChange={(event) =>
                        setIndependentRationale(event.target.value)
                      }
                    />
                  </FormField>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">
                    Evidence review ({evidenceOpened} opened)
                  </div>
                  {selected.evidenceRefs.length === 0 ? (
                    <p className="muted">未记录证据引用。</p>
                  ) : (
                    <div className="chip-row">
                      {selected.evidenceRefs.map((reference) => (
                        <button
                          type="button"
                          className="chip"
                          key={reference}
                          onClick={() => setEvidenceOpened((count) => count + 1)}
                        >
                          {reference}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="checkbox" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={blindReview}
                      onChange={(event) => setBlindReview(event.target.checked)}
                    />
                    <span>
                      Mark this review as a blind-audit sample. AI output is not
                      shown before the independent scores are recorded.
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">总分</div>
                    <div className="coverage-cell__value">
                      旧提案（数值评分已退役）
                    </div>
                    <div className="coverage-cell__sub">仅提案</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">置信度</div>
                    <div className="coverage-cell__value">
                      {formatPercent(selected.confidence)}
                    </div>
                    <div className="coverage-cell__sub">证据加权</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">打开证据数</div>
                    <div className="coverage-cell__value">{evidenceOpened}</div>
                    <div className="coverage-cell__sub">本次复核期间</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">状态</div>
                    <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                      <Badge status={selected.status} />
                    </div>
                    <div className="coverage-cell__sub">
                      {selected.decidedAt
                        ? formatDateTime(selected.decidedAt)
                        : "awaiting review"}
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">维度得分</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {Object.entries(selected.scores).map(([dimension, score]) => (
                      <div className="score-row" key={dimension}>
                        <span className="score-row__label">
                          {titleCase(dimension)}
                        </span>
                        <span className="score-row__track">
                          <span
                            className="score-row__fill"
                            style={{
                              display: "block",
                              width: `${Math.min(100, (score / 5) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="score-row__value">
                          {score.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">AI 理由</div>
                  <div className="reason-box">{selected.rationale}</div>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">证据引用</div>
                  <div className="chip-row">
                    {selected.evidenceRefs.map((reference) => (
                      <span className="chip" key={reference}>
                        {reference}
                      </span>
                    ))}
                  </div>
                  <p className="subtle" style={{ fontSize: 12, marginTop: 8 }}>
                    Snapshot {shortId(selected.evidenceSnapshotHash, 16)}
                  </p>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">门禁指标</div>
                  <pre className="code-block">
                    {JSON.stringify(selected.gateMetrics ?? {}, null, 2)}
                  </pre>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">你的独立判断</div>
                  <div className="reason-box">
                    {selected.dimensions
                      .map(
                        (dimension) =>
                          `${titleCase(dimension)}: ${independentScores[dimension] ?? "—"}`,
                      )
                      .join(" · ")}
                    {independentRationale ? ` — ${independentRationale}` : ""}
                  </div>
                  {(selected.status === "PENDING"
                    ? currentOverride(selected)
                    : selected.override) ? (
                    <InfoNotice tone="warning">
                      Your score differs from the AI proposal. A written override
                      reason is required and will be retained.
                    </InfoNotice>
                  ) : (
                    <InfoNotice tone="success">
                      Your independent score matches the AI proposal within
                      tolerance.
                    </InfoNotice>
                  )}
                </div>

                {selected.secondReviewRequired ? (
                  <div className="detail-section">
                    <div className="detail-section__title">
                      高风险第二复核
                    </div>
                    <InfoNotice tone="warning">
                      This proposal is marked {titleCase(selected.riskTier)} risk.
                      A second reviewer must independently score every dimension
                      and agree with the decision before it can be recorded.
                      {selected.secondReviewDueAt
                        ? ` Second review due ${new Date(selected.secondReviewDueAt).toLocaleString()}.`
                        : ""}
                    </InfoNotice>
                    {selected.riskReasons?.length ? (
                      <p className="muted">
                        Risk signals: {selected.riskReasons.map(titleCase).join(" · ")}
                      </p>
                    ) : null}
                    <FormField
                      label="第二复核人"
                      htmlFor="ai-second-reviewer"
                    >
                      <PersonSelect
                        id="ai-second-reviewer"
                        value={secondReviewer}
                        onChange={setSecondReviewer}
                      />
                    </FormField>
                    <div className="form-grid">
                      {selected.dimensions.map((dimension) => (
                        <FormField
                          key={dimension}
                          label={`${titleCase(dimension)} score (0–5)`}
                          htmlFor={`second-${dimension}`}
                        >
                          <TextInput
                            id={`second-${dimension}`}
                            type="number"
                            min="0"
                            max="5"
                            step="0.01"
                            value={secondScores[dimension] ?? ""}
                            onChange={(event) =>
                              setSecondScores((current) => ({
                                ...current,
                                [dimension]: event.target.value,
                              }))
                            }
                          />
                        </FormField>
                      ))}
                    </div>
                    <FormField
                      label="复核理由"
                      htmlFor="second-rationale"
                    >
                      <Textarea
                        id="second-rationale"
                        value={secondRationale}
                        onChange={(event) =>
                          setSecondRationale(event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                ) : null}

                {selected.status === "PENDING" ? (
                  <div className="detail-section">
                    <div className="detail-section__title">人工决策</div>
                    <div className="form-grid">
                      <FormField label="决策" htmlFor="ai-decision">
                        <Select
                          id="ai-decision"
                          value={decision}
                          onChange={(event) =>
                            setDecision(
                              event.target.value as "ACCEPT" | "REJECT",
                            )
                          }
                        >
                          <option value="ACCEPT">采纳提案</option>
                          <option value="REJECT">驳回提案</option>
                        </Select>
                      </FormField>
                      <FormField label="决策人" htmlFor="ai-decider">
                        <PersonSelect
                          id="ai-decider"
                          value={decidedBy}
                          onChange={setDecidedBy}
                        />
                      </FormField>
                      <FormField
                        label={
                          decision === "REJECT"
                            ? "决策备注（必填）"
                            : "决策备注（可选）"
                        }
                        htmlFor="ai-note"
                        className="field--full"
                      >
                        <Textarea
                          id="ai-note"
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="决策前你核对了什么？"
                        />
                      </FormField>
                      {currentOverride(selected) ? (
                        <FormField
                          label="改判理由（必填）"
                          htmlFor="ai-override"
                          className="field--full"
                        >
                          <Textarea
                            id="ai-override"
                            value={overrideReason}
                            onChange={(event) =>
                              setOverrideReason(event.target.value)
                            }
                          />
                        </FormField>
                      ) : null}
                    </div>
                  </div>
                ) : selected.decisionNote || selected.independentRationale ? (
                  <div className="detail-section">
                    <div className="detail-section__title">决策记录</div>
                    {selected.independentRationale ? (
                      <div className="reason-box">
                        <strong>独立判断理由：</strong>{" "}
                        {selected.independentRationale}
                      </div>
                    ) : null}
                    {selected.decisionNote ? (
                      <div className="reason-box" style={{ marginTop: 8 }}>
                        <strong>决策备注：</strong> {selected.decisionNote}
                      </div>
                    ) : null}
                    <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
                      Decided by {displayName(selected.decidedBy, people)}
                      {selected.reviewDurationSeconds !== undefined
                        ? ` · review ${selected.reviewDurationSeconds}s`
                        : ""}
                      {selected.override ? " · override" : ""}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
