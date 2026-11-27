/**
 * JEV 案件入口（评价决定）：创建/关联 → 服务端校验 → 授权决定 → 最终批准。
 *
 * 只展示服务端事实：案件状态、证据承诺、人工/AI 判断（分开）、校验绑定与
 * decision record。前端不能伪造 AI 判断，也不能把 AI 建议当决定。
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
  Textarea,
} from "../ui.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { useApiQuery } from "../../lib/hooks.js";
import { ApiError, api } from "../../lib/api.js";
import { formatDateTime, shortId } from "../../lib/format.js";
import { AiSuggestionPanel, type AiDraftView } from "./AiSuggestionPanel.js";
import { HumanVsAiDiff } from "./HumanVsAiDiff.js";
import type { DecisionCaseDetailView } from "./types.js";
import type { EvaluationDecision } from "../../lib/types.js";

export function DecisionCaseModal({
  decision,
  aiDraft,
  onClose,
  onChanged,
}: {
  decision: EvaluationDecision | null;
  aiDraft: AiDraftView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const open = Boolean(decision);
  const path = decision
    ? `/api/v1/evaluation-decisions/${encodeURIComponent(decision.id)}/decision-case`
    : null;
  const detail = useApiQuery<DecisionCaseDetailView>(path, decision?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");

  async function run(
    key: string,
    action: () => Promise<string>,
  ): Promise<void> {
    setBusy(key);
    setError(null);
    setStatus(null);
    try {
      setStatus(await action());
      detail.reload();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.code}: ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : "操作失败",
      );
    } finally {
      setBusy(null);
    }
  }

  const view =
    detail.data && decision && detail.data.decision.id === decision.id
      ? detail.data
      : undefined;
  const decisionCase = view?.case ?? null;
  const record = view?.record;
  const jev = view?.decision.jev;
  const canAct = Boolean(session.personId);

  return (
    <Modal
      open={open}
      title="JEV 决策案件"
      description="评价决定必须留下 JEV decision record 才能进入最终批准；AI 建议只读，人工判断独立保存。"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {decisionCase ? (
            <Button
              variant="secondary"
              loading={busy === "create"}
              onClick={() =>
                run("create", async () => {
                  await api(
                    `/api/v1/evaluation-decisions/${encodeURIComponent(decision!.id)}/decision-case`,
                    { method: "POST" },
                  );
                  return "案件已关联（幂等，不会重复建案）";
                })
              }
            >
              重新关联
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!decision}
              onClick={() =>
                run("create", async () => {
                  await api(
                    `/api/v1/evaluation-decisions/${encodeURIComponent(decision!.id)}/decision-case`,
                    { method: "POST" },
                  );
                  return "已创建/关联 JEV 案件与两条证据";
                })
              }
            >
              创建/关联 JEV 案件
            </Button>
          )}
          <Button
            variant="primary"
            loading={busy === "approve"}
            disabled={!record}
            onClick={() =>
              run("approve", async () => {
                await api(
                  `/api/v1/evaluation-decisions/${encodeURIComponent(decision!.id)}/final-approval`,
                  { method: "POST" },
                );
                return "最终批准门禁通过（JEV record 已存在）";
              })
            }
          >
            进入最终批准
          </Button>
        </>
      }
    >
      {decision ? (
        <div className="stack">
          <div role="status" aria-live="polite">
            {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}
            {status ? <InfoNotice tone="success">{status}</InfoNotice> : null}
          </div>
          <DefinitionList
            items={[
              { label: "评价决定", value: shortId(decision.id, 22) },
              { label: "人员", value: shortId(decision.personId, 22) },
              { label: "决定版本", value: `v${decision.decisionVersion}` },
              {
                label: "JEV 状态",
                value: (
                  <Badge
                    tone={jev?.decided ? "success" : "warning"}
                    dot={false}
                  >
                    {jev?.decided ? "JEV_DECIDED" : "PENDING_JEV"}
                  </Badge>
                ),
              },
            ]}
          />

          {detail.error ? (
            <ErrorNotice error={detail.error} onRetry={detail.reload} />
          ) : detail.loading && !view ? (
            <LoadingRows rows={3} />
          ) : !decisionCase ? (
            <EmptyState
              icon="approvals"
              title="尚未关联 JEV 案件"
              description="没有 JEV record 的评价决定不能进入最终批准（409 DECISION_CASE_REQUIRED）。"
            />
          ) : (
            <>
              <DefinitionList
                items={[
                  { label: "案件", value: shortId(decisionCase.id, 22) },
                  { label: "kind", value: decisionCase.kind },
                  { label: "subject", value: decisionCase.subjectType },
                  {
                    label: "subjectId",
                    value: (
                      <span className="mono">
                        {shortId(decisionCase.subjectId, 22)}
                      </span>
                    ),
                  },
                  {
                    label: "案件状态",
                    value: <Badge status={decisionCase.status} />,
                  },
                  { label: "案件版本", value: `v${decisionCase.version}` },
                ]}
              />

              <section aria-label="JEV 案件证据">
                <div className="detail-section__title">证据（append-only）</div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">来源</th>
                        <th scope="col">sourceId</th>
                        <th scope="col">倾向</th>
                        <th scope="col">contentHash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view?.evidence.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.sourceType}</td>
                          <td className="mono">
                            {shortId(entry.sourceId, 18)}
                          </td>
                          <td>{entry.supports}</td>
                          <td className="mono">
                            {shortId(entry.contentHash, 20)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <HumanVsAiDiff
                human={view?.judgments.human ?? []}
                ai={view?.judgments.ai ?? []}
              />

              <section aria-label="JEV 服务端校验">
                <div className="detail-section__title">服务端校验</div>
                {(view?.verifications.length ?? 0) === 0 ? (
                  <p className="muted">尚未运行 5 个 checker。</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">结果</th>
                          <th scope="col">校验人</th>
                          <th scope="col">版本绑定</th>
                          <th scope="col">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view?.verifications.map((verification) => (
                          <tr key={verification.id}>
                            <td>
                              <Badge
                                tone={
                                  verification.passed ? "success" : "danger"
                                }
                                dot={false}
                              >
                                {verification.passed ? "PASSED" : "FAILED"}
                                {verification.stale ? " · STALE" : ""}
                              </Badge>
                            </td>
                            <td className="mono">
                              {shortId(verification.verifiedBy, 18)}
                            </td>
                            <td className="mono">
                              v{verification.verifiedCaseVersion}
                            </td>
                            <td className="nowrap">
                              {formatDateTime(verification.verifiedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {record ? (
                <DefinitionList
                  items={[
                    { label: "decision record", value: shortId(record.id, 22) },
                    { label: "授权人", value: shortId(record.decidedBy, 22) },
                    { label: "决定时间", value: formatDateTime(record.decidedAt) },
                    { label: "理由", value: record.rationale },
                  ]}
                />
              ) : (
                <FormField
                  label="JEV 决定理由"
                  htmlFor="jev-decide-rationale"
                  hint="授权人必须与所有人工判断者不同（自决 409 SELF_DECISION_FORBIDDEN）。"
                >
                  <Textarea
                    id="jev-decide-rationale"
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    placeholder="记录最终决定的依据"
                  />
                </FormField>
              )}

              <div className="chip-row">
                <Button
                  variant="secondary"
                  loading={busy === "verify"}
                  disabled={!canAct || !decisionCase || Boolean(record)}
                  onClick={() =>
                    run("verify", async () => {
                      await api(
                        `/api/v1/decision-cases/${encodeURIComponent(decisionCase!.id)}/verify`,
                        {
                          method: "POST",
                          body: { verifiedBy: session.personId },
                        },
                      );
                      return "5 个 checker 全部通过，校验绑定已记录";
                    })
                  }
                >
                  运行服务端校验
                </Button>
                <Button
                  variant="primary"
                  loading={busy === "decide"}
                  disabled={!canAct || Boolean(record) || rationale.trim().length === 0}
                  onClick={() =>
                    run("decide", async () => {
                      await api(
                        `/api/v1/evaluation-decisions/${encodeURIComponent(decision!.id)}/decision-case/decide`,
                        {
                          method: "POST",
                          body: { rationale: rationale.trim() },
                        },
                      );
                      return "JEV 决定已记录：评价决定推进为 JEV_DECIDED";
                    })
                  }
                >
                  JEV 授权决定
                </Button>
              </div>
              {!canAct ? (
                <InfoNotice tone="warning">
                  当前会话没有人员身份，无法提交人工判断/校验/决定。
                </InfoNotice>
              ) : null}
            </>
          )}

          <section aria-label="AI 建议（只读）">
            <AiSuggestionPanel draft={aiDraft} revealed hint="决定后仍可只读查看。" />
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
