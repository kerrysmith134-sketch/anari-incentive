/**
 * 字段映射解析预览：把示例 payload 按当前 fieldMap 解析成 canonical 字段。
 *
 * 纯前端预览（与 packages/connectors resolveField 同规则），不调用后端。
 * 错误字段用行底色 + 文案双重标记，不只依赖颜色。
 */
import { useId, useMemo, useState } from "react";
import { Badge, InfoNotice, Textarea } from "../ui.js";
import {
  analyzeFieldMap,
  samplePayloadFor,
  unusedTopLevelFields,
} from "./mapping-fields.js";

interface ParsedPayload {
  payload?: Record<string, unknown>;
  error?: string;
}

export function MappingPreview({
  mappingLabel,
  fieldMap,
  requiredTargets,
}: {
  mappingLabel: string;
  fieldMap: Record<string, string>;
  requiredTargets: ReadonlySet<string>;
}) {
  const payloadId = useId();
  const hintId = useId();
  const errorId = useId();
  const [payloadText, setPayloadText] = useState(() =>
    JSON.stringify(samplePayloadFor(fieldMap), null, 2),
  );

  const parsed = useMemo<ParsedPayload>(() => {
    try {
      const value: unknown = JSON.parse(payloadText);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: "payload 必须是 JSON 对象（不能是数组或标量）。" };
      }
      return { payload: value as Record<string, unknown> };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "无法解析";
      return { error: `JSON 解析失败：${detail}` };
    }
  }, [payloadText]);

  const analysis = useMemo(
    () =>
      parsed.payload
        ? analyzeFieldMap(fieldMap, parsed.payload, requiredTargets)
        : [],
    [parsed.payload, fieldMap, requiredTargets],
  );

  const unused = useMemo(
    () =>
      parsed.payload ? unusedTopLevelFields(parsed.payload, fieldMap) : [],
    [parsed.payload, fieldMap],
  );

  const resolvedCount = analysis.filter(
    (field) => field.error === undefined && field.value !== undefined,
  ).length;
  const errorCount = analysis.filter((field) => field.error !== undefined).length;
  const describedBy = parsed.error ? `${hintId} ${errorId}` : hintId;

  return (
    <div className="stack">
      <div className="field">
        <label className="field__label" htmlFor={payloadId}>
          示例 payload（JSON 对象）
        </label>
        <Textarea
          id={payloadId}
          className="input textarea mono"
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          rows={10}
          spellCheck={false}
          autoComplete="off"
          style={
            parsed.error
              ? { borderColor: "var(--critical)" }
              : undefined
          }
          aria-invalid={parsed.error ? true : undefined}
          aria-describedby={describedBy}
        />
        <span className="field__hint" id={hintId}>
          仅在本地解析，不会发送到后端。预览只应用 fieldMap 表达式（
          <span className="mono">=常量</span>、点路径、
          <span className="mono">|</span> 转换管道），不叠加 config.constants
          与 config.transforms。
        </span>
        {parsed.error ? (
          <span className="field__error" id={errorId} role="alert">
            {parsed.error}
          </span>
        ) : null}
      </div>

      <p className="muted" style={{ fontSize: 12 }} role="status" aria-live="polite">
        {parsed.error
          ? "修正 JSON 后显示解析结果"
          : `${analysis.length} 个 canonical 字段 · ${resolvedCount} 个解析出值 · ${errorCount} 个错误`}
      </p>

      {parsed.error ? (
        <InfoNotice tone="warning">
          修正上面的 JSON 后，这里会显示逐字段解析结果。
        </InfoNotice>
      ) : null}

      {!parsed.error && Object.keys(fieldMap).length === 0 ? (
        <InfoNotice tone="warning">
          该映射的 fieldMap 为空；下表按契约必填列标出缺失字段。
        </InfoNotice>
      ) : null}

      {!parsed.error && analysis.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">
              {mappingLabel} 的 canonical 字段解析结果（包含必填与错误标记）
            </caption>
            <thead>
              <tr>
                <th scope="col">Canonical 字段</th>
                <th scope="col">映射表达式</th>
                <th scope="col">解析值</th>
                <th scope="col">必填</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {analysis.map((field) => {
                return (
                  <tr
                    key={field.target}
                    style={
                      field.error
                        ? { background: "var(--critical-soft)" }
                        : undefined
                    }
                  >
                    <td>
                      <span className="mono cell-primary">
                        {field.target}
                      </span>
                    </td>
                    <td>
                      <span className="mono">
                        {field.expression || "—"}
                      </span>
                    </td>
                    <td>
                      {field.value === undefined ? (
                        <span className="subtle">—</span>
                      ) : (
                        <span
                          className="mono"
                          style={{ wordBreak: "break-word" }}
                        >
                          {field.value}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={field.required ? "warning" : "neutral"}
                        dot={false}
                      >
                        {field.required ? "必填" : "可选"}
                      </Badge>
                    </td>
                    <td>
                      {field.error ? (
                        <span className="field__error">{field.error}</span>
                      ) : field.value === undefined ? (
                        <span className="subtle">可选字段未提供</span>
                      ) : (
                        <Badge tone="success" dot={false}>
                          已解析
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!parsed.error && unused.length > 0 ? (
        <InfoNotice tone="info">
          payload 中未被任何映射引用的顶层字段：
          <span className="mono"> {unused.join("、")}</span>
          。若是拼写错误，解析会表现为必填字段缺失。
        </InfoNotice>
      ) : null}
    </div>
  );
}
