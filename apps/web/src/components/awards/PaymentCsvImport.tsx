import { useId, useState } from "react";
import { Badge, Button, FormField, InfoNotice, Textarea } from "../ui.js";
import { useToast } from "../../contexts/ToastContext.js";
import { formatMoney, shortId } from "../../lib/format.js";
import {
  parseAwardPaymentCsv,
  type PaymentCsvPreviewRow,
  type PaymentCsvPerson,
} from "./payment-csv.js";
import {
  PAYMENT_STATUS_LABELS,
  type AwardPaymentPayload,
  type AwardReconciliation,
  type SubmitOutcome,
} from "./types.js";

interface CsvRowResult {
  state: "success" | "error";
  message?: string;
}

interface CsvSummary {
  ok: number;
  failed: number;
  skipped: number;
}

/**
 * 批量粘贴 / CSV 支付回执导入。
 * 前端解析并校验每一行，提交时逐行 POST /payments，成功/失败原因逐行展示；
 * 单行失败不会回滚已成功的行（后端也按行幂等）。
 */
export function PaymentCsvImport({
  reconciliation,
  people,
  onSubmit,
  onRefresh,
}: {
  reconciliation: AwardReconciliation;
  people: ReadonlyArray<PaymentCsvPerson>;
  onSubmit: (payment: AwardPaymentPayload) => Promise<SubmitOutcome>;
  onRefresh: () => void;
}) {
  const baseId = useId();
  const toast = useToast();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PaymentCsvPreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, CsvRowResult>>({});
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pendingCount =
    rows?.filter(
      (row) => !row.error && results[row.row]?.state !== "success",
    ).length ?? 0;

  function resetResults(): void {
    setResults({});
    setSummary(null);
  }

  function handleParse(): void {
    resetResults();
    const parsed = parseAwardPaymentCsv({
      text,
      lines: reconciliation.lines,
      people,
      currency: reconciliation.currency,
    });
    setParseError(parsed.error ?? null);
    setRows(parsed.rows);
  }

  async function submitRows(): Promise<void> {
    if (!rows || submitting) return;
    setSubmitting(true);
    setSummary(null);
    const alreadySucceeded = new Set(
      Object.entries(results)
        .filter(([, result]) => result.state === "success")
        .map(([rowNumber]) => Number(rowNumber)),
    );
    const lineStatus = new Map(
      reconciliation.lines.map((line) => [line.lineId, line.status]),
    );
    const processedLines = new Set<string>();
    const nextResults: Record<number, CsvRowResult> = { ...results };
    let ok = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (alreadySucceeded.has(row.row)) {
        skipped += 1;
        continue;
      }
      if (row.error) {
        nextResults[row.row] = { state: "error", message: row.error };
        failed += 1;
        setResults({ ...nextResults });
        continue;
      }
      if (!row.lineId) {
        nextResults[row.row] = {
          state: "error",
          message: "无法定位对账行，未提交",
        };
        failed += 1;
        setResults({ ...nextResults });
        continue;
      }
      if (
        lineStatus.get(row.lineId) !== "UNPAID" ||
        processedLines.has(row.lineId)
      ) {
        nextResults[row.row] = {
          state: "error",
          message: "该行已不是未付状态（可能已在本次导入或此前支付）",
        };
        failed += 1;
        setResults({ ...nextResults });
        continue;
      }
      const outcome = await onSubmit({
        lineId: row.lineId,
        paymentRef: row.paymentRef,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        creditAccount: row.creditAccount,
        legalEntityId: row.legalEntityId,
        accountingPeriod: row.accountingPeriod,
        failureCode: row.failureCode,
      });
      if (outcome.ok) {
        processedLines.add(row.lineId);
        nextResults[row.row] = { state: "success" };
        ok += 1;
      } else {
        nextResults[row.row] = {
          state: "error",
          message: outcome.error,
        };
        failed += 1;
      }
      setResults({ ...nextResults });
    }

    setSubmitting(false);
    setSummary({ ok, failed, skipped });
    if (ok > 0) {
      toast.success(
        "支付回执已逐行提交",
        `成功 ${ok} 笔${failed > 0 ? ` · 失败 ${failed} 行` : ""}`,
      );
      onRefresh();
    }
  }

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      style={{ marginTop: 22 }}
    >
      <h3
        id={`${baseId}-heading`}
        style={{ fontSize: 14, fontWeight: 650, margin: "0 0 4px" }}
      >
        批量粘贴 / CSV 支付回执导入
      </h3>
      <p className="field__hint" style={{ marginBottom: 10 }}>
        表头需包含「流水号 / payment_ref」，以及「行ID」「人员ID」「工号」之一；
        金额缺省为应付金额且必须与应付一致；状态缺省 PAID。可从 Excel
        直接复制制表符分隔的数据。
      </p>
      <div className="form-grid">
        <FormField
          label="粘贴支付回执 CSV"
          className="field--full"
          hint="例如：流水号,工号,金额,状态,失败原因。逐行提交，失败行会保留原因供修正后重试。"
        >
          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setRows(null);
              setParseError(null);
              resetResults();
            }}
            rows={6}
            placeholder={
              "流水号,工号,金额,状态,贷方科目\nBANK-20261127-1,E002,5000,PAID,CASH"
            }
          />
        </FormField>
        <FormField
          label="选择 CSV 文件"
          className="field--full"
          hint="选择文件会填入上方文本框，不会自动提交。"
        >
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setText(await file.text());
              setRows(null);
              setParseError(null);
              resetResults();
            }}
          />
        </FormField>
      </div>
      <div className="form-actions" style={{ marginTop: 10 }}>
        <Button
          variant="secondary"
          onClick={handleParse}
          disabled={!text.trim() || submitting}
        >
          解析预览
        </Button>
        <Button
          variant="primary"
          onClick={() => void submitRows()}
          loading={submitting}
          disabled={!rows || pendingCount === 0}
        >
          逐行提交有效行
        </Button>
      </div>
      {parseError ? (
        <div role="alert" style={{ marginTop: 10 }}>
          <InfoNotice tone="warning">{parseError}</InfoNotice>
        </div>
      ) : null}
      {summary ? (
        <div role="status" aria-live="polite" style={{ marginTop: 10 }}>
          <InfoNotice tone={summary.failed > 0 ? "warning" : "success"}>
            逐行提交完成：成功 {summary.ok} 笔，失败 {summary.failed} 行
            {summary.skipped > 0
              ? `，跳过 ${summary.skipped} 行（此前已成功记录）`
              : ""}
            。
          </InfoNotice>
        </div>
      ) : null}
      {rows ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <caption className="sr-only">
              支付回执导入预览：共 {rows.length} 行，成功或失败结果逐行显示
            </caption>
            <thead>
              <tr>
                <th scope="col">CSV 行</th>
                <th scope="col">目标人员 / 行</th>
                <th scope="col">支付流水号</th>
                <th scope="col" className="cell-num">
                  金额
                </th>
                <th scope="col">状态</th>
                <th scope="col">结果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = results[row.row];
                return (
                  <tr key={row.row}>
                    <td className="mono">{row.row}</td>
                    <td>
                      {row.personName ?? shortId(row.personId)}
                      <span className="cell-sub mono">
                        {row.lineId ? `行 ${shortId(row.lineId)}` : "未匹配到行"}
                      </span>
                    </td>
                    <td className="mono">{row.paymentRef || "—"}</td>
                    <td className="cell-num mono">
                      {formatMoney(row.amount, row.currency)}
                    </td>
                    <td>{PAYMENT_STATUS_LABELS[row.status]}</td>
                    <td>
                      {row.error ? (
                        <span className="field__error" role="alert">
                          {row.error}
                        </span>
                      ) : result?.state === "success" ? (
                        <Badge tone="success" dot={false}>
                          已提交
                        </Badge>
                      ) : result?.state === "error" ? (
                        <span className="field__error" role="alert">
                          {result.message}
                        </span>
                      ) : (
                        <span className="field__hint">待提交</span>
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
