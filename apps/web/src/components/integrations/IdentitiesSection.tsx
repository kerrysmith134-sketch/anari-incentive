import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  Select,
  Tabs,
  TextInput,
  Textarea,
} from "../ui.js";
import { Icon } from "../Icon.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api, ApiError } from "../../lib/api.js";
import { useApiQuery } from "../../lib/hooks.js";
import { formatDateTime, formatRelative, shortId } from "../../lib/format.js";
import type {
  IntegrationConnection,
  IntegrationMapping,
  MappingPreset,
  SyncRun,
  SyncSchedule,
} from "../../lib/types.js";
import type { ExternalIdentityView } from "../../lib/ops-types.js";

export function IdentitiesSection() {
  const toast = useToast();
  const identities = useApiQuery<ExternalIdentityView[]>(
    "/api/v1/external-identities",
  );
  const [open, setOpen] = useState(false);
  const [sourceSystem, setSourceSystem] = useState("");
  const [externalId, setExternalId] = useState("");
  const [objectType, setObjectType] = useState("PERSON");
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openForm() {
    setSourceSystem("");
    setExternalId("");
    setObjectType("PERSON");
    setPersonId("");
    setError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/v1/external-identities", {
        method: "POST",
        body: {
          sourceSystem: sourceSystem.trim(),
          externalId: externalId.trim(),
          objectType: objectType.trim(),
          personId: personId.trim() || undefined,
        },
      });
      toast.success("外部身份已映射", externalId);
      setOpen(false);
      identities.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "映射身份失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className="inline"
        style={{ justifyContent: "space-between", width: "100%", marginBottom: 10 }}
      >
        <span className="muted">
          来源系统标识映射到内部人员。
        </span>
        <Button size="sm" variant="secondary" icon="plus" onClick={openForm}>
          映射身份
        </Button>
      </div>
      {identities.error ? (
        <ErrorNotice error={identities.error} onRetry={identities.reload} />
      ) : identities.loading ? (
        <LoadingRows rows={3} />
      ) : (identities.data?.length ?? 0) === 0 ? (
        <p className="muted">尚无外部身份映射。</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>外部 ID</th>
                <th>对象</th>
                <th>人员</th>
              </tr>
            </thead>
            <tbody>
              {(identities.data ?? []).map((identity) => (
                <tr key={identity.id}>
                  <td>{identity.sourceSystem}</td>
                  <td className="mono">{identity.externalId}</td>
                  <td>{identity.objectType}</td>
                  <td className="mono">
                    {identity.personId
                      ? shortId(identity.personId, 10)
                      : "unmapped"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="映射外部身份"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="identity-form"
              loading={busy}
            >
              映射身份
            </Button>
          </>
        }
      >
        <form id="identity-form" onSubmit={submit} className="form-grid">
          {error ? (
            <div className="field--full">
              <InfoNotice tone="warning">{error}</InfoNotice>
            </div>
          ) : null}
          <FormField label="来源系统" htmlFor="identity-source">
            <TextInput
              id="identity-source"
              value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              required
            />
          </FormField>
          <FormField label="外部 ID" htmlFor="identity-external">
            <TextInput
              id="identity-external"
              value={externalId}
              onChange={(event) => setExternalId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="对象类型" htmlFor="identity-object">
            <TextInput
              id="identity-object"
              value={objectType}
              onChange={(event) => setObjectType(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="人员 ID（可选）"
            htmlFor="identity-person"
            className="field--full"
          >
            <TextInput
              id="identity-person"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}


