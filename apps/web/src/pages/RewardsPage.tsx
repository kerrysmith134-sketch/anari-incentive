import { useState, type FormEvent } from "react";
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
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
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
  useDocumentTitle("Rewards");
  const [tab, setTab] = useState("equity");
  const grants = useApiQuery<EquityGrant[]>("/api/v1/equity-grants");
  const exercises = useApiQuery<EquityExercise[]>("/api/v1/equity-exercises");
  const bounties = useApiQuery<Bounty[]>("/api/v1/bounties");

  const grantList = grants.data ?? [];
  const exerciseList = exercises.data ?? [];
  const bountyList = bounties.data ?? [];
  const openBounties = bountyList.filter(
    (bounty) => bounty.status === "OPEN" || bounty.status === "CLAIMED",
  );

  return (
    <>
      <PageHeader
        eyebrow="Long-term and spot rewards"
        title="Rewards"
        description="Equity vesting with cliff-aware exercises, and a bounty marketplace with review and payment trace. Both paths enforce separation of duties."
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
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Equity grants</span>
          </div>
          <div className="stat-tile__value">{grantList.length}</div>
          <div className="stat-tile__detail">
            {grantList.filter((grant) => grant.status === "ACTIVE").length} active
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Exercises in review</span>
          </div>
          <div className="stat-tile__value">
            {exerciseList.filter((exercise) => exercise.status === "PENDING").length}
          </div>
          <div className="stat-tile__detail">Pending approval or settlement</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Open bounties</span>
          </div>
          <div className="stat-tile__value">{openBounties.length}</div>
          <div className="stat-tile__detail">
            {formatMoney(
              openBounties.reduce(
                (total, bounty) => total + toNumber(bounty.rewardAmount),
                0,
              ),
              openBounties[0]?.currency ?? "CNY",
              { compact: true },
            )}{" "}
            committed
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "equity", label: "Equity", count: grantList.length },
          { id: "bounties", label: "Bounties", count: bountyList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="Reward programmes"
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
      toast.success("Strategic pool case created");
      setOpen(false);
      cases.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not create case",
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
      toast.success("Strategic pool updated", command);
      cases.reload();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Could not update case",
      );
    }
  }

  const list = cases.data ?? [];
  return (
    <>
      <Panel
        title="Strategic / A-class pools"
        action={<Button onClick={() => setOpen(true)}>New case</Button>}
      >
        {cases.loading && cases.data === undefined ? (
          <LoadingRows rows={4} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No strategic pool cases"
            description="A-class pools require standard-cost accounting, a transfer-pricing reference, a total cap and finance sign-off before activation (INC-09)."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Pool / cap</th>
                <th>Standard cost</th>
                <th>Transfer pricing</th>
                <th>Status</th>
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
                        Cost review
                      </Button>
                    ) : record.status === "COST_REVIEWED" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "finance-approve")}
                      >
                        Finance approve
                      </Button>
                    ) : record.status === "FINANCE_APPROVED" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "activate")}
                      >
                        Activate
                      </Button>
                    ) : record.status === "ACTIVE" ? (
                      <Button
                        variant="ghost"
                        onClick={() => advance(record, "settle")}
                      >
                        Settle
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
        title="New strategic pool case"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={createCase}>
              Create case
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
          <FormField label="Cycle ID" htmlFor="sp-cycle">
            <TextInput
              id="sp-cycle"
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Pool amount" htmlFor="sp-amount">
            <TextInput
              id="sp-amount"
              value={poolAmount}
              onChange={(event) => setPoolAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Cap amount" htmlFor="sp-cap">
            <TextInput
              id="sp-cap"
              value={capAmount}
              onChange={(event) => setCapAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Rationale" htmlFor="sp-rationale">
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
      toast.success("Equity grant created", grantCode);
      setCreateOpen(false);
      reloadGrants();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the grant.",
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
      toast.success("Exercise requested", selectedGrant.grantCode);
      setExerciseUnits("");
      reloadExercises();
      vesting.reload();
    } catch (caught) {
      setExerciseError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Could not request the exercise.",
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
          ? "Exercise approved"
          : "Exercise settled",
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
            : "The action failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Panel
        title="Equity grants"
        subtitle="Cliff and monthly vesting with request → approve → settle separation"
        action={
          <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
            New grant
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
            title="No equity grant"
            description="Create a grant with a vesting schedule to begin tracking cliff and exercisable units."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                Create grant
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table table-clickable">
              <thead>
                <tr>
                  <th>Grant</th>
                  <th>Person</th>
                  <th>Type</th>
                  <th className="cell-num">Units</th>
                  <th className="cell-num">Strike</th>
                  <th>Vesting</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} onClick={() => openGrant(grant)}>
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
                        Open
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
        title="Exercises"
        subtitle="Requests cannot be approved by their requester"
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
            title="No exercise requested"
            description="Open a grant to request units once the cliff has been reached."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Grant</th>
                  <th>Person</th>
                  <th className="cell-num">Units</th>
                  <th className="cell-num">Cost</th>
                  <th>Requested</th>
                  <th>Status</th>
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
                            Approve
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
                            Settle
                          </Button>
                        ) : (
                          <span className="subtle">Settled</span>
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
        title="New equity grant"
        description="The vesting clock starts on the vesting start date, not the grant date."
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-grant-form"
              loading={submitting}
            >
              Create grant
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
          <FormField label="Person" htmlFor="grant-person">
            <PersonSelect id="grant-person" value={personId} onChange={setPersonId} />
          </FormField>
          <FormField label="Grant code" htmlFor="grant-code">
            <TextInput
              id="grant-code"
              value={grantCode}
              onChange={(event) => setGrantCode(event.target.value)}
              placeholder="OPT-2026-001"
              required
            />
          </FormField>
          <FormField label="Grant type" htmlFor="grant-type">
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
          <FormField label="Total units" htmlFor="grant-units">
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
          <FormField label="Strike price" htmlFor="grant-strike">
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
          <FormField label="Currency" htmlFor="grant-currency">
            <TextInput
              id="grant-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="Grant date" htmlFor="grant-date">
            <TextInput
              id="grant-date"
              type="date"
              value={grantDate}
              onChange={(event) => setGrantDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Vesting start" htmlFor="grant-vesting">
            <TextInput
              id="grant-vesting"
              type="date"
              value={vestingStart}
              onChange={(event) => setVestingStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Cliff (months)" htmlFor="grant-cliff">
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
          <FormField label="Total vesting (months)" htmlFor="grant-months">
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
        title={selectedGrant ? `Grant ${selectedGrant.grantCode}` : "Grant detail"}
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
                    <div className="coverage-cell__label">Available</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.availableUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">exercisable now</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Vested</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.vestedUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">
                      {Number(vesting.data.exercisedUnits).toLocaleString("en-US")} exercised
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Unvested</div>
                    <div className="coverage-cell__value">
                      {Number(vesting.data.unvestedUnits).toLocaleString("en-US")}
                    </div>
                    <div className="coverage-cell__sub">
                      {vesting.data.fullyVested ? "fully vested" : "still vesting"}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Next vest</div>
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
              <div className="detail-section__title">Request an exercise</div>
              <form onSubmit={createExercise} className="form-grid">
                {exerciseError ? (
                  <div className="field--full">
                    <InfoNotice tone="warning">{exerciseError}</InfoNotice>
                  </div>
                ) : null}
                <FormField label="Units" htmlFor="exercise-units">
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
                <FormField label="Requested by" htmlFor="exercise-requester">
                  <PersonSelect
                    id="exercise-requester"
                    value={requestedBy}
                    onChange={setRequestedBy}
                  />
                </FormField>
                <div className="field--full form-actions">
                  <Button type="submit" variant="primary" loading={exerciseSubmitting}>
                    Request exercise
                  </Button>
                </div>
              </form>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Grant terms</div>
              <DefinitionList
                items={[
                  { label: "Total units", value: Number(selectedGrant.totalUnits).toLocaleString("en-US") },
                  {
                    label: "Strike price",
                    value: formatMoney(selectedGrant.strikePrice, selectedGrant.currency),
                  },
                  { label: "Grant date", value: formatDate(selectedGrant.grantDate) },
                  {
                    label: "Vesting start",
                    value: formatDate(selectedGrant.vestingStart),
                  },
                  { label: "Status", value: <Badge status={selectedGrant.status} /> },
                  { label: "Created", value: formatDateTime(selectedGrant.createdAt) },
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
            ? "Approve equity exercise"
            : "Settle equity exercise"
        }
        description={
          exerciseAction?.kind === "approve"
            ? "The requester cannot approve their own exercise."
            : "Settlement marks the exercise complete. Confirm the payment/cost has been handled."
        }
        onClose={() => setExerciseAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseAction(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={executeExerciseAction}
              loading={submitting}
            >
              {exerciseAction?.kind === "approve" ? "Approve" : "Settle"}
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
                  label: "Units",
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
                  label: "Requested by",
                  value: displayName(exerciseAction.exercise.requestedBy, people),
                },
              ]}
            />
            {exerciseAction.kind === "approve" ? (
              <FormField label="Approved by" htmlFor="exercise-approver">
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
      toast.success("Bounty published", title);
      setCreateOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not publish the bounty.",
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
      setActionError("A submission reference is required.");
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
          ? "Bounty claimed"
          : kind === "submit"
            ? "Submission recorded"
            : kind === "accept"
              ? "Bounty accepted"
              : "Bounty cancelled",
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
            : "The action failed.",
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
            label: status === "ALL" ? "All" : titleCase(status),
            count:
              status === "ALL"
                ? bounties.length
                : bounties.filter((bounty) => bounty.status === status).length,
          }))}
          active={filter}
          onChange={setFilter}
          label="Bounty status"
        />
        <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
          New bounty
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <Panel title="Loading bounties">
          <LoadingRows rows={3} />
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon="rewards"
            title={filter === "ALL" ? "No bounty yet" : "No bounty in this status"}
            description="Publish a scoped task with a reward. Claim, submission, acceptance and payment reference are all traced."
            action={
              filter === "ALL" ? (
                <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                  Publish bounty
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setFilter("ALL")}>
                  Show all
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
                  <dt>Assignee</dt>
                  <dd>
                    {bounty.assigneePersonId
                      ? displayName(bounty.assigneePersonId, people)
                      : "Unclaimed"}
                  </dd>
                </div>
                <div className="definition-list__row">
                  <dt>Due</dt>
                  <dd>{bounty.dueAt ? formatDate(bounty.dueAt) : "—"}</dd>
                </div>
                <div className="definition-list__row">
                  <dt>Created</dt>
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
                    Claim
                  </Button>
                ) : null}
                {bounty.status === "CLAIMED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openAction("submit", bounty)}
                  >
                    Submit
                  </Button>
                ) : null}
                {bounty.status === "SUBMITTED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openAction("accept", bounty)}
                  >
                    Accept
                  </Button>
                ) : null}
                {!["ACCEPTED", "CANCELLED"].includes(bounty.status) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openAction("cancel", bounty)}
                  >
                    Cancel
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
        title="Publish a bounty"
        description="Scope the outcome, amount and due date. The creator can be any registered person."
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-bounty-form"
              loading={submitting}
            >
              Publish bounty
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
          <FormField label="Title" htmlFor="bounty-title" className="field--full">
            <TextInput
              id="bounty-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ship the quarterly reconciliation walkthrough"
              required
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor="bounty-description"
            className="field--full"
          >
            <Textarea
              id="bounty-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is the acceptance condition?"
              required
            />
          </FormField>
          <FormField label="Reward amount" htmlFor="bounty-reward">
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
          <FormField label="Currency" htmlFor="bounty-currency">
            <TextInput
              id="bounty-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="Created by" htmlFor="bounty-creator">
            <PersonSelect
              id="bounty-creator"
              value={createdBy}
              onChange={setCreatedBy}
            />
          </FormField>
          <FormField label="Due date (optional)" htmlFor="bounty-due">
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
              ? "Claim bounty"
              : action.kind === "submit"
                ? "Submit bounty"
                : action.kind === "accept"
                  ? "Accept bounty"
                  : "Cancel bounty"
            : ""
        }
        description={
          action?.kind === "accept"
            ? "Acceptance records the payment reference and closes the bounty."
            : action?.kind === "cancel"
              ? "Cancellation is final and cannot be applied to an accepted bounty."
              : action?.bounty.title
        }
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Close
            </Button>
            <Button
              variant={action?.kind === "cancel" ? "danger" : "primary"}
              onClick={executeAction}
              loading={submitting}
            >
              {action?.kind === "claim"
                ? "Claim"
                : action?.kind === "submit"
                  ? "Submit"
                  : action?.kind === "accept"
                    ? "Accept"
                    : "Cancel bounty"}
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
              <FormField label="Person" htmlFor="bounty-person">
                <PersonSelect
                  id="bounty-person"
                  value={actionPerson}
                  onChange={setActionPerson}
                />
              </FormField>
            ) : null}
            {action.kind === "submit" ? (
              <FormField
                label="Submission reference"
                htmlFor="bounty-submission"
                hint="Link to the deliverable, commit or document."
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
                <FormField label="Reviewer" htmlFor="bounty-reviewer">
                  <PersonSelect
                    id="bounty-reviewer"
                    value={reviewer}
                    onChange={setReviewer}
                  />
                </FormField>
                <FormField
                  label="Payment reference (optional)"
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
                This will cancel <strong>{action.bounty.title}</strong>. The action
                is recorded in the audit trail.
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
