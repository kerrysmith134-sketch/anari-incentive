import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  FormField,
  InfoNotice,
  Modal,
  Select,
  TextInput,
  Textarea,
} from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import { titleCase } from "../../lib/format.js";
import type { PolicyVersionSummary } from "../../lib/types.js";
import type { EmployeeNoticeView } from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface EmployeeNoticeModalProps {
  list: PolicyVersionSummary[];
  noticeAckRequired: boolean;
  noticeBodyRef: string;
  noticeEffectiveFrom: string;
  noticeError: string | null;
  noticeOpen: boolean;
  noticePolicyVersionId: string;
  noticeTitle: string;
  noticeType: EmployeeNoticeView["noticeType"];
  setNoticeAckRequired: Dispatch<SetStateAction<boolean>>;
  setNoticeBodyRef: Dispatch<SetStateAction<string>>;
  setNoticeEffectiveFrom: Dispatch<SetStateAction<string>>;
  setNoticeOpen: Dispatch<SetStateAction<boolean>>;
  setNoticePolicyVersionId: Dispatch<SetStateAction<string>>;
  setNoticeTitle: Dispatch<SetStateAction<string>>;
  setNoticeType: Dispatch<SetStateAction<EmployeeNoticeView["noticeType"]>>;
  submitNotice: () => void;
}

