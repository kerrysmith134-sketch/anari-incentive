import { useMemo, useState, type FormEvent } from "react";
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
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatRelative,
  shortId,
  toIsoDate,
  titleCase,
} from "../lib/format.js";
import type {
  AttributionDecision,
  ContributionAttestation,
  ContributionClaim,
  WorkPackage,
} from "../lib/types.js";
import type { DeliverableView, EvidenceView } from "../lib/ops-types.js";

type PackageAction = "commit" | "start" | "submit" | "review";

interface MemberRow {
  personId: string;
  responsibilityCode: string;
  expectedOutput: string;
}

export function ContributionPage() {
  useDocumentTitle("贡献");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const packages = useApiQuery<WorkPackage[]>("/api/v1/work-packages");
  const claims = useApiQuery<ContributionClaim[]>("/api/v1/contribution-claims");
  const attestations = useApiQuery<ContributionAttestation[]>(
    "/api/v1/contribution-attestations",
  );
  const decisions = useApiQuery<AttributionDecision[]>(
    "/api/v1/attribution-decisions",
  );
  const [tab, setTab] = useState("packages");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [ownerId, setOwnerId] = useState(session.personId);
  const [members, setMembers] = useState<MemberRow[]>([
    {
      personId: session.personId,
      responsibilityCode: "OWNER",
      expectedOutput: "",
    },
  ]);
  const [criteria, setCriteria] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [packageType, setPackageType] = useState("ORDER_DELIVERY");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<WorkPackage | null>(
    null,
  );
  const deliverables = useApiQuery<DeliverableView[]>(
    selectedPackage
      ? `/api/v1/work-packages/${selectedPackage.id}/deliverables`
      : null,
    selectedPackage?.id,
  );
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverableType, setDeliverableType] = useState("DOCUMENT");
  const [deliverableOwner, setDeliverableOwner] = useState(session.personId);
  const [deliverableDueAt, setDeliverableDueAt] = useState("");
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<DeliverableView | null>(null);
  const [acceptDecision, setAcceptDecision] = useState<
    "ACCEPT" | "REJECT" | "ACCEPT_WITH_ISSUES"
  >("ACCEPT");
  const [acceptReviewer, setAcceptReviewer] = useState(session.personId);
  const [acceptComments, setAcceptComments] = useState("");
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [deliverableBusy, setDeliverableBusy] = useState<string | null>(null);
  const evidence = useApiQuery<EvidenceView[]>("/api/v1/evidence");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceType, setEvidenceType] = useState("DELIVERY_RECORD");
  const [evidenceSubjectType, setEvidenceSubjectType] = useState("WORK_PACKAGE");
  const [evidenceSubjectId, setEvidenceSubjectId] = useState("");
  const [evidenceSourceSystem, setEvidenceSourceSystem] = useState("");
  const [evidenceSourceUri, setEvidenceSourceUri] = useState("");
  const [evidencePayload, setEvidencePayload] = useState("{}");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [viewEvidence, setViewEvidence] = useState<EvidenceView | null>(null);
  const [packageAction, setPackageAction] = useState<{
    kind: PackageAction;
    workPackage: WorkPackage;
  } | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"ACCEPT" | "REJECT">(
    "ACCEPT",
  );
  const [reviewer, setReviewer] = useState(session.personId);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimPackageId, setClaimPackageId] = useState("");
  const [claimantId, setClaimantId] = useState(session.personId);
  const [claimType, setClaimType] = useState("CONTRIBUTION");
  const [claimMode, setClaimMode] = useState<
    "STANDARD" | "EXCEPTION" | "BACKFILL"
  >("STANDARD");
  const [claimExceptionReason, setClaimExceptionReason] = useState("");
  const [claimDimensions, setClaimDimensions] = useState("execution, ownership");
  const [claimSummary, setClaimSummary] = useState("");
  const [claimRationale, setClaimRationale] = useState("");
  const [evidenceRefs, setEvidenceRefs] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [attestOpen, setAttestOpen] = useState(false);
  const [attestPackageId, setAttestPackageId] = useState("");
  const [attestSubject, setAttestSubject] = useState("");
  const [attestAttester, setAttestAttester] = useState(session.personId);
  const [attestType, setAttestType] = useState<"PEER" | "MANAGER">("PEER");
  const [attestStatement, setAttestStatement] = useState("");
  const [attestEvidence, setAttestEvidence] = useState("");
  const [attestError, setAttestError] = useState<string | null>(null);

  const [adjudicateClaim, setAdjudicateClaim] =
    useState<ContributionClaim | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<
    "CONFIRMED" | "PARTIALLY_CONFIRMED" | "REJECTED"
  >("CONFIRMED");
  const [adjudicator, setAdjudicator] = useState(session.personId);
  const [decisionDimensions, setDecisionDimensions] = useState("{}");
  const [acceptedFacts, setAcceptedFacts] = useState("");
  const [rejectedFacts, setRejectedFacts] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [confidenceBand, setConfidenceBand] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const packageList = packages.data ?? [];
  const claimablePackages = packageList.filter(
    (pkg) => pkg.status === "ACCEPTED",
  );
  const claimList = claims.data ?? [];
  const attestationList = attestations.data ?? [];
  const decisionList = decisions.data ?? [];
  const awaitingAdjudication = claimList.filter(
    (claim) =>
      claim.status === "SUBMITTED" || claim.status === "UNDER_REVIEW",
  );

  const decisionByClaim = useMemo(() => {
    const map = new Map<string, AttributionDecision>();
    for (const decision of decisionList) {
      const current = map.get(decision.claimId);
      if (!current || decision.decisionVersion > current.decisionVersion) {
        map.set(decision.claimId, decision);
      }
    }
    return map;
  }, [decisionList]);

  function resetCreate() {
    setTitle("");
    setObjective("");
    setOwnerId(session.personId);
    setMembers([
      {
        personId: session.personId,
        responsibilityCode: "OWNER",
        expectedOutput: "",
      },
    ]);
    setCriteria("");
    setDueAt("");
    setPackageType("ORDER_DELIVERY");
    setFormError(null);
    setCreateOpen(true);
  }

  function updateMember(
    index: number,
    patch: Partial<MemberRow>,
  ) {
    setMembers((current) =>
      current.map((member, position) =>
        position === index ? { ...member, ...patch } : member,
      ),
    );
  }

  async function createPackage(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const criteriaList = criteria
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (criteriaList.length === 0) {
      setFormError("At least one acceptance criterion is required.");
      return;
    }
    if (
      members.length === 0 ||
      members.some(
        (member) =>
          !member.personId ||
          !member.responsibilityCode.trim() ||
          !member.expectedOutput.trim(),
      )
    ) {
      setFormError("Every member needs a person, responsibility and output.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/work-packages", {
        method: "POST",
        body: {
          title: title.trim(),
          objective: objective.trim(),
          ownerPersonId: ownerId,
          members: members.map((member) => ({
            personId: member.personId,
            responsibilityCode: member.responsibilityCode.trim(),
            expectedOutput: member.expectedOutput.trim(),
          })),
          packageType: packageType.trim(),
          acceptanceCriteria: criteriaList,
          dueAt: dueAt ? toIsoDate(dueAt) : undefined,
        },
      });
      toast.success("Work package created", title);
      setCreateOpen(false);
      packages.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the package.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openPackageAction(kind: PackageAction, workPackage: WorkPackage) {
    setPackageAction({ kind, workPackage });
    setReviewDecision("ACCEPT");
    setReviewer(
      people.find((person) => person.id !== workPackage.ownerPersonId)?.id ??
        session.personId,
    );
    setRejectReason("");
    setActionError(null);
  }

  async function executePackageAction() {
    if (!packageAction) return;
    const { kind, workPackage } = packageAction;
    if (kind === "review" && reviewDecision === "REJECT" && rejectReason.trim().length < 3) {
      setActionError("A rejection reason of at least 3 characters is required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      if (kind === "review") {
        if (reviewDecision === "ACCEPT") {
          await api(`/api/v1/work-packages/${workPackage.id}/accept`, {
            method: "POST",
            body: {
              reviewerPersonId: reviewer,
              expectedVersion: workPackage.version,
            },
          });
        } else {
          await api(`/api/v1/work-packages/${workPackage.id}/reject`, {
            method: "POST",
            body: {
              reviewerPersonId: reviewer,
              reason: rejectReason.trim(),
              expectedVersion: workPackage.version,
            },
          });
        }
      } else {
        await api(`/api/v1/work-packages/${workPackage.id}/${kind}`, {
          method: "POST",
          body:
            kind === "commit" ? { expectedVersion: workPackage.version } : undefined,
        });
      }
      toast.success(
        kind === "commit"
          ? "Package committed"
          : kind === "start"
            ? "Work started"
            : kind === "submit"
              ? "Package submitted"
              : reviewDecision === "ACCEPT"
                ? "Package accepted"
                : "Package rejected",
        workPackage.title,
      );
      setPackageAction(null);
      setSelectedPackage(null);
      packages.reload();
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

  function openClaimForm() {
    if (claimablePackages.length === 0) {
      toast.error(
        "No accepted work package",
        "发起申报前请先验收已提交的工作包。",
      );
      return;
    }
    setClaimPackageId(claimablePackages[0]?.id ?? "");
    setClaimantId(session.personId);
    setClaimType("CONTRIBUTION");
    setClaimMode("STANDARD");
    setClaimExceptionReason("");
    setClaimDimensions("execution, ownership");
    setClaimSummary("");
    setClaimRationale("");
    setEvidenceRefs("");
    setClaimError(null);
    setClaimOpen(true);
  }

  function openAttestationForm() {
    const pkg = packageList[0];
    setAttestPackageId(pkg?.id ?? "");
    setAttestSubject(pkg?.ownerPersonId ?? "");
    setAttestAttester(session.personId);
    setAttestType("PEER");
    setAttestStatement("");
    setAttestEvidence("");
    setAttestError(null);
    setAttestOpen(true);
  }

  async function createAttestation(event: FormEvent) {
    event.preventDefault();
    setAttestError(null);
    setSubmitting(true);
    try {
      await api("/api/v1/contribution-attestations", {
        method: "POST",
        body: {
          workPackageId: attestPackageId,
          subjectPersonId: attestSubject,
          attesterPersonId: attestAttester,
          attestationType: attestType,
          statement: attestStatement.trim(),
          evidenceRefs: attestEvidence
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      toast.success("Attestation recorded");
      setAttestOpen(false);
      attestations.reload();
    } catch (caught) {
      setAttestError(
        caught instanceof Error
          ? caught.message
          : "Could not record the attestation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawAttestation(attestation: ContributionAttestation) {
    setSubmitting(true);
    try {
      await api(
        `/api/v1/contribution-attestations/${attestation.id}/withdraw`,
        {
          method: "POST",
          body: { personId: session.personId },
        },
      );
      toast.success("Attestation withdrawn");
      attestations.reload();
    } catch (caught) {
      toast.error(
        "Could not withdraw attestation",
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function createClaim(event: FormEvent) {
    event.preventDefault();
    setClaimError(null);
    const dimensions = claimDimensions
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (dimensions.length === 0) {
      setClaimError("At least one contribution dimension is required.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/contribution-claims", {
        method: "POST",
        body: {
          workPackageId: claimPackageId,
          claimantPersonId: claimantId,
          claimType: claimType.trim(),
          claimMode,
          exceptionReason:
            claimMode === "STANDARD"
              ? undefined
              : claimExceptionReason.trim(),
          claimedContribution: {
            dimensions,
            summary: claimSummary.trim(),
          },
          rationale: claimRationale.trim(),
          evidenceRefs: evidenceRefs
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      toast.success("Contribution claim created", claimSummary.slice(0, 60));
      setClaimOpen(false);
      claims.reload();
    } catch (caught) {
      setClaimError(
        caught instanceof Error ? caught.message : "Could not create the claim.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitClaim(claim: ContributionClaim) {
    setSubmitting(true);
    try {
      await api(`/api/v1/contribution-claims/${claim.id}/submit`, {
        method: "POST",
      });
      toast.success("Claim submitted", shortId(claim.id));
      claims.reload();
    } catch (caught) {
      toast.error(
        "Could not submit the claim",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openAdjudicate(claim: ContributionClaim) {
    setAdjudicateClaim(claim);
    setDecisionStatus("CONFIRMED");
    setAdjudicator(session.personId);
    setDecisionDimensions(
      JSON.stringify(
        Object.fromEntries(
          claim.claimedContribution.dimensions.map((dimension) => [
            dimension,
            1,
          ]),
        ),
        null,
        2,
      ),
    );
    setAcceptedFacts("");
    setRejectedFacts("");
    setDecisionRationale("");
    setConfidenceBand("");
    setDecisionError(null);
  }

  async function submitAttribution() {
    if (!adjudicateClaim) return;
    let dimensions: Record<string, number>;
    try {
      const parsed = JSON.parse(decisionDimensions || "{}") as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(
          (value) => typeof value !== "number" || value < 0 || value > 1,
        )
      ) {
        throw new Error("dimensions must be an object of numbers between 0 and 1");
      }
      dimensions = parsed as Record<string, number>;
    } catch (caught) {
      setDecisionError(
        caught instanceof Error
          ? caught.message
          : "Decision dimensions must be valid JSON.",
      );
      return;
    }
    setSubmitting(true);
    setDecisionError(null);
    try {
      await api("/api/v1/attribution-decisions", {
        method: "POST",
        body: {
          claimId: adjudicateClaim.id,
          adjudicatorPersonId: adjudicator,
          status: decisionStatus,
          acceptedFacts: acceptedFacts
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          rejectedFacts: rejectedFacts
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          contributionDimensions: dimensions,
          rationale: decisionRationale.trim(),
          confidenceBand: confidenceBand.trim() || undefined,
        },
      });
      toast.success(
        "Attribution decision recorded",
        titleCase(decisionStatus),
      );
      setAdjudicateClaim(null);
      claims.reload();
      decisions.reload();
    } catch (caught) {
      setDecisionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "无法记录决策。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openDeliverable() {
    setDeliverableTitle("");
    setDeliverableType("DOCUMENT");
    setDeliverableOwner(selectedPackage?.ownerPersonId ?? session.personId);
    setDeliverableDueAt("");
    setDeliverableError(null);
    setDeliverableOpen(true);
  }

  async function createDeliverable() {
    if (!selectedPackage) return;
    setDeliverableError(null);
    try {
      await api(`/api/v1/work-packages/${selectedPackage.id}/deliverables`, {
        method: "POST",
        body: {
          title: deliverableTitle.trim(),
          deliverableType: deliverableType.trim(),
          ownerPersonId: deliverableOwner,
          dueAt: deliverableDueAt
            ? new Date(deliverableDueAt).toISOString()
            : undefined,
        },
      });
      toast.success("Deliverable added", deliverableTitle);
      setDeliverableOpen(false);
      deliverables.reload();
    } catch (caught) {
      setDeliverableError(
        caught instanceof ApiError ? caught.message : "Could not add deliverable",
      );
    }
  }

  async function submitDeliverable(deliverable: DeliverableView) {
    setDeliverableBusy(`submit:${deliverable.id}`);
    try {
      await api(`/api/v1/deliverables/${deliverable.id}/submit`, {
        method: "POST",
        body: {},
      });
      toast.success("交付物已提交", deliverable.title);
      deliverables.reload();
    } catch (caught) {
      toast.error(
        "Could not submit deliverable",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setDeliverableBusy(null);
    }
  }

  async function acceptDeliverable() {
    if (!acceptTarget) return;
    setAcceptError(null);
    try {
      await api(`/api/v1/deliverables/${acceptTarget.id}/acceptance`, {
        method: "POST",
        body: {
          decision: acceptDecision,
          reviewerPersonId: acceptReviewer,
          comments: acceptComments.trim() || undefined,
        },
      });
      toast.success("Deliverable reviewed", acceptTarget.title);
      setAcceptTarget(null);
      deliverables.reload();
    } catch (caught) {
      setAcceptError(
        caught instanceof ApiError ? caught.message : "Could not record acceptance",
      );
    }
  }

  function openEvidence() {
    setEvidenceType("DELIVERY_RECORD");
    setEvidenceSubjectType("WORK_PACKAGE");
    setEvidenceSubjectId(packageList[0]?.id ?? "");
    setEvidenceSourceSystem("");
    setEvidenceSourceUri("");
    setEvidencePayload("{}");
    setEvidenceError(null);
    setEvidenceOpen(true);
  }

  async function submitEvidence() {
    setEvidenceError(null);
    try {
      const normalizedPayload = JSON.parse(evidencePayload) as Record<
        string,
        unknown
      >;
      await api("/api/v1/evidence", {
        method: "POST",
        body: {
          evidenceType: evidenceType.trim(),
          subjectType: evidenceSubjectType.trim(),
          subjectId: evidenceSubjectId,
          sourceSystem: evidenceSourceSystem.trim(),
          sourceUri: evidenceSourceUri.trim() || undefined,
          normalizedPayload,
          submittedBy: session.personId,
        },
      });
      toast.success("Evidence recorded", evidenceType);
      setEvidenceOpen(false);
      evidence.reload();
    } catch (caught) {
      setEvidenceError(
        caught instanceof Error ? caught.message : "Could not record evidence",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Contribution evidence"
        title="贡献"
        description="Work packages freeze a commitment snapshot; claims cite evidence; a non-claimant adjudicator records the attribution decision. Every step is versioned."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              packages.reload();
              claims.reload();
              decisions.reload();
              attestations.reload();
            }}
            loading={packages.loading || claims.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">工作包</span>
          </div>
          <div className="stat-tile__value">{packageList.length}</div>
          <div className="stat-tile__detail">
            {packageList.filter((pkg) => pkg.status === "IN_PROGRESS").length} in
            progress
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">待认定申报</span>
          </div>
          <div className="stat-tile__value">{awaitingAdjudication.length}</div>
          <div className="stat-tile__detail">已提交或复核中</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">贡献认定</span>
          </div>
          <div className="stat-tile__value">{decisionList.length}</div>
          <div className="stat-tile__detail">版本化并记录复核人</div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "packages", label: "工作包", count: packageList.length },
          { id: "claims", label: "申报", count: claimList.length },
          {
            id: "attestations",
            label: "贡献证明",
            count: attestationList.length,
          },
          {
            id: "evidence",
            label: "证据",
            count: evidence.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="Contribution views"
      />

      <div className="tab-panel">
        {tab === "packages" ? (
          <Panel
            title="工作包"
            subtitle="Draft → committed → in progress → submitted → accepted"
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={resetCreate}>
                新建工作包
              </Button>
            }
            flush
          >
            {packages.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={packages.error} onRetry={packages.reload} />
              </div>
            ) : packages.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : packageList.length === 0 ? (
              <EmptyState
                icon="layers"
                title="暂无工作包"
                description="工作包在提交承诺时冻结目标、成员、产出与验收标准。"
                action={
                  <Button variant="primary" size="sm" icon="plus" onClick={resetCreate}>
                    创建工作包
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>工作包</th>
                      <th>负责人</th>
                      <th>成员</th>
                      <th>状态</th>
                      <th>截止</th>
                      <th>版本</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {packageList.map((workPackage) => (
                      <tr key={workPackage.id}>
                        <td>
                          <span className="cell-primary">{workPackage.title}</span>
                          <span className="cell-sub">
                            {titleCase(workPackage.packageType)} ·{" "}
                            {workPackage.acceptanceCriteria.length} criteria
                          </span>
                        </td>
                        <td>{displayName(workPackage.ownerPersonId, people)}</td>
                        <td>{workPackage.members.length}</td>
                        <td>
                          <Badge status={workPackage.status} />
                        </td>
                        <td className="nowrap">
                          {workPackage.dueAt ? formatDate(workPackage.dueAt) : "—"}
                        </td>
                        <td>v{workPackage.version}</td>
                        <td className="cell-actions">
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedPackage(workPackage)}
                            >
                              待处理
                            </Button>
                            {workPackage.status === "DRAFT" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  openPackageAction("commit", workPackage)
                                }
                              >
                                承诺
                              </Button>
                            ) : null}
                            {workPackage.status === "COMMITTED" ||
                            workPackage.status === "BLOCKED" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  openPackageAction("start", workPackage)
                                }
                              >
                                开始
                              </Button>
                            ) : null}
                            {workPackage.status === "IN_PROGRESS" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  openPackageAction("submit", workPackage)
                                }
                              >
                                提交
                              </Button>
                            ) : null}
                            {workPackage.status === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  openPackageAction("review", workPackage)
                                }
                              >
                                复核
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
        ) : tab === "claims" ? (
          <Panel
            title="Contribution claims"
            subtitle="A claimant cannot adjudicate their own claim"
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={openClaimForm}
                disabled={claimablePackages.length === 0}
              >
                新建申报
              </Button>
            }
            flush
          >
            {claims.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={claims.error} onRetry={claims.reload} />
              </div>
            ) : claims.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : claimList.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="No contribution claim"
                description={
                  claimablePackages.length === 0
                    ? "申报只能针对已验收的工作包；请先提交并验收工作包。"
                    : "申报说明本人做了什么贡献、由哪些证据支持。"
                }
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon="plus"
                    onClick={openClaimForm}
                    disabled={claimablePackages.length === 0}
                  >
                    新建申报
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>认领</th>
                      <th>工作包</th>
                      <th>申报人</th>
                      <th>状态</th>
                      <th>决策</th>
                      <th>更新时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {claimList.map((claim) => {
                      const workPackage = packageList.find(
                        (pkg) => pkg.id === claim.workPackageId,
                      );
                      const decision = decisionByClaim.get(claim.id);
                      return (
                        <tr key={claim.id}>
                          <td>
                            <span className="cell-primary">
                              {claim.claimType}
                            </span>
                            {claim.claimMode !== "STANDARD" ? (
                              <Badge tone="warning">
                                {titleCase(claim.claimMode)}
                              </Badge>
                            ) : null}
                            <span className="cell-sub">
                              {claim.claimedContribution.summary}
                            </span>
                          </td>
                          <td>{workPackage?.title ?? shortId(claim.workPackageId)}</td>
                          <td>{displayName(claim.claimantPersonId, people)}</td>
                          <td>
                            <Badge status={claim.status} />
                          </td>
                          <td>
                            {decision ? (
                              <Badge status={decision.status} />
                            ) : (
                              <span className="subtle">—</span>
                            )}
                          </td>
                          <td className="nowrap">
                            {formatRelative(claim.updatedAt)}
                          </td>
                          <td className="cell-actions">
                            <div className="row-actions">
                              {claim.status === "DRAFT" ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void submitClaim(claim)}
                                  loading={submitting}
                                >
                                  提交
                                </Button>
                              ) : null}
                              {claim.status === "SUBMITTED" ||
                              claim.status === "UNDER_REVIEW" ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => openAdjudicate(claim)}
                                >
                                  认定
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : tab === "attestations" ? (
          <Panel
            title="Peer and manager attestations"
            subtitle="支持参与人贡献的独立证明"
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={openAttestationForm}
                disabled={packageList.length === 0}
              >
                添加证明
              </Button>
            }
            flush
          >
            {attestations.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice
                  error={attestations.error}
                  onRetry={attestations.reload}
                />
              </div>
            ) : attestations.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : attestationList.length === 0 ? (
              <EmptyState
                icon="people"
                title="No attestation"
                description="同侪与直属经理可添加支持工作包贡献的证明陈述。"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon="plus"
                    onClick={openAttestationForm}
                    disabled={packageList.length === 0}
                  >
                    添加证明
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>工作包</th>
                      <th>主体</th>
                      <th>证明人</th>
                      <th>类型</th>
                      <th>声明</th>
                      <th>状态</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {attestationList.map((attestation) => {
                      const workPackage = packageList.find(
                        (pkg) => pkg.id === attestation.workPackageId,
                      );
                      return (
                        <tr key={attestation.id}>
                          <td>
                            {workPackage?.title ??
                              shortId(attestation.workPackageId)}
                          </td>
                          <td>
                            {displayName(attestation.subjectPersonId, people)}
                          </td>
                          <td>
                            {displayName(attestation.attesterPersonId, people)}
                          </td>
                          <td>{titleCase(attestation.attestationType)}</td>
                          <td>{attestation.statement}</td>
                          <td>
                            <Badge status={attestation.status} />
                          </td>
                          <td className="cell-actions">
                            {attestation.status === "SUBMITTED" &&
                            attestation.attesterPersonId ===
                              session.personId ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void withdrawAttestation(attestation)
                                }
                              >
                                撤回
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : (
          <Panel
            title="证据"
            subtitle="Evidence nodes with provenance, payload and quality status"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={openEvidence}
              >
                添加证据
              </Button>
            }
          >
            {evidence.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={evidence.error} onRetry={evidence.reload} />
              </div>
            ) : evidence.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (evidence.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="layers"
                title="No evidence node"
                description="证据必须有出处：来源系统、主体与负载哈希。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>证据</th>
                      <th>主体</th>
                      <th>来源</th>
                      <th>质量</th>
                      <th>已记录</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(evidence.data ?? []).map((node) => (
                      <tr key={node.id}>
                        <td>
                          <span className="cell-primary">
                            {titleCase(node.evidenceType)}
                          </span>
                          <span className="cell-sub mono">
                            {shortId(node.payloadHash, 14)}
                          </span>
                        </td>
                        <td>
                          {titleCase(node.subjectType)}
                          <span className="cell-sub mono">
                            {shortId(node.subjectId, 10)}
                          </span>
                        </td>
                        <td>
                          {node.sourceSystem}
                          {node.sourceUri ? (
                            <span className="cell-sub mono">
                              {node.sourceUri}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <Badge status={node.qualityStatus} />
                        </td>
                        <td className="nowrap">
                          {formatDateTime(node.createdAt)}
                        </td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewEvidence(node)}
                          >
                            负载
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>

      <Modal
        open={attestOpen}
        title="New contribution attestation"
        description="经理证明要求证明人是对象当前直属经理。"
        onClose={() => setAttestOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAttestOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="attestation-form"
              loading={submitting}
            >
              记录证明
            </Button>
          </>
        }
      >
        <form id="attestation-form" className="stack" onSubmit={createAttestation}>
          {attestError ? (
            <InfoNotice tone="warning">{attestError}</InfoNotice>
          ) : null}
          <FormField label="工作包" htmlFor="attest-package">
            <Select
              id="attest-package"
              value={attestPackageId}
              onChange={(event) => {
                const next = packageList.find(
                  (pkg) => pkg.id === event.target.value,
                );
                setAttestPackageId(event.target.value);
                setAttestSubject(next?.ownerPersonId ?? "");
              }}
              required
            >
              <option value="">Select a package…</option>
              {packageList.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.title} · {pkg.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="主体" htmlFor="attest-subject">
            <PersonSelect
              id="attest-subject"
              value={attestSubject}
              onChange={setAttestSubject}
            />
          </FormField>
          <FormField label="证明人" htmlFor="attest-attester">
            <PersonSelect
              id="attest-attester"
              value={attestAttester}
              onChange={setAttestAttester}
            />
          </FormField>
          <FormField label="类型" htmlFor="attest-type">
            <Select
              id="attest-type"
              value={attestType}
              onChange={(event) =>
                setAttestType(event.target.value as "PEER" | "MANAGER")
              }
            >
              <option value="PEER">同侪</option>
              <option value="MANAGER">经理</option>
            </Select>
          </FormField>
          <FormField
            label="声明"
            htmlFor="attest-statement"
            className="field--full"
          >
            <Textarea
              id="attest-statement"
              value={attestStatement}
              onChange={(event) => setAttestStatement(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="证据引用（逗号分隔）"
            htmlFor="attest-evidence"
            className="field--full"
          >
            <TextInput
              id="attest-evidence"
              value={attestEvidence}
              onChange={(event) => setAttestEvidence(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={createOpen}
        title="New work package"
        description="承诺将当前内容冻结为后续申报的基线。"
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
              form="create-package-form"
              loading={submitting}
            >
              创建工作包
            </Button>
          </>
        }
      >
        <form id="create-package-form" onSubmit={createPackage} className="stack">
          {formError ? <InfoNotice tone="warning">{formError}</InfoNotice> : null}
          <div className="form-grid">
            <FormField label="标题" htmlFor="package-title" className="field--full">
              <TextInput
                id="package-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="目标"
              htmlFor="package-objective"
              className="field--full"
            >
              <Textarea
                id="package-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                required
              />
            </FormField>
            <FormField label="负责人" htmlFor="package-owner">
              <PersonSelect id="package-owner" value={ownerId} onChange={setOwnerId} />
            </FormField>
            <FormField label="截止日期（可选）" htmlFor="package-due">
              <TextInput
                id="package-due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </FormField>
            <FormField
              label="Task / package type"
              htmlFor="package-type"
              hint="Used for evidence-coverage stratification"
            >
              <TextInput
                id="package-type"
                value={packageType}
                onChange={(event) => setPackageType(event.target.value)}
                placeholder="ORDER_DELIVERY"
                required
              />
            </FormField>
            <FormField
              label="Acceptance criteria (one per line)"
              htmlFor="package-criteria"
              className="field--full"
            >
              <Textarea
                id="package-criteria"
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
                placeholder={"Customer accepts the delivery\nEvidence attached for each milestone"}
                required
              />
            </FormField>
          </div>

          <div className="detail-section">
            <div className="detail-section__title">成员与预期产出</div>
            <div className="stack">
              {members.map((member, index) => (
                <div className="form-grid" key={index}>
                  <FormField label={`Member ${index + 1}`} htmlFor={`member-person-${index}`}>
                    <PersonSelect
                      id={`member-person-${index}`}
                      value={member.personId}
                      onChange={(personId) => updateMember(index, { personId })}
                    />
                  </FormField>
                  <FormField
                    label="Responsibility code"
                    htmlFor={`member-code-${index}`}
                  >
                    <TextInput
                      id={`member-code-${index}`}
                      value={member.responsibilityCode}
                      onChange={(event) =>
                        updateMember(index, {
                          responsibilityCode: event.target.value,
                        })
                      }
                      placeholder="OWNER"
                      required
                    />
                  </FormField>
                  <FormField
                    label="Expected output"
                    htmlFor={`member-output-${index}`}
                    className="field--full"
                  >
                    <TextInput
                      id={`member-output-${index}`}
                      value={member.expectedOutput}
                      onChange={(event) =>
                        updateMember(index, {
                          expectedOutput: event.target.value,
                        })
                      }
                      required
                    />
                  </FormField>
                  {members.length > 1 ? (
                    <div className="field--full" style={{ textAlign: "right" }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setMembers((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        移除成员
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() =>
                    setMembers((current) => [
                      ...current,
                      {
                        personId: "",
                        responsibilityCode: "CONTRIBUTOR",
                        expectedOutput: "",
                      },
                    ])
                  }
                >
                  添加成员
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedPackage)}
        title={selectedPackage?.title ?? "工作包"}
        description={
          selectedPackage
            ? `${titleCase(selectedPackage.status)} · v${selectedPackage.version}`
            : undefined
        }
        onClose={() => setSelectedPackage(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setSelectedPackage(null)}>
            关闭
          </Button>
        }
      >
        {selectedPackage ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "负责人",
                  value: displayName(selectedPackage.ownerPersonId, people),
                },
                {
                  label: "截止",
                  value: selectedPackage.dueAt
                    ? formatDate(selectedPackage.dueAt)
                    : "No due date",
                },
                {
                  label: "Commitment",
                  value: selectedPackage.commitmentSnapshot
                    ? `${shortId(selectedPackage.commitmentSnapshot.contentHash, 16)} · ${formatDateTime(selectedPackage.commitmentSnapshot.capturedAt)}`
                    : "Not committed yet",
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">目标</div>
              <div className="reason-box">{selectedPackage.objective}</div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">成员</div>
              <div className="stack" style={{ gap: 8 }}>
                {selectedPackage.members.map((member) => (
                  <div
                    key={`${member.personId}-${member.responsibilityCode}`}
                    className="inline"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>
                      <strong style={{ fontWeight: 600 }}>
                        {displayName(member.personId, people)}
                      </strong>
                      <span className="subtle"> · {member.responsibilityCode}</span>
                    </span>
                    <span className="muted" style={{ textAlign: "right" }}>
                      {member.expectedOutput}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">验收标准</div>
              <ul className="stack" style={{ gap: 5 }}>
                {selectedPackage.acceptanceCriteria.map((criterion) => (
                  <li key={criterion} className="muted">
                    • {criterion}
                  </li>
                ))}
              </ul>
            </div>
            <div className="detail-section">
              <div
                className="inline"
                style={{ justifyContent: "space-between", width: "100%" }}
              >
                <div className="detail-section__title" style={{ margin: 0 }}>
                  交付物
                </div>
                <Button size="sm" variant="secondary" icon="plus" onClick={openDeliverable}>
                  添加
                </Button>
              </div>
              {deliverables.error ? (
                <ErrorNotice
                  error={deliverables.error}
                  onRetry={deliverables.reload}
                />
              ) : deliverables.loading ? (
                <LoadingRows rows={2} />
              ) : (deliverables.data?.length ?? 0) === 0 ? (
                <p className="muted">该工作包暂无交付物记录。</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>交付物</th>
                        <th>状态</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(deliverables.data ?? []).map((deliverable) => (
                        <tr key={deliverable.id}>
                          <td>
                            <span className="cell-primary">
                              {deliverable.title}
                            </span>
                            <span className="cell-sub">
                              {titleCase(deliverable.deliverableType)} ·{" "}
                              {displayName(deliverable.ownerPersonId, people)}
                            </span>
                          </td>
                          <td>
                            <Badge status={deliverable.status} />
                          </td>
                          <td className="cell-actions">
                            {["DRAFT", "REJECTED"].includes(
                              deliverable.status,
                            ) ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={
                                  deliverableBusy ===
                                  `submit:${deliverable.id}`
                                }
                                onClick={() => submitDeliverable(deliverable)}
                              >
                                提交
                              </Button>
                            ) : null}
                            {deliverable.status === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => {
                                  setAcceptTarget(deliverable);
                                  setAcceptDecision("ACCEPT");
                                  setAcceptReviewer(session.personId);
                                  setAcceptComments("");
                                  setAcceptError(null);
                                }}
                              >
                                复核
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(packageAction)}
        title={
          packageAction
            ? packageAction.kind === "review"
              ? "Review work package"
              : packageAction.kind === "commit"
                ? "Commit work package"
                : packageAction.kind === "start"
                  ? "开始"
                  : "Submit work package"
            : ""
        }
        description={
          packageAction
            ? packageAction.kind === "review"
              ? "验收需要复核人；驳回需要理由。"
              : packageAction.workPackage.title
            : undefined
        }
        onClose={() => setPackageAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackageAction(null)}>
              取消
            </Button>
            <Button
              variant={
                packageAction?.kind === "review" && reviewDecision === "REJECT"
                  ? "danger"
                  : "primary"
              }
              onClick={executePackageAction}
              loading={submitting}
            >
              {packageAction?.kind === "review"
                ? reviewDecision === "ACCEPT"
                  ? "验收"
                  : "驳回"
                : packageAction?.kind === "commit"
                  ? "承诺"
                  : packageAction?.kind === "start"
                    ? "开始"
                    : "提交"}
            </Button>
          </>
        }
      >
        {packageAction ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            {packageAction.kind === "review" ? (
              <div className="form-grid">
                <FormField label="决策" htmlFor="package-decision">
                  <Select
                    id="package-decision"
                    value={reviewDecision}
                    onChange={(event) =>
                      setReviewDecision(
                        event.target.value as "ACCEPT" | "REJECT",
                      )
                    }
                  >
                    <option value="ACCEPT">验收</option>
                    <option value="REJECT">驳回</option>
                  </Select>
                </FormField>
                <FormField label="复核人" htmlFor="package-reviewer">
                  <PersonSelect
                    id="package-reviewer"
                    value={reviewer}
                    onChange={setReviewer}
                  />
                </FormField>
                {reviewDecision === "REJECT" ? (
                  <FormField
                    label="原因"
                    htmlFor="package-reason"
                    className="field--full"
                  >
                    <Textarea
                      id="package-reason"
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      required
                    />
                  </FormField>
                ) : null}
                {reviewer === packageAction.workPackage.ownerPersonId ? (
                  <div className="field--full">
                    <InfoNotice tone="warning">
                      The owner is also the reviewer. Acceptance requires an
                      independent reviewer.
                    </InfoNotice>
                  </div>
                ) : null}
              </div>
            ) : (
              <InfoNotice>
                {packageAction.kind === "commit"
                  ? "提交承诺会把目标、成员与验收标准冻结为快照。"
                  : packageAction.kind === "start"
                    ? "Start execution once the package is committed."
                    : "提交后工作包即可由负责人验收。"}
              </InfoNotice>
            )}
            <DefinitionList
              items={[
                { label: "工作包", value: packageAction.workPackage.title },
                {
                  label: "版本",
                  value: `v${packageAction.workPackage.version}`,
                },
                {
                  label: "成员",
                  value: packageAction.workPackage.members.length,
                },
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={claimOpen}
        title="New contribution claim"
        description="State the contribution, dimensions and evidence references."
        onClose={() => setClaimOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setClaimOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-claim-form"
              loading={submitting}
            >
              新建申报
            </Button>
          </>
        }
      >
        <form id="create-claim-form" onSubmit={createClaim} className="form-grid">
          {claimError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{claimError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="工作包" htmlFor="claim-package">
            <Select
              id="claim-package"
              value={claimPackageId}
              onChange={(event) => setClaimPackageId(event.target.value)}
              required
            >
              <option value="">Select a package…</option>
              {claimablePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.title} · {pkg.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="申报人" htmlFor="claim-claimant">
            <PersonSelect
              id="claim-claimant"
              value={claimantId}
              onChange={setClaimantId}
            />
          </FormField>
          <FormField label="申报类型" htmlFor="claim-type">
            <TextInput
              id="claim-type"
              value={claimType}
              onChange={(event) => setClaimType(event.target.value)}
              placeholder="CONTRIBUTION"
              required
            />
          </FormField>
          <FormField label="Claim mode" htmlFor="claim-mode">
            <Select
              id="claim-mode"
              value={claimMode}
              onChange={(event) =>
                setClaimMode(
                  event.target.value as
                    | "STANDARD"
                    | "EXCEPTION"
                    | "BACKFILL",
                )
              }
            >
              <option value="STANDARD">标准</option>
              <option value="EXCEPTION">例外</option>
              <option value="BACKFILL">补录</option>
            </Select>
          </FormField>
          {claimMode !== "STANDARD" ? (
            <FormField
              label="Exception / backfill reason"
              htmlFor="claim-exception-reason"
            >
              <TextInput
                id="claim-exception-reason"
                value={claimExceptionReason}
                onChange={(event) =>
                  setClaimExceptionReason(event.target.value)
                }
                required
              />
            </FormField>
          ) : null}
          <FormField
            label="维度（逗号分隔）"
            htmlFor="claim-dimensions"
          >
            <TextInput
              id="claim-dimensions"
              value={claimDimensions}
              onChange={(event) => setClaimDimensions(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Contribution summary"
            htmlFor="claim-summary"
            className="field--full"
          >
            <Textarea
              id="claim-summary"
              value={claimSummary}
              onChange={(event) => setClaimSummary(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="理由"
            htmlFor="claim-rationale"
            className="field--full"
          >
            <Textarea
              id="claim-rationale"
              value={claimRationale}
              onChange={(event) => setClaimRationale(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="证据引用（逗号分隔）"
            htmlFor="claim-evidence"
            className="field--full"
            hint="Evidence node UUIDs; optional."
          >
            <TextInput
              id="claim-evidence"
              value={evidenceRefs}
              onChange={(event) => setEvidenceRefs(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(adjudicateClaim)}
        title="Adjudicate contribution claim"
        description="裁决人不能是申报人；决策会替代之前的版本。"
        onClose={() => setAdjudicateClaim(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjudicateClaim(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={submitAttribution}
              loading={submitting}
            >
              记录决策
            </Button>
          </>
        }
      >
        {adjudicateClaim ? (
          <div className="stack">
            {decisionError ? (
              <InfoNotice tone="warning">{decisionError}</InfoNotice>
            ) : null}
            {adjudicator === adjudicateClaim.claimantPersonId ? (
              <InfoNotice tone="warning">
                The adjudicator is the claimant. Separation of duties requires a
                different person.
              </InfoNotice>
            ) : null}
            <div className="reason-box">
              <strong>{adjudicateClaim.claimedContribution.summary}</strong>
              <p style={{ marginTop: 6 }}>{adjudicateClaim.rationale}</p>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {adjudicateClaim.claimedContribution.dimensions.map((dimension) => (
                  <span className="chip" key={dimension}>
                    {dimension}
                  </span>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <FormField label="决策" htmlFor="attribution-status">
                <Select
                  id="attribution-status"
                  value={decisionStatus}
                  onChange={(event) =>
                    setDecisionStatus(
                      event.target.value as
                        | "CONFIRMED"
                        | "PARTIALLY_CONFIRMED"
                        | "REJECTED",
                    )
                  }
                >
                  <option value="CONFIRMED">确认</option>
                  <option value="PARTIALLY_CONFIRMED">部分确认</option>
                  <option value="REJECTED">驳回</option>
                </Select>
              </FormField>
              <FormField label="Adjudicator" htmlFor="attribution-adjudicator">
                <PersonSelect
                  id="attribution-adjudicator"
                  value={adjudicator}
                  onChange={setAdjudicator}
                />
              </FormField>
              <FormField
                label="Contribution dimensions (JSON)"
                htmlFor="attribution-dimensions"
                className="field--full"
                hint='Numbers between 0 and 1, e.g. {"execution":0.7,"ownership":0.3}.'
              >
                <Textarea
                  id="attribution-dimensions"
                  value={decisionDimensions}
                  onChange={(event) => setDecisionDimensions(event.target.value)}
                  className="input mono"
                  spellCheck={false}
                />
              </FormField>
              <FormField label="Accepted facts (one per line)" htmlFor="accepted-facts">
                <Textarea
                  id="accepted-facts"
                  value={acceptedFacts}
                  onChange={(event) => setAcceptedFacts(event.target.value)}
                />
              </FormField>
              <FormField label="Rejected facts (one per line)" htmlFor="rejected-facts">
                <Textarea
                  id="rejected-facts"
                  value={rejectedFacts}
                  onChange={(event) => setRejectedFacts(event.target.value)}
                />
              </FormField>
              <FormField
                label="理由"
                htmlFor="attribution-rationale"
                className="field--full"
              >
                <Textarea
                  id="attribution-rationale"
                  value={decisionRationale}
                  onChange={(event) => setDecisionRationale(event.target.value)}
                  required
                />
              </FormField>
              <FormField
                label="Confidence band (optional)"
                htmlFor="confidence-band"
                className="field--full"
              >
                <TextInput
                  id="confidence-band"
                  value={confidenceBand}
                  onChange={(event) => setConfidenceBand(event.target.value)}
                  placeholder="HIGH"
                />
              </FormField>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deliverableOpen}
        title="添加交付物"
        description={selectedPackage?.title}
        onClose={() => setDeliverableOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeliverableOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createDeliverable}>
              添加交付物
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {deliverableError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{deliverableError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="标题" htmlFor="deliverable-title">
            <TextInput
              id="deliverable-title"
              value={deliverableTitle}
              onChange={(event) => setDeliverableTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="类型" htmlFor="deliverable-type">
            <TextInput
              id="deliverable-type"
              value={deliverableType}
              onChange={(event) => setDeliverableType(event.target.value)}
              placeholder="DOCUMENT"
              required
            />
          </FormField>
          <FormField label="负责人" htmlFor="deliverable-owner">
            <PersonSelect
              id="deliverable-owner"
              value={deliverableOwner}
              onChange={setDeliverableOwner}
            />
          </FormField>
          <FormField label="Due (optional)" htmlFor="deliverable-due">
            <TextInput
              id="deliverable-due"
              type="date"
              value={deliverableDueAt}
              onChange={(event) => setDeliverableDueAt(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(acceptTarget)}
        title="Review deliverable"
        description={acceptTarget?.title}
        onClose={() => setAcceptTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAcceptTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={acceptDeliverable}>
              记录决策
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {acceptError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{acceptError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="决策" htmlFor="deliverable-decision">
            <Select
              id="deliverable-decision"
              value={acceptDecision}
              onChange={(event) =>
                setAcceptDecision(
                  event.target.value as
                    | "ACCEPT"
                    | "REJECT"
                    | "ACCEPT_WITH_ISSUES",
                )
              }
            >
              <option value="ACCEPT">验收</option>
              <option value="ACCEPT_WITH_ISSUES">有遗留问题验收</option>
              <option value="REJECT">驳回</option>
            </Select>
          </FormField>
          <FormField label="复核人" htmlFor="deliverable-reviewer">
            <PersonSelect
              id="deliverable-reviewer"
              value={acceptReviewer}
              onChange={setAcceptReviewer}
            />
          </FormField>
          <FormField
            label="Comments (optional)"
            htmlFor="deliverable-comments"
            className="field--full"
          >
            <Textarea
              id="deliverable-comments"
              value={acceptComments}
              onChange={(event) => setAcceptComments(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={evidenceOpen}
        title="添加证据"
        description="Activity monitoring fields are rejected server-side."
        onClose={() => setEvidenceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEvidenceOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitEvidence}>
              添加证据
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {evidenceError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{evidenceError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Evidence type" htmlFor="evidence-type">
            <TextInput
              id="evidence-type"
              value={evidenceType}
              onChange={(event) => setEvidenceType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Subject type" htmlFor="evidence-subject-type">
            <Select
              id="evidence-subject-type"
              value={evidenceSubjectType}
              onChange={(event) => setEvidenceSubjectType(event.target.value)}
            >
              {["WORK_PACKAGE", "CLAIM", "ORDER", "PERSON"].map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Subject id" htmlFor="evidence-subject-id">
            {evidenceSubjectType === "WORK_PACKAGE" ? (
              <Select
                id="evidence-subject-id"
                value={evidenceSubjectId}
                onChange={(event) => setEvidenceSubjectId(event.target.value)}
                required
              >
                <option value="">选择工作包…</option>
                {packageList.map((workPackage) => (
                  <option key={workPackage.id} value={workPackage.id}>
                    {workPackage.title}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                id="evidence-subject-id"
                value={evidenceSubjectId}
                onChange={(event) => setEvidenceSubjectId(event.target.value)}
                placeholder="UUID"
                required
              />
            )}
          </FormField>
          <FormField label="来源系统" htmlFor="evidence-source">
            <TextInput
              id="evidence-source"
              value={evidenceSourceSystem}
              onChange={(event) => setEvidenceSourceSystem(event.target.value)}
              placeholder="CRM"
              required
            />
          </FormField>
          <FormField label="Source URI (optional)" htmlFor="evidence-uri">
            <TextInput
              id="evidence-uri"
              value={evidenceSourceUri}
              onChange={(event) => setEvidenceSourceUri(event.target.value)}
            />
          </FormField>
          <FormField
            label="Normalized payload (JSON)"
            htmlFor="evidence-payload"
            className="field--full"
          >
            <Textarea
              id="evidence-payload"
              value={evidencePayload}
              onChange={(event) => setEvidencePayload(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(viewEvidence)}
        title="Evidence payload"
        description={
          viewEvidence
            ? `${titleCase(viewEvidence.evidenceType)} · ${viewEvidence.sourceSystem}`
            : undefined
        }
        onClose={() => setViewEvidence(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setViewEvidence(null)}>
            关闭
          </Button>
        }
      >
        {viewEvidence ? (
          <pre className="code-block">
            {JSON.stringify(
              {
                payload: viewEvidence.normalizedPayload,
                payloadHash: viewEvidence.payloadHash,
                redactedFields: viewEvidence.redactedFields,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </Modal>
    </>
  );
}
