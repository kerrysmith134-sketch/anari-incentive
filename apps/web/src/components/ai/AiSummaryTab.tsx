/**
 * AI 保障 · 模型证据摘要 tab：建议性摘要展示与请求摘要模态。
 * 证据节点查询由页面容器持有（props 传入）；摘要结果与表单状态自持。
 */
import { useState } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  FormField,
  InfoNotice,
  Modal,
  Panel,
  Textarea,
  TextInput,
} from "../ui.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";

type EvidenceNode = {
  id: string;
  evidenceType: string;
  qualityStatus: string;
};

type ModelSummaryResult = {
  summary: string;
  dimensionAssessments: Array<{
    dimension: string;
    status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
    rationale: string;
    supportingEvidenceRefs: string[];
    counterEvidenceRefs: string[];
    missingInformation: string[];
  }>;
  uncertainty: { band: "LOW" | "MEDIUM" | "HIGH"; reasons: string[] };
  model: string;
};

export function AiSummaryTab({
  evidenceNodes,
}: {
  evidenceNodes: QueryState<EvidenceNode[]>;
}) {
  const toast = useToast();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDimensions, setSummaryDimensions] = useState("QUALITY, TIMELINESS");
  const [summaryEvidenceRefs, setSummaryEvidenceRefs] = useState("");
  const [summaryRubric, setSummaryRubric] = useState("");
  const [summaryResult, setSummaryResult] =
    useState<ModelSummaryResult | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  async function runModelSummary() {
    setSummaryError(null);
    setSummaryResult(null);
    setSummaryBusy(true);
    try {
      const response = await api<{
        suggestionLogId: string;
        summary: ModelSummaryResult;
      }>("/api/v1/ai/model-summary", {
        method: "POST",
        body: {
          dimensions: summaryDimensions
            .split(",")
            .map((dimension) => dimension.trim())
            .filter(Boolean),
          evidenceRefs: summaryEvidenceRefs
            .split(/[\n,]/)
            .map((ref) => ref.trim())
            .filter(Boolean),
          rubric: summaryRubric.trim() || undefined,
        },
      });
      setSummaryResult(response.summary);
      toast.success(
        "模型摘要已生成",
        "已记录为建议性 AI 建议；绝不进入资金路径。",
      );
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setSummaryBusy(false);
    }
  }

  return (
    <>
      <Panel
        title="模型证据摘要"
        subtitle="仅作证据归纳：识别支持、反证与信息缺口，不生成绩效分或置信度分数"
        action={
          <Button
            variant="primary"
            onClick={() => {
              setSummaryOpen(true);
              setSummaryResult(null);
              setSummaryError(null);
            }}
          >
            新建摘要
          </Button>
        }
      >
        <InfoNotice>
          Requires a configured and tenant-approved model provider. In
          production, an active provider policy with DPA, zero-retention
          confirmation and a matching egress allowlist is mandatory.
          Evidence is sent as JSON data, never as prompt instructions. The
          model can only produce qualitative support/counter-evidence
          findings; numeric performance scores are not accepted.
        </InfoNotice>
        {summaryResult ? (
          <div className="stack">
            <div className="row-actions">
              <Badge tone="info">🤖 AI 模型 · {summaryResult.model}</Badge>
              <Badge tone="neutral">Advisory — never enters money paths</Badge>
            </div>
            <DefinitionList
              items={summaryResult.dimensionAssessments.map((item) => ({
                label: item.dimension,
                value: item.status.replaceAll("_", " "),
              }))}
            />
            <div className="stack">
              <div className="stat-label">
                Uncertainty: {summaryResult.uncertainty.band}
              </div>
              {summaryResult.uncertainty.reasons.length > 0 ? (
                <ul>
                  {summaryResult.uncertainty.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {summaryResult.dimensionAssessments.map((item) => (
              <div className="card" key={item.dimension}>
                <strong>{item.dimension} · {item.status.replaceAll("_", " ")}</strong>
                <p>{item.rationale}</p>
                <p className="hint">Supporting: {item.supportingEvidenceRefs.join(", ") || "—"}</p>
                <p className="hint">Counter-evidence: {item.counterEvidenceRefs.join(", ") || "—"}</p>
                {item.missingInformation.length > 0 ? (
                  <p className="hint">Missing: {item.missingInformation.join("; ")}</p>
                ) : null}
              </div>
            ))}
            <p>{summaryResult.summary}</p>
          </div>
        ) : (
          <EmptyState
            icon="ai"
            title="暂无摘要"
            description="选择证据引用与维度，请求一次建议性模型摘要。"
          />
        )}
      </Panel>

      <Modal
        open={summaryOpen}
        title="请求模型摘要"
        onClose={() => setSummaryOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSummaryOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              loading={summaryBusy}
              disabled={
                summaryEvidenceRefs.trim().length === 0 ||
                summaryDimensions.trim().length === 0
              }
              onClick={() => void runModelSummary()}
            >
              生成摘要
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {summaryError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{summaryError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="维度（逗号分隔）"
            htmlFor="summary-dimensions"
            hint="每个维度给出 0–5 的建议分。"
          >
            <TextInput
              id="summary-dimensions"
              value={summaryDimensions}
              onChange={(event) => setSummaryDimensions(event.target.value)}
            />
          </FormField>
          <FormField
            label="证据引用"
            htmlFor="summary-evidence"
            hint="每行一个证据节点 ID（见「贡献认定」证据表）。"
          >
            <Textarea
              id="summary-evidence"
              rows={5}
              value={summaryEvidenceRefs}
              onChange={(event) => setSummaryEvidenceRefs(event.target.value)}
              spellCheck={false}
            />
          </FormField>
          <FormField label="评分标准（可选）" htmlFor="summary-rubric">
            <TextInput
              id="summary-rubric"
              value={summaryRubric}
              onChange={(event) => setSummaryRubric(event.target.value)}
            />
          </FormField>
          {evidenceNodes.data && evidenceNodes.data.length > 0 ? (
            <div className="field--full">
              <p className="hint">
                Recent evidence:{" "}
                {evidenceNodes.data
                  .slice(0, 5)
                  .map((node) => node.id)
                  .join(", ")}
              </p>
            </div>
          ) : null}
          {summaryResult ? (
            <div className="field--full">
              <DefinitionList
                items={summaryResult.dimensionAssessments.map((item) => ({
                  label: item.dimension,
                  value: item.status.replaceAll("_", " "),
                }))}
              />
              <p>{summaryResult.summary}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
