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
  Textarea,
  TextInput,
} from "../components/ui.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface BountyView {
  id: string;
  title: string;
  description: string;
  rewardAmount: string;
  currency: string;
  status: string;
  assigneePersonId?: string;
}

interface GrantView {
  id: string;
  grantCode: string;
  grantType: string;
  totalUnits: string;
  cliffMonths: number;
  vestingMonths: number;
  status: string;
  personId: string;
}

interface VestingView {
  vestedUnits: string;
  availableUnits: string;
  unvestedUnits: string;
  nextVestAt?: string;
  fullyVested: boolean;
}

interface WorkPackageView {
  id: string;
  title: string;
  status: string;
  objective?: string;
}

interface RunView {
  id: string;
  mode: string;
  status: string;
  resultHash?: string;
  lines?: Array<{
    id: string;
    personId: string;
    incentiveType?: string;
    amount?: string;
    netAmount?: string;
  }>;
}

/** 员工自助：我的悬赏 / 我的股权 / 我的提成。 */
export function MyRewardsPage() {
  useDocumentTitle("我的激励");
  const toast = useToast();
  const { session } = useAuth();
  const me = session.personId;
  const bounties = useApiQuery<BountyView[]>("/api/v1/bounties");
  const grants = useApiQuery<GrantView[]>("/api/v1/equity-grants");
  const runs = useApiQuery<RunView[]>("/api/v1/calculation-runs");
  const [tab, setTab] = useState("bounties");
  const packages = useApiQuery<WorkPackageView[]>("/api/v1/work-packages");

  const bountyList = bounties.data ?? [];
  const grantList = grants.data ?? [];
  const runList = runs.data ?? [];

  const [submitTarget, setSubmitTarget] = useState<BountyView | null>(null);
  const [submissionRef, setSubmissionRef] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [exerciseTarget, setExerciseTarget] = useState<GrantView | null>(null);
  const [exerciseUnits, setExerciseUnits] = useState("");
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  // 我要申报
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimPackage, setClaimPackage] = useState("");
  const [claimDims, setClaimDims] = useState("QUALITY, TIMELINESS");
  const [claimSummary, setClaimSummary] = useState("");
  const [claimEvidence, setClaimEvidence] = useState("");
  const [claimRationale, setClaimRationale] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [savingClaim, setSavingClaim] = useState(false);

  const [vesting, setVesting] = useState<{
    grant: GrantView;
    data: VestingView | null;
  } | null>(null);

  async function claimBounty(bounty: BountyView) {
    try {
      await api(`/api/v1/bounties/${bounty.id}/claim`, {
        method: "POST",
        body: { personId: me },
      });
      toast.success("已认领", bounty.title);
      bounties.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "认领失败");
    }
  }

  async function submitBounty(event: FormEvent) {
    event.preventDefault();
    if (!submitTarget) return;
    setSubmitError(null);
    try {
      await api(`/api/v1/bounties/${submitTarget.id}/submit`, {
        method: "POST",
        body: { personId: me, submissionRef: submissionRef.trim() },
      });
      toast.success("成果已提交", "等待验收");
      setSubmitTarget(null);
      bounties.reload();
    } catch (caught) {
      setSubmitError(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  async function openVesting(grant: GrantView) {
    setVesting({ grant, data: null });
    try {
      const data = await api<VestingView>(
        `/api/v1/equity-grants/${grant.id}/vesting`,
      );
      setVesting({ grant, data });
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "查询失败");
      setVesting(null);
    }
  }

  async function requestExercise(event: FormEvent) {
    event.preventDefault();
    if (!exerciseTarget) return;
    setExerciseError(null);
    try {
      await api(`/api/v1/equity-grants/${exerciseTarget.id}/exercises`, {
        method: "POST",
        body: { units: exerciseUnits, requestedBy: me },
      });
      toast.success("行权申请已提交", "等待管理员审批");
      setExerciseTarget(null);
      grants.reload();
    } catch (caught) {
      setExerciseError(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  const myBounties = bountyList.filter(
    (bounty) =>
      bounty.status === "OPEN" || bounty.assigneePersonId === me,
  );
  const myGrants = grantList.filter((grant) => grant.personId === me);
  const myRuns = runList.filter((run) =>
    (run.lines ?? []).some((line) => line.personId === me),
  );
  const myAcceptedPackages = (packages.data ?? []).filter(
    (item) => item.status === "ACCEPTED",
  );

  async function createClaim(event: FormEvent) {
    event.preventDefault();
    setClaimError(null);
    setSavingClaim(true);
    try {
      await api("/api/v1/contribution-claims", {
        method: "POST",
        body: {
          workPackageId: claimPackage,
          claimantPersonId: me,
          claimType: "DELIVERABLE_CONTRIBUTION",
          claimedContribution: {
            dimensions: claimDims
              .split(",")
              .map((dimension) => dimension.trim())
              .filter(Boolean),
            summary: claimSummary.trim(),
          },
          evidenceRefs: claimEvidence
            .split(/[,，]/)
            .map((ref) => ref.trim())
            .filter(Boolean),
          rationale: claimRationale.trim(),
        },
      });
      toast.success("申报已创建", "提交后进入人工认定");
      setClaimOpen(false);
      packages.reload();
    } catch (caught) {
      setClaimError(caught instanceof ApiError ? caught.message : "申报失败");
    } finally {
      setSavingClaim(false);
    }
  }

  async function confirmCalculation(
    run: RunView,
    decision: "VIEWED" | "CONFIRMED" | "OBJECTED",
  ) {
    try {
      await api("/api/v1/employee-confirmations", {
        method: "POST",
        body: {
          personId: me,
          targetType: "CALCULATION",
          targetId: run.id,
          decision,
          reason:
            decision === "OBJECTED" ? "员工对计算结果提出异议" : undefined,
        },
      });
      toast.success(
        decision === "CONFIRMED"
          ? "已确认计算结果"
          : decision === "OBJECTED"
            ? "已提出异议"
            : "已标记查看",
      );
    } catch (caught) {
      toast.error(
        "操作失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="自助服务"
        title="我的激励"
        description="查看并处理属于你的悬赏、股权归属与提成结果。所有操作仅作用于你本人。"
        actions={
          <Button variant="secondary" onClick={() => bounties.reload()}>
            刷新
          </Button>
        }
      />
      <Tabs
        items={[
          { id: "bounties", label: "我的悬赏", count: myBounties.length },
          { id: "equity", label: "我的股权", count: myGrants.length },
          { id: "commission", label: "我的提成", count: myRuns.length },
          { id: "claims", label: "我要申报", count: myAcceptedPackages.length },
        ]}
        active={tab}
        onChange={setTab}
        label="我的激励视图"
      />

      <div className="tab-panel">
        {tab === "bounties" ? (
          <Panel title="我的悬赏" flush>
            {bounties.loading && bounties.data === undefined ? (
              <LoadingRows rows={3} />
            ) : myBounties.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无悬赏"
                description="管理员发布悬赏后会出现在这里，你可以认领并提交成果。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>奖金</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {myBounties.map((bounty) => (
                    <tr key={bounty.id}>
                      <td>
                        <strong>{bounty.title}</strong>
                        <div className="hint">{bounty.description}</div>
                      </td>
                      <td className="mono">
                        {bounty.rewardAmount} {bounty.currency}
                      </td>
                      <td>
                        <Badge status={bounty.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {bounty.status === "OPEN" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void claimBounty(bounty)}
                            >
                              认领
                            </Button>
                          ) : null}
                          {bounty.status === "CLAIMED" &&
                          bounty.assigneePersonId === me ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setSubmitTarget(bounty);
                                setSubmissionRef("");
                                setSubmitError(null);
                              }}
                            >
                              提交成果
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

        {tab === "equity" ? (
          <Panel title="我的股权" flush>
            {grantList.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无授予"
                description="公司授予你期权/RSU 后，这里会显示归属进度与行权入口。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>授予</th>
                    <th>类型</th>
                    <th>总量</th>
                    <th>归属</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {myGrants.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        <code>{grant.grantCode}</code>
                      </td>
                      <td>{grant.grantType}</td>
                      <td className="mono">{grant.totalUnits}</td>
                      <td>
                        {grant.cliffMonths} 个月悬崖 · {grant.vestingMonths} 个月
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

        {tab === "commission" ? (
          <Panel title="我的提成" flush>
            {myRuns.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="暂无提成记录"
                description="提成计算完成后，你可见自己的计算行与结算状态。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>模式</th>
                    <th>状态</th>
                    <th>我的金额</th>
                    <th>确认</th>
                  </tr>
                </thead>
                <tbody>
                  {myRuns.map((run) => {
                    const mine = (run.lines ?? []).find(
                      (line) => line.personId === me,
                    );
                    return (
                      <tr key={run.id}>
                        <td>
                          <code>{run.id.slice(0, 8)}</code>
                        </td>
                        <td>{run.mode === "FORMAL" ? "正式" : "影子"}</td>
                        <td>
                          <Badge status={run.status} />
                        </td>
                        <td className="mono">
                          {mine?.amount ?? mine?.netAmount ?? "—"}
                        </td>
                        <td className="cell-actions">
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void confirmCalculation(run, "CONFIRMED")}
                            >
                              确认
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void confirmCalculation(run, "OBJECTED")}
                            >
                              异议
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}
      </div>

      {tab === "claims" ? (
        <Panel
          title="我要申报"
          subtitle="针对已验收的工作包申报本人贡献；申报≠认定，由独立裁决人复核"
          action={
            <Button
              variant="primary"
              disabled={myAcceptedPackages.length === 0}
              onClick={() => {
                setClaimPackage(myAcceptedPackages[0]?.id ?? "");
                setClaimSummary("");
                setClaimRationale("");
                setClaimEvidence("");
                setClaimError(null);
                setClaimOpen(true);
              }}
            >
              新建申报
            </Button>
          }
          flush
        >
          {packages.loading && packages.data === undefined ? (
            <LoadingRows rows={3} />
          ) : myAcceptedPackages.length === 0 ? (
            <EmptyState
              icon="layers"
              title="暂无可申报的工作包"
              description="申报需要工作包已验收。没有时请联系负责人在「贡献认定」中完成验收。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>工作包</th>
                  <th>目标</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {myAcceptedPackages.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                    </td>
                    <td>{item.objective ?? "—"}</td>
                    <td>
                      <Badge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {/* 提交成果 */}
      <Modal
        open={Boolean(submitTarget)}
        title="提交成果"
        onClose={() => setSubmitTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSubmitTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="submit-form">
              提交
            </Button>
          </>
        }
      >
        <form id="submit-form" onSubmit={submitBounty} className="form-grid">
          {submitError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{submitError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="成果引用"
            htmlFor="submission-ref"
            hint="PR 链接、文档编号或可核验的交付物引用"
          >
            <TextInput
              id="submission-ref"
              value={submissionRef}
              onChange={(event) => setSubmissionRef(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 新建申报 */}
      <Modal
        open={claimOpen}
        title="新建贡献申报"
        onClose={() => setClaimOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClaimOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="my-claim-form" loading={savingClaim}>
              提交申报
            </Button>
          </>
        }
      >
        <form id="my-claim-form" onSubmit={createClaim} className="form-grid">
          {claimError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{claimError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="工作包" htmlFor="my-claim-package">
            <Select
              id="my-claim-package"
              value={claimPackage}
              onChange={(event) => setClaimPackage(event.target.value)}
              required
            >
              {myAcceptedPackages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="贡献维度（逗号分隔）" htmlFor="my-claim-dims">
            <TextInput
              id="my-claim-dims"
              value={claimDims}
              onChange={(event) => setClaimDims(event.target.value)}
            />
          </FormField>
          <FormField label="贡献摘要" htmlFor="my-claim-summary">
            <Textarea
              id="my-claim-summary"
              rows={2}
              value={claimSummary}
              onChange={(event) => setClaimSummary(event.target.value)}
              required
            />
          </FormField>
          <FormField label="证据引用（逗号分隔，可选）" htmlFor="my-claim-evidence">
            <TextInput
              id="my-claim-evidence"
              value={claimEvidence}
              onChange={(event) => setClaimEvidence(event.target.value)}
              placeholder="evidence-id-1"
            />
          </FormField>
          <FormField label="申报理由" htmlFor="my-claim-rationale">
            <Textarea
              id="my-claim-rationale"
              rows={2}
              value={claimRationale}
              onChange={(event) => setClaimRationale(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 归属进度 */}
      <Modal
        open={Boolean(vesting)}
        title={`归属进度 · ${vesting?.grant.grantCode ?? ""}`}
        onClose={() => setVesting(null)}
        footer={
          <Button variant="ghost" onClick={() => setVesting(null)}>
            关闭
          </Button>
        }
      >
        {vesting?.data ? (
          <div className="stat-grid stat-grid--three">
            <div>
              <div className="stat-label">已归属</div>
              <div className="stat-value">{vesting.data.vestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">可行使</div>
              <div className="stat-value">{vesting.data.availableUnits}</div>
            </div>
            <div>
              <div className="stat-label">未归属</div>
              <div className="stat-value">{vesting.data.unvestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">下一次归属</div>
              <div className="stat-value">
                {vesting.data.nextVestAt?.slice(0, 10) ?? "—"}
              </div>
            </div>
          </div>
        ) : (
          <LoadingRows rows={2} />
        )}
      </Modal>

      {/* 行权 */}
      <Modal
        open={Boolean(exerciseTarget)}
        title={`行权申请 · ${exerciseTarget?.grantCode ?? ""}`}
        onClose={() => setExerciseTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="my-exercise-form">
              提交申请
            </Button>
          </>
        }
      >
        <form id="my-exercise-form" onSubmit={requestExercise} className="form-grid">
          {exerciseError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{exerciseError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="行权数量" htmlFor="my-exercise-units">
            <TextInput
              id="my-exercise-units"
              value={exerciseUnits}
              onChange={(event) => setExerciseUnits(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
