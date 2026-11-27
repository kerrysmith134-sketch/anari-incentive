/**
 * Human vs AI：同一案件上「人工独立判断」与「AI 建议」并排显示。
 *
 * 两者来自后端 `judgments.human` / `judgments.ai` 两个数组，前端不做合并；
 * 差异只做视觉强调（同一维度取值不同），不改变任何一边的分值。
 */
import { Badge, DefinitionList } from "../ui.js";
import type { DecisionJudgmentView } from "./types.js";

const PAIR_STYLE = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
} as const;

function scoreEntries(
  scores: Record<string, unknown>,
): Array<[string, string]> {
  return Object.entries(scores)
    .map(([key, value]): [string, string] => [
      key,
      typeof value === "number" || typeof value === "string"
        ? String(value)
        : JSON.stringify(value),
    ])
    .sort(([left], [right]) => left.localeCompare(right));
}

function scoresOf(
  judgment: DecisionJudgmentView | undefined,
): Record<string, unknown> {
  const scores = judgment?.independentScores ?? {};
  // 常见嵌套：{states: {...}}（vLLM 建议）；只对一层的数值做对比。
  const nested = scores.states;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return scores;
}

function JudgmentCard({
  title,
  description,
  judgment,
  tone,
}: {
  title: string;
  description: string;
  judgment?: DecisionJudgmentView;
  tone: "human" | "ai";
}) {
  const entries = judgment ? scoreEntries(scoresOf(judgment)) : [];
  return (
    <article className="detail-section" aria-label={title}>
      <div className="detail-section__title">{title}</div>
      <div className="chip-row">
        <Badge tone={tone === "human" ? "success" : "info"} dot={false}>
          {tone === "human" ? "人工" : "AI 建议"}
        </Badge>
        <span className="muted">{description}</span>
      </div>
      {judgment ? (
        <>
          <DefinitionList
            items={[
              {
                label: "actor",
                value: <span className="mono">{judgment.actorId}</span>,
              },
              ...(judgment.modelRef
                ? [
                    {
                      label: "模型",
                      value: (
                        <span className="mono">{judgment.modelRef}</span>
                      ),
                    },
                  ]
                : []),
              ...(typeof judgment.confidence === "number"
                ? [
                    {
                      label: "自信度",
                      value: judgment.confidence.toFixed(2),
                    },
                  ]
                : []),
            ]}
          />
          {entries.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">维度</th>
                    <th scope="col">取值</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([dimension, value]) => (
                    <tr key={dimension}>
                      <td className="mono">{dimension}</td>
                      <td className="mono">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">没有独立得分（仅文字判断）。</p>
          )}
          <div className="detail-section">
            <div className="detail-section__title">判断理由</div>
            <p className="muted">
              {judgment.independentRationale || "（无理由）"}
            </p>
          </div>
        </>
      ) : (
        <p className="muted">
          {tone === "ai"
            ? "尚无 AI 建议。AI 建议只能由服务端模型写入，人工判断不依赖它。"
            : "尚无人工独立判断：没有它，案件不能进入校验/决定。"}
        </p>
      )}
    </article>
  );
}

export function HumanVsAiDiff({
  human,
  ai,
}: {
  human: DecisionJudgmentView[];
  ai: DecisionJudgmentView[];
}) {
  const humanJudgment = human.at(-1);
  const aiJudgment = ai.at(-1);
  const humanScores = humanJudgment ? scoresOf(humanJudgment) : {};
  const aiScores = aiJudgment ? scoresOf(aiJudgment) : {};
  const dimensions = [
    ...new Set([...Object.keys(humanScores), ...Object.keys(aiScores)]),
  ].sort();
  const differences = dimensions.filter(
    (dimension) =>
      String(humanScores[dimension] ?? "—") !==
      String(aiScores[dimension] ?? "—"),
  );
  return (
    <section className="stack" aria-label="人工判断与 AI 建议对比">
      <div className="chip-row">
        <span className="chip">人工判断 {human.length} 条</span>
        <span className="chip">AI 建议 {ai.length} 条</span>
        <span className="chip">
          差异维度 {differences.length > 0 ? differences.join("、") : "无"}
        </span>
      </div>
      <div style={PAIR_STYLE}>
        <JudgmentCard
          title="人工独立判断（先于 AI 建议）"
          description="由真实复核人提交；决定人不得是其中任何一位。"
          judgment={humanJudgment}
          tone="human"
        />
        <JudgmentCard
          title="AI 建议（只读，不能作为最终依据）"
          description="服务端模型写入的 advisory 判断；永远不能成为 record。"
          judgment={aiJudgment}
          tone="ai"
        />
      </div>
      {dimensions.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption style={{ textAlign: "left" }}>
              <span className="muted">同一维度的人工 / AI 取值</span>
            </caption>
            <thead>
              <tr>
                <th scope="col">维度</th>
                <th scope="col">人工</th>
                <th scope="col">AI</th>
                <th scope="col">差异</th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dimension) => {
                const humanValue = String(humanScores[dimension] ?? "—");
                const aiValue = String(aiScores[dimension] ?? "—");
                return (
                  <tr key={dimension}>
                    <td className="mono">{dimension}</td>
                    <td className="mono">{humanValue}</td>
                    <td className="mono">{aiValue}</td>
                    <td>
                      {humanValue !== aiValue ? (
                        <Badge tone="warning" dot={false}>
                          不一致
                        </Badge>
                      ) : (
                        <span className="muted">一致</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
