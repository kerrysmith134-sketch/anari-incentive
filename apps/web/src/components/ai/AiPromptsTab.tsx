/**
 * AI 保障 · 提示词登记簿 tab：提示词列表、详情、登记与激活模态。
 * 查询由页面容器持有（props 传入）；表单与详情状态自持。
 */
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  DefinitionList,
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
import { Icon } from "../Icon.js";
import { useToast } from "../../contexts/ToastContext.js";
import { ApiError, api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";
import { formatRelative, shortId } from "../../lib/format.js";
import type { ModelPrompt } from "../../lib/types.js";

export function AiPromptsTab({
  prompts,
}: {
  prompts: QueryState<ModelPrompt[]>;
}) {
  const toast = useToast();
  const [promptDetail, setPromptDetail] = useState<ModelPrompt | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptCode, setPromptCode] = useState("");
  const [promptVersion, setPromptVersion] = useState("1");
  const [promptPurpose, setPromptPurpose] = useState("");
  const [promptProvider, setPromptProvider] = useState("openai");
  const [promptModel, setPromptModel] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [activateTarget, setActivateTarget] = useState<ModelPrompt | null>(null);
  const [activateRunId, setActivateRunId] = useState("");
  const [activateError, setActivateError] = useState<string | null>(null);

  const promptList = prompts.data ?? [];

  async function createPrompt(event: FormEvent) {
    event.preventDefault();
    setPromptError(null);
    try {
      await api("/api/v1/model-prompts", {
        method: "POST",
        body: {
          promptCode: promptCode.trim(),
          version: Number(promptVersion),
          purpose: promptPurpose.trim(),
          modelProvider: promptProvider.trim(),
          modelName: promptModel.trim(),
          template: promptTemplate,
        },
      });
      toast.success("提示词已登记", promptCode.trim());
      setPromptOpen(false);
      prompts.reload();
    } catch (caught) {
      setPromptError(
        caught instanceof ApiError ? caught.message : "登记提示词失败",
      );
    }
  }

  async function activatePrompt(event: FormEvent) {
    event.preventDefault();
    if (!activateTarget) return;
    setActivateError(null);
    try {
      await api(`/api/v1/model-prompts/${activateTarget.id}/activate`, {
        method: "POST",
        body: { evaluationRunId: activateRunId.trim() },
      });
      toast.success("提示词已激活", activateTarget.promptCode);
      setActivateTarget(null);
      prompts.reload();
    } catch (caught) {
      setActivateError(
        caught instanceof ApiError ? caught.message : "激活失败",
      );
    }
  }

  async function retirePrompt(prompt: ModelPrompt) {
    try {
      await api(`/api/v1/model-prompts/${prompt.id}/retire`, {
        method: "POST",
      });
      toast.success("提示词已退役", prompt.promptCode);
      prompts.reload();
    } catch (caught) {
      toast.error(
        "退役失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    }
  }

  return (
    <>
      <Panel
        title="提示词登记簿"
        subtitle="提示词仅在评测通过后激活"
        action={
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setPromptOpen(true)}>
            登记提示词
          </Button>
        }
        flush
      >
        {prompts.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={prompts.error} onRetry={prompts.reload} />
          </div>
        ) : prompts.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : promptList.length === 0 ? (
          <EmptyState
            icon="policy"
            title="暂无提示词"
            description="登记提示词版本→运行评测→激活；评分提案只能引用已激活提示词。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>提示词</th>
                  <th>用途</th>
                  <th>模型</th>
                  <th>模板哈希</th>
                  <th>状态</th>
                  <th>已激活</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {promptList.map((prompt) => (
                  <tr key={prompt.id}>
                    <td>
                      <span className="cell-primary">{prompt.promptCode}</span>
                      <span className="cell-sub">v{prompt.version}</span>
                    </td>
                    <td>{prompt.purpose}</td>
                    <td>
                      <span>{prompt.modelName}</span>
                      <span className="cell-sub">{prompt.modelProvider}</span>
                    </td>
                    <td>
                      <span className="chip mono">
                        {shortId(prompt.templateHash, 10)}
                      </span>
                    </td>
                    <td>
                      <Badge status={prompt.status} />
                    </td>
                    <td className="nowrap">
                      {prompt.activatedAt
                        ? formatRelative(prompt.activatedAt)
                        : "—"}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPromptDetail(prompt)}
                        >
                          查看
                        </Button>
                        {prompt.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setActivateTarget(prompt);
                              setActivateRunId("");
                              setActivateError(null);
                            }}
                          >
                            激活
                          </Button>
                        ) : null}
                        {prompt.status !== "RETIRED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void retirePrompt(prompt)}
                          >
                            退役
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(promptDetail)}
        title={promptDetail ? `Prompt ${promptDetail.promptCode}` : "提示词"}
        description={promptDetail?.purpose}
        onClose={() => setPromptDetail(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setPromptDetail(null)}>
            关闭
          </Button>
        }
      >
        {promptDetail ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "模型",
                  value: `${promptDetail.modelProvider} · ${promptDetail.modelName}`,
                },
                { label: "版本", value: `v${promptDetail.version}` },
                { label: "状态", value: <Badge status={promptDetail.status} /> },
                {
                  label: "模板哈希",
                  value: <span className="mono">{promptDetail.templateHash}</span>,
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">模板</div>
              <pre className="code-block">{promptDetail.template}</pre>
            </div>
            <InfoNotice>
              <Icon name="shield" size={15} /> Prompt activation is gated by a
              passed model evaluation. Existing proposals keep their original
              prompt version.
            </InfoNotice>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={promptOpen}
        title="登记提示词版本"
        onClose={() => setPromptOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromptOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="prompt-form">
              登记
            </Button>
          </>
        }
      >
        <form id="prompt-form" onSubmit={createPrompt} className="form-grid">
          {promptError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{promptError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="提示词编码">
            <TextInput value={promptCode} onChange={(event) => setPromptCode(event.target.value)} required />
          </FormField>
          <FormField label="版本号">
            <TextInput value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} required />
          </FormField>
          <FormField label="用途">
            <TextInput value={promptPurpose} onChange={(event) => setPromptPurpose(event.target.value)} required />
          </FormField>
          <FormField label="模型供应商">
            <TextInput value={promptProvider} onChange={(event) => setPromptProvider(event.target.value)} required />
          </FormField>
          <FormField label="模型名称">
            <TextInput value={promptModel} onChange={(event) => setPromptModel(event.target.value)} required />
          </FormField>
          <FormField label="提示词模板" className="field--full">
            <Textarea rows={8} value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} required />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(activateTarget)}
        title={`激活提示词 · ${activateTarget?.promptCode ?? ""}`}
        onClose={() => setActivateTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActivateTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="prompt-activate-form">
              激活
            </Button>
          </>
        }
      >
        <form id="prompt-activate-form" onSubmit={activatePrompt} className="form-grid">
          {activateError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{activateError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="通过的评测运行 ID"
            className="field--full"
            hint="只能引用评测通过的运行；未通过评测的提示词不能激活"
          >
            <TextInput
              value={activateRunId}
              onChange={(event) => setActivateRunId(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
