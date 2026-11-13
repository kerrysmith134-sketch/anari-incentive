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

  async listEvaluationCycles(): Promise<
    Array<{ id: string; name: string; status: string; startsAt: string; endsAt: string }>
  > {
    return readData<{ id: string; name: string; status: string; startsAt: string; endsAt: string }[]>(
      this.baseUrl,
      "/api/v1/evaluation-cycles",
      await this.headers(),
    );
  }

  async advanceEvaluationCycle(id: string, status: string, reason?: string) {
    return postData(
      this.baseUrl,
      `/api/v1/evaluation-cycles/${id}/advance`,
      await this.headers(),
      { status, reason },
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


  /** NPV2-020：Agent 待办经 API 落库（幂等键透传）。 */
  async upsertAgentTodo(input: {
    title: string;
    detail?: string;
    assigneePersonId: string;
    dueAt?: string;
    targetType?: string;
    targetId?: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    createdByAgentTaskId?: string;
  }): Promise<{
    id: string;
    title: string;
    assigneePersonId: string;
    status: string;
    dueAt?: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
  }> {
    const body = await postData(
      this.baseUrl,
      "/api/v1/agent-todos:upsert",
      await this.headers(),
      input,
    );
    const todo = (body as { data?: Record<string, unknown> }).data ?? {};
    return {
      id: String(todo.id ?? ""),
      title: String(todo.title ?? input.title),
      assigneePersonId: String(todo.assigneePersonId ?? input.assigneePersonId),
      status: String(todo.status ?? "OPEN"),
      dueAt: todo.due_at ? String(todo.due_at) : input.dueAt,
      idempotencyKey: String(todo.idempotency_key ?? input.idempotencyKey),
      sourceType: String(todo.source_type ?? input.sourceType),
      sourceId: String(todo.source_id ?? input.sourceId),
    };
  }

  async listAgentTodos(filter?: {
    assigneePersonId?: string;
    status?: "OPEN" | "DONE" | "CANCELLED";
  }): Promise<
    Array<{
      id: string;
      title: string;
      assigneePersonId: string;
      status: string;
      dueAt?: string;
      targetId?: string;
      sourceId: string;
    }>
  > {
    const params = new URLSearchParams();
    if (filter?.assigneePersonId) params.set("assigneePersonId", filter.assigneePersonId);
    if (filter?.status) params.set("status", filter.status);
    const body = await readData(
      this.baseUrl,
      `/api/v1/agent-todos${params.size ? `?${params.toString()}` : ""}`,
      await this.headers(),
    );
    const rows = (body as { data?: Array<Record<string, unknown>> }).data ?? [];
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      assigneePersonId: String(row.assignee_person_id ?? ""),
      status: String(row.status ?? "OPEN"),
      dueAt: row.due_at ? String(row.due_at) : undefined,
      targetId: row.target_id ? String(row.target_id) : undefined,
      sourceId: String(row.source_id ?? ""),
    }));
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
