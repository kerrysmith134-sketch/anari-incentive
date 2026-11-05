import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface EquityGrantView {
  id: string;
  personId: string;
  grantCode: string;
  grantType: string;
  totalUnits: string;
  strikePrice: string;
  currency: string;
  cliffMonths: number;
  vestingMonths: number;
  status: string;
  createdAt?: string;
}

interface VestingView {
  vestedUnits: string;
  unvestedUnits: string;
  exercisedUnits: string;
  availableUnits: string;
  nextVestAt?: string;
  fullyVested: boolean;
}

interface ExerciseView {
  id: string;
  grantId: string;
  personId: string;
  units: string;
  status: string;
  createdAt: string;
}

/** 期权股权：授予 → 悬崖归属 → 行权申请 → 审批 → 交割。 */
export function EquityPage() {
  useDocumentTitle("期权股权");
  const toast = useToast();
  const { session } = useAuth();
  const identity = useApiQuery<{ roles: string[] }>("/api/v1/platform/identity");
  const privileged =
    identity.data?.roles.some((role) =>
      ["admin", "manager", "finance"].includes(role),
    ) ?? false;
  const grants = useApiQuery<EquityGrantView[]>("/api/v1/equity-grants");
  const exercises = useApiQuery<ExerciseView[]>("/api/v1/equity-exercises");
  const [tab, setTab] = useState("grants");

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantPerson, setGrantPerson] = useState(session.personId);
  const [grantCode, setGrantCode] = useState("");
  const [grantType, setGrantType] = useState<"OPTION" | "RSU" | "SAR">("RSU");
  const [grantUnits, setGrantUnits] = useState("");
  const [grantStrike, setGrantStrike] = useState("0");
  const [grantCurrency, setGrantCurrency] = useState("CNY");
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10));
  const [vestingStart, setVestingStart] = useState(new Date().toISOString().slice(0, 10));
  const [cliffMonths, setCliffMonths] = useState("12");
  const [vestingMonths, setVestingMonths] = useState("48");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [savingGrant, setSavingGrant] = useState(false);

  const [vestingTarget, setVestingTarget] = useState<EquityGrantView | null>(null);
  const [vesting, setVesting] = useState<VestingView | null>(null);
  const [vestingError, setVestingError] = useState<string | null>(null);

  const [exerciseTarget, setExerciseTarget] = useState<EquityGrantView | null>(null);
  const [exerciseUnits, setExerciseUnits] = useState("");
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  const grantList = grants.data ?? [];
  const exerciseList = exercises.data ?? [];

  function toIso(value: string): string {
    return new Date(`${value}T00:00:00Z`).toISOString();
  }

  async function createGrant(event: FormEvent) {
    event.preventDefault();
    setGrantError(null);
    setSavingGrant(true);
    try {
      await api("/api/v1/equity-grants", {
        method: "POST",
        body: {
          personId: grantPerson,
          grantCode: grantCode.trim(),
          grantType,
          totalUnits: grantUnits,
          strikePrice: grantStrike,
          currency: grantCurrency.toUpperCase(),
          grantDate: toIso(grantDate),
          vestingStart: toIso(vestingStart),
          cliffMonths: Number.parseInt(cliffMonths, 10) || 0,
          vestingMonths: Number.parseInt(vestingMonths, 10) || 1,
        },
      });
      toast.success("授予已创建", grantCode);
      setGrantOpen(false);
      grants.reload();
    } catch (caught) {
      setGrantError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingGrant(false);
    }
  }

  async function openVesting(grant: EquityGrantView) {
    setVestingTarget(grant);
    setVesting(null);
    setVestingError(null);
    try {
      const result = await api<VestingView>(
        `/api/v1/equity-grants/${grant.id}/vesting`,
      );
      setVesting(result);
    } catch (caught) {
      setVestingError(caught instanceof ApiError ? caught.message : "查询失败");
    }
  }

  async function requestExercise(event: FormEvent) {
    event.preventDefault();
    if (!exerciseTarget) return;
    setExerciseError(null);
    try {
      await api(`/api/v1/equity-grants/${exerciseTarget.id}/exercises`, {
        method: "POST",
        body: { units: exerciseUnits, requestedBy: session.personId },
      });
      toast.success("行权申请已提交", "等待审批");
      setExerciseTarget(null);
      exercises.reload();
    } catch (caught) {
      setExerciseError(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  async function advanceExercise(exercise: ExerciseView, action: "approve" | "settle") {
    try {
      await api(`/api/v1/equity-exercises/${exercise.id}/${action}`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success(action === "approve" ? "行权已批准" : "行权已交割");
      exercises.reload();
      grants.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="期权股权"
        description="OPTION / RSU / SAR 授予，悬崖 + 按月归属；行权需审批人≠申请人，归属与可用额度实时可查。"
        actions={
          <Button variant="secondary" onClick={() => grants.reload()}>
            刷新
          </Button>
        }
      />
      <Tabs
        items={[
          { id: "grants", label: "授予台账", count: grantList.length },
          { id: "exercises", label: "行权记录", count: exerciseList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="期权股权视图"
      />

      <div className="tab-panel">
        {tab === "grants" ? (
          <Panel
            title="授予台账"
            action={
              privileged ? (
                <Button onClick={() => setGrantOpen(true)}>新建授予</Button>
              ) : null
            }
            flush
          >
            {grants.loading && grants.data === undefined ? (
              <LoadingRows rows={4} />
            ) : grantList.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无授予记录"
                description="为员工创建期权/RSU/SAR 授予后，这里会展示台账、归属进度与行权状态。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>授予编号</th>
                    <th>对象</th>
                    <th>类型</th>
                    <th>总量</th>
                    <th>悬崖/归属</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {grantList.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        <code>{grant.grantCode}</code>
                      </td>
                      <td>
                        <code>{grant.personId.slice(0, 8)}</code>
                      </td>
                      <td>{grant.grantType}</td>
                      <td className="mono">{grant.totalUnits}</td>
                      <td>
                        {grant.cliffMonths} 个月悬崖 · {grant.vestingMonths} 个月归属
                      </td>
                      <td>
                        <Badge status={grant.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openVesting(grant)}
                          >
                            归属进度
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setExerciseTarget(grant);
                              setExerciseUnits("");
                              setExerciseError(null);
                            }}
                          >
                            行权
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "exercises" ? (
          <Panel title="行权记录" flush>
            {exerciseList.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无行权记录"
                description="行权需在归属后发起，审批人不能是申请人本人。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>数量</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {exerciseList.map((exercise) => (
                    <tr key={exercise.id}>
                      <td>
                        <code>{exercise.personId.slice(0, 8)}</code>
                      </td>
                      <td className="mono">{exercise.units}</td>
                      <td>
                        <Badge status={exercise.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {privileged && exercise.status === "PENDING" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void advanceExercise(exercise, "approve")}
                            >
                              批准
                            </Button>
                          ) : null}
                          {privileged && exercise.status === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void advanceExercise(exercise, "settle")}
                            >
                              交割
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}
      </div>

      {/* 新建授予 */}
      <Modal
        open={grantOpen}
        title="新建授予"
        onClose={() => setGrantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="grant-form" loading={savingGrant}>
              创建授予
            </Button>
          </>
        }
      >
        <form id="grant-form" onSubmit={createGrant} className="form-grid">
          {grantError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{grantError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="授予对象" htmlFor="grant-person">
            <PersonSelect id="grant-person" value={grantPerson} onChange={setGrantPerson} />
          </FormField>
          <FormField label="授予编号" htmlFor="grant-code">
            <TextInput
              id="grant-code"
              value={grantCode}
              onChange={(event) => setGrantCode(event.target.value)}
              placeholder="G-2026-001"
              required
            />
          </FormField>
          <FormField label="类型" htmlFor="grant-type">
            <Select
              id="grant-type"
              value={grantType}
              onChange={(event) =>
                setGrantType(event.target.value as "OPTION" | "RSU" | "SAR")
              }
            >
              <option value="RSU">限制性股票（RSU）</option>
              <option value="OPTION">期权（OPTION）</option>
              <option value="SAR">股票增值权（SAR）</option>
            </Select>
          </FormField>
          <FormField label="授予总量" htmlFor="grant-units">
            <TextInput
              id="grant-units"
              value={grantUnits}
              onChange={(event) => setGrantUnits(event.target.value)}
              placeholder="10000"
              required
            />
          </FormField>
          <FormField label="行权价" htmlFor="grant-strike">
            <TextInput
              id="grant-strike"
              value={grantStrike}
              onChange={(event) => setGrantStrike(event.target.value)}
            />
          </FormField>
          <FormField label="币种" htmlFor="grant-currency">
            <TextInput
              id="grant-currency"
              value={grantCurrency}
              onChange={(event) => setGrantCurrency(event.target.value)}
            />
          </FormField>
          <FormField label="授予日" htmlFor="grant-date">
            <TextInput
              id="grant-date"
              type="date"
              value={grantDate}
              onChange={(event) => setGrantDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="归属起始日" htmlFor="vesting-start">
            <TextInput
              id="vesting-start"
              type="date"
              value={vestingStart}
              onChange={(event) => setVestingStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="悬崖（月）" htmlFor="cliff-months">
            <TextInput
              id="cliff-months"
              value={cliffMonths}
              onChange={(event) => setCliffMonths(event.target.value)}
            />
          </FormField>
          <FormField label="总归属期（月）" htmlFor="vesting-months">
            <TextInput
              id="vesting-months"
              value={vestingMonths}
              onChange={(event) => setVestingMonths(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      {/* 归属进度 */}
      <Modal
        open={Boolean(vestingTarget)}
        title={`归属进度 · ${vestingTarget?.grantCode ?? ""}`}
        onClose={() => setVestingTarget(null)}
        footer={
          <Button variant="ghost" onClick={() => setVestingTarget(null)}>
            关闭
          </Button>
        }
      >
        {vestingError ? <InfoNotice tone="warning">{vestingError}</InfoNotice> : null}
        {vesting ? (
          <div className="stat-grid stat-grid--three">
            <div>
              <div className="stat-label">已归属</div>
              <div className="stat-value">{vesting.vestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">未归属</div>
              <div className="stat-value">{vesting.unvestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">可行使</div>
              <div className="stat-value">{vesting.availableUnits}</div>
            </div>
            <div>
              <div className="stat-label">已行权</div>
              <div className="stat-value">{vesting.exercisedUnits}</div>
            </div>
            <div>
              <div className="stat-label">下一次归属</div>
              <div className="stat-value">{vesting.nextVestAt?.slice(0, 10) ?? "—"}</div>
            </div>
            <div>
              <div className="stat-label">状态</div>
              <div className="stat-value">{vesting.fullyVested ? "已全部归属" : "归属中"}</div>
            </div>
          </div>
        ) : (
          <LoadingRows rows={2} />
        )}
      </Modal>

      {/* 行权申请 */}
      <Modal
        open={Boolean(exerciseTarget)}
        title={`行权申请 · ${exerciseTarget?.grantCode ?? ""}`}
        onClose={() => setExerciseTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="exercise-form">
              提交申请
            </Button>
          </>
        }
      >
        <form id="exercise-form" onSubmit={requestExercise} className="form-grid">
          {exerciseError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{exerciseError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="行权数量" htmlFor="exercise-units">
            <TextInput
              id="exercise-units"
              value={exerciseUnits}
              onChange={(event) => setExerciseUnits(event.target.value)}
              placeholder="1000"
              required
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
