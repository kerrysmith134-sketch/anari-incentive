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
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<WorkPackage | null>(
    null,
  );
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
        ) : (
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
    </>
  );
}
