import { useState, type FormEvent, useEffect } from "react";
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
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
  Textarea,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { Icon } from "../components/Icon.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api, getApiSession } from "../lib/api.js";
import { useApiQuery, useDocumentTitle, useTenantModules } from "../lib/hooks.js";
import { clickableRowProps } from "../lib/a11y.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  shortId,
  titleCase,
  toIsoDate,
  toNumber,
} from "../lib/format.js";
import type {
  Bounty,
  EquityExercise,
  EquityGrant,
  EquityVesting,
} from "../lib/types.js";

const GRANT_TYPES = ["OPTION", "RSU", "SAR"] as const;
const BOUNTY_STATUSES = [
  "ALL",
  "OPEN",
  "CLAIMED",
  "SUBMITTED",
  "ACCEPTED",
  "CANCELLED",
] as const;

type BountyAction = "claim" | "submit" | "accept" | "cancel";

export function RewardsPage() {
  useDocumentTitle("激励");
  // AUD-017：扩展域未启用时不要发请求（默认 P0 租户会 403）。
  const { modules: enabledModules, loading: modulesLoading } = useTenantModules();
  const equityEnabled = enabledModules.has("EQUITY");
  const poolEnabled = enabledModules.has("STRATEGIC_POOL");
  const [tab, setTab] = useState("bounties");
  const grants = useApiQuery<EquityGrant[]>(
    equityEnabled ? "/api/v1/equity-grants" : null,
  );
  const exercises = useApiQuery<EquityExercise[]>(
    equityEnabled ? "/api/v1/equity-exercises" : null,
  );
  const bounties = useApiQuery<Bounty[]>("/api/v1/bounties");

  // 模块能力加载完成后，把默认标签落到第一个已启用的标签上。
  useEffect(() => {
    if (modulesLoading) return;
    const enabledTabs = [
      ...(equityEnabled ? ["equity"] : []),
      "bounties",
      ...(poolEnabled ? ["pools"] : []),
    ];
    if (!enabledTabs.includes(tab)) setTab(enabledTabs[0] ?? "bounties");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesLoading, equityEnabled, poolEnabled]);

  const grantList = grants.data ?? [];
  const exerciseList = exercises.data ?? [];
  const bountyList = bounties.data ?? [];
  const openBounties = bountyList.filter(
    (bounty) => bounty.status === "OPEN" || bounty.status === "CLAIMED",
  );

  // Bounties can be priced in different currencies; never sum them together.
  const bountyTotalsLabel = (() => {
    const totals = openBounties.reduce<Record<string, number>>((acc, bounty) => {
      const currency = bounty.currency || "CNY";
      acc[currency] = (acc[currency] ?? 0) + toNumber(bounty.rewardAmount);
      return acc;
    }, {});
    const entries = Object.entries(totals);
    return entries.length === 0
      ? formatMoney(0, "CNY", { compact: true })
      : entries
          .map(([currency, total]) => formatMoney(total, currency, { compact: true }))
          .join(" · ");
  })();

  return (
    <>
      <PageHeader
        eyebrow="长期与即时激励"
        title="激励"
        description="股权悬崖归属与行权、悬赏市场验收与支付留痕；两条线都强制职责分离。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              grants.reload();
              exercises.reload();
              bounties.reload();
            }}
            loading={grants.loading || exercises.loading || bounties.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">股权授予</span>
          </div>
          <div className="stat-tile__value">{grantList.length}</div>
          <div className="stat-tile__detail">
            {grantList.filter((grant) => grant.status === "ACTIVE").length} active
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">行权审批中</span>
          </div>
          <div className="stat-tile__value">
            {exerciseList.filter((exercise) => exercise.status === "PENDING").length}
          </div>
          <div className="stat-tile__detail">待批准或交割</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">进行中悬赏</span>
          </div>
          <div className="stat-tile__value">{openBounties.length}</div>
          <div className="stat-tile__detail">
            {bountyTotalsLabel}{" "}
            已承诺
          </div>
        </div>
      </div>

      <Tabs
        items={[
          ...(equityEnabled
            ? [{ id: "equity", label: "股权", count: grantList.length }]
            : []),
          { id: "bounties", label: "悬赏", count: bountyList.length },
          ...(poolEnabled ? [{ id: "pools", label: "战略池" }] : []),
        ]}
        active={tab}
        onChange={setTab}
        label="激励计划"
      />

      <div className="tab-panel">
        {tab === "equity" ? (
          <EquityTab
            grants={grantList}
            exercises={exerciseList}
            grantsLoading={grants.loading}
            exercisesLoading={exercises.loading}
            grantsError={
              grants.error instanceof Error ? grants.error : undefined
            }
            exercisesError={
              exercises.error instanceof Error ? exercises.error : undefined
            }
            reloadGrants={grants.reload}
            reloadExercises={exercises.reload}
          />
        ) : tab === "bounties" ? (
          <BountiesTab
            bounties={bountyList}
            loading={bounties.loading}
            error={bounties.error instanceof Error ? bounties.error : undefined}
            reload={bounties.reload}
          />
        ) : (
          <StrategicPoolsTab />
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------- strategic */

interface StrategicPoolCaseView {
  id: string;
  cycleId: string;
  poolAmount: string;
  capAmount: string;
  currency: string;
  rationale: string;
  requestedBy: string;
  units?: number;
  unitStandardCost?: string;
  totalStandardCost?: string;
  transferPricingRef?: string;
  deferredInstallmentMonths: number;
  status: string;
}

function StrategicPoolsTab() {
  const toast = useToast();
  const cases = useApiQuery<StrategicPoolCaseView[]>(
    "/api/v1/strategic-pool-cases",
  );
  const [open, setOpen] = useState(false);
  const [cycleId, setCycleId] = useState("");
  const [poolAmount, setPoolAmount] = useState("100000");
  const [capAmount, setCapAmount] = useState("120000");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createCase() {
    setError(null);
    setBusy(true);
    try {
      await api("/api/v1/strategic-pool-cases", {
        method: "POST",
        body: {
          cycleId: cycleId.trim(),
          poolAmount: poolAmount.trim(),
          capAmount: capAmount.trim(),
          currency: "CNY",
          requestedBy:
            getApiSession().personId ?? getApiSession().userId ?? "console",
          rationale: rationale.trim(),
        },
      });
      toast.success("战略池案件已创建");
      setOpen(false);
      cases.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "创建案例失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function advance(
    record: StrategicPoolCaseView,
    command: "cost-review" | "finance-approve" | "activate" | "settle",
  ) {
    try {
      const body =
        command === "cost-review"
          ? {
              units: 1,
              unitStandardCost: "0",
              transferPricingRef: `TP-${record.id.slice(0, 8)}`,
              reviewedBy:
                getApiSession().personId ?? getApiSession().userId ?? "console",
            }
          : command === "finance-approve"
            ? {
                approvedBy:
                  getApiSession().personId ?? getApiSession().userId ?? "console",
                deferredInstallmentMonths: 0,
              }
            : {};
      await api(`/api/v1/strategic-pool-cases/${record.id}/${command}`, {
        method: "POST",
        body,
      });
      toast.success("战略池已更新", command);
      cases.reload();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "更新案例失败",
      );
    }
  }

  const list = cases.data ?? [];
  return (
    <>
      <Panel
        title="战略 / A 类池"
        action={<Button onClick={() => setOpen(true)}>新建案例</Button>}
      >
        {cases.loading && cases.data === undefined ? (
          <LoadingRows rows={4} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="layers"
            title="暂无战略池案例"
            description="A 类池激活前需标准成本核算、转移定价引用、总额上限与财务签核（INC-09）。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>周期</th>
                <th>资金池 / 上限</th>
                <th>标准成本</th>
                <th>转移定价</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((record) => (
                <tr key={record.id}>
                  <td>
                    <code>{shortId(record.cycleId)}</code>
                  </td>
                  <td>
                    {record.poolAmount} / {record.capAmount} {record.currency}
                  </td>
                  <td>
                    {record.totalStandardCost
                      ? `${record.totalStandardCost} (${record.units} × ${record.unitStandardCost})`
                      : "—"}
                  </td>
                  <td>{record.transferPricingRef ?? "—"}</td>
                  <td>
                    <Badge
                      tone={
                        record.status === "ACTIVE"
                          ? "success"
                          : record.status === "REJECTED"
                            ? "neutral"
                            : "info"
                      }
                    >
                      {titleCase(record.status)}
                    </Badge>
                  </td>
                  <td>
                    {record.status === "DRAFT" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "cost-review")}
                      >
                        成本核算
                      </Button>
                    ) : record.status === "COST_REVIEWED" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "finance-approve")}
                      >
                        财务批准
                      </Button>
                    ) : record.status === "FINANCE_APPROVED" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "activate")}
                      >
                        激活
                      </Button>
                    ) : record.status === "ACTIVE" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "settle")}
                      >
                        交割
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Modal
        open={open}
        title="新建战略池案例"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy} onClick={createCase}>
              新建案例
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {error ? (
            <div className="field--full">
              <InfoNotice tone="warning">{error}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期 ID" htmlFor="sp-cycle">
            <TextInput
              id="sp-cycle"
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="资金池金额" htmlFor="sp-amount">
            <TextInput
              id="sp-amount"
              value={poolAmount}
              onChange={(event) => setPoolAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="上限金额" htmlFor="sp-cap">
            <TextInput
              id="sp-cap"
              value={capAmount}
              onChange={(event) => setCapAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="理由" htmlFor="sp-rationale">
            <TextInput
              id="sp-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ equity */

function EquityTab({
  grants,
  exercises,
  grantsLoading,
  exercisesLoading,
  grantsError,
  exercisesError,
  reloadGrants,
  reloadExercises,
}: {
  grants: EquityGrant[];
  exercises: EquityExercise[];
  grantsLoading: boolean;
  exercisesLoading: boolean;
  grantsError: Error | undefined;
  exercisesError: Error | undefined;
  reloadGrants: () => void;
  reloadExercises: () => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const [createOpen, setCreateOpen] = useState(false);
  const [grantCode, setGrantCode] = useState("");
  const [personId, setPersonId] = useState("");
  const [grantType, setGrantType] = useState<string>("OPTION");
  const [totalUnits, setTotalUnits] = useState("");
  const [strikePrice, setStrikePrice] = useState("0");
  const [currency, setCurrency] = useState("CNY");
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10));
  const [vestingStart, setVestingStart] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cliffMonths, setCliffMonths] = useState("12");
  const [vestingMonths, setVestingMonths] = useState("48");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selectedGrant, setSelectedGrant] = useState<EquityGrant | null>(null);
  const [exerciseUnits, setExerciseUnits] = useState("");
  const [requestedBy, setRequestedBy] = useState(session.personId);
  const [exerciseError, setExerciseError] = useState<string | null>(null);
  const [exerciseSubmitting, setExerciseSubmitting] = useState(false);

  const [exerciseAction, setExerciseAction] = useState<{
    kind: "approve" | "settle";
    exercise: EquityExercise;
  } | null>(null);
  const [approvedBy, setApprovedBy] = useState(session.personId);
  const [actionError, setActionError] = useState<string | null>(null);

  const vesting = useApiQuery<EquityVesting>(
    selectedGrant
      ? `/api/v1/equity-grants/${selectedGrant.id}/vesting`
      : null,
    selectedGrant?.id,
  );

  function openCreate() {
    setPersonId(people[0]?.id ?? "");
    setGrantCode("");
    setGrantType("OPTION");
    setTotalUnits("");
    setStrikePrice("0");
    setCurrency("CNY");
    const today = new Date().toISOString().slice(0, 10);
    setGrantDate(today);
    setVestingStart(today);
    setCliffMonths("12");
    setVestingMonths("48");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createGrant(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api("/api/v1/equity-grants", {
        method: "POST",
        body: {
          personId,
          grantCode: grantCode.trim(),
          grantType,
          totalUnits,
          strikePrice,
          currency: currency.toUpperCase(),
          grantDate: toIsoDate(grantDate),
          vestingStart: toIsoDate(vestingStart),
          cliffMonths: Math.max(0, Math.floor(toNumber(cliffMonths))),
          vestingMonths: Math.max(1, Math.floor(toNumber(vestingMonths))),
        },
      });
      toast.success("股权授予已创建", grantCode);
      setCreateOpen(false);
      reloadGrants();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建授予失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openGrant(grant: EquityGrant) {
    setSelectedGrant(grant);
    setExerciseUnits("");
    setRequestedBy(session.personId);
    setExerciseError(null);
  }

  async function createExercise(event: FormEvent) {
    event.preventDefault();
    if (!selectedGrant) return;
    setExerciseSubmitting(true);
    setExerciseError(null);
    try {
      await api(`/api/v1/equity-grants/${selectedGrant.id}/exercises`, {
        method: "POST",
        body: { units: exerciseUnits, requestedBy },
      });
      toast.success("行权申请已提交", selectedGrant.grantCode);
      setExerciseUnits("");
      reloadExercises();
      vesting.reload();
    } catch (caught) {
      setExerciseError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "发起行权失败。",
      );
    } finally {
      setExerciseSubmitting(false);
    }
  }

  async function executeExerciseAction() {
    if (!exerciseAction) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api(
        `/api/v1/equity-exercises/${exerciseAction.exercise.id}/${exerciseAction.kind}`,
        {
          method: "POST",
          body:
            exerciseAction.kind === "approve" ? { approvedBy } : undefined,
        },
      );
      toast.success(
        exerciseAction.kind === "approve"
          ? "行权已批准"
          : "行权已交割",
        shortId(exerciseAction.exercise.id),
      );
      setExerciseAction(null);
      reloadExercises();
      if (selectedGrant) vesting.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "操作失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Panel
        title="股权授予"
        subtitle="悬崖 + 按月归属，申请→批准→交割三段分离"
        action={
          <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
            新建授予
          </Button>
        }
        flush
      >
        {grantsError ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={grantsError} onRetry={reloadGrants} />
          </div>
        ) : grantsLoading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : grants.length === 0 ? (
          <EmptyState
            icon="rewards"
            title="暂无股权授予"
            description="创建带归属计划的授予，开始跟踪悬崖与可行使数量。"
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                新建授予
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table table-clickable">
              <thead>
                <tr>
                  <th>授予</th>
                  <th>人员</th>
                  <th>类型</th>
                  <th className="cell-num">数量</th>
                  <th className="cell-num">行权价</th>
                  <th>归属中</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} {...clickableRowProps(() => openGrant(grant))}>
                    <td>
                      <span className="cell-primary">{grant.grantCode}</span>
                      <span className="cell-sub">
                        Granted {formatDate(grant.grantDate)}
                      </span>
                    </td>
                    <td>{displayName(grant.personId, people)}</td>
                    <td>{grant.grantType}</td>
                    <td className="cell-num">
                      {Number(grant.totalUnits).toLocaleString("en-US")}
                    </td>
                    <td className="cell-num">
                      {formatMoney(grant.strikePrice, grant.currency)}
                    </td>
                    <td>
                      {grant.cliffMonths}mo cliff · {grant.vestingMonths}mo
                      <span className="cell-sub">
                        From {formatDate(grant.vestingStart)}
                      </span>
                    </td>
                    <td>
                      <Badge status={grant.status} />
                    </td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          openGrant(grant);
                        }}
                      >
                        待处理
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="行权"
        subtitle="行权申请不能由申请人本人批准"
        className="section-gap"
        flush
      >
        {exercisesError ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={exercisesError} onRetry={reloadExercises} />
          </div>
        ) : exercisesLoading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : exercises.length === 0 ? (
          <EmptyState
            icon="layers"
            title="暂无行权申请"
            description="悬崖期满后，打开授予发起行权数量申请。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>授予</th>
                  <th>人员</th>
                  <th className="cell-num">数量</th>
                  <th className="cell-num">成本</th>
                  <th>已发起</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exercises.map((exercise) => {
                  const grant = grants.find((item) => item.id === exercise.grantId);
                  return (
                    <tr key={exercise.id}>
                      <td>
                        <span className="cell-primary">
                          {grant?.grantCode ?? shortId(exercise.grantId)}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(exercise.id, 12)}
                        </span>
                      </td>
                      <td>{displayName(exercise.personId, people)}</td>
                      <td className="cell-num">
                        {Number(exercise.units).toLocaleString("en-US")}
                      </td>
                      <td className="cell-num">
                        {formatMoney(exercise.totalCost, exercise.currency)}
                      </td>
                      <td className="nowrap">
                        {formatDateTime(exercise.createdAt)}
                      </td>
                      <td>
                        <Badge status={exercise.status} />
                      </td>
                      <td className="cell-actions">
                        {exercise.status === "PENDING" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setApprovedBy(session.personId);
                              setActionError(null);
                              setExerciseAction({ kind: "approve", exercise });
                            }}
                          >
                            批准
                          </Button>
                        ) : exercise.status === "APPROVED" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              setActionError(null);
                              setExerciseAction({ kind: "settle", exercise });
                            }}
                          >
                            交割
                          </Button>
                        ) : (
                          <span className="subtle">已交割</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={createOpen}
        title="新建股权授予"
        description="归属计时从归属起始日开始，而非授予日。"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-grant-form"
              loading={submitting}
            >
              新建授予
            </Button>
          </>
        }
      >
        <form id="create-grant-form" onSubmit={createGrant} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="人员" htmlFor="grant-person">
            <PersonSelect id="grant-person" value={personId} onChange={setPersonId} />
          </FormField>
          <FormField label="授予编号" htmlFor="grant-code">
            <TextInput
              id="grant-code"
              value={grantCode}
              onChange={(event) => setGrantCode(event.target.value)}
              placeholder="OPT-2026-001"
              required
            />
          </FormField>
          <FormField label="授予类型" htmlFor="grant-type">
            <Select
              id="grant-type"
              value={grantType}
              onChange={(event) => setGrantType(event.target.value)}
            >
              {GRANT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="总量" htmlFor="grant-units">
            <TextInput
              id="grant-units"
              type="number"
              min="0"
              step="1"
              value={totalUnits}
              onChange={(event) => setTotalUnits(event.target.value)}
              required
            />
          </FormField>
          <FormField label="行权价" htmlFor="grant-strike">
            <TextInput
              id="grant-strike"
              type="number"
              min="0"
              step="0.01"
              value={strikePrice}
              onChange={(event) => setStrikePrice(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="grant-currency">
            <TextInput
              id="grant-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
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
          <FormField label="归属起始" htmlFor="grant-vesting">
            <TextInput
              id="grant-vesting"
              type="date"
              value={vestingStart}
              onChange={(event) => setVestingStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="悬崖（月）" htmlFor="grant-cliff">
            <TextInput
              id="grant-cliff"
              type="number"
              min="0"
              step="1"
              value={cliffMonths}
              onChange={(event) => setCliffMonths(event.target.value)}
              required
            />
          </FormField>
          <FormField label="总归属期（月）" htmlFor="grant-months">
            <TextInput
              id="grant-months"
              type="number"
              min="1"
              step="1"
              value={vestingMonths}
              onChange={(event) => setVestingMonths(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedGrant)}
        title={selectedGrant ? `Grant ${selectedGrant.grantCode}` : "授予详情"}
        description={
          selectedGrant
            ? `${displayName(selectedGrant.personId, people)} · ${selectedGrant.grantType} · v${selectedGrant.version}`
            : undefined
        }
        onClose={() => setSelectedGrant(null)}
        wide
      >
        {selectedGrant ? (
          <div className="stack">
            {vesting.error ? (
              <ErrorNotice error={vesting.error} onRetry={vesting.reload} />
            ) : vesting.loading || !vesting.data ? (
              <div className="loading-inline">
                <span className="spinner" /> Computing vesting…
              </div>
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">可行使</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.availableUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">当前可行使</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">已归属</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.vestedUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">
                      {Number(vesting.data.exercisedUnits).toLocaleString("en-US")} exercised
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">未归属</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.unvestedUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">
                      {vesting.data.fullyVested ? "fully vested" : "still vesting"}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">下次归属</div>
                    <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                      {vesting.data.nextVestAt
                        ? formatDate(vesting.data.nextVestAt)
                        : "—"}
                    </div>
                    <div className="coverage-cell__sub">
                      {selectedGrant.cliffMonths}mo cliff
                    </div>
                  </div>
                </div>
                <p className="subtle" style={{ fontSize: 11.5 }}>
                  As of {formatDateTime(vesting.data.asOf)}
                </p>
              </>
            )}

            <div className="detail-section">
              <div className="detail-section__title">发起行权</div>
              <form onSubmit={createExercise} className="form-grid">
                {exerciseError ? (
                  <div className="field--full">
                    <InfoNotice tone="warning">{exerciseError}</InfoNotice>
                  </div>
                ) : null}
                <FormField label="数量" htmlFor="exercise-units">
                  <TextInput
                    id="exercise-units"
                    type="number"
                    min="0"
                    step="1"
                    value={exerciseUnits}
                    onChange={(event) => setExerciseUnits(event.target.value)}
                    placeholder={vesting.data?.availableUnits ?? "0"}
                    required
                  />
                </FormField>
                <FormField label="发起人" htmlFor="exercise-requester">
                  <PersonSelect
                    id="exercise-requester"
                    value={requestedBy}
                    onChange={setRequestedBy}
                  />
                </FormField>
                <div className="field--full form-actions">
                  <Button type="submit" variant="primary" loading={exerciseSubmitting}>
                    发起行权
                  </Button>
                </div>
              </form>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">授予条款</div>
              <DefinitionList
                items={[
                  { label: "总量", value: Number(selectedGrant.totalUnits).toLocaleString("en-US") },
                  {
                    label: "行权价",
                    value: formatMoney(selectedGrant.strikePrice, selectedGrant.currency),
                  },
                  { label: "授予日", value: formatDate(selectedGrant.grantDate) },
                  {
                    label: "归属起始",
                    value: formatDate(selectedGrant.vestingStart),
                  },
                  { label: "状态", value: <Badge status={selectedGrant.status} /> },
                  { label: "创建时间", value: formatDateTime(selectedGrant.createdAt) },
                ]}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(exerciseAction)}
        title={
          exerciseAction?.kind === "approve"
            ? "批准行权"
            : "Settle equity exercise"
        }
        description={
          exerciseAction?.kind === "approve"
            ? "申请人不能批准自己的行权。"
            : "交割即行权完成；请确认款项/成本已处理。"
        }
        onClose={() => setExerciseAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseAction(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={executeExerciseAction}
              loading={submitting}
            >
              {exerciseAction?.kind === "approve" ? "批准" : "交割"}
            </Button>
          </>
        }
      >
        {exerciseAction ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Exercise", value: shortId(exerciseAction.exercise.id, 14) },
                {
                  label: "数量",
                  value: Number(exerciseAction.exercise.units).toLocaleString("en-US"),
                },
                {
                  label: "Total cost",
                  value: formatMoney(
                    exerciseAction.exercise.totalCost,
                    exerciseAction.exercise.currency,
                  ),
                },
                {
                  label: "发起人",
                  value: displayName(exerciseAction.exercise.requestedBy, people),
                },
              ]}
            />
            {exerciseAction.kind === "approve" ? (
              <FormField label="批准人" htmlFor="exercise-approver">
                <PersonSelect
                  id="exercise-approver"
                  value={approvedBy}
                  onChange={setApprovedBy}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- bounties */

function BountiesTab({
  bounties,
  loading,
  error,
  reload,
}: {
  bounties: Bounty[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const [filter, setFilter] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [createdBy, setCreatedBy] = useState(session.personId);
  const [dueAt, setDueAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [action, setAction] = useState<{
    kind: BountyAction;
    bounty: Bounty;
  } | null>(null);
  const [actionPerson, setActionPerson] = useState(session.personId);
  const [reviewer, setReviewer] = useState(session.personId);
  const [submissionRef, setSubmissionRef] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const visible =
    filter === "ALL"
      ? bounties
      : bounties.filter((bounty) => bounty.status === filter);

  function openCreate() {
    setTitle("");
    setDescription("");
    setRewardAmount("");
    setCurrency("CNY");
    setCreatedBy(session.personId);
    setDueAt("");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createBounty(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api("/api/v1/bounties", {
        method: "POST",
        body: {
          title: title.trim(),
          description: description.trim(),
          rewardAmount,
          currency: currency.toUpperCase(),
          createdBy,
          dueAt: dueAt ? toIsoDate(dueAt) : undefined,
        },
      });
      toast.success("悬赏已发布", title);
      setCreateOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "发布悬赏失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openAction(kind: BountyAction, bounty: Bounty) {
    setAction({ kind, bounty });
    setActionPerson(session.personId);
    setReviewer(session.personId);
    setSubmissionRef("");
    setPaymentRef("");
    setActionError(null);
  }

  async function executeAction() {
    if (!action) return;
    const { kind, bounty } = action;
    if (kind === "submit" && !submissionRef.trim()) {
      setActionError("必须填写成果引用。");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      const paths: Record<BountyAction, string> = {
        claim: "claim",
        submit: "submit",
        accept: "accept",
        cancel: "cancel",
      };
      const bodies: Record<BountyAction, unknown> = {
        claim: { personId: actionPerson },
        submit: { personId: actionPerson, submissionRef: submissionRef.trim() },
        accept: {
          reviewerPersonId: reviewer,
          paymentRef: paymentRef.trim() || undefined,
        },
        cancel: undefined,
      };
      await api(`/api/v1/bounties/${bounty.id}/${paths[kind]}`, {
        method: "POST",
        body: bodies[kind],
      });
      toast.success(
        kind === "claim"
          ? "悬赏已认领"
          : kind === "submit"
            ? "Submission recorded"
            : kind === "accept"
              ? "悬赏已验收"
              : "悬赏已取消",
        bounty.title,
      );
      setAction(null);
      reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "操作失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <Tabs
          items={BOUNTY_STATUSES.map((status) => ({
            id: status,
            label: status === "ALL" ? "全部" : titleCase(status),
            count:
              status === "ALL"
                ? bounties.length
                : bounties.filter((bounty) => bounty.status === status).length,
          }))}
          active={filter}
          onChange={setFilter}
          label="悬赏状态"
        />
        <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
          新建悬赏
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <Panel title="悬赏加载中">
          <LoadingRows rows={3} />
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon="rewards"
            title={filter === "ALL" ? "暂无悬赏" : "该状态暂无悬赏"}
            description="发布带奖金的定向任务；认领、提交、验收与支付引用全程留痕。"
            action={
              filter === "ALL" ? (
                <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                  发布悬赏
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setFilter("ALL")}>
                  显示全部
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <div className="connection-grid">
          {visible.map((bounty) => (
            <article className="connection-card" key={bounty.id}>
              <div className="connection-card__top">
                <div className="inline">
                  <span className="connection-card__icon">
                    <Icon name="rewards" size={17} />
                  </span>
                  <div>
                    <h3>{bounty.title}</h3>
                    <div className="connection-card__provider">
                      {formatMoney(bounty.rewardAmount, bounty.currency)}
                    </div>
                  </div>
                </div>
                <Badge status={bounty.status} />
              </div>
              <p
                className="muted"
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {bounty.description}
              </p>
              <div className="definition-list">
                <div className="definition-list__row">
                  <dt>承办人</dt>
                  <dd>
                    {bounty.assigneePersonId
                      ? displayName(bounty.assigneePersonId, people)
                      : "Unclaimed"}
                  </dd>
                </div>
                <div className="definition-list__row">
                  <dt>截止</dt>
                  <dd>{bounty.dueAt ? formatDate(bounty.dueAt) : "—"}</dd>
                </div>
                <div className="definition-list__row">
                  <dt>创建时间</dt>
                  <dd>{formatRelative(bounty.createdAt)}</dd>
                </div>
              </div>
              <div className="row-actions" style={{ flexWrap: "wrap" }}>
                {bounty.status === "OPEN" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openAction("claim", bounty)}
                  >
                    认领
                  </Button>
                ) : null}
                {bounty.status === "CLAIMED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openAction("submit", bounty)}
                  >
                    提交
                  </Button>
                ) : null}
                {bounty.status === "SUBMITTED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openAction("accept", bounty)}
                  >
                    验收
                  </Button>
                ) : null}
                {!["ACCEPTED", "CANCELLED"].includes(bounty.status) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openAction("cancel", bounty)}
                  >
                    取消
                  </Button>
                ) : null}
                {bounty.status === "ACCEPTED" ? (
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    Paid ref {bounty.paymentRef ?? "not recorded"}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        title="发布悬赏"
        description="明确成果、金额与截止日；发布人可以是任意已登记人员。"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-bounty-form"
              loading={submitting}
            >
              发布悬赏
            </Button>
          </>
        }
      >
        <form id="create-bounty-form" onSubmit={createBounty} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="标题" htmlFor="bounty-title" className="field--full">
            <TextInput
              id="bounty-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="完成季度对账演练"
              required
            />
          </FormField>
          <FormField
            label="说明"
            htmlFor="bounty-description"
            className="field--full"
          >
            <Textarea
              id="bounty-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="验收条件是什么？"
              required
            />
          </FormField>
          <FormField label="奖金金额" htmlFor="bounty-reward">
            <TextInput
              id="bounty-reward"
              type="number"
              min="0"
              step="0.01"
              value={rewardAmount}
              onChange={(event) => setRewardAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="bounty-currency">
            <TextInput
              id="bounty-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="创建人" htmlFor="bounty-creator">
            <PersonSelect
              id="bounty-creator"
              value={createdBy}
              onChange={setCreatedBy}
            />
          </FormField>
          <FormField label="截止日期（可选）" htmlFor="bounty-due">
            <TextInput
              id="bounty-due"
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(action)}
        title={
          action
            ? action.kind === "claim"
              ? "认领悬赏"
              : action.kind === "submit"
                ? "Submit bounty"
                : action.kind === "accept"
                  ? "验收悬赏"
                  : "取消悬赏"
            : ""
        }
        description={
          action?.kind === "accept"
            ? "验收记录支付引用并关闭悬赏。"
            : action?.kind === "cancel"
              ? "取消不可逆；已验收的悬赏不能取消。"
              : action?.bounty.title
        }
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              关闭
            </Button>
            <Button
              variant={action?.kind === "cancel" ? "danger" : "primary"}
              onClick={executeAction}
              loading={submitting}
            >
              {action?.kind === "claim"
                ? "认领"
                : action?.kind === "submit"
                  ? "提交"
                  : action?.kind === "accept"
                    ? "验收"
                    : "取消悬赏"}
            </Button>
          </>
        }
      >
        {action ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            {action.kind === "claim" || action.kind === "submit" ? (
              <FormField label="人员" htmlFor="bounty-person">
                <PersonSelect
                  id="bounty-person"
                  value={actionPerson}
                  onChange={setActionPerson}
                />
              </FormField>
            ) : null}
            {action.kind === "submit" ? (
              <FormField
                label="成果引用"
                htmlFor="bounty-submission"
                hint="链接到交付物、提交记录或文档。"
              >
                <TextInput
                  id="bounty-submission"
                  value={submissionRef}
                  onChange={(event) => setSubmissionRef(event.target.value)}
                  placeholder="https://… or artifact id"
                  required
                />
              </FormField>
            ) : null}
            {action.kind === "accept" ? (
              <>
                <FormField label="复核人" htmlFor="bounty-reviewer">
                  <PersonSelect
                    id="bounty-reviewer"
                    value={reviewer}
                    onChange={setReviewer}
                  />
                </FormField>
                <FormField
                  label="支付引用（可选）"
                  htmlFor="bounty-payment"
                >
                  <TextInput
                    id="bounty-payment"
                    value={paymentRef}
                    onChange={(event) => setPaymentRef(event.target.value)}
                    placeholder="PAY-2026-0042"
                  />
                </FormField>
              </>
            ) : null}
            {action.kind === "cancel" ? (
              <InfoNotice tone="warning">
                此操作将取消 <strong>{action.bounty.title}</strong>. The action
                is recorded in the audit trail.
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
