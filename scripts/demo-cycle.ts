/**
 * End-to-end demo against a running API.
 *
 * Requires the API server (memory or PostgreSQL) to be running. In dev auth
 * mode no credentials are needed; set TENANT_ID to override the tenant header.
 */
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId = process.env.TENANT_ID;
const ownerId =
  process.env.OWNER_ID ?? "00000000-0000-4000-8000-000000000001";
const memberId =
  process.env.MEMBER_ID ?? "00000000-0000-4000-8000-000000000002";
const reviewerId =
  process.env.REVIEWER_ID ?? "00000000-0000-4000-8000-000000000003";
const cycleId =
  process.env.CYCLE_ID ?? "00000000-0000-4000-8000-000000000020";
const policyVersionId =
  process.env.POLICY_VERSION_ID ?? "00000000-0000-4000-8000-000000000100";

const headers: Record<string, string> = {};
if (tenantId) headers["x-tenant-id"] = tenantId;

async function api<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers:
      body === undefined
        ? headers
        : { ...headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed: ${payload.error?.code ?? response.status} ${
        payload.error?.message ?? ""
      } ${payload.error?.details ? JSON.stringify(payload.error.details) : ""}`,
    );
  }
  return payload.data as T;
}

function log(step: string, detail = ""): void {
  console.log(`- ${step}${detail ? `: ${detail}` : ""}`);
}

const summary: Record<string, unknown> = {};

try {
  log("health", JSON.stringify(await api("GET", "/health")));

  const workPackage = await api<{ id: string; status: string }>(
    "POST",
    "/api/v1/work-packages",
    {
      title: "Demo cross-team order",
      objective: "Deliver and validate a customer order",
      ownerPersonId: ownerId,
      members: [
        {
          personId: ownerId,
          responsibilityCode: "OWNER",
          expectedOutput: "Order delivery",
        },
        {
          personId: memberId,
          responsibilityCode: "CONTRIBUTOR",
          expectedOutput: "Technical validation",
        },
      ],
      acceptanceCriteria: ["Customer accepts the delivery"],
    },
  );
  summary.workPackageId = workPackage.id;
  log("work package", workPackage.id);

  await api("POST", `/api/v1/work-packages/${workPackage.id}/commit`, {
    expectedVersion: 1,
  });
  await api("POST", `/api/v1/work-packages/${workPackage.id}/start`);
  await api("POST", `/api/v1/work-packages/${workPackage.id}/submit`);
  await api("POST", `/api/v1/work-packages/${workPackage.id}/accept`, {
    reviewerPersonId: memberId,
    comments: "Accepted",
  });
  log("work package lifecycle", "ACCEPTED");

  const claims: string[] = [];
  for (const personId of [ownerId, memberId]) {
    const claim = await api<{ id: string }>("POST", "/api/v1/contribution-claims", {
      workPackageId: workPackage.id,
      claimantPersonId: personId,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Delivered the agreed scope",
      },
      evidenceRefs: [],
      rationale: "Delivered the agreed scope",
    });
    await api("POST", `/api/v1/contribution-claims/${claim.id}/submit`);
    await api("POST", "/api/v1/attribution-decisions", {
      claimId: claim.id,
      adjudicatorPersonId: reviewerId,
      status: "CONFIRMED",
      acceptedFacts: ["Delivered"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });
    claims.push(claim.id);
  }
  summary.claimIds = claims;
  log("claims and attribution", claims.join(", "));

  await api("POST", `/api/v1/policy-versions/${policyVersionId}/legal-gate`, {
    policyApproved: true,
    minimumWageChecked: true,
    democraticProcedureRef: "demo-dp",
    employeeNoticeRef: "demo-notice",
    dataProtectionAssessmentRef: "demo-dpia",
    recordedBy: reviewerId,
  });
  log("legal gate", policyVersionId);

  const run = await api<{ id: string; lines: Array<{ personId: string }> }>(
    "POST",
    "/api/v1/calculation-runs",
    {
      cycleId,
      policyVersionId,
      mode: "FORMAL",
      order: { id: `demo-order-${Date.now()}`, grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: ownerId,
          workPackageId: workPackage.id,
          attributionWeight: "0.6",
          role: "OWNER",
        },
        {
          personId: memberId,
          workPackageId: workPackage.id,
          attributionWeight: "0.4",
          role: "CONTRIBUTOR",
        },
      ],
    },
  );
  summary.calculationRunId = run.id;
  log("calculation run", run.id);

  for (const personId of [ownerId, memberId]) {
    await api("POST", "/api/v1/employee-confirmations", {
      personId,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });
  }
  await api("POST", `/api/v1/calculation-runs/${run.id}/approve`);
  await api("POST", `/api/v1/calculation-runs/${run.id}/lock`, {
    confirmation: "LOCK_CALCULATION",
  });
  const ledger = await api<Array<{ id: string; status: string }>>(
    "GET",
    "/api/v1/ledger",
  );
  log("ledger", `${ledger.length} entries, all ${ledger[0]?.status ?? "n/a"}`);

  const batch = await api<{ id: string }>(
    "POST",
    "/api/v1/settlement-batches",
    { cycleId },
  );
  summary.settlementBatchId = batch.id;
  await api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, {
    command: "RECONCILE",
  });
  await api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, {
    command: "SUBMIT",
  });
  await api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, {
    command: "APPROVE",
    actorPersonId: reviewerId,
  });
  await api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, {
    command: "LOCK",
  });
  const exported = await api<{ csv: string }>(
    "POST",
    `/api/v1/settlement-batches/${batch.id}/commands`,
    { command: "EXPORT" },
  );
  await api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, {
    command: "ACKNOWLEDGE",
    externalReference: "demo-finance-batch",
  });
  log("settlement", `${exported.csv.trim().split("\n").length - 1} CSV rows`);

  const rubric = await api<{ id: string }>("POST", "/api/v1/rubrics", {
    code: "DEMO_PERFORMANCE_V1",
    name: "Demo performance",
    dimensions: ["QUALITY"],
    scoringAnchors: { 1: "below", 3: "meets", 5: "exceeds" },
    effectiveFrom: "2026-10-01",
  });
  const evaluationDecisionIds: string[] = [];
  for (const [personId, score] of [
    [ownerId, 4],
    [memberId, 3],
  ] as const) {
    const draft = await api<{ id: string }>(
      "POST",
      "/api/v1/evaluation-drafts",
      {
        cycleId,
        personId,
        generatedByType: "USER",
        evidenceSnapshotHash: `demo-evidence-${personId}`,
        draftPayload: { summary: "Demo evaluation" },
      },
    );
    await api("POST", `/api/v1/evaluation-drafts/${draft.id}/submit`);
    const decision = await api<{ decision: { id: string } }>(
      "POST",
      `/api/v1/evaluation-drafts/${draft.id}/decision`,
      {
        reviewerPersonId: reviewerId,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: score },
        rationale: "Demo review",
      },
    );
    evaluationDecisionIds.push(decision.decision.id);
  }
  summary.evaluationDecisionIds = evaluationDecisionIds;
  log("evaluation decisions", evaluationDecisionIds.join(", "));

  const issue = await api<{ id: string }>(
    "POST",
    "/api/v1/data-quality-issues",
    {
      objectType: "WORK_PACKAGE",
      objectId: workPackage.id,
      issueCode: "DEMO_MISSING_NOTE",
      severity: "WARNING",
    },
  );
  await api("POST", `/api/v1/data-quality-issues/${issue.id}/commands`, {
    command: "RESOLVE",
  });
  summary.dataQualityIssueId = issue.id;
  log("data-quality issue", `${issue.id} RESOLVED`);

  if (ledger[0]) {
    const appeal = await api<{ id: string }>("POST", "/api/v1/appeals", {
      appellantPersonId: ownerId,
      targetType: "LEDGER",
      targetId: ledger[0].id,
      reasonCode: "DEMO_APPEAL",
      statement: "Please confirm the ledger calculation.",
    });
    await api("POST", `/api/v1/appeals/${appeal.id}/triage`, {
      reviewerPersonId: reviewerId,
    });
    await api("POST", `/api/v1/appeals/${appeal.id}/review`);
    await api("POST", `/api/v1/appeals/${appeal.id}/resolve`, {
      reviewerPersonId: reviewerId,
      resolution: "UPHOLD",
      rationale: "Calculation verified",
    });
    summary.appealId = appeal.id;
    log("appeal", `${appeal.id} resolved`);
  }

  console.log("\nDemo completed:");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error("Demo failed:", error);
  process.exitCode = 1;
}
