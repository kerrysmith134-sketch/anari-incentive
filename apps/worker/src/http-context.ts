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
    // AUD-013/P0：租户头必须始终携带——否则多租户 worker 会以 token 所属
    // 租户的身份操作其它租户的数据。
    const headers: RequestHeaders = { "x-tenant-id": this.tenantId };
    if (this.tokenProvider) {
      headers.authorization = `Bearer ${await this.tokenProvider.getToken()}`;
    }
    return headers;
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
    idempotencyKey?: string;
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

  async listDataQualityIssues(filter?: {
    cycleId?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    if (filter?.cycleId) params.set("cycleId", filter.cycleId);
    if (filter?.status) params.set("status", filter.status);
    return readData<{ id: string; severity: string; status: string }[]>(
      this.baseUrl,
      `/api/v1/data-quality-issues${params.size ? `?${params.toString()}` : ""}`,
      await this.headers(),
    );
  }

  async listEvaluationDecisions(filter?: { cycleId?: string; personId?: string }) {
    const params = new URLSearchParams();
    if (filter?.cycleId) params.set("cycleId", filter.cycleId);
    if (filter?.personId) params.set("personId", filter.personId);
    return readData<
      { id: string; status: string; personId: string; rubricVersionId: string }[]
    >(
      this.baseUrl,
      `/api/v1/evaluation-decisions${params.size ? `?${params.toString()}` : ""}`,
      await this.headers(),
    );
  }

  async listPolicyVersions() {
    return readData<
      { policyVersionId: string; code: string; version: number; status: string }[]
    >(this.baseUrl, "/api/v1/policy-versions", await this.headers());
  }

  async getPolicy(policyVersionId: string) {
    return readData<{ code: string; version: number }>(
      this.baseUrl,
      `/api/v1/policy-versions/${policyVersionId}`,
      await this.headers(),
    );
  }

  async listEvaluationDrafts(filter?: { cycleId?: string; status?: string }) {
    const params = new URLSearchParams();
    if (filter?.cycleId) params.set("cycleId", filter.cycleId);
    if (filter?.status) params.set("status", filter.status);
    return readData<{ id: string; status: string }[]>(
      this.baseUrl,
      `/api/v1/evaluation-drafts${params.size ? `?${params.toString()}` : ""}`,
      await this.headers(),
    );
  }

  async completeAgentTodo(id: string, completedByPersonId?: string) {
    // 系统完成（workflow reconcile）不写 person id——PG 侧为 uuid 列，
    // 传 "SYSTEM_*" 字符串会 22P02 报错；省略即 NULL。
    const body = await postData(
      this.baseUrl,
      `/api/v1/agent-todos/${id}/complete`,
      await this.headers(),
      completedByPersonId ? { completedByPersonId } : {},
    );
    const todo = (body as { data?: Record<string, unknown> }).data ?? {};
    return {
      id: String(todo.id ?? id),
      status: String(todo.status ?? "DONE"),
      completedByPersonId: String(
        todo.completed_by_person_id ?? completedByPersonId,
      ),
      completedAt: todo.completed_at ? String(todo.completed_at) : undefined,
    };
  }

  async listAgentTodos(filter?: {
    assigneePersonId?: string;
    status?: "OPEN" | "DONE" | "CANCELLED";
  }): Promise<
    Array<{
      id: string;
      title: string;
      detail?: string;
      assigneePersonId: string;
      status: string;
      dueAt?: string;
      targetType?: string;
      targetId?: string;
      sourceType?: string;
      sourceId: string;
      idempotencyKey?: string;
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
    // readData 已解包 envelope.data——body 就是数组；兼容旧形态兜底。
    const rows = Array.isArray(body)
      ? (body as Array<Record<string, unknown>>)
      : (((body as { data?: Array<Record<string, unknown>> }).data) ?? []);
    // AUD-010/P0：API 返回 camelCase（AgentTodo）——此前按 snake_case 读取，
    // dueAt/targetId/idempotencyKey 恒为 undefined，导致 workflow 死代码。
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      detail: row.detail ? String(row.detail) : undefined,
      assigneePersonId: String(row.assigneePersonId ?? ""),
      status: String(row.status ?? "OPEN"),
      dueAt: row.dueAt ? String(row.dueAt) : undefined,
      targetType: row.targetType ? String(row.targetType) : undefined,
      targetId: row.targetId ? String(row.targetId) : undefined,
      sourceType: row.sourceType ? String(row.sourceType) : undefined,
      sourceId: String(row.sourceId ?? ""),
      idempotencyKey: row.idempotencyKey ? String(row.idempotencyKey) : undefined,
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
