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
import { titleCase } from "../../lib/format.js";
import type { PolicyVersionSummary } from "../../lib/types.js";
import type {
  EmployeeRepresentationView,
  PolicyConsultationView,
} from "../../lib/ops-types.js";

export interface RepresentationModalProps {
  repError: string | null;
  repJurisdiction: string;
  repName: string;
  repOpen: boolean;
  repType: EmployeeRepresentationView["bodyType"];
  setRepJurisdiction: Dispatch<SetStateAction<string>>;
  setRepName: Dispatch<SetStateAction<string>>;
  setRepOpen: Dispatch<SetStateAction<boolean>>;
  setRepType: Dispatch<SetStateAction<EmployeeRepresentationView["bodyType"]>>;
  submitRepresentation: () => void;
}

export function RepresentationModal({
  repError,
  repJurisdiction,
  repName,
  repOpen,
  repType,
  setRepJurisdiction,
  setRepName,
  setRepOpen,
  setRepType,
  submitRepresentation,
}: RepresentationModalProps) {
  return (
    <Modal
      open={repOpen}
      title="添加员工代表"
      description="政策变更咨询的机构。"
      onClose={() => setRepOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setRepOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitRepresentation}>
            添加
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {repError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{repError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="机构名称" htmlFor="rep-name">
          <TextInput
            id="rep-name"
            value={repName}
            onChange={(event) => setRepName(event.target.value)}
            required
          />
        </FormField>
        <FormField label="机构类型" htmlFor="rep-type">
          <Select
            id="rep-type"
            value={repType}
            onChange={(event) =>
              setRepType(
                event.target.value as EmployeeRepresentationView["bodyType"],
              )
            }
          >
            {["WORKS_COUNCIL", "UNION", "EMPLOYEE_REP", "ALL_EMPLOYEES"].map(
              (type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ),
            )}
          </Select>
        </FormField>
        <FormField label="法域" htmlFor="rep-jurisdiction">
          <TextInput
            id="rep-jurisdiction"
            value={repJurisdiction}
            onChange={(event) => setRepJurisdiction(event.target.value)}
            placeholder="CN"
            required
          />
        </FormField>
      </div>
    </Modal>
  );
}

export interface ConsultationModalProps {
  consultError: string | null;
  consultFeedback: string;
  consultMinutesRef: string;
  consultOpen: boolean;
  consultPolicyVersionId: string;
  consultRepresentationId: string;
  consultStartedAt: string;
  consultType: PolicyConsultationView["consultationType"];
  list: PolicyVersionSummary[];
  setConsultFeedback: Dispatch<SetStateAction<string>>;
  setConsultMinutesRef: Dispatch<SetStateAction<string>>;
  setConsultOpen: Dispatch<SetStateAction<boolean>>;
  setConsultPolicyVersionId: Dispatch<SetStateAction<string>>;
  setConsultRepresentationId: Dispatch<SetStateAction<string>>;
  setConsultStartedAt: Dispatch<SetStateAction<string>>;
  setConsultType: Dispatch<SetStateAction<PolicyConsultationView["consultationType"]>>;
  submitConsultation: () => void;
}

export function ConsultationModal({
  consultError,
  consultFeedback,
  consultMinutesRef,
  consultOpen,
  consultPolicyVersionId,
  consultRepresentationId,
  consultStartedAt,
  consultType,
  list,
  setConsultFeedback,
  setConsultMinutesRef,
  setConsultOpen,
  setConsultPolicyVersionId,
  setConsultRepresentationId,
  setConsultStartedAt,
  setConsultType,
  submitConsultation,
}: ConsultationModalProps) {
  return (
    <Modal
      open={consultOpen}
      title="记录政策咨询"
      onClose={() => setConsultOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setConsultOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitConsultation}>
            记录
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {consultError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{consultError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="政策版本" htmlFor="consult-policy">
          <Select
            id="consult-policy"
            value={consultPolicyVersionId}
            onChange={(event) => setConsultPolicyVersionId(event.target.value)}
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
        <FormField label="类型" htmlFor="consult-type">
          <Select
            id="consult-type"
            value={consultType}
            onChange={(event) =>
              setConsultType(
                event.target.value as PolicyConsultationView["consultationType"],
              )
            }
          >
            {["DISCUSSION", "COMMENT_PERIOD", "NEGOTIATION", "INFORMATION"].map(
              (type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ),
            )}
          </Select>
        </FormField>
        <FormField label="代表机构 ID（可选）" htmlFor="consult-rep">
          <TextInput
            id="consult-rep"
            value={consultRepresentationId}
            onChange={(event) => setConsultRepresentationId(event.target.value)}
            placeholder="UUID"
          />
        </FormField>
        <FormField label="开始时间" htmlFor="consult-start">
          <TextInput
            id="consult-start"
            type="datetime-local"
            value={consultStartedAt}
            onChange={(event) => setConsultStartedAt(event.target.value)}
            required
          />
        </FormField>
        <FormField label="会议纪要引用" htmlFor="consult-minutes">
          <TextInput
            id="consult-minutes"
            value={consultMinutesRef}
            onChange={(event) => setConsultMinutesRef(event.target.value)}
          />
        </FormField>
        <FormField
          label="意见汇总"
          htmlFor="consult-feedback"
          className="field--full"
        >
          <Textarea
            id="consult-feedback"
            value={consultFeedback}
            onChange={(event) => setConsultFeedback(event.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  );
}

export interface ConsultationConcludeModalProps {
  concludeError: string | null;
  concludeFeedback: string;
  concludeMinutesRef: string;
  concludeOutcome: "AGREED" | "NO_AGREEMENT" | "INFORMATION_ONLY" | "CLOSED";
  concludeTarget: PolicyConsultationView | null;
  setConcludeFeedback: Dispatch<SetStateAction<string>>;
  setConcludeMinutesRef: Dispatch<SetStateAction<string>>;
  setConcludeOutcome: Dispatch<SetStateAction<"AGREED" | "NO_AGREEMENT" | "INFORMATION_ONLY" | "CLOSED">>;
  setConcludeTarget: Dispatch<SetStateAction<PolicyConsultationView | null>>;
  submitConclude: () => void;
}

export function ConsultationConcludeModal({
  concludeError,
  concludeFeedback,
  concludeMinutesRef,
  concludeOutcome,
  concludeTarget,
  setConcludeFeedback,
  setConcludeMinutesRef,
  setConcludeOutcome,
  setConcludeTarget,
  submitConclude,
}: ConsultationConcludeModalProps) {
  return (
    <Modal
      open={Boolean(concludeTarget)}
      title="结论咨询"
      onClose={() => setConcludeTarget(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setConcludeTarget(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitConclude}>
            结论
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {concludeError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{concludeError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="结论" htmlFor="conclude-outcome">
          <Select
            id="conclude-outcome"
            value={concludeOutcome}
            onChange={(event) =>
              setConcludeOutcome(
                event.target.value as
                  | "AGREED"
                  | "NO_AGREEMENT"
                  | "INFORMATION_ONLY"
                  | "CLOSED",
              )
            }
          >
            {["AGREED", "NO_AGREEMENT", "INFORMATION_ONLY", "CLOSED"].map(
              (outcome) => (
                <option key={outcome} value={outcome}>
                  {titleCase(outcome)}
                </option>
              ),
            )}
          </Select>
        </FormField>
        <FormField label="会议纪要引用" htmlFor="conclude-minutes">
          <TextInput
            id="conclude-minutes"
            value={concludeMinutesRef}
            onChange={(event) => setConcludeMinutesRef(event.target.value)}
          />
        </FormField>
        <FormField
          label="意见汇总"
          htmlFor="conclude-feedback"
          className="field--full"
        >
          <Textarea
            id="conclude-feedback"
            value={concludeFeedback}
            onChange={(event) => setConcludeFeedback(event.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  );
}
