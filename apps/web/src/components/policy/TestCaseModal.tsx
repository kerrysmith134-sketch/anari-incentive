import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  Button,
  FormField,
  InfoNotice,
  Modal,
  Select,
  TextInput,
  Textarea,
} from "../ui.js";

export interface TestCaseModalProps {
  createTestCase: (event: FormEvent) => void;
  setTestCategory: Dispatch<SetStateAction<string>>;
  setTestCode: Dispatch<SetStateAction<string>>;
  setTestExpected: Dispatch<SetStateAction<string>>;
  setTestInput: Dispatch<SetStateAction<string>>;
  setTestOpen: Dispatch<SetStateAction<boolean>>;
  testCategory: string;
  testCode: string;
  testError: string | null;
  testExpected: string;
  testInput: string;
  testOpen: boolean;
}

export function TestCaseModal({
  createTestCase,
  setTestCategory,
  setTestCode,
  setTestExpected,
  setTestInput,
  setTestOpen,
  testCategory,
  testCode,
  testError,
  testExpected,
  testInput,
  testOpen,
}: TestCaseModalProps) {
  return (
    <Modal
      open={testOpen}
      title="新建回归用例"
      onClose={() => setTestOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setTestOpen(false)}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="test-case-form">
            创建
          </Button>
        </>
      }
    >
      <form id="test-case-form" onSubmit={createTestCase} className="form-grid">
        {testError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{testError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="用例编码">
          <TextInput
            value={testCode}
            onChange={(event) => setTestCode(event.target.value)}
            required
          />
        </FormField>
        <FormField label="类别">
          <Select
            value={testCategory}
            onChange={(event) => setTestCategory(event.target.value)}
          >
            <option value="NORMAL">正常</option>
            <option value="BOUNDARY">边界</option>
            <option value="EXCEPTION">异常</option>
            <option value="HISTORICAL">历史回放</option>
          </Select>
        </FormField>
        <FormField label="输入 JSON" className="field--full">
          <Textarea
            rows={6}
            value={testInput}
            onChange={(event) => setTestInput(event.target.value)}
          />
        </FormField>
        <FormField label="期望输出 JSON" className="field--full">
          <Textarea
            rows={6}
            value={testExpected}
            onChange={(event) => setTestExpected(event.target.value)}
          />
        </FormField>
      </form>
    </Modal>
  );
}
