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

export function SchedulesSection({
  connection,
  schedules,
  loading,
  error,
  reload,
}: {
  connection: IntegrationConnection;
  schedules: SyncSchedule[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [startAt, setStartAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  function openForm() {
    setName(`${connection.provider} sync`);
    setIntervalMinutes("60");
    setStartAt("");
    setFormError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/integration-connections/${connection.id}/schedules`, {
        method: "POST",
        body: {
          name: name.trim(),
          intervalMinutes: Math.max(1, Math.floor(Number(intervalMinutes))),
          startAt: startAt ? new Date(startAt).toISOString() : undefined,
        },
      });
      toast.success("计划已创建", name);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建计划失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(schedule: SyncSchedule) {
    setToggling(schedule.id);
    try {
      await api(`/api/v1/sync-schedules/${schedule.id}/status`, {
        method: "POST",
        body: { enabled: !schedule.enabled },
      });
      toast.success(
        schedule.enabled ? "Schedule paused" : "Schedule enabled",
        schedule.name,
      );
      reload();
    } catch (caught) {
      toast.error(
        "修改计划失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setToggling(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          同步执行器原子认领到期计划。
        </span>
        <Button size="sm" variant="primary" icon="plus" onClick={openForm}>
          新建计划
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={2} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon="clock"
          title="暂无同步计划"
          description="设置重复间隔，执行器才能认领并排队同步。"
          action={
            <Button variant="primary" size="sm" onClick={openForm}>
              新建计划
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>计划</th>
                <th>间隔</th>
                <th>下次运行</th>
                <th>最近运行</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>
                    <span className="cell-primary">{schedule.name}</span>
                    <span className="cell-sub mono">{shortId(schedule.id, 10)}</span>
                  </td>
                  <td>{schedule.intervalMinutes} min</td>
                  <td>{formatDateTime(schedule.nextRunAt)}</td>
                  <td>{schedule.lastRunAt ? formatRelative(schedule.lastRunAt) : "从未"}</td>
                  <td>
                    <Badge
                      tone={schedule.enabled ? "success" : "warning"}
                    >
                      {schedule.enabled ? "Enabled" : "Paused"}
                    </Badge>
                  </td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={toggling === schedule.id}
                      onClick={() => void toggle(schedule)}
                    >
                      {schedule.enabled ? "Pause" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="新建同步计划"
        description="间隔单位为分钟；到期后由同步执行器认领。"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-schedule-form"
              loading={submitting}
            >
              创建计划
            </Button>
          </>
        }
      >
        <form id="create-schedule-form" onSubmit={submit} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="名称" htmlFor="schedule-name" className="field--full">
            <TextInput
              id="schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="间隔（分钟）" htmlFor="schedule-interval">
            <TextInput
              id="schedule-interval"
              type="number"
              min="1"
              step="1"
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              required
            />
          </FormField>
          <FormField label="首次运行（可选）" htmlFor="schedule-start">
            <TextInput
              id="schedule-start"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------- sync runs */