export function EmployeeNoticeModal({
  list,
  noticeAckRequired,
  noticeBodyRef,
  noticeEffectiveFrom,
  noticeError,
  noticeOpen,
  noticePolicyVersionId,
  noticeTitle,
  noticeType,
  setNoticeAckRequired,
  setNoticeBodyRef,
  setNoticeEffectiveFrom,
  setNoticeOpen,
  setNoticePolicyVersionId,
  setNoticeTitle,
  setNoticeType,
  submitNotice,
}: EmployeeNoticeModalProps) {
  return (
    <Modal
      open={noticeOpen}
      title="发布员工告知"
      description="记录向员工告知的内容与生效时间。"
      onClose={() => setNoticeOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setNoticeOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitNotice}>
            发布
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {noticeError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{noticeError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="类型" htmlFor="notice-type">
          <Select
            id="notice-type"
            value={noticeType}
            onChange={(event) =>
              setNoticeType(event.target.value as EmployeeNoticeView["noticeType"])
            }
          >
            {["POLICY", "PAY_PLAN", "AI_USE", "DATA_PROCESSING", "OTHER"].map(
              (type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ),
            )}
          </Select>
        </FormField>
        <FormField label="标题" htmlFor="notice-title">
          <TextInput
            id="notice-title"
            value={noticeTitle}
            onChange={(event) => setNoticeTitle(event.target.value)}
            required
          />
        </FormField>
        <FormField label="机构引用" htmlFor="notice-body">
          <TextInput
            id="notice-body"
            value={noticeBodyRef}
            onChange={(event) => setNoticeBodyRef(event.target.value)}
            placeholder="内部文档引用"
            required
          />
        </FormField>
        <FormField label="政策版本（可选）" htmlFor="notice-policy">
          <Select
            id="notice-policy"
            value={noticePolicyVersionId}
            onChange={(event) => setNoticePolicyVersionId(event.target.value)}
          >
            <option value="">无</option>
            {list.map((version) => (
              <option
                key={version.policyVersionId}
                value={version.policyVersionId}
              >
                {version.code} v{version.version}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="生效自" htmlFor="notice-effective">
          <TextInput
            id="notice-effective"
            type="datetime-local"
            value={noticeEffectiveFrom}
            onChange={(event) => setNoticeEffectiveFrom(event.target.value)}
            required
          />
        </FormField>
        <label className="checkbox field--full">
          <input
            type="checkbox"
            checked={noticeAckRequired}
            onChange={(event) => setNoticeAckRequired(event.target.checked)}
          />
          <span>员工必须签收本告知。</span>
        </label>
      </div>
    </Modal>
  );
}

export interface AcknowledgementModalProps {
  ackDecision: "ACKNOWLEDGE" | "DECLINE";
  ackDeclineReason: string;
  ackError: string | null;
  ackOpen: EmployeeNoticeView | null;
  ackPerson: string;
  ackSignatureRef: string;
  setAckDecision: Dispatch<SetStateAction<"ACKNOWLEDGE" | "DECLINE">>;
  setAckDeclineReason: Dispatch<SetStateAction<string>>;
  setAckOpen: Dispatch<SetStateAction<EmployeeNoticeView | null>>;
  setAckPerson: Dispatch<SetStateAction<string>>;
  setAckSignatureRef: Dispatch<SetStateAction<string>>;
  submitAck: () => void;
}

export function AcknowledgementModal({
  ackDecision,
  ackDeclineReason,
  ackError,
  ackOpen,
  ackPerson,
  ackSignatureRef,
  setAckDecision,
  setAckDeclineReason,
  setAckOpen,
  setAckPerson,
  setAckSignatureRef,
  submitAck,
}: AcknowledgementModalProps) {
  return (
    <Modal
      open={Boolean(ackOpen)}
      title="记录告知反馈"
      description={ackOpen?.title}
      onClose={() => setAckOpen(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setAckOpen(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitAck}>
            记录
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {ackError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{ackError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="人员" htmlFor="ack-person">
          <PersonSelect id="ack-person" value={ackPerson} onChange={setAckPerson} />
        </FormField>
        <FormField label="决策" htmlFor="ack-decision">
          <Select
            id="ack-decision"
            value={ackDecision}
            onChange={(event) =>
              setAckDecision(
                event.target.value as "ACKNOWLEDGE" | "DECLINE",
              )
            }
          >
            <option value="ACKNOWLEDGE">签收</option>
            <option value="DECLINE">婉拒</option>
          </Select>
        </FormField>
        <FormField label="签名引用（可选）" htmlFor="ack-signature">
          <TextInput
            id="ack-signature"
            value={ackSignatureRef}
            onChange={(event) => setAckSignatureRef(event.target.value)}
          />
        </FormField>
        {ackDecision === "DECLINE" ? (
          <FormField
            label="婉拒原因"
            htmlFor="ack-decline-reason"
            className="field--full"
          >
            <Textarea
              id="ack-decline-reason"
              value={ackDeclineReason}
              onChange={(event) => setAckDeclineReason(event.target.value)}
              required
            />
          </FormField>
        ) : null}
      </div>
    </Modal>
  );
}

export interface NoticeLinkModalProps {
  linkError: string | null;
  linkNotice: () => void;
  linkNoticeId: string;
  linkOpen: boolean;
  linkPolicyVersionId: string;
  list: PolicyVersionSummary[];
  notices: QueryState<EmployeeNoticeView[]>;
  setLinkNoticeId: Dispatch<SetStateAction<string>>;
  setLinkOpen: Dispatch<SetStateAction<boolean>>;
  setLinkPolicyVersionId: Dispatch<SetStateAction<string>>;
}

export function NoticeLinkModal({
  linkError,
  linkNotice,
  linkNoticeId,
  linkOpen,
  linkPolicyVersionId,
  list,
  notices,
  setLinkNoticeId,
  setLinkOpen,
  setLinkPolicyVersionId,
}: NoticeLinkModalProps) {
  return (
    <Modal
      open={linkOpen}
      title="将告知关联到政策版本"
      onClose={() => setLinkOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setLinkOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={linkNotice}>
            关联
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {linkError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{linkError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="政策版本" htmlFor="link-policy">
          <Select
            id="link-policy"
            value={linkPolicyVersionId}
            onChange={(event) => setLinkPolicyVersionId(event.target.value)}
            required
          >
            <option value="">选择版本…</option>
            {list.map((version) => (
              <option
                key={version.policyVersionId}
                value={version.policyVersionId}
              >
                {version.code} v{version.version}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="通知" htmlFor="link-notice">
          <Select
            id="link-notice"
            value={linkNoticeId}
            onChange={(event) => setLinkNoticeId(event.target.value)}
            required
          >
            <option value="">选择告知…</option>
            {(notices.data ?? []).map((notice) => (
              <option key={notice.id} value={notice.id}>
                {notice.title}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </Modal>
  );
}
