/**
 * NP-028（2026-11-21 审计）：集成连接向导——免 JSON 的四步引导。
 *
 * 1. 供应商与预设（结构化字段，无自由 JSON）
 * 2. 连接（凭据引用——绝不保存密钥本体）
 * 3. 映射预览（按预设展开 fieldMap 表格）
 * 4. 创建 + 样例探测（testConnection 返回样例与诊断，脱敏）
 * 完成后展示身份解析入口提示（NP-008：外部对象 → 内部对象）。
 */
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  FormField,
  InfoNotice,
  Modal,
  Select,
  TextInput,
} from "../components/ui.js";
import { api, ApiError } from "../lib/api.js";
import { useToast } from "../contexts/ToastContext.js";

export interface WizardPreset {
  code: string;
  provider?: string;
  name: string;
  mappingType?: string;
  sourceSystem?: string;
  targetType?: string;
  fieldMap: Record<string, string>;
  config?: Record<string, unknown>;
}

/** 按 provider 的结构化配置字段（不接受自由 JSON）。 */
const PROVIDER_FIELDS: Record<
  string,
  Array<{ key: string; label: string; placeholder: string; hint?: string }>
> = {
  hubspot: [
    { key: "portalId", label: "HubSpot Portal ID", placeholder: "24123456" },
    { key: "url", label: "API 基址", placeholder: "https://api.hubapi.com" },
  ],
  feishu: [
    { key: "appToken", label: "多维表格 App Token", placeholder: "bascn…" },
    { key: "url", label: "API 基址", placeholder: "https://open.feishu.cn" },
  ],
  erp: [
    { key: "url", label: "API 基址", placeholder: "https://erp.example.com/api" },
    { key: "probePath", label: "探测路径", placeholder: "/orders", hint: "testConnection 将真实读取该端点" },
  ],
  generic: [
    { key: "url", label: "API 基址", placeholder: "https://provider.example/api", },
    { key: "recordsPath", label: "记录路径", placeholder: "records", hint: "响应里数组所在点路径" },
    { key: "probePath", label: "探测路径", placeholder: "/orders", hint: "testConnection 将真实读取该端点" },
  ],
};

interface TestOutcome {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  sample?: unknown;
  testedAt?: string;
}

