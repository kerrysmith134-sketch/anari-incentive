import type {
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ContributionClaim,
  DataQualityIssue,
  EmployeeConfirmation,
  EvaluationDraft,
  InAppNotification,
  EvidenceNode,
  LegalGateRecord,
  PublishPolicyInput,
  PublishedPolicy,
  WorkPackage,
} from "@anari/domain";
import type { AgentContext } from "@anari/agent-runtime";
import type { TokenProvider } from "@anari/auth";

type RequestHeaders = Record<string, string>;

async function readData<T>(
  baseUrl: string,
  path: string,
  headers: RequestHeaders,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
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
  headers: RequestHeaders,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
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
    private readonly tokenProvider?: TokenProvider,
  ) {}

  private async headers(): Promise<RequestHeaders> {
    if (this.tokenProvider) {
      return { authorization: `Bearer ${await this.tokenProvider.getToken()}` };
    }
    return { "x-tenant-id": this.tenantId };
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return readData(
      this.baseUrl,
      "/api/v1/work-packages",
      await this.headers(),
    );
  }

  async listClaims(): Promise<ContributionClaim[]> {
    return readData(
      this.baseUrl,
      "/api/v1/contribution-claims",
      await this.headers(),
    );
  }

  async listDecisions(claimId?: string): Promise<AttributionDecision[]> {
    const suffix = claimId ? `?claimId=${encodeURIComponent(claimId)}` : "";
    return readData(
      this.baseUrl,
      `/api/v1/attribution-decisions${suffix}`,
      await this.headers(),
    );
  }

  async listRuns(): Promise<CalculationRun[]> {
    return readData(
      this.baseUrl,
      "/api/v1/calculation-runs",
      await this.headers(),
    );
  }

  async listConfirmations(personId?: string): Promise<EmployeeConfirmation[]> {
    const suffix = personId ? `?personId=${encodeURIComponent(personId)}` : "";
    return readData(
      this.baseUrl,
      `/api/v1/employee-confirmations${suffix}`,
      await this.headers(),
    );
  }

  async listAppeals(): Promise<AppealCase[]> {
    return readData(this.baseUrl, "/api/v1/appeals", await this.headers());
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
      await this.headers(),
    );
    return data.status === "RECORDED" ? data.gate : undefined;
  }

  async listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    const params = new URLSearchParams();
    if (subjectType) params.set("subjectType", subjectType);
    if (subjectId) params.set("subjectId", subjectId);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return readData(
      this.baseUrl,
      `/api/v1/evidence${suffix}`,
      await this.headers(),
    );
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    return postData(
      this.baseUrl,
      "/api/v1/policy-versions",
      await this.headers(),
      input,
    );
  }

  async createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
  }): Promise<DataQualityIssue> {
    return postData(
      this.baseUrl,
      "/api/v1/data-quality-issues",
      await this.headers(),
      input,
    );
  }

  async createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  }): Promise<InAppNotification> {
    return postData(
      this.baseUrl,
      "/api/v1/notifications",
      await this.headers(),
      input,
    );
  }

  async createEvaluationDraft(input: {
    cycleId: string;
    personId: string;
    generatedByType: "AGENT" | "USER" | "SYSTEM";
    generatedById?: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: string;
    agentTaskId?: string;
    evidenceSnapshotHash: string;
    draftPayload: Record<string, unknown>;
    strengths?: string[];
    counterEvidence?: string[];
    missingInformation?: string[];
    uncertainty?: Record<string, unknown>;
  }): Promise<EvaluationDraft> {
    return postData(
      this.baseUrl,
      "/api/v1/evaluation-drafts",
      await this.headers(),
      input,
    );
  }
}
