import type {
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ContributionClaim,
  EmployeeConfirmation,
  EvidenceNode,
  LegalGateRecord,
  PublishPolicyInput,
  PublishedPolicy,
  WorkPackage,
} from "@anari/domain";
import type { AgentContext } from "@anari/agent-runtime";

async function readData<T>(
  baseUrl: string,
  path: string,
  tenantId: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-tenant-id": tenantId },
  });
  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      `API ${path} failed: ${body.error?.message ?? response.status}`,
    );
  }
  return body.data as T;
}

async function postData<T>(
  baseUrl: string,
  path: string,
  tenantId: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      `API ${path} failed: ${result.error?.message ?? response.status}`,
    );
  }
  return result.data as T;
}

export class HttpAgentContext implements AgentContext {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  listWorkPackages(): Promise<WorkPackage[]> {
    return readData(this.baseUrl, "/api/v1/work-packages", this.tenantId);
  }

  listClaims(): Promise<ContributionClaim[]> {
    return readData(this.baseUrl, "/api/v1/contribution-claims", this.tenantId);
  }

  listDecisions(claimId?: string): Promise<AttributionDecision[]> {
    const suffix = claimId ? `?claimId=${encodeURIComponent(claimId)}` : "";
    return readData(
      this.baseUrl,
      `/api/v1/attribution-decisions${suffix}`,
      this.tenantId,
    );
  }

  listRuns(): Promise<CalculationRun[]> {
    return readData(this.baseUrl, "/api/v1/calculation-runs", this.tenantId);
  }

  listConfirmations(personId?: string): Promise<EmployeeConfirmation[]> {
    const suffix = personId ? `?personId=${encodeURIComponent(personId)}` : "";
    return readData(
      this.baseUrl,
      `/api/v1/employee-confirmations${suffix}`,
      this.tenantId,
    );
  }

  listAppeals(): Promise<AppealCase[]> {
    return readData(this.baseUrl, "/api/v1/appeals", this.tenantId);
  }

  async getLegalGate(
    policyVersionId: string,
  ): Promise<LegalGateRecord | undefined> {
    const data = await readData<{
      status: string;
      gate?: LegalGateRecord;
    }>(
      this.baseUrl,
      `/api/v1/policy-versions/${encodeURIComponent(policyVersionId)}/legal-gate`,
      this.tenantId,
    );
    return data.status === "RECORDED" ? data.gate : undefined;
  }

  listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    const params = new URLSearchParams();
    if (subjectType) params.set("subjectType", subjectType);
    if (subjectId) params.set("subjectId", subjectId);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return readData(this.baseUrl, `/api/v1/evidence${suffix}`, this.tenantId);
  }

  publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    return postData(
      this.baseUrl,
      "/api/v1/policy-versions",
      this.tenantId,
      input,
    );
  }
}
