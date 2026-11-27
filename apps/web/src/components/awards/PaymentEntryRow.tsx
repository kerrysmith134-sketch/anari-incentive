import { Fragment, useId, useState } from "react";
import { Button, Select, TextInput } from "../ui.js";
import { useToast } from "../../contexts/ToastContext.js";
import {
  CREDIT_ACCOUNT_LABELS,
  PAYMENT_STATUS_LABELS,
  currentAccountingPeriod,
  decimalEquals,
  isValidAccountingPeriod,
  isValidPaymentAmount,
  type AwardCreditAccount,
  type AwardPaymentPayload,
  type AwardPaymentStatus,
  type AwardReconciliationLine,
  type SubmitOutcome,
} from "./types.js";

/**
 * 未付行的一行支付回执录入。
 * 每个字段都有真实 label（视觉隐藏，避免表格拥挤）与 aria-invalid，
 * 错误用 role="alert" 呈现；提交按钮原生键盘可达。
 */
export function PaymentEntryRow({
  line,
  personName,
  onSubmit,
  onRefresh,
}: {
  line: AwardReconciliationLine;
  personName: string;
  onSubmit: (payment: AwardPaymentPayload) => Promise<SubmitOutcome>;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const baseId = useId();
  const [paymentRef, setPaymentRef] = useState("");
  const [amount, setAmount] = useState(line.amount);
  const [status, setStatus] = useState<AwardPaymentStatus>("PAID");
  const [creditAccount, setCreditAccount] =
    useState<AwardCreditAccount>("CASH");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [accountingPeriod, setAccountingPeriod] = useState(
    currentAccountingPeriod(),
  );
  const [failureCode, setFailureCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const errorId = `${baseId}-error`;
  const successId = `${baseId}-success`;

  function invalid(name: string): true | undefined {
    return invalidFields.has(name) ? true : undefined;
  }

  function describedBy(name: string): string | undefined {
    return invalidFields.has(name) ? errorId : undefined;
  }

  async function submit(): Promise<void> {
    if (busy) return;
    setError(null);
    setSuccess(null);
    const issues: string[] = [];
    const invalidFieldNames = new Set<string>();
    const ref = paymentRef.trim();
    if (!ref) {
      issues.push("请填写支付流水号");
      invalidFieldNames.add("paymentRef");
    } else if (ref.length > 200) {
      issues.push("支付流水号最多 200 字");
      invalidFieldNames.add("paymentRef");
    }
    const rawAmount = amount.trim();
    if (!isValidPaymentAmount(rawAmount)) {
      issues.push("金额必须是大于 0、最多 6 位小数的十进制数");
      invalidFieldNames.add("amount");
    } else if (!decimalEquals(rawAmount, line.amount)) {
      issues.push(`金额必须等于应付金额 ${line.amount}`);
      invalidFieldNames.add("amount");
    }
    const entity = legalEntityId.trim();
    if (entity.length > 64) {
      issues.push("法人主体最多 64 字");
      invalidFieldNames.add("legalEntityId");
    }
    const period = accountingPeriod.trim();
    if (!period) {
      issues.push("请填写会计期间");
      invalidFieldNames.add("accountingPeriod");
    } else if (!isValidAccountingPeriod(period)) {
      issues.push("会计期间格式需为 YYYY-MM，例如 2026-11");
      invalidFieldNames.add("accountingPeriod");
    }
    const failure = failureCode.trim();
    if (failure.length > 100) {
      issues.push("失败/退回原因最多 100 字");
      invalidFieldNames.add("failureCode");
    }
    setInvalidFields(invalidFieldNames);
    if (issues.length > 0) {
      setError(issues.join("；"));
      return;
    }
    setBusy(true);
    const outcome = await onSubmit({
      lineId: line.lineId,
      paymentRef: ref,
      status,
      amount: rawAmount,
      currency: line.currency,
      creditAccount,
      legalEntityId: entity || undefined,
      accountingPeriod: period,
      failureCode: status === "PAID" ? undefined : failure || undefined,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setPaymentRef("");
    setSuccess(
      `已记录回执 ${ref}（${PAYMENT_STATUS_LABELS[status]}）${
        status === "PAID" ? "，已刷新对账。" : "，该行仍未支付。"
      }`,
    );
    toast.success(
      "支付回执已记录",
      `${personName} · ${ref} · ${PAYMENT_STATUS_LABELS[status]}`,
    );
    onRefresh();
  }

  return (
    <Fragment>
      <tr>
        <th scope="row" className="cell-primary" style={{ whiteSpace: "nowrap" }}>
          {personName}
          <span className="cell-sub mono">应付 {line.amount}</span>
        </th>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-ref`}>
            {personName} 的支付流水号
          </label>
          <TextInput
            id={`${baseId}-ref`}
            value={paymentRef}
            onChange={(event) => setPaymentRef(event.target.value)}
            placeholder="银行/内部流水号"
            style={{ minWidth: 150 }}
            aria-required="true"
            aria-invalid={invalid("paymentRef")}
            aria-describedby={describedBy("paymentRef")}
          />
        </td>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-amount`}>
            {personName} 的支付金额
          </label>
          <TextInput
            id={`${baseId}-amount`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            style={{ minWidth: 110 }}
            aria-required="true"
            aria-invalid={invalid("amount")}
            aria-describedby={describedBy("amount")}
          />
        </td>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-status`}>
            {personName} 的支付状态
          </label>
          <Select
            id={`${baseId}-status`}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AwardPaymentStatus)
            }
            style={{ minWidth: 120 }}
          >
            <option value="PAID">{PAYMENT_STATUS_LABELS.PAID}</option>
            <option value="FAILED">{PAYMENT_STATUS_LABELS.FAILED}</option>
            <option value="RETURNED">{PAYMENT_STATUS_LABELS.RETURNED}</option>
          </Select>
          {status !== "PAID" ? (
            <>
              <label className="sr-only" htmlFor={`${baseId}-failure`}>
                {personName} 的失败或退回原因
              </label>
              <TextInput
                id={`${baseId}-failure`}
                value={failureCode}
                onChange={(event) => setFailureCode(event.target.value)}
                placeholder="失败/退回原因（可选）"
                style={{ minWidth: 160, marginTop: 6 }}
                aria-invalid={invalid("failureCode")}
                aria-describedby={describedBy("failureCode")}
              />
            </>
          ) : null}
        </td>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-credit`}>
            {personName} 的贷方科目
          </label>
          <Select
            id={`${baseId}-credit`}
            value={creditAccount}
            onChange={(event) =>
              setCreditAccount(event.target.value as AwardCreditAccount)
            }
            style={{ minWidth: 150 }}
          >
            <option value="CASH">{CREDIT_ACCOUNT_LABELS.CASH}</option>
            <option value="PAYABLE">{CREDIT_ACCOUNT_LABELS.PAYABLE}</option>
          </Select>
        </td>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-entity`}>
            {personName} 的法人主体
          </label>
          <TextInput
            id={`${baseId}-entity`}
            value={legalEntityId}
            onChange={(event) => setLegalEntityId(event.target.value)}
            placeholder="缺省 DEFAULT"
            style={{ minWidth: 140 }}
            aria-invalid={invalid("legalEntityId")}
            aria-describedby={describedBy("legalEntityId")}
          />
        </td>
        <td>
          <label className="sr-only" htmlFor={`${baseId}-period`}>
            {personName} 的会计期间
          </label>
          <TextInput
            id={`${baseId}-period`}
            value={accountingPeriod}
            onChange={(event) => setAccountingPeriod(event.target.value)}
            placeholder="YYYY-MM"
            style={{ minWidth: 110 }}
            aria-required="true"
            aria-invalid={invalid("accountingPeriod")}
            aria-describedby={describedBy("accountingPeriod")}
          />
        </td>
        <td className="cell-actions">
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => void submit()}
            aria-label={`提交回执：${personName}`}
          >
            提交回执
          </Button>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} style={{ paddingTop: 0 }}>
            <span id={errorId} className="field__error" role="alert">
              {error}
            </span>
          </td>
        </tr>
      ) : null}
      {success ? (
        <tr>
          <td colSpan={8} style={{ paddingTop: 0 }}>
            <span id={successId} className="field__hint" role="status">
              {success}
            </span>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