export function IntegrationWizard({
  open,
  presets,
  onClose,
  onCreated,
}: {
  open: boolean;
  presets: WizardPreset[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState("generic");
  const [connectionName, setConnectionName] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [presetCode, setPresetCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null);

  const providerPresets = useMemo(
    () => presets.filter((preset) => preset.provider === provider),
    [presets, provider],
  );
  const selectedPreset = providerPresets.find((preset) => preset.code === presetCode);
  const fields = PROVIDER_FIELDS[provider] ?? PROVIDER_FIELDS.generic!;

  function reset() {
    setStep(1);
    setProvider("generic");
    setConnectionName("");
    setCredentialRef("");
    setConfigValues({});
    setPresetCode("");
    setSubmitting(false);
    setError(null);
    setConnectionId(null);
    setTestOutcome(null);
  }

  function close() {
    onClose();
    reset();
  }

  function goTo(next: number) {
    setError(null);
    // 离开步骤 2（进入 3=映射预览）时才校验连接字段；向前回看不拦。
    if (next > 2) {
      if (!connectionName.trim()) {
        setError("必须填写连接名称。");
        return;
      }
      if (!credentialRef.trim()) {
        setError("必须填写凭据引用（保管库路径或密钥名，不是凭据值）。");
        return;
      }
    }
    setStep(Math.min(4, Math.max(1, next)));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const connection = await api<{ id: string }>("/api/v1/integration-connections", {
        method: "POST",
        body: {
          provider,
          connectionName: connectionName.trim(),
          credentialRef: credentialRef.trim(),
          config: Object.fromEntries(
            Object.entries(configValues).filter(([, value]) => value.trim()),
          ),
        },
      });
      setConnectionId(connection.id);
      if (selectedPreset) {
        await api(`/api/v1/integration-connections/${connection.id}/mappings`, {
          method: "POST",
          body: {
            name: selectedPreset.name,
            mappingType: selectedPreset.mappingType,
            sourceSystem: selectedPreset.sourceSystem,
            targetType: selectedPreset.targetType,
            fieldMap: selectedPreset.fieldMap,
            config: selectedPreset.config,
            version: 1,
          },
        });
      }
      const outcome = await api<TestOutcome>(
        `/api/v1/integration-connections/${connection.id}/test`,
      );
      setTestOutcome(outcome);
      setStep(4);
      toast.success("连接已创建并完成探测", connectionName.trim());
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "创建连接失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="新建集成连接（向导）"
      description="四步引导：供应商 → 连接 → 映射预览 → 探测。只保存凭据引用——绝不保存密钥本体。"
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          {step < 4 ? (
            <>
              {step > 1 ? (
                <Button variant="secondary" onClick={() => goTo(step - 1)}>
                  上一步
                </Button>
              ) : null}
              {step < 3 ? (
                <Button variant="primary" onClick={() => goTo(step + 1)}>
                  下一步
                </Button>
              ) : (
                <Button variant="primary" onClick={submit} loading={submitting}>
                  创建并探测
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" onClick={close}>
              完成
            </Button>
          )}
        </>
      }
    >
      {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}
      {step === 1 ? (
        <>
          <FormField label="供应商" htmlFor="wizard-provider">
            <Select
              id="wizard-provider"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setPresetCode("");
              }}
              aria-label="选择供应商"
            >
              <option value="generic">通用 HTTP/JSON</option>
              <option value="hubspot">HubSpot（CRM，部分能力）</option>
              <option value="feishu">飞书（多维表格/通讯录）</option>
              <option value="erp">ERP（财务事实，未验证前 NO_GO）</option>
            </Select>
          </FormField>
          <FormField label="映射预设（可选）" htmlFor="wizard-preset" hint="按供应商预置的字段映射，创建后可在映射页调整。">
            <Select
              id="wizard-preset"
              value={presetCode}
              onChange={(event) => setPresetCode(event.target.value)}
              aria-label="选择映射预设"
            >
              <option value="">暂不创建映射</option>
              {providerPresets.map((preset) => (
                <option key={preset.code} value={preset.code}>
                  {preset.name}
                </option>
              ))}
            </Select>
          </FormField>
          <InfoNotice>
            接入状态以 README「Provider readiness truth table」为准：预设/框架 ≠ 生产连接器；
            ERP 财务事实在未经真实对账验证前为 NO_GO。
          </InfoNotice>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <FormField label="连接名称" htmlFor="wizard-name">
            <TextInput
              id="wizard-name"
              value={connectionName}
              onChange={(event) => setConnectionName(event.target.value)}
              placeholder="收入 CRM 沙箱"
              required
            />
          </FormField>
          <FormField
            label="凭据引用"
            htmlFor="wizard-credential"
            hint="保管库路径或密钥名——服务端通过 SecretProvider 解析，永不回显值。"
          >
            <TextInput
              id="wizard-credential"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
              placeholder="vault://integrations/sandbox"
              required
            />
          </FormField>
          {fields.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              htmlFor={`wizard-config-${field.key}`}
              hint={field.hint}
            >
              <TextInput
                id={`wizard-config-${field.key}`}
                value={configValues[field.key] ?? ""}
                onChange={(event) =>
                  setConfigValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                placeholder={field.placeholder}
              />
            </FormField>
          ))}
        </>
      ) : null}
      {step === 3 ? (
        <>
          <InfoNotice>
            映射预览——列到源路径的对应关系（来自预设；可稍后在映射页微调）。
          </InfoNotice>
          {selectedPreset ? (
            <table className="table">
              <caption className="muted">{selectedPreset.name} 字段映射</caption>
              <thead>
                <tr>
                  <th scope="col">目标列</th>
                  <th scope="col">源表达式</th>
                  <th scope="col">说明</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(selectedPreset.fieldMap).map(([column, expression]) => (
                  <tr key={column}>
                    <th scope="row">{column}</th>
                    <td className="mono">{expression}</td>
                    <td className="muted">
                      {expression.startsWith("=") ? "常量（=前缀）" : "源记录点路径"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">未选择预设——创建后需手动配置字段映射才能同步。</div>
          )}
        </>
      ) : null}
      {step === 4 ? (
        <>
          {testOutcome ? (
            <>
              <InfoNotice tone={testOutcome.ok ? "success" : "warning"}>
                探测结果：{testOutcome.ok ? "通过" : "未通过"}
                {testOutcome.testedAt ? `（${testOutcome.testedAt.slice(0, 19).replace("T", " ")}）` : ""}
              </InfoNotice>
              <ul className="stack-list">
                {testOutcome.checks.map((check) => (
                  <li key={check.name}>
                    <Badge status={check.ok ? "APPROVED" : "NEEDS_EVIDENCE"}>
                      {check.ok ? "通过" : "未过"}
                    </Badge>{" "}
                    {check.name}
                    {check.detail ? (
                      <span className="muted"> · {check.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {testOutcome.sample !== undefined ? (
                <>
                  <InfoNotice>样例记录（来自 provider 探测端点）：</InfoNotice>
                  <pre className="code-block">{JSON.stringify(testOutcome.sample, null, 2)}</pre>
                </>
              ) : null}
            </>
          ) : null}
          <InfoNotice>
            身份解析：外部系统的不透明 ID（如 HubSpot deal id）需要登记到
            「外部对象身份」（连接详情 → 外部对象）后，同步时才能落到内部对象；
            未解析的记录会进入隔离区（UNRESOLVED_IDENTITY）等待人工处置。
          </InfoNotice>
          {connectionId ? (
            <div className="muted mono">connectionId: {connectionId}</div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
