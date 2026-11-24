/**
 * AI 保障 · 评测运行 tab：评测运行列表、评测详情与评测台模态。
 * 查询由页面容器持有（props 传入）；详情与评测台表单状态自持。
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
import { useToast } from "../../contexts/ToastContext.js";
import { api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
} from "../../lib/format.js";
import type {
  ModelEvaluationDataset,
  ModelEvaluationRun,
} from "../../lib/types.js";

export function AiEvaluationsTab({
  evaluations,
  datasets,
}: {
  evaluations: QueryState<ModelEvaluationRun[]>;
  datasets: QueryState<ModelEvaluationDataset[]>;
}) {
  const toast = useToast();
  const [evaluationDetail, setEvaluationDetail] =
    useState<ModelEvaluationRun | null>(null);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [harnessType, setHarnessType] = useState("SCORE_AGREEMENT");
  const [harnessProvider, setHarnessProvider] = useState("anthropic");
  const [harnessModel, setHarnessModel] = useState("claude");
  const [harnessPromptVersion, setHarnessPromptVersion] = useState("v1");
  const [harnessDatasetRef, setHarnessDatasetRef] = useState("gold-set-1");
  const [harnessSamples, setHarnessSamples] = useState("[]");
  const [harnessThresholds, setHarnessThresholds] = useState("{}");
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessRunning, setHarnessRunning] = useState(false);

  const evaluationList = evaluations.data ?? [];

  function openHarness() {
    setHarnessType("SCORE_AGREEMENT");
    setHarnessProvider("anthropic");
    setHarnessModel("claude");
    setHarnessPromptVersion("v1");
    setHarnessDatasetRef(datasets.data?.[0]?.code ?? "gold-set-1");
    setHarnessSamples("[]");
    setHarnessThresholds("{}");
    setHarnessError(null);
    setHarnessOpen(true);
  }

  async function runHarness() {
    setHarnessError(null);
    setHarnessRunning(true);
    try {
      const samples = JSON.parse(harnessSamples) as unknown[];
      const thresholds = JSON.parse(harnessThresholds) as Record<
        string,
        unknown
      >;
      await api("/api/v1/model-evaluation-runs:evaluate", {
        method: "POST",
        body: {
          evaluationType: harnessType.trim(),
          modelProvider: harnessProvider.trim(),
          modelName: harnessModel.trim(),
          promptVersion: harnessPromptVersion.trim(),
          datasetRef: harnessDatasetRef.trim(),
          samples,
          thresholds,
        },
      });
      toast.success("评测已记录", harnessType);
      setHarnessOpen(false);
      evaluations.reload();
      datasets.reload();
    } catch (caught) {
      setHarnessError(
        caught instanceof Error ? caught.message : "评测失败",
      );
    } finally {
      setHarnessRunning(false);
    }
  }

  return (
    <>
      <Panel
        title="评测运行"
        subtitle="通过/失败由受控评测计算；导入记录无法解锁激活或评分"
        flush
        action={
          <Button size="sm" variant="primary" icon="play" onClick={openHarness}>
            运行评测
          </Button>
        }
      >
        {evaluations.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={evaluations.error} onRetry={evaluations.reload} />
          </div>
        ) : evaluations.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : evaluationList.length === 0 ? (
          <EmptyState
            icon="chart"
            title="暂无评测运行"
            description="激活提示词或使用数值评分提案前，用标注金标集运行评测。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>评测</th>
                  <th>模型</th>
                  <th className="cell-num">样本</th>
                  <th>评测台</th>
                  <th>结果</th>
                  <th>已评测</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {evaluationList.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <span className="cell-primary">{run.evaluationType}</span>
                      <span className="cell-sub mono">
                        {run.datasetRef} · {shortId(run.id, 10)}
                      </span>
                    </td>
                    <td>
                      {run.modelName}
                      <span className="cell-sub">
                        {run.modelProvider} · prompt {run.promptVersion}
                      </span>
                    </td>
                    <td className="cell-num">{run.sampleSize}</td>
                    <td>
                      {run.metrics.harnessVersion === "ai-gate-v1" ? (
                        <Badge tone="accent">已验证</Badge>
                      ) : (
                        <Badge tone="warning">已导入</Badge>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={run.passed ? "success" : "danger"}
                      >
                        {run.passed ? "通过" : "已阻断"}
                      </Badge>
                    </td>
                    <td className="nowrap">
                      {formatRelative(run.evaluatedAt)}
                    </td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEvaluationDetail(run)}
                      >
                        查看
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
        open={Boolean(evaluationDetail)}
        title="评测运行"
        description={
          evaluationDetail
            ? `${evaluationDetail.modelProvider} ${evaluationDetail.modelName} · ${evaluationDetail.datasetRef}`
            : undefined
        }
        onClose={() => setEvaluationDetail(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setEvaluationDetail(null)}>
            关闭
          </Button>
        }
      >
        {evaluationDetail ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "评测台",
                  value:
                    evaluationDetail.metrics.harnessVersion === "ai-gate-v1"
                      ? "Verified (ai-gate-v1)"
                      : "已导入记录",
                },
                {
                  label: "结果",
                  value: (
                    <Badge
                      tone={evaluationDetail.passed ? "success" : "danger"}
                    >
                      {evaluationDetail.passed ? "通过" : "已阻断"}
                    </Badge>
                  ),
                },
                {
                  label: "样本",
                  value: evaluationDetail.sampleSize,
                },
                {
                  label: "已评测",
                  value: formatDateTime(evaluationDetail.evaluatedAt),
                },
              ]}
            />
            {evaluationDetail.blockers.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">阻断项</div>
                <div className="chip-row">
                  {evaluationDetail.blockers.map((blocker) => (
                    <span className="chip" key={blocker}>
                      {blocker}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="detail-section">
              <div className="detail-section__title">指标</div>
              <pre className="code-block">
                {JSON.stringify(evaluationDetail.metrics, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={harnessOpen}
        title="运行评测台"
        description="样本为人工打分对与模型分；通过/阻断由服务端计算。"
        onClose={() => setHarnessOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setHarnessOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={runHarness}
              loading={harnessRunning}
            >
              运行评测
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {harnessError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{harnessError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="评测类型" htmlFor="harness-type">
            <TextInput
              id="harness-type"
              value={harnessType}
              onChange={(event) => setHarnessType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="模型供应商" htmlFor="harness-provider">
            <TextInput
              id="harness-provider"
              value={harnessProvider}
              onChange={(event) => setHarnessProvider(event.target.value)}
              required
            />
          </FormField>
          <FormField label="模型名称" htmlFor="harness-model">
            <TextInput
              id="harness-model"
              value={harnessModel}
              onChange={(event) => setHarnessModel(event.target.value)}
              required
            />
          </FormField>
          <FormField label="提示词版本" htmlFor="harness-prompt">
            <TextInput
              id="harness-prompt"
              value={harnessPromptVersion}
              onChange={(event) =>
                setHarnessPromptVersion(event.target.value)
              }
              required
            />
          </FormField>
          <FormField label="数据集引用" htmlFor="harness-dataset">
            <TextInput
              id="harness-dataset"
              value={harnessDatasetRef}
              onChange={(event) => setHarnessDatasetRef(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="样本（JSON）"
            htmlFor="harness-samples"
            className="field--full"
            hint="[{ sampleId, subgroup, humanScoreA, humanScoreB, aiScore, counterfactualScores, promptInjectionPassed, holdout }]"
          >
            <Textarea
              id="harness-samples"
              value={harnessSamples}
              onChange={(event) => setHarnessSamples(event.target.value)}
              rows={10}
              spellCheck={false}
            />
          </FormField>
          <FormField
            label="阈值（JSON，可选）"
            htmlFor="harness-thresholds"
            className="field--full"
          >
            <Textarea
              id="harness-thresholds"
              value={harnessThresholds}
              onChange={(event) => setHarnessThresholds(event.target.value)}
              rows={4}
              spellCheck={false}
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
