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
  useDocumentTitle("Contribution");
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
            : "The action failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openClaimForm() {
    if (claimablePackages.length === 0) {
      toast.error(
        "No accepted work package",
        "Accept a submitted package before filing a contribution claim.",
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
        caught instanceof Error ? caught.message : "The action failed.",
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
            : "Could not record the decision.",
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
      toast.success("Deliverable submitted", deliverable.title);
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
        title="Contribution"
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
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Work packages</span>
          </div>
          <div className="stat-tile__value">{packageList.length}</div>
          <div className="stat-tile__detail">
            {packageList.filter((pkg) => pkg.status === "IN_PROGRESS").length} in
            progress
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Claims awaiting attribution</span>
          </div>
          <div className="stat-tile__value">{awaitingAdjudication.length}</div>
          <div className="stat-tile__detail">Submitted or under review</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Attribution decisions</span>
          </div>
          <div className="stat-tile__value">{decisionList.length}</div>
          <div className="stat-tile__detail">Versioned, with reviewer identity</div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "packages", label: "Work packages", count: packageList.length },
          { id: "claims", label: "Claims", count: claimList.length },
          {
            id: "attestations",
            label: "Attestations",
            count: attestationList.length,
          },
          {
            id: "evidence",
            label: "Evidence",
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
            title="Work packages"
            subtitle="Draft → committed → in progress → submitted → accepted"
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={resetCreate}>
                New package
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
                title="No work package"
                description="A work package freezes the objective, members, outputs and acceptance criteria at commit time."
                action={
                  <Button variant="primary" size="sm" icon="plus" onClick={resetCreate}>
                    Create package
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Owner</th>
                      <th>Members</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Version</th>
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
                              Open
                            </Button>
                            {workPackage.status === "DRAFT" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  openPackageAction("commit", workPackage)
                                }
                              >
                                Commit
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
                                Start
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
                                Submit
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
                                Review
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
                New claim
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
                    ? "A claim can only be filed against an accepted work package. Submit and accept a package first."
                    : "A claim states what the person contributed and which evidence supports it."
                }
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon="plus"
                    onClick={openClaimForm}
                    disabled={claimablePackages.length === 0}
                  >
                    Create claim
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Claim</th>
                      <th>Package</th>
                      <th>Claimant</th>
                      <th>Status</th>
                      <th>Decision</th>
                      <th>Updated</th>
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
                                  Submit
                                </Button>
                              ) : null}
                              {claim.status === "SUBMITTED" ||
                              claim.status === "UNDER_REVIEW" ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => openAdjudicate(claim)}
                                >
                                  Adjudicate
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
            subtitle="Independent statements supporting a participant's contribution"
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={openAttestationForm}
                disabled={packageList.length === 0}
              >
                New attestation
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
                description="Peers and the subject's manager can add a statement supporting a work-package contribution."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon="plus"
                    onClick={openAttestationForm}
                    disabled={packageList.length === 0}
                  >
                    Create attestation
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Subject</th>
                      <th>Attester</th>
                      <th>Type</th>
                      <th>Statement</th>
                      <th>Status</th>
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
                                Withdraw
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
            title="Evidence"
            subtitle="Evidence nodes with provenance, payload and quality status"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={openEvidence}
              >
                Add evidence
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
                description="Evidence must have provenance: source system, subject and payload hash."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Evidence</th>
                      <th>Subject</th>
                      <th>Source</th>
                      <th>Quality</th>
                      <th>Recorded</th>
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
                            Payload
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
        description="A manager attestation requires the attester to be the subject's current manager."
        onClose={() => setAttestOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAttestOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="attestation-form"
              loading={submitting}
            >
              Record attestation
            </Button>
          </>
        }
      >
        <form id="attestation-form" className="stack" onSubmit={createAttestation}>
          {attestError ? (
            <InfoNotice tone="warning">{attestError}</InfoNotice>
          ) : null}
          <FormField label="Work package" htmlFor="attest-package">
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
          <FormField label="Subject" htmlFor="attest-subject">
            <PersonSelect
              id="attest-subject"
              value={attestSubject}
              onChange={setAttestSubject}
            />
          </FormField>
          <FormField label="Attester" htmlFor="attest-attester">
            <PersonSelect
              id="attest-attester"
              value={attestAttester}
              onChange={setAttestAttester}
            />
          </FormField>
          <FormField label="Type" htmlFor="attest-type">
            <Select
              id="attest-type"
              value={attestType}
              onChange={(event) =>
                setAttestType(event.target.value as "PEER" | "MANAGER")
              }
            >
              <option value="PEER">Peer</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </FormField>
          <FormField
            label="Statement"
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
            label="Evidence references (comma separated)"
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
        description="Commitment freezes this content as the baseline for later claims."
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
              form="create-package-form"
              loading={submitting}
            >
              Create package
            </Button>
          </>
        }
      >
        <form id="create-package-form" onSubmit={createPackage} className="stack">
          {formError ? <InfoNotice tone="warning">{formError}</InfoNotice> : null}
          <div className="form-grid">
            <FormField label="Title" htmlFor="package-title" className="field--full">
              <TextInput
                id="package-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Objective"
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
            <FormField label="Owner" htmlFor="package-owner">
              <PersonSelect id="package-owner" value={ownerId} onChange={setOwnerId} />
            </FormField>
            <FormField label="Due date (optional)" htmlFor="package-due">
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
            <div className="detail-section__title">Members and expected outputs</div>
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
                        Remove member
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
                  Add member
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedPackage)}
        title={selectedPackage?.title ?? "Work package"}
        description={
          selectedPackage
            ? `${titleCase(selectedPackage.status)} · v${selectedPackage.version}`
            : undefined
        }
        onClose={() => setSelectedPackage(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setSelectedPackage(null)}>
            Close
          </Button>
        }
      >
        {selectedPackage ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "Owner",
                  value: displayName(selectedPackage.ownerPersonId, people),
                },
                {
                  label: "Due",
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
              <div className="detail-section__title">Objective</div>
              <div className="reason-box">{selectedPackage.objective}</div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">Members</div>
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
              <div className="detail-section__title">Acceptance criteria</div>
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
                  Deliverables
                </div>
                <Button size="sm" variant="secondary" icon="plus" onClick={openDeliverable}>
                  Add
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
                <p className="muted">No deliverable recorded for this package.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Deliverable</th>
                        <th>Status</th>
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
                                Submit
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
                                Review
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
                  ? "Start work"
                  : "Submit work package"
            : ""
        }
        description={
          packageAction
            ? packageAction.kind === "review"
              ? "Acceptance requires a reviewer. Rejection requires a reason."
              : packageAction.workPackage.title
            : undefined
        }
        onClose={() => setPackageAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackageAction(null)}>
              Cancel
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
                  ? "Accept package"
                  : "Reject package"
                : packageAction?.kind === "commit"
                  ? "Commit"
                  : packageAction?.kind === "start"
                    ? "Start"
                    : "Submit"}
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
                <FormField label="Decision" htmlFor="package-decision">
                  <Select
                    id="package-decision"
                    value={reviewDecision}
                    onChange={(event) =>
                      setReviewDecision(
                        event.target.value as "ACCEPT" | "REJECT",
                      )
                    }
                  >
                    <option value="ACCEPT">Accept</option>
                    <option value="REJECT">Reject</option>
                  </Select>
                </FormField>
                <FormField label="Reviewer" htmlFor="package-reviewer">
                  <PersonSelect
                    id="package-reviewer"
                    value={reviewer}
                    onChange={setReviewer}
                  />
                </FormField>
                {reviewDecision === "REJECT" ? (
                  <FormField
                    label="Reason"
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
                  ? "Committing freezes the objective, members and acceptance criteria as a snapshot."
                  : packageAction.kind === "start"
                    ? "Start execution once the package is committed."
                    : "Submission makes the package available for owner acceptance."}
              </InfoNotice>
            )}
            <DefinitionList
              items={[
                { label: "Package", value: packageAction.workPackage.title },
                {
                  label: "Version",
                  value: `v${packageAction.workPackage.version}`,
                },
                {
                  label: "Members",
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
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-claim-form"
              loading={submitting}
            >
              Create claim
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
          <FormField label="Work package" htmlFor="claim-package">
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
          <FormField label="Claimant" htmlFor="claim-claimant">
            <PersonSelect
              id="claim-claimant"
              value={claimantId}
              onChange={setClaimantId}
            />
          </FormField>
          <FormField label="Claim type" htmlFor="claim-type">
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
              <option value="STANDARD">Standard</option>
              <option value="EXCEPTION">Exception</option>
              <option value="BACKFILL">Backfill</option>
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
            label="Dimensions (comma separated)"
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
            label="Rationale"
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
            label="Evidence references (comma separated)"
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
        description="The adjudicator cannot be the claimant. The decision supersedes any prior version."
        onClose={() => setAdjudicateClaim(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjudicateClaim(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitAttribution}
              loading={submitting}
            >
              Record decision
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
              <FormField label="Decision" htmlFor="attribution-status">
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
                  <option value="CONFIRMED">Confirm</option>
                  <option value="PARTIALLY_CONFIRMED">Partially confirm</option>
                  <option value="REJECTED">Reject</option>
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
                label="Rationale"
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
        title="Add deliverable"
        description={selectedPackage?.title}
        onClose={() => setDeliverableOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeliverableOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createDeliverable}>
              Add deliverable
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
          <FormField label="Title" htmlFor="deliverable-title">
            <TextInput
              id="deliverable-title"
              value={deliverableTitle}
              onChange={(event) => setDeliverableTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Type" htmlFor="deliverable-type">
            <TextInput
              id="deliverable-type"
              value={deliverableType}
              onChange={(event) => setDeliverableType(event.target.value)}
              placeholder="DOCUMENT"
              required
            />
          </FormField>
          <FormField label="Owner" htmlFor="deliverable-owner">
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
              Cancel
            </Button>
            <Button variant="primary" onClick={acceptDeliverable}>
              Record decision
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
          <FormField label="Decision" htmlFor="deliverable-decision">
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
              <option value="ACCEPT">Accept</option>
              <option value="ACCEPT_WITH_ISSUES">Accept with issues</option>
              <option value="REJECT">Reject</option>
            </Select>
          </FormField>
          <FormField label="Reviewer" htmlFor="deliverable-reviewer">
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
        title="Add evidence"
        description="Activity monitoring fields are rejected server-side."
        onClose={() => setEvidenceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEvidenceOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitEvidence}>
              Add evidence
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
                <option value="">Select a package</option>
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
          <FormField label="Source system" htmlFor="evidence-source">
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
            Close
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
