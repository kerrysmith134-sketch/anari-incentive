/**
 * AI 建议（只读）。
 *
 * 同一份草稿在 SUBMITTED（待独立判断）状态由服务端盲审遮蔽；这里不绕过
 * 服务端，只把「独立判断已记录」后才允许展示的语义显式化：
 * - 未记录独立判断：先显示提示，不渲染任何 AI 内容；
 * - 已记录但内容被遮蔽：说明盲审状态与查看路径；
 * - 内容可用：只读展示 strengths / 反证 / 缺失信息 / 草稿负载 / 不确定性。
 */
import { DefinitionList, InfoNotice } from "../ui.js";
import type { EvaluationDraft } from "../../lib/types.js";

export type AiDraftView = EvaluationDraft & { contentHidden?: boolean };

export function AiSuggestionPanel({
  draft,
  revealed,
  hint,
}: {
  draft: AiDraftView | null;
  /** 复核人是否已记录自己的独立判断（记录前不展示 AI 内容）。 */
  revealed: boolean;
  hint?: string;
}) {
  if (!draft) {
    return (
      <InfoNotice tone="info">
        该草稿不是 AI 草稿，没有可展示的 AI 建议。
      </InfoNotice>
    );
  }
  const metadata = (
    <DefinitionList
      items={[
        {
          label: "来源",
          value:
            draft.generatedByType === "AGENT"
              ? "AI 生成（advisory）"
              : draft.generatedByType,
        },
        ...(draft.modelProvider
          ? [{ label: "模型商", value: draft.modelProvider }]
          : []),
        ...(draft.modelName
          ? [{ label: "模型", value: draft.modelName }]
          : []),
        ...(draft.promptVersion
          ? [{ label: "Prompt", value: draft.promptVersion }]
          : []),
        {
          label: "草稿状态",
          value: draft.status,
        },
      ]}
    />
  );
  if (!revealed) {
    return (
      <InfoNotice tone="warning">
        先填写并锁定「独立判断」，之后才会展示 AI 建议（避免建议污染判断）。
        {hint ? ` ${hint}` : ""}
      </InfoNotice>
    );
  }
  if (draft.contentHidden) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <InfoNotice tone="info">
          服务端盲审遮蔽（NP-004）：AI 草稿在 SUBMITTED
          状态不返回内容。提交最终决定后，可在「已批决策」的 JEV
          案件中只读查看 AI 建议。
        </InfoNotice>
        {metadata}
      </div>
    );
  }
  return (
    <section className="stack" aria-label="AI 建议（只读）">
      <InfoNotice tone="info">
        AI 建议仅供参考，不是决定，也不进入最终 record；人工判断独立保存。
      </InfoNotice>
      {metadata}
      {draft.strengths.length > 0 ? (
        <div className="detail-section">
          <div className="detail-section__title">AI 认为的优势</div>
          <ul className="stack" style={{ gap: 4 }}>
            {draft.strengths.map((item) => (
              <li key={item} className="muted">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {draft.counterEvidence.length > 0 ? (
        <div className="detail-section">
          <div className="detail-section__title">AI 识别的反证</div>
          <ul className="stack" style={{ gap: 4 }}>
            {draft.counterEvidence.map((item) => (
              <li key={item} className="muted">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {draft.missingInformation.length > 0 ? (
        <div className="detail-section">
          <div className="detail-section__title">AI 标注的缺失信息</div>
          <div className="chip-row">
            {draft.missingInformation.map((item) => (
              <span className="chip" key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="detail-section">
        <div className="detail-section__title">草稿内容（只读）</div>
        <pre className="code-block">
          {JSON.stringify(draft.draftPayload, null, 2)}
        </pre>
      </div>
      {Object.keys(draft.uncertainty ?? {}).length > 0 ? (
        <div className="detail-section">
          <div className="detail-section__title">不确定性</div>
          <pre className="code-block">
            {JSON.stringify(draft.uncertainty, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
