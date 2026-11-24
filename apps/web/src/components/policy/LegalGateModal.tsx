import type { Dispatch, SetStateAction } from "react";
import { Button, FormField, InfoNotice, Modal, TextInput } from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import type { PolicyVersionSummary } from "../../lib/types.js";

export interface LegalGateModalProps {
  democraticRef: string;
  dpiaRef: string;
  gateApprovalId: string;
  gateError: string | null;
  gateOpen: boolean;
  gateSubmitting: boolean;
  minimumWageChecked: boolean;
  noticeRef: string;
  policyApproved: boolean;
  recordGate: () => void;
  recordedBy: string;
  selected: PolicyVersionSummary | undefined;
  setDemocraticRef: Dispatch<SetStateAction<string>>;
  setDpiaRef: Dispatch<SetStateAction<string>>;
  setGateApprovalId: Dispatch<SetStateAction<string>>;
  setGateOpen: Dispatch<SetStateAction<boolean>>;
  setMinimumWageChecked: Dispatch<SetStateAction<boolean>>;
  setNoticeRef: Dispatch<SetStateAction<string>>;
  setPolicyApproved: Dispatch<SetStateAction<boolean>>;
  setRecordedBy: Dispatch<SetStateAction<string>>;
}

export function LegalGateModal({
  democraticRef,
  dpiaRef,
  gateApprovalId,
  gateError,
  gateOpen,
  gateSubmitting,
  minimumWageChecked,
  noticeRef,
  policyApproved,
  recordGate,
  recordedBy,
  selected,
  setDemocraticRef,
  setDpiaRef,
  setGateApprovalId,
  setGateOpen,
  setMinimumWageChecked,
  setNoticeRef,
  setPolicyApproved,
  setRecordedBy,
}: LegalGateModalProps) {
  return (
    <Modal
      open={gateOpen}
      title="记录法律门禁"
      description={
        selected
          ? `${selected.code} v${selected.version} · this is assurance evidence, not a legal opinion.`
          : undefined
      }
      onClose={() => setGateOpen(false)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setGateOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={recordGate}
            loading={gateSubmitting}
          >
            记录门禁
          </Button>
        </>
      }
    >
      <div className="stack">
        {gateError ? (
          <InfoNotice tone="warning">{gateError}</InfoNotice>
        ) : null}
        <div className="notice notice--warning">
          The legal gate records the controls you confirmed. Referencing a
          notice, consultation or DPIA by id triggers server-side coverage
          checks; free-text references are retained as evidence only.
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={policyApproved}
            onChange={(event) => setPolicyApproved(event.target.checked)}
          />
          <span>政策内容已经授权机构批准。</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={minimumWageChecked}
            onChange={(event) =>
              setMinimumWageChecked(event.target.checked)
            }
          />
          <span>已核对最低工资与薪酬处理。</span>
        </label>
        <div className="form-grid">
          <FormField
            label="民主程序引用"
            htmlFor="gate-democratic"
          >
            <TextInput
              id="gate-democratic"
              value={democraticRef}
              onChange={(event) => setDemocraticRef(event.target.value)}
              placeholder="咨询纪要/决议 ID"
            />
          </FormField>
          <FormField
            label="员工告知引用"
            htmlFor="gate-notice"
          >
            <TextInput
              id="gate-notice"
              value={noticeRef}
              onChange={(event) => setNoticeRef(event.target.value)}
              placeholder="告知引用"
            />
          </FormField>
          <FormField
            label="DPIA 引用"
            htmlFor="gate-dpia"
          >
            <TextInput
              id="gate-dpia"
              value={dpiaRef}
              onChange={(event) => setDpiaRef(event.target.value)}
              placeholder="评估引用"
            />
          </FormField>
          <FormField label="记录人" htmlFor="gate-recorder">
            <PersonSelect
              id="gate-recorder"
              value={recordedBy}
              onChange={setRecordedBy}
            />
          </FormField>
          <FormField
            label="审批请求 ID（可选）"
            htmlFor="gate-approval"
            className="field--full"
            hint="仅当 LEGAL_GATE 配置为需审批时必填。"
          >
            <TextInput
              id="gate-approval"
              value={gateApprovalId}
              onChange={(event) => setGateApprovalId(event.target.value)}
            />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
