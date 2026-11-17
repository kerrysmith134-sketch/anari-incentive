/**
 * NP-020：贡献认定草案服务端生成链。
 *
 * 证据由服务端按 claim 解析；模型只做定性综合（D-02）；生成结果为
 * AGENT 草案并记录模型用量；证据不足时 409。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const TENANT = "00000000-0000-4000-8000-000000000001";

const MODEL_OUTPUT = {
  summary: "Delivery evidence supports the claim.",
  dimensionAssessments: [
    {
      dimension: "QUALITY",
      status: "SUPPORTED",
      rationale: "Acceptance record exists.",
      supportingEvidenceRefs: [],
      counterEvidenceRefs: [],
      missingInformation: [],
    },
  ],
  uncertainty: { band: "LOW", reasons: [] },
};

// 生成链会把证据 id 传给模型——SUPPORTED 必须引用存在的证据。
const MODEL_OUTPUT_WITH_REF = {
  ...MODEL_OUTPUT,
  dimensionAssessments: [
    {
      ...MODEL_OUTPUT.dimensionAssessments[0]!,
      supportingEvidenceRefs: ["evidence-ref"],
    },
  ],
};

let appStore: Store;

function app() {
  const platformStore = new MemoryPlatformStore({
    demoTenant: { id: TENANT, name: "Tenant", slug: "t1" },
  });
  return buildApp(
    () => appStore,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: "manager-1",
          roles: ["manager"],
          personId: OWNER,
        };
      },
    },
    platformStore,
    {
      modelScoring: {
        baseUrl: "https://model.test/v1",
        apiKey: "k",
        model: "test-model",
        // 动态回显：从请求里取第一个证据 ref，作为模型的支持引用——
        // 保证引用落在证据集合内（与生产约束一致）。
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          void input;
          const raw = String(init?.body ?? "{}");
          const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
          const userContent = body.messages.at(-1)?.content ?? "[]";
          const parsed = JSON.parse(userContent) as {
            evidence?: Array<{ ref: string }>;
          };
          const ref = parsed.evidence?.[0]?.ref ?? "unknown";
          const output = {
            ...MODEL_OUTPUT,
            dimensionAssessments: [
              {
                ...MODEL_OUTPUT.dimensionAssessments[0]!,
                supportingEvidenceRefs: [ref],
              },
            ],
          };
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(output) } }],
              usage: { prompt_tokens: 30, completion_tokens: 12 },
            }),
            { status: 200 },
          );
        }) as unknown as typeof fetch,
      },
    },
  );
}

async function seedClaimWithEvidence() {
  const wp = await appStore.createWorkPackage({
    title: `np020-${Date.now()}`,
    objective: "np020 objective",
    ownerPersonId: OWNER,
    members: [{ personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" }],
    acceptanceCriteria: ["done"],
  });
  await appStore.commitWorkPackage(wp.id, 1);
  await appStore.startWorkPackage(wp.id);
  await appStore.submitWorkPackage(wp.id);
  await appStore.acceptWorkPackage(wp.id, MEMBER);
  const claim = await appStore.createClaim({
    workPackageId: wp.id,
    claimantPersonId: OWNER,
    claimType: "DELIVERABLE_CONTRIBUTION",
    claimedContribution: { dimensions: ["QUALITY"], summary: "delivered" },
    evidenceRefs: [],
    rationale: "np020 claim",
  });
  const evidence = await appStore.createEvidence({
    sourceSystem: "NP020",
    subjectType: "CONTRIBUTION_CLAIM",
    subjectId: claim.id,
    evidenceType: "NOTE",
    normalizedPayload: { note: "acceptance record" },
    qualityStatus: "VALID",
  });
  // 测试内存店直连：把证据挂到 claim.evidenceRefs（等价于员工补证后的状态）。
  (appStore as unknown as {
    claims: Map<string, { evidenceRefs: string[] }>;
  }).claims.get(claim.id)!.evidenceRefs = [evidence.id];
  return { claim, evidence };
}

describe("NP-020: 贡献草案生成链", () => {
  beforeEach(() => {
    appStore = new Store(TENANT);
    vi.restoreAllMocks();
  });

  it("生成 AGENT 草案：模型元数据/用量记录/证据绑定", async () => {
    const client = app();
    const { claim } = await seedClaimWithEvidence();
    const res = await client.inject({
      method: "POST",
      url: `/api/v1/contribution-claims/${claim.id}/generate-assessment-draft`,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    const draft = (res.json() as { data: Record<string, unknown> }).data;
    expect(draft.generatedByType).toBe("AGENT");
    expect(draft.modelName).toBe("test-model");
    expect(draft.evidenceSnapshotHash).toBeUndefined();
    expect(
      (draft.supporting as Array<{ statement: string }>)[0]?.statement,
    ).toContain("Acceptance record");
  });

  it("无证据的 claim → 409 INSUFFICIENT_EVIDENCE_FOR_GENERATION", async () => {
    const client = app();
    const wp = await appStore.createWorkPackage({
      title: `np020-noev-${Date.now()}`,
      objective: "objective",
      ownerPersonId: OWNER,
      members: [{ personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" }],
      acceptanceCriteria: ["done"],
    });
    await appStore.commitWorkPackage(wp.id, 1);
    await appStore.startWorkPackage(wp.id);
    await appStore.submitWorkPackage(wp.id);
    await appStore.acceptWorkPackage(wp.id, MEMBER);
    const claim = await appStore.createClaim({
      workPackageId: wp.id,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "x" },
      evidenceRefs: [],
      rationale: "no evidence",
    });
    const res = await client.inject({
      method: "POST",
      url: `/api/v1/contribution-claims/${claim.id}/generate-assessment-draft`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain(
      "INSUFFICIENT_EVIDENCE_FOR_GENERATION",
    );
  });
});
