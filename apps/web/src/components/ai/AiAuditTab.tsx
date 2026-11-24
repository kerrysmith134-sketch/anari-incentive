/**
 * AI 保障 · 审计队列 tab：第二复核审计队列与审计模态。
 * 查询由页面容器持有（props 传入）；审计表单状态自持。
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
  Textarea,
  TextInput,
} from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api } from "../../lib/api.js";
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

export function AiAuditTab({
  auditQueue,
  reviewMetrics,
  people,
  personId,
}: {
  auditQueue: QueryState<AiScoreProposal[]>;
  reviewMetrics: QueryState<AiReviewMetrics>;
  people: PlatformPerson[];
  personId: string;
}) {
  const toast = useToast();
  const [auditTarget, setAuditTarget] = useState<AiScoreProposal | null>(null);
  const [auditReviewer, setAuditReviewer] = useState(personId);
  const [auditScores, setAuditScores] = useState<Record<string, string>>({});
  const [auditRationale, setAuditRationale] = useState("");
  const [auditEvidenceOpened, setAuditEvidenceOpened] = useState(0);
  const [auditStartedAt, setAuditStartedAt] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSubmitting, setAuditSubmitting] = useState(false);

  function openAudit(proposal: AiScoreProposal) {
    setAuditTarget(proposal);
    setAuditReviewer(personId);
    setAuditScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [dimension, ""]),
      ),
    );
    setAuditRationale("");
    setAuditEvidenceOpened(0);
    setAuditStartedAt(new Date().toISOString());
    setAuditError(null);
  }

  async function submitAuditReview() {
    if (!auditTarget) return;
    setAuditError(null);
    const scores: Record<string, number> = {};
    for (const dimension of auditTarget.dimensions) {
      const value = Number(auditScores[dimension]);
      if (!Number.isFinite(value) || value < 0 || value > 5) {
        setAuditError(
          `Enter a second-review score between 0 and 5 for ${titleCase(dimension)}.`,
        );
        return;
      }
      scores[dimension] = value;
    }
    if (auditRationale.trim().length < 3) {
      setAuditError("第二复核理由过短。");
      return;
    }
    setAuditSubmitting(true);
    try {
      await api(
        `/api/v1/ai-score-proposals/${auditTarget.id}/audit-review`,
        {
          method: "POST",
          body: {
            reviewerPersonId: auditReviewer,
            scores,
            rationale: auditRationale.trim(),
            reviewStartedAt: auditStartedAt,
            evidenceOpened: auditEvidenceOpened,
          },
        },
      );
      toast.success(
        "审计复核已记录",
        "第二次复核会单独留痕，不改变原决定。",
      );
      setAuditTarget(null);
      auditQueue.reload();
      reviewMetrics.reload();
    } catch (caught) {
      setAuditError(
        caught instanceof Error
          ? caught.message
          : "无法记录审计复核。",
      );
    } finally {
      setAuditSubmitting(false);
    }
  }

  return (
    <>
      <Panel
        title="第二复核审计队列"
        subtitle="所有改判必抽，另按可配置比例随机抽样"
        flush
      >
        {reviewMetrics.data ? (
          <div style={{ padding: "14px 20px 0" }}>
            <InfoNotice>
              Sampled {reviewMetrics.data.auditSampledCount} · reviewed{" "}
              {reviewMetrics.data.auditReviewedCount} · pending{" "}
              {reviewMetrics.data.auditPendingCount} · agreement{" "}
              {formatPercent(reviewMetrics.data.auditAgreementRate)}. Avg
              review{" "}
              {Math.round(
                reviewMetrics.data.averageReviewDurationSeconds,
              )}
              s · evidence opened{" "}
              {reviewMetrics.data.averageEvidenceOpened.toFixed(1)} · blind{" "}
              {reviewMetrics.data.blindReviewCount}. The second reviewer does
              not see the first independent scores.
            </InfoNotice>
          </div>
        ) : null}
        {auditQueue.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={auditQueue.error}
              onRetry={auditQueue.reload}
            />
          </div>
        ) : auditQueue.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (auditQueue.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="暂无待审项"
            description="改判必抽样；其他决策按配置比例进入审计队列。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>模型分</th>
                  <th>初次决策</th>
                  <th>第一复核人</th>
                  <th>抽样</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {auditQueue.data?.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>
                      <span className="cell-primary">
                        {displayName(proposal.personId, people)}
                      </span>
                      <span className="cell-sub mono">
                        {shortId(proposal.id, 10)}
                      </span>
                    </td>
                    <td>
                      已退役
                      <span className="cell-sub">
                        confidence {formatPercent(proposal.confidence)}
                      </span>
                    </td>
                    <td>
                      <Badge status={proposal.status} />
                      {proposal.override ? (
                        <span className="cell-sub">
                          <Badge tone="warning">改判</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {proposal.decidedBy
                        ? displayName(proposal.decidedBy, people)
                        : "—"}
                    </td>
                    <td className="nowrap">
                      {proposal.auditSampledAt
                        ? formatRelative(proposal.auditSampledAt)
                        : "—"}
                    </td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openAudit(proposal)}
                      >
                        审计
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(auditTarget)}
        title="第二复核审计"
        description="先独立评分，再与第一复核对比。"
        onClose={() => setAuditTarget(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuditTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={submitAuditReview}
              loading={auditSubmitting}
            >
              记录审计复核
            </Button>
          </>
        }
      >
        {auditTarget ? (
          <div className="stack">
            {auditError ? (
              <InfoNotice tone="warning">{auditError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                {
                  label: "人员",
                  value: displayName(auditTarget.personId, people),
                },
                {
                  label: "初次决策",
                  value: <Badge status={auditTarget.status} />,
                },
                {
                  label: "抽样",
                  value: auditTarget.auditSampledAt
                    ? formatDateTime(auditTarget.auditSampledAt)
                    : "—",
                },
              ]}
            />
            <FormField label="第二复核人" htmlFor="audit-reviewer">
              <PersonSelect
                id="audit-reviewer"
                value={auditReviewer}
                onChange={setAuditReviewer}
              />
            </FormField>
            <div className="form-grid">
              {auditTarget.dimensions.map((dimension) => (
                <FormField
                  key={dimension}
                  label={`${titleCase(dimension)} score (0–5)`}
                  htmlFor={`audit-score-${dimension}`}
                >
                  <TextInput
                    id={`audit-score-${dimension}`}
                    type="number"
                    min="0"
                    max="5"
                    step="0.01"
                    value={auditScores[dimension] ?? ""}
                    onChange={(event) =>
                      setAuditScores((current) => ({
                        ...current,
                        [dimension]: event.target.value,
                      }))
                    }
                  />
                </FormField>
              ))}
              <FormField
                label="打开证据数"
                htmlFor="audit-evidence"
              >
                <TextInput
                  id="audit-evidence"
                  type="number"
                  min={0}
                  value={auditEvidenceOpened}
                  onChange={(event) =>
                    setAuditEvidenceOpened(Number(event.target.value))
                  }
                />
              </FormField>
            </div>
            <FormField
              label="复核理由"
              htmlFor="audit-rationale"
            >
              <Textarea
                id="audit-rationale"
                value={auditRationale}
                onChange={(event) => setAuditRationale(event.target.value)}
              />
            </FormField>
            <InfoNotice>
              The second reviewer must differ from the requester and the first
              reviewer. Agreement is computed by comparing the second scores
              with the model scores, then with the recorded decision.
            </InfoNotice>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
