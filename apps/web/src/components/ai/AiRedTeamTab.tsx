/**
 * AI 保障 · 红队 tab：红队运行列表与记录运行模态。
 * 查询由页面容器持有（props 传入）；表单状态自持。
 */
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Panel,
  Textarea,
  TextInput,
} from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";
import type { ModelRedTeamRun } from "../../lib/types.js";

export function AiRedTeamTab({
  redTeam,
  personId,
}: {
  redTeam: QueryState<ModelRedTeamRun[]>;
  personId: string;
}) {
  const toast = useToast();
  const [redTeamOpen, setRedTeamOpen] = useState(false);
  const [redTeamSaving, setRedTeamSaving] = useState(false);
  const [redTeamError, setRedTeamError] = useState<string | null>(null);
  const [redTeamProvider, setRedTeamProvider] = useState("anthropic");
  const [redTeamModel, setRedTeamModel] = useState("claude");
  const [redTeamVersion, setRedTeamVersion] = useState("v1");
  const [redTeamScope, setRedTeamScope] = useState(
    "提示注入与数据外泄",
  );
  const [redTeamTests, setRedTeamTests] = useState("10");
  const [redTeamPassed, setRedTeamPassed] = useState(true);
  const [redTeamFindings, setRedTeamFindings] = useState("");
  const [redTeamArtifact, setRedTeamArtifact] = useState("");
  const [redTeamCreator, setRedTeamCreator] = useState(personId);

  function openRedTeamForm() {
    setRedTeamProvider("anthropic");
    setRedTeamModel("claude");
    setRedTeamVersion("v1");
    setRedTeamScope("提示注入与数据外泄");
    setRedTeamTests("10");
    setRedTeamPassed(true);
    setRedTeamFindings("");
    setRedTeamArtifact("");
    setRedTeamCreator(personId);
    setRedTeamError(null);
    setRedTeamOpen(true);
  }

  async function saveRedTeam(event: FormEvent) {
    event.preventDefault();
    setRedTeamSaving(true);
    setRedTeamError(null);
    try {
      await api("/api/v1/model-red-team-runs", {
        method: "POST",
        body: {
          modelProvider: redTeamProvider.trim(),
          modelName: redTeamModel.trim(),
          promptVersion: redTeamVersion.trim(),
          scope: redTeamScope.trim(),
          testsRun: Number(redTeamTests),
          passed: redTeamPassed,
          findings: redTeamFindings
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          artifactRef: redTeamArtifact.trim() || undefined,
          createdBy: redTeamCreator,
        },
      });
      toast.success("红队演练已记录");
      setRedTeamOpen(false);
      redTeam.reload();
    } catch (error) {
      setRedTeamError(
        error instanceof Error
          ? error.message
          : "无法记录红队运行。",
      );
    } finally {
      setRedTeamSaving(false);
    }
  }

  return (
    <>
      <Panel
        title="红队运行"
        subtitle="租户启用后，激活提示词前必须提供对抗测试证据"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openRedTeamForm}
          >
            记录运行
          </Button>
        }
        flush
      >
        {redTeam.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={redTeam.error} onRetry={redTeam.reload} />
          </div>
        ) : redTeam.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (redTeam.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="暂无红队运行"
            description="启用强制时，激活提示词前必须记录注入与外泄测试。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>版本</th>
                  <th>范围</th>
                  <th className="cell-num">测试</th>
                  <th>结果</th>
                  <th>发现</th>
                  <th>产物</th>
                </tr>
              </thead>
              <tbody>
                {redTeam.data?.map((run) => (
                  <tr key={run.id}>
                    <td>
                      {run.modelName}
                      <span className="cell-sub">{run.modelProvider}</span>
                    </td>
                    <td className="mono">{run.promptVersion}</td>
                    <td>{run.scope}</td>
                    <td className="cell-num">{run.testsRun}</td>
                    <td>
                      <Badge tone={run.passed ? "success" : "danger"}>
                        {run.passed ? "通过" : "发现"}
                      </Badge>
                    </td>
                    <td>
                      {run.findings.length === 0
                        ? "—"
                        : run.findings.join("; ")}
                    </td>
                    <td className="mono">
                      {run.artifactRef ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={redTeamOpen}
        title="记录红队运行"
        description="失败的运行必须列出发现。"
        onClose={() => setRedTeamOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedTeamOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="red-team-form"
              loading={redTeamSaving}
            >
              记录运行
            </Button>
          </>
        }
      >
        <form id="red-team-form" className="stack" onSubmit={saveRedTeam}>
          {redTeamError ? (
            <InfoNotice tone="warning">{redTeamError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="供应商" htmlFor="red-team-provider">
              <TextInput
                id="red-team-provider"
                value={redTeamProvider}
                onChange={(event) => setRedTeamProvider(event.target.value)}
                required
              />
            </FormField>
            <FormField label="模型" htmlFor="red-team-model">
              <TextInput
                id="red-team-model"
                value={redTeamModel}
                onChange={(event) => setRedTeamModel(event.target.value)}
                required
              />
            </FormField>
            <FormField label="提示词版本" htmlFor="red-team-version">
              <TextInput
                id="red-team-version"
                value={redTeamVersion}
                onChange={(event) => setRedTeamVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="已运行测试" htmlFor="red-team-tests">
              <TextInput
                id="red-team-tests"
                type="number"
                min={1}
                value={redTeamTests}
                onChange={(event) => setRedTeamTests(event.target.value)}
                required
              />
            </FormField>
            <FormField label="创建人" htmlFor="red-team-creator">
              <PersonSelect
                id="red-team-creator"
                value={redTeamCreator}
                onChange={setRedTeamCreator}
              />
            </FormField>
            <FormField label="产物引用" htmlFor="red-team-artifact">
              <TextInput
                id="red-team-artifact"
                value={redTeamArtifact}
                onChange={(event) => setRedTeamArtifact(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="范围" htmlFor="red-team-scope">
            <TextInput
              id="red-team-scope"
              value={redTeamScope}
              onChange={(event) => setRedTeamScope(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={redTeamPassed}
              onChange={(event) => setRedTeamPassed(event.target.checked)}
            />
            <span>红队运行通过，无未解决发现。</span>
          </label>
          <FormField
            label="发现（每行一条）"
            htmlFor="red-team-findings"
          >
            <Textarea
              id="red-team-findings"
              value={redTeamFindings}
              onChange={(event) => setRedTeamFindings(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
