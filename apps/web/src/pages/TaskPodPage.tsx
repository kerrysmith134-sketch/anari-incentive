import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDateTime } from "../lib/format.js";
import { zhStatus } from "../lib/zh.js";

interface PolicyRecord<T> {
  id: string;
  recordType: string;
  status?: string;
  personId?: string;
  period?: string;
  payload: T;
  createdAt: string;
  updatedAt: string;
}

interface TaskPodPayload {
  id: string;
  title: string;
  objective: string;
  initiatorPersonId: string;
  status: string;
  members: Array<{ kind: string; memberId: string; role: string; aiVersion?: string }>;
  startsAt: string;
  dueAt?: string;
  completedAt?: string;
}

interface AiMemberPayload {
  id: string;
  name: string;
  role: string;
  aiVersion: string;
  responsibilities: string[];
  active: boolean;
}

interface InventoryTask {
  taskId: string;
  name: string;
  deliverable: string;
  measure: string;
  mode: "HUMAN" | "AI" | "HYBRID";
  aiWorkflow?: string;
  aiTransformationCandidate?: boolean;
}

interface InventoryPayload {
  id: string;
  personId: string;
  period: string;
  tasks: InventoryTask[];
  status: string;
}

/** 任务制与 AI 原生组织：任务组、AI 成员登记、个人任务清单与 AI 标注。 */
export function TaskPodPage() {
  useDocumentTitle("任务制组织");
  const toast = useToast();
  const [tab, setTab] = useState("pods");

  const pods = useApiQuery<PolicyRecord<TaskPodPayload>[]>("/api/v1/task-pods");
  const aiMembers = useApiQuery<PolicyRecord<AiMemberPayload>[]>(
    "/api/v1/ai-members",
  );
  const inventories = useApiQuery<PolicyRecord<InventoryPayload>[]>(
    "/api/v1/personal-task-inventories",
  );

  const [podTitle, setPodTitle] = useState("");
  const [podObjective, setPodObjective] = useState("");
  const [podInitiator, setPodInitiator] = useState("");
  const [podDue, setPodDue] = useState("");
  const [podAi, setPodAi] = useState("");
  const [podError, setPodError] = useState<string | null>(null);
  const [savingPod, setSavingPod] = useState(false);

  const [aiName, setAiName] = useState("");
  const [aiRole, setAiRole] = useState("EVIDENCE_AGENT");
  const [aiVersion, setAiVersion] = useState("1.0.0");
  const [aiDuties, setAiDuties] = useState("归集证据、识别异常、生成预审初稿");
  const [aiError, setAiError] = useState<string | null>(null);

  const [inventoryPerson, setInventoryPerson] = useState("");
  const [inventoryPeriod, setInventoryPeriod] = useState("2026-Q4");
  const [tasks, setTasks] = useState<InventoryTask[]>([
    {
      taskId: "t-1",
      name: "",
      deliverable: "",
      measure: "",
      mode: "HUMAN",
      aiWorkflow: "",
      aiTransformationCandidate: false,
    },
  ]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const aiList = aiMembers.data ?? [];

  function message(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function updateTask(index: number, patch: Partial<InventoryTask>) {
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...patch } : task,
      ),
    );
  }

  function addTask() {
    setTasks((current) => [
      ...current,
      {
        taskId: `t-${current.length + 1}`,
        name: "",
        deliverable: "",
        measure: "",
        mode: "HUMAN",
        aiWorkflow: "",
        aiTransformationCandidate: false,
      },
    ]);
  }

  async function createPod(event: FormEvent) {
    event.preventDefault();
    setPodError(null);
    setSavingPod(true);
    try {
      const members: TaskPodPayload["members"] = [
        { kind: "PERSON", memberId: podInitiator, role: "INITIATOR" },
      ];
      if (podAi) {
        const ai = aiList.find((record) => record.payload.id === podAi);
        if (ai) {
          members.push({
            kind: "AI",
            memberId: ai.payload.id,
            role: ai.payload.role,
            aiVersion: ai.payload.aiVersion,
          });
        }
      }
      await api("/api/v1/task-pods", {
        method: "POST",
        body: {
          title: podTitle.trim(),
          objective: podObjective.trim(),
          initiatorPersonId: podInitiator,
          dueAt: podDue ? `${podDue}T00:00:00Z` : undefined,
          members,
        },
      });
      toast.success("任务组已创建", podTitle.trim());
      setPodTitle("");
      setPodObjective("");
      pods.reload();
    } catch (error) {
      setPodError(message(error, "创建任务组失败"));
    } finally {
      setSavingPod(false);
    }
  }

  async function createAiMember(event: FormEvent) {
    event.preventDefault();
    setAiError(null);
    try {
      await api("/api/v1/ai-members", {
        method: "POST",
        body: {
          name: aiName.trim(),
          role: aiRole.trim(),
          aiVersion: aiVersion.trim(),
          responsibilities: aiDuties
            .split(/[、,，\n]/)
            .map((duty) => duty.trim())
            .filter(Boolean),
        },
      });
      toast.success("AI 成员已登记", aiName.trim());
      setAiName("");
      aiMembers.reload();
    } catch (error) {
      setAiError(message(error, "登记 AI 成员失败"));
    }
  }

  async function updatePod(record: PolicyRecord<TaskPodPayload>, status: string) {
    try {
      await api(`/api/v1/task-pods/${record.id}/status`, {
        method: "POST",
        body: { status },
      });
      toast.success("任务组状态已更新", zhStatus(status));
      pods.reload();
    } catch (error) {
      toast.error("更新失败", message(error, "请稍后重试"));
    }
  }

  async function submitInventory(event: FormEvent) {
    event.preventDefault();
    setInventoryError(null);
    try {
      await api("/api/v1/personal-task-inventories", {
        method: "POST",
        body: {
          personId: inventoryPerson,
          period: inventoryPeriod,
          tasks: tasks.map((task) => ({
            ...task,
            aiWorkflow: task.aiWorkflow?.trim() || undefined,
          })),
        },
      });
      toast.success("任务清单已保存", inventoryPeriod);
      inventories.reload();
    } catch (error) {
      setInventoryError(message(error, "任务清单校验未通过"));
    }
  }

  async function advanceInventory(
    record: PolicyRecord<InventoryPayload>,
    status: string,
  ) {
    try {
      await api(`/api/v1/personal-task-inventories/${record.id}/status`, {
        method: "POST",
        body: { status },
      });
      toast.success("清单状态已更新", zhStatus(status));
      inventories.reload();
    } catch (error) {
      toast.error("更新失败", message(error, "请稍后重试"));
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="组织方式"
        title="任务制与 AI 原生组织"
        description="围绕任务组建 Task Pod，发起人对结果负责；AI 成员有名字、职责与版本；个人任务清单逐项标注人 / AI / 人机协同，并锁定本季度 AI 化改造对象。"
      />
      <Tabs
        items={[
          { id: "pods", label: "任务组", count: pods.data?.length ?? 0 },
          { id: "ai", label: "AI 成员", count: aiList.length },
          {
            id: "inventory",
            label: "个人任务清单",
            count: inventories.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="任务制视图"
      />

      <div className="tab-panel">
        {tab === "pods" ? (
          <div className="stack">
            <Panel title="发起任务组">
              <form onSubmit={createPod}>
                <div className="form-grid">
                  <FormField label="任务名称">
                    <TextInput value={podTitle} onChange={(event) => setPodTitle(event.target.value)} required />
                  </FormField>
                  <FormField label="目标成果">
                    <TextInput value={podObjective} onChange={(event) => setPodObjective(event.target.value)} required />
                  </FormField>
                  <FormField label="发起人" hint="发起人对任务结果负责，必须是任务组成员">
                    <PersonSelect value={podInitiator} onChange={setPodInitiator} />
                  </FormField>
                  <FormField label="加入 AI 成员（可选）">
                    <Select value={podAi} onChange={(event) => setPodAi(event.target.value)}>
                      <option value="">不加入</option>
                      {aiList
                        .filter((record) => record.payload.active)
                        .map((record) => (
                          <option key={record.payload.id} value={record.payload.id}>
                            {record.payload.name} · {record.payload.role} v{record.payload.aiVersion}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  <FormField label="完成期限">
                    <TextInput type="date" value={podDue} onChange={(event) => setPodDue(event.target.value)} />
                  </FormField>
                </div>
                {podError ? <InfoNotice tone="warning">{podError}</InfoNotice> : null}
                <div className="form-actions">
                  <Button type="submit" disabled={savingPod}>
                    {savingPod ? "创建中…" : "创建任务组"}
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel title="任务组台账">
              {pods.loading ? <LoadingRows /> : null}
              {!pods.loading && (pods.data ?? []).length === 0 ? (
                <EmptyState
                  title="还没有任务组"
                  description="围绕一个重点投标、市场进入、认证交付或大客户上线，先组建一个 Task Pod。"
                />
              ) : null}
              <div className="stack">
                {(pods.data ?? []).map((record) => (
                  <div className="panel" key={record.id}>
                    <div className="panel__header">
                      <div>
                        <strong>{record.payload.title}</strong>
                        <div className="muted">{record.payload.objective}</div>
                      </div>
                      <Badge status={record.payload.status} />
                    </div>
                    <div className="muted">
                      发起人 {record.payload.initiatorPersonId.slice(0, 8)} ·
                      成员 {record.payload.members.length} 人（含 AI{" "}
                      {record.payload.members.filter((member) => member.kind === "AI").length}）·
                      创建于 {formatDateTime(record.createdAt)}
                    </div>
                    <div className="form-actions">
                      {record.payload.status === "OPEN" || record.payload.status === "ACTIVE" ? (
                        <>
                          <Button variant="secondary" onClick={() => updatePod(record, "ACTIVE")}>
                            开始执行
                          </Button>
                          <Button variant="secondary" onClick={() => updatePod(record, "COMPLETED")}>
                            完成任务
                          </Button>
                          <Button variant="ghost" onClick={() => updatePod(record, "DISSOLVED")}>
                            解散
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "ai" ? (
          <div className="stack">
            <Panel title="登记 AI 成员">
              <form onSubmit={createAiMember}>
                <div className="form-grid">
                  <FormField label="名称">
                    <TextInput value={aiName} onChange={(event) => setAiName(event.target.value)} placeholder="例如：证据助理" required />
                  </FormField>
                  <FormField label="角色">
                    <TextInput value={aiRole} onChange={(event) => setAiRole(event.target.value)} required />
                  </FormField>
                  <FormField label="版本">
                    <TextInput value={aiVersion} onChange={(event) => setAiVersion(event.target.value)} required />
                  </FormField>
                  <FormField label="职责">
                    <TextInput value={aiDuties} onChange={(event) => setAiDuties(event.target.value)} />
                  </FormField>
                </div>
                {aiError ? <InfoNotice tone="warning">{aiError}</InfoNotice> : null}
                <div className="form-actions"><Button type="submit">登记 AI 成员</Button></div>
              </form>
            </Panel>
            <Panel title="AI 成员登记簿">
              {aiMembers.loading ? <LoadingRows /> : null}
              {!aiMembers.loading && aiList.length === 0 ? (
                <EmptyState title="尚未登记 AI 成员" description="虚拟团队中的 AI 成员需要名字、职责与版本记录。" />
              ) : null}
              <div className="stack">
                {aiList.map((record) => (
                  <div className="panel" key={record.id}>
                    <div className="panel__header">
                      <div>
                        <strong>{record.payload.name}</strong>
                        <div className="muted">
                          {record.payload.role} · v{record.payload.aiVersion}
                        </div>
                      </div>
                      <Badge status={record.payload.active ? "ACTIVE" : "RETIRED"} />
                    </div>
                    <div className="muted">
                      职责：{record.payload.responsibilities.join("、") || "未填写"}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "inventory" ? (
          <div className="stack">
            <Panel title="个人任务清单（2026 Q4）">
              <form onSubmit={submitInventory}>
                <div className="form-grid">
                  <FormField label="员工">
                    <PersonSelect value={inventoryPerson} onChange={setInventoryPerson} />
                  </FormField>
                  <FormField label="周期">
                    <TextInput value={inventoryPeriod} onChange={(event) => setInventoryPeriod(event.target.value)} />
                  </FormField>
                </div>
                <div className="stack">
                  {tasks.map((task, index) => (
                    <div className="panel" key={task.taskId}>
                      <div className="form-grid">
                        <FormField label={`任务 ${index + 1} 名称`}>
                          <TextInput value={task.name} onChange={(event) => updateTask(index, { name: event.target.value })} required />
                        </FormField>
                        <FormField label="可交付成果">
                          <TextInput value={task.deliverable} onChange={(event) => updateTask(index, { deliverable: event.target.value })} required />
                        </FormField>
                        <FormField label="可衡量口径">
                          <TextInput value={task.measure} onChange={(event) => updateTask(index, { measure: event.target.value })} required />
                        </FormField>
                        <FormField label="执行方式">
                          <Select value={task.mode} onChange={(event) => updateTask(index, { mode: event.target.value as InventoryTask["mode"] })}>
                            <option value="HUMAN">人独立完成</option>
                            <option value="AI">AI 完成</option>
                            <option value="HYBRID">人机协同</option>
                          </Select>
                        </FormField>
                        <FormField label="AI 工作流说明" hint="AI / 人机协同任务必填">
                          <TextInput value={task.aiWorkflow ?? ""} onChange={(event) => updateTask(index, { aiWorkflow: event.target.value })} />
                        </FormField>
                        <FormField label="本季度 AI 化改造对象">
                          <Select
                            value={task.aiTransformationCandidate ? "yes" : "no"}
                            onChange={(event) => updateTask(index, { aiTransformationCandidate: event.target.value === "yes" })}
                          >
                            <option value="no">否</option>
                            <option value="yes">是（每人一项）</option>
                          </Select>
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
                {inventoryError ? <InfoNotice tone="warning">{inventoryError}</InfoNotice> : null}
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={addTask}>增加任务</Button>
                  <Button type="submit">保存并校验</Button>
                </div>
              </form>
            </Panel>
            <Panel title="已提交清单">
              {inventories.loading ? <LoadingRows /> : null}
              {!inventories.loading && (inventories.data ?? []).length === 0 ? (
                <EmptyState title="尚无任务清单" description="完成清单后由运营总监统一汇总评审。" />
              ) : null}
              <div className="stack">
                {(inventories.data ?? []).map((record) => (
                  <div className="panel" key={record.id}>
                    <div className="panel__header">
                      <div>
                        <strong>{record.period} · {record.payload.tasks.length} 项任务</strong>
                        <div className="muted">员工 {record.payload.personId.slice(0, 8)}</div>
                      </div>
                      <Badge status={record.payload.status} />
                    </div>
                    <div className="form-actions">
                      {record.payload.status === "DRAFT" || record.payload.status === "RETURNED" ? (
                        <Button variant="secondary" onClick={() => advanceInventory(record, "SUBMITTED")}>
                          提交评审
                        </Button>
                      ) : null}
                      {record.payload.status === "SUBMITTED" ? (
                        <>
                          <Button variant="secondary" onClick={() => advanceInventory(record, "ACCEPTED")}>
                            验收通过
                          </Button>
                          <Button variant="ghost" onClick={() => advanceInventory(record, "RETURNED")}>
                            退回修改
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
