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
import type { PolicyVersionSummary } from "../../lib/types.js";

export interface RuleChangeModalProps {
  list: PolicyVersionSummary[];
  ruleChangeType: string;
  ruleEffectiveFrom: string;
  ruleError: string | null;
  ruleFromVersionId: string;
  ruleOpen: boolean;
  rulePolicyCode: string;
  ruleReason: string;
  ruleToVersionId: string;
  setRuleChangeType: Dispatch<SetStateAction<string>>;
  setRuleEffectiveFrom: Dispatch<SetStateAction<string>>;
  setRuleFromVersionId: Dispatch<SetStateAction<string>>;
  setRuleOpen: Dispatch<SetStateAction<boolean>>;
  setRulePolicyCode: Dispatch<SetStateAction<string>>;
  setRuleReason: Dispatch<SetStateAction<string>>;
  setRuleToVersionId: Dispatch<SetStateAction<string>>;
  submitRuleChange: () => void;
}

export function RuleChangeModal({
  list,
  ruleChangeType,
  ruleEffectiveFrom,
  ruleError,
  ruleFromVersionId,
  ruleOpen,
  rulePolicyCode,
  ruleReason,
  ruleToVersionId,
  setRuleChangeType,
  setRuleEffectiveFrom,
  setRuleFromVersionId,
  setRuleOpen,
  setRulePolicyCode,
  setRuleReason,
  setRuleToVersionId,
  submitRuleChange,
}: RuleChangeModalProps) {
  return (
    <Modal
      open={ruleOpen}
      title="新建规则变更单"
      description="规则变更经批准、测试并公示后方可生效。"
      onClose={() => setRuleOpen(false)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setRuleOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={submitRuleChange}>
            创建变更单
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {ruleError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{ruleError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="政策编码" htmlFor="rule-policy-code">
          <TextInput
            id="rule-policy-code"
            value={rulePolicyCode}
            onChange={(event) => setRulePolicyCode(event.target.value)}
            required
          />
        </FormField>
        <FormField label="变更类型" htmlFor="rule-change-type">
          <TextInput
            id="rule-change-type"
            value={ruleChangeType}
            onChange={(event) => setRuleChangeType(event.target.value)}
            placeholder="比例或上限"
            required
          />
        </FormField>
        <FormField label="来源版本（可选）" htmlFor="rule-from">
          <Select
            id="rule-from"
            value={ruleFromVersionId}
            onChange={(event) => setRuleFromVersionId(event.target.value)}
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
        <FormField label="目标版本" htmlFor="rule-to">
          <Select
            id="rule-to"
            value={ruleToVersionId}
            onChange={(event) => setRuleToVersionId(event.target.value)}
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
        <FormField label="生效自" htmlFor="rule-effective">
          <TextInput
            id="rule-effective"
            type="datetime-local"
            value={ruleEffectiveFrom}
            onChange={(event) => setRuleEffectiveFrom(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="原因"
          htmlFor="rule-reason"
          className="field--full"
        >
          <Textarea
            id="rule-reason"
            value={ruleReason}
            onChange={(event) => setRuleReason(event.target.value)}
            required
          />
        </FormField>
      </div>
    </Modal>
  );
}
