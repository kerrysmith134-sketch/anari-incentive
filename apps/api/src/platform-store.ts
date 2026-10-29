import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { formatDecimal, parseDecimal } from "@anari/policy-dsl";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  BudgetAllocation,
  BudgetPool,
  CashGateInput,
  ConsultationOutcome,
  ConsultationType,
  DpiaAssessmentType,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  FinancialFact,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  PolicyAcknowledgement,
  PolicyConsultation,
  RepresentationBodyType,
  RetentionPolicy,
  SettlementAcknowledgement,
  SettlementExport,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "./store.js";

export interface PlatformStore {
  createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant>;
  listTenants(): Promise<PlatformTenant[]>;
  createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser>;
  listUsers(): Promise<PlatformUser[]>;
  addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership>;
  listMemberships(tenantId: string): Promise<PlatformMembership[]>;
  createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson>;
  listPersons(tenantId: string): Promise<PlatformPerson[]>;
  linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson>;
  /** Resolve the person and tenant roles behind a platform user. */
  resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity>;
  createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode>;
  listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]>;
  assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment>;
  listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]>;
  setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson>;
  createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice>;
  listNotices(tenantId: string): Promise<EmployeeNotice[]>;
  getNotice(tenantId: string, noticeId: string): Promise<EmployeeNotice>;
  recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement>;
  listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview>;
  createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation>;
  listRepresentations(tenantId: string): Promise<EmployeeRepresentation[]>;
  createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation>;
  listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]>;
  getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation>;
  concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation>;
  createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord>;
  listDpias(tenantId: string): Promise<DpiaRecord[]>;
  getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord>;
  approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord>;
  createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest>;
  listDsars(tenantId: string, personId?: string): Promise<DsarRequest[]>;
  getDsar(tenantId: string, dsarId: string): Promise<DsarRequest>;
  resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest>;
  createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy>;
  listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]>;
  setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy>;
  createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest>;
  listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]>;
  getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest>;
  listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]>;
  decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest>;
  consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest>;
  createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport>;
  listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]>;
  getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport>;
  acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement>;
  createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool>;
  listBudgetPools(tenantId: string, cycleId?: string): Promise<BudgetPool[]>;
  getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool>;
  approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool>;
  createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation>;
  listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]>;
  releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation>;
  createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput>;
  listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]>;
  createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact>;
  listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]>;
}

function now(): string {
  return new Date().toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

export class MemoryPlatformStore implements PlatformStore {
  private readonly tenants = new Map<string, PlatformTenant>();
  private readonly users = new Map<string, PlatformUser>();
  private readonly memberships = new Map<string, PlatformMembership>();
  private readonly persons = new Map<string, PlatformPerson>();
  private readonly orgNodes = new Map<string, PlatformOrgNode>();
  private readonly orgAssignments = new Map<string, PlatformOrgAssignment>();
  private readonly notices = new Map<string, EmployeeNotice>();
  private readonly acknowledgements = new Map<string, PolicyAcknowledgement>();
  private readonly representations = new Map<string, EmployeeRepresentation>();
  private readonly consultations = new Map<string, PolicyConsultation>();
  private readonly dpias = new Map<string, DpiaRecord>();
  private readonly dsars = new Map<string, DsarRequest>();
  private readonly retentionPolicies = new Map<string, RetentionPolicy>();
  private readonly approvalRequests = new Map<string, ApprovalRequest>();
  private readonly approvalDecisions = new Map<string, ApprovalDecision>();
  private readonly settlementExports = new Map<string, SettlementExport>();
  private readonly settlementAcknowledgements = new Map<
    string,
    SettlementAcknowledgement
  >();
  private readonly budgetPools = new Map<string, BudgetPool>();
  private readonly budgetAllocations = new Map<string, BudgetAllocation>();
  private readonly cashGateInputs = new Map<string, CashGateInput>();
  private readonly financialFacts = new Map<string, FinancialFact>();

  constructor(
    options: {
      /** Seed a demo tenant (and optional people) for memory-mode demos. */
      demoTenant?: {
        id: string;
        name: string;
        slug: string;
        persons?: Array<{
          id: string;
          employeeCode: string;
          displayName: string;
        }>;
      };
    } = {},
  ) {
    const demo = options.demoTenant;
    if (!demo) return;
    const createdAt = now();
    this.tenants.set(demo.id, {
      id: demo.id,
      name: demo.name,
      slug: demo.slug,
      status: "ACTIVE",
      defaultTimezone: "UTC",
      defaultCurrency: "CNY",
      createdAt,
    });
    for (const person of demo.persons ?? []) {
      this.persons.set(person.id, {
        id: person.id,
        tenantId: demo.id,
        employeeCode: person.employeeCode,
        displayName: person.displayName,
        employmentStatus: "ACTIVE",
        createdAt,
      });
    }
  }

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    if ([...this.tenants.values()].some((tenant) => tenant.slug === input.slug)) {
      throw new ConflictError(`tenant slug ${input.slug} already exists`);
    }
    const tenant: PlatformTenant = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      status: "ACTIVE",
      defaultTimezone: input.defaultTimezone ?? "UTC",
      defaultCurrency: input.defaultCurrency ?? "CNY",
      createdAt: now(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async listTenants(): Promise<PlatformTenant[]> {
    return [...this.tenants.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    if (
      [...this.users.values()].some(
        (user) => user.authSubject === input.authSubject,
      )
    ) {
      throw new ConflictError(`auth subject ${input.authSubject} exists`);
    }
    const user: PlatformUser = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      authSubject: input.authSubject,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async listUsers(): Promise<PlatformUser[]> {
    return [...this.users.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    const key = `${input.tenantId}:${input.userId}`;
    const existing = [...this.memberships.values()].find(
      (membership) =>
        membership.tenantId === input.tenantId &&
        membership.userId === input.userId,
    );
    const membership: PlatformMembership = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      status: "ACTIVE",
      roleCodes: input.roleCodes,
      joinedAt: now(),
      createdAt: now(),
    };
    membership.roleCodes = input.roleCodes;
    membership.status = "ACTIVE";
    membership.joinedAt = membership.joinedAt ?? now();
    this.memberships.set(key, membership);
    return membership;
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.memberships.values()]
      .filter((membership) => membership.tenantId === tenantId)
      .map((membership) => {
        const user = this.users.get(membership.userId);
        return {
          ...membership,
          userDisplayName: user?.displayName,
          userEmail: user?.email,
        };
      });
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.userId && !this.users.has(input.userId)) {
      notFound("User", input.userId);
    }
    if (
      [...this.persons.values()].some(
        (person) =>
          person.tenantId === input.tenantId &&
          person.employeeCode === input.employeeCode,
      )
    ) {
      throw new ConflictError(
        `employee code ${input.employeeCode} already exists in tenant`,
      );
    }
    if (input.userId) this.assertUserNotLinked(input.tenantId, input.userId);
    const person: PlatformPerson = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      employeeCode: input.employeeCode,
      displayName: input.displayName,
      employmentStatus: input.employmentStatus ?? "ACTIVE",
      createdAt: now(),
    };
    this.persons.set(person.id, person);
    return person;
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.persons.values()]
      .filter((person) => person.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    this.assertUserNotLinked(input.tenantId, input.userId, person.id);
    person.userId = input.userId;
    return person;
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity> {
    const person = [...this.persons.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    return {
      userId: input.userId,
      personId: person?.id,
      roles: membership?.roleCodes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const parent = input.parentId
      ? this.orgNodes.get(input.parentId)
      : undefined;
    if (input.parentId && (!parent || parent.tenantId !== input.tenantId)) {
      notFound("OrgNode", input.parentId);
    }
    const node: PlatformOrgNode = {
      id: randomUUID(),
      tenantId: input.tenantId,
      parentId: input.parentId,
      nodeType: input.nodeType,
      name: input.name,
      path: parent?.path ? `${parent.path}/${input.name}` : `/${input.name}`,
      active: true,
      createdAt: now(),
    };
    this.orgNodes.set(node.id, node);
    return node;
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgNodes.values()]
      .filter((node) => node.tenantId === tenantId)
      .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const node = this.orgNodes.get(input.orgNodeId);
    if (!node || node.tenantId !== input.tenantId) {
      notFound("OrgNode", input.orgNodeId);
    }
    if (input.validTo && input.validTo < input.validFrom) {
      throw new ConflictError("validTo must not be before validFrom");
    }
    if (input.allocation !== undefined) {
      const allocation = Number(input.allocation);
      if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
        throw new ConflictError("allocation must be between 0 and 1");
      }
    }
    const assignment: PlatformOrgAssignment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      orgNodeId: input.orgNodeId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      allocation: input.allocation,
      createdAt: now(),
    };
    this.orgAssignments.set(assignment.id, assignment);
    return assignment;
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgAssignments.values()]
      .filter(
        (assignment) =>
          assignment.tenantId === tenantId &&
          (!personId || assignment.personId === personId),
      )
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (input.managerPersonId === null) {
      person.managerPersonId = undefined;
      return person;
    }
    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const manager = this.persons.get(input.managerPersonId);
    if (!manager || manager.tenantId !== input.tenantId) {
      notFound("Person", input.managerPersonId);
    }
    let current: PlatformPerson | undefined = manager;
    while (current?.managerPersonId) {
      if (current.managerPersonId === input.personId) {
        throw new ConflictError("manager assignment would create a cycle");
      }
      current = this.persons.get(current.managerPersonId);
    }
    person.managerPersonId = input.managerPersonId;
    return person;
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const notice: EmployeeNotice = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      noticeType: input.noticeType,
      title: input.title,
      bodyRef: input.bodyRef,
      publishedAt: input.publishedAt ?? timestamp,
      effectiveFrom: input.effectiveFrom,
      acknowledgementRequired: input.acknowledgementRequired,
      createdAt: timestamp,
    };
    this.notices.set(notice.id, notice);
    return notice;
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.notices.values()]
      .filter((notice) => notice.tenantId === tenantId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const notice = this.notices.get(noticeId);
    if (!notice || notice.tenantId !== tenantId) {
      notFound("Notice", noticeId);
    }
    return notice;
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const key = `${notice.id}:${input.personId}`;
    const existing = this.acknowledgements.get(key);
    const timestamp = now();
    const acknowledgement: PolicyAcknowledgement = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      noticeId: notice.id,
      personId: input.personId,
      createdAt: timestamp,
    };
    if (input.decision === "ACKNOWLEDGE") {
      acknowledgement.acknowledgedAt = timestamp;
      acknowledgement.signatureRef = input.signatureRef;
      acknowledgement.declinedAt = undefined;
      acknowledgement.declineReason = undefined;
    } else {
      acknowledgement.declinedAt = timestamp;
      acknowledgement.declineReason = input.declineReason;
      acknowledgement.acknowledgedAt = undefined;
      acknowledgement.signatureRef = undefined;
    }
    this.acknowledgements.set(key, acknowledgement);
    return acknowledgement;
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const acknowledgements = [...this.acknowledgements.values()]
      .filter((candidate) => candidate.noticeId === notice.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activePersonIds = new Set(
      [...this.persons.values()]
        .filter(
          (person) =>
            person.tenantId === tenantId &&
            person.employmentStatus === "ACTIVE",
        )
        .map((person) => person.id),
    );
    const activeAcknowledgements = acknowledgements.filter((candidate) =>
      activePersonIds.has(candidate.personId),
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (candidate) => candidate.acknowledgedAt,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (candidate) => candidate.declinedAt,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersonIds.size,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersonIds.size - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersonIds.size > 0 &&
            acknowledgedCount >= activePersonIds.size),
      },
      acknowledgements,
    };
  }

  async createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const representation: EmployeeRepresentation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      bodyName: input.bodyName,
      bodyType: input.bodyType,
      jurisdiction: input.jurisdiction,
      active: true,
      createdAt: now(),
    };
    this.representations.set(representation.id, representation);
    return representation;
  }

  async listRepresentations(
    tenantId: string,
  ): Promise<EmployeeRepresentation[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.representations.values()]
      .filter((representation) => representation.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.representationId) {
      const representation = this.representations.get(input.representationId);
      if (
        !representation ||
        representation.tenantId !== input.tenantId
      ) {
        notFound("EmployeeRepresentation", input.representationId);
      }
    }
    if (input.endedAt && input.endedAt < input.startedAt) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    const consultation: PolicyConsultation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      representationId: input.representationId,
      consultationType: input.consultationType,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      minutesRef: input.minutesRef,
      feedbackSummary: input.feedbackSummary,
      outcome: input.outcome,
      createdAt: now(),
    };
    this.consultations.set(consultation.id, consultation);
    return consultation;
  }

  async listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.consultations.values()]
      .filter(
        (consultation) =>
          consultation.tenantId === tenantId &&
          (!policyVersionId ||
            consultation.policyVersionId === policyVersionId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation> {
    const consultation = this.consultations.get(consultationId);
    if (!consultation || consultation.tenantId !== tenantId) {
      notFound("PolicyConsultation", consultationId);
    }
    return consultation;
  }

  async concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation> {
    const consultation = await this.getConsultation(
      input.tenantId,
      input.consultationId,
    );
    if (consultation.outcome !== "PENDING") {
      throw new ConflictError(
        `consultation ${consultation.id} is already concluded`,
      );
    }
    if (input.endedAt < consultation.startedAt) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    consultation.endedAt = input.endedAt;
    consultation.outcome = input.outcome;
    consultation.minutesRef = input.minutesRef ?? consultation.minutesRef;
    consultation.feedbackSummary =
      input.feedbackSummary ?? consultation.feedbackSummary;
    return consultation;
  }

  async createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const dpia: DpiaRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      assessmentType: input.assessmentType,
      scope: input.scope,
      status: "DRAFT",
      riskSummary: input.riskSummary ?? {},
      mitigationSummary: input.mitigationSummary ?? {},
      createdAt: now(),
    };
    this.dpias.set(dpia.id, dpia);
    return dpia;
  }

  async listDpias(tenantId: string): Promise<DpiaRecord[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.dpias.values()]
      .filter((dpia) => dpia.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
    const dpia = this.dpias.get(dpiaId);
    if (!dpia || dpia.tenantId !== tenantId) notFound("DpiaRecord", dpiaId);
    return dpia;
  }

  async approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord> {
    const dpia = await this.getDpia(input.tenantId, input.dpiaId);
    if (dpia.status === "APPROVED") {
      throw new ConflictError(`DPIA ${dpia.id} is already approved`);
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    dpia.status = "APPROVED";
    dpia.approvedBy = input.approvedBy;
    dpia.approvedAt = now();
    return dpia;
  }

  async createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const timestamp = now();
    const dsar: DsarRequest = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      requestType: input.requestType,
      status: "OPEN",
      receivedAt: timestamp,
      dueAt: input.dueAt,
      createdAt: timestamp,
    };
    this.dsars.set(dsar.id, dsar);
    return dsar;
  }

  async listDsars(
    tenantId: string,
    personId?: string,
  ): Promise<DsarRequest[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.dsars.values()]
      .filter(
        (dsar) =>
          dsar.tenantId === tenantId &&
          (!personId || dsar.personId === personId),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
    const dsar = this.dsars.get(dsarId);
    if (!dsar || dsar.tenantId !== tenantId) notFound("DsarRequest", dsarId);
    return dsar;
  }

  async resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest> {
    const dsar = await this.getDsar(input.tenantId, input.dsarId);
    if (dsar.status !== "OPEN") {
      throw new ConflictError(`DSAR ${dsar.id} is already ${dsar.status}`);
    }
    dsar.status = input.resolution;
    dsar.resolutionRef = input.resolutionRef;
    dsar.resolvedAt = now();
    return dsar;
  }

  async createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.retentionPolicies.values()].some(
        (policy) =>
          policy.tenantId === input.tenantId &&
          policy.dataCategory === input.dataCategory,
      )
    ) {
      throw new ConflictError(
        `retention policy for ${input.dataCategory} already exists`,
      );
    }
    const policy: RetentionPolicy = {
      id: randomUUID(),
      tenantId: input.tenantId,
      dataCategory: input.dataCategory,
      retentionMonths: input.retentionMonths,
      legalBasis: input.legalBasis,
      legalHold: input.legalHold,
      createdAt: now(),
    };
    this.retentionPolicies.set(policy.id, policy);
    return policy;
  }

  async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.retentionPolicies.values()]
      .filter((policy) => policy.tenantId === tenantId)
      .sort((a, b) => a.dataCategory.localeCompare(b.dataCategory));
  }

  async setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    const policy = this.retentionPolicies.get(input.retentionPolicyId);
    if (!policy || policy.tenantId !== input.tenantId) {
      notFound("RetentionPolicy", input.retentionPolicyId);
    }
    policy.legalHold = input.legalHold;
    return policy;
  }

  async createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const existing = [...this.approvalRequests.values()].find(
      (request) =>
        request.tenantId === input.tenantId &&
        request.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        throw new ConflictError(
          `idempotency key ${input.idempotencyKey} was reused with a different payload`,
        );
      }
      return existing;
    }
    const request: ApprovalRequest = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion,
      requestedByType: input.requestedByType,
      requestedById: input.requestedById,
      riskTier: input.riskTier,
      status: "PENDING",
      requiredApprovals: input.requiredApprovals,
      approvedCount: 0,
      expiresAt: input.expiresAt,
      payloadHash: input.payloadHash,
      idempotencyKey: input.idempotencyKey,
      createdAt: now(),
    };
    this.approvalRequests.set(request.id, request);
    return request;
  }

  async listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.approvalRequests.values()]
      .filter(
        (request) =>
          request.tenantId === tenantId &&
          (!filter?.status || request.status === filter.status) &&
          (!filter?.targetType || request.targetType === filter.targetType) &&
          (!filter?.targetId || request.targetId === filter.targetId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest> {
    const request = this.approvalRequests.get(requestId);
    if (!request || request.tenantId !== tenantId) {
      notFound("ApprovalRequest", requestId);
    }
    return request;
  }

  async listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]> {
    await this.getApprovalRequest(tenantId, requestId);
    return [...this.approvalDecisions.values()]
      .filter((decision) => decision.requestId === requestId)
      .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  }

  async decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const request = await this.getApprovalRequest(
      input.tenantId,
      input.requestId,
    );
    if (request.status !== "PENDING") {
      throw new ConflictError(
        `approval request ${request.id} is ${request.status}`,
      );
    }
    if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
      request.status = "EXPIRED";
      throw new ConflictError(`approval request ${request.id} has expired`);
    }
    if (input.payloadHash !== request.payloadHash) {
      throw new ConflictError(
        "PAYLOAD_HASH_MISMATCH: the approved payload differs from the request",
      );
    }
    if (
      request.requestedByType === "USER" &&
      request.requestedById === input.approverPersonId
    ) {
      throw new ConflictError(
        "SEPARATION_OF_DUTIES: the requester cannot approve their own request",
      );
    }
    const approver = this.persons.get(input.approverPersonId);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approverPersonId);
    }
    const key = `${request.id}:${input.approverPersonId}`;
    if (this.approvalDecisions.has(key)) {
      throw new ConflictError(
        `approver ${input.approverPersonId} already decided this request`,
      );
    }
    const decision: ApprovalDecision = {
      id: randomUUID(),
      tenantId: input.tenantId,
      requestId: request.id,
      decision: input.decision,
      approverPersonId: input.approverPersonId,
      payloadHash: input.payloadHash,
      reason: input.reason,
      decidedAt: now(),
      authContext: input.authContext,
    };
    this.approvalDecisions.set(key, decision);
    if (input.decision === "REJECT") {
      request.status = "REJECTED";
    } else {
      request.approvedCount += 1;
      if (request.approvedCount >= request.requiredApprovals) {
        request.status = "APPROVED";
      }
    }
    return request;
  }

  async consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest> {
    const request = await this.getApprovalRequest(
      input.tenantId,
      input.requestId,
    );
    if (request.status !== "APPROVED") {
      throw new ConflictError(
        `approval request ${request.id} is ${request.status}`,
      );
    }
    if (request.consumedAt) {
      throw new ConflictError(
        `approval request ${request.id} was already consumed`,
      );
    }
    const consumer = this.persons.get(input.consumedBy);
    if (!consumer || consumer.tenantId !== input.tenantId) {
      notFound("Person", input.consumedBy);
    }
    request.consumedAt = now();
    request.consumedBy = input.consumedBy;
    return request;
  }

  async createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const exporter = this.persons.get(input.exportedBy);
    if (!exporter || exporter.tenantId !== input.tenantId) {
      notFound("Person", input.exportedBy);
    }
    const timestamp = now();
    const record: SettlementExport = {
      id: randomUUID(),
      tenantId: input.tenantId,
      batchId: input.batchId,
      exportRef: input.exportRef,
      exportHash: input.exportHash,
      exportedBy: input.exportedBy,
      exportedAt: input.exportedAt ?? timestamp,
      createdAt: timestamp,
    };
    this.settlementExports.set(record.id, record);
    return record;
  }

  async listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.settlementExports.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          (!batchId || record.batchId === batchId),
      )
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  }

  async getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport> {
    const record = this.settlementExports.get(exportId);
    if (!record || record.tenantId !== tenantId) {
      notFound("SettlementExport", exportId);
    }
    return record;
  }

  async acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement> {
    const record = await this.getSettlementExport(
      input.tenantId,
      input.exportId,
    );
    if (record.acknowledgedAt) {
      throw new ConflictError(
        `settlement export ${record.id} was already acknowledged`,
      );
    }
    const timestamp = input.acknowledgedAt ?? now();
    const acknowledgement: SettlementAcknowledgement = {
      id: randomUUID(),
      tenantId: input.tenantId,
      exportId: record.id,
      externalReference: input.externalReference,
      acknowledgedAt: timestamp,
      payloadHash: record.exportHash,
      createdAt: now(),
    };
    this.settlementAcknowledgements.set(
      acknowledgement.id,
      acknowledgement,
    );
    record.acknowledgedAt = timestamp;
    record.acknowledgementRef = input.externalReference;
    return acknowledgement;
  }

  async createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.budgetPools.values()].some(
        (pool) =>
          pool.tenantId === input.tenantId &&
          pool.cycleId === input.cycleId &&
          pool.code === input.code,
      )
    ) {
      throw new ConflictError(
        `budget pool ${input.code} already exists for the cycle`,
      );
    }
    const approved = money(input.approvedAmount);
    if (approved < 0n) {
      throw new ConflictError("approvedAmount must not be negative");
    }
    const timestamp = now();
    const pool: BudgetPool = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      code: input.code,
      name: input.name,
      poolType: input.poolType,
      currency: input.currency,
      approvedAmount: formatDecimal(approved),
      committedAmount: "0",
      status: "DRAFT",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.budgetPools.set(pool.id, pool);
    return pool;
  }

  async listBudgetPools(
    tenantId: string,
    cycleId?: string,
  ): Promise<BudgetPool[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.budgetPools.values()]
      .filter(
        (pool) =>
          pool.tenantId === tenantId &&
          (!cycleId || pool.cycleId === cycleId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool> {
    const pool = this.budgetPools.get(poolId);
    if (!pool || pool.tenantId !== tenantId) {
      notFound("BudgetPool", poolId);
    }
    return {
      ...pool,
      allocations: [...this.budgetAllocations.values()].filter(
        (allocation) => allocation.budgetPoolId === pool.id,
      ),
    };
  }

  async approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool> {
    const pool = this.budgetPools.get(input.poolId);
    if (!pool || pool.tenantId !== input.tenantId) {
      notFound("BudgetPool", input.poolId);
    }
    if (pool.status !== "DRAFT") {
      throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    pool.status = "APPROVED";
    pool.approvedBy = input.approvedBy;
    pool.approvedAt = now();
    pool.updatedAt = pool.approvedAt;
    return pool;
  }

  async createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation> {
    const pool = this.budgetPools.get(input.poolId);
    if (!pool || pool.tenantId !== input.tenantId) {
      notFound("BudgetPool", input.poolId);
    }
    if (pool.status !== "APPROVED") {
      throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
    }
    const amount = money(input.amount);
    if (amount <= 0n) {
      throw new ConflictError("allocation amount must be positive");
    }
    const committed = money(pool.committedAmount);
    const approved = money(pool.approvedAmount);
    if (committed + amount > approved) {
      throw new ConflictError(
        `BUDGET_EXCEEDED: committed ${formatDecimal(committed)} + ${formatDecimal(amount)} > ${pool.approvedAmount}`,
      );
    }
    const allocation: BudgetAllocation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      budgetPoolId: pool.id,
      targetType: input.targetType,
      targetId: input.targetId,
      amount: formatDecimal(amount),
      status: "RESERVED",
      createdAt: now(),
    };
    this.budgetAllocations.set(allocation.id, allocation);
    pool.committedAmount = formatDecimal(committed + amount);
    pool.updatedAt = now();
    return allocation;
  }

  async listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]> {
    const pool = this.budgetPools.get(poolId);
    if (!pool || pool.tenantId !== tenantId) {
      notFound("BudgetPool", poolId);
    }
    return [...this.budgetAllocations.values()]
      .filter((allocation) => allocation.budgetPoolId === pool.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation> {
    const allocation = this.budgetAllocations.get(input.allocationId);
    if (!allocation || allocation.tenantId !== input.tenantId) {
      notFound("BudgetAllocation", input.allocationId);
    }
    if (allocation.status !== "RESERVED") {
      throw new ConflictError(
        `budget allocation ${allocation.id} is ${allocation.status}`,
      );
    }
    const pool = this.budgetPools.get(allocation.budgetPoolId);
    if (!pool) notFound("BudgetPool", allocation.budgetPoolId);
    const committed = money(pool.committedAmount);
    const amount = money(allocation.amount);
    if (committed < amount) {
      throw new ConflictError("BUDGET_LEDGER_INCONSISTENT");
    }
    allocation.status = "RELEASED";
    pool.committedAmount = formatDecimal(committed - amount);
    pool.updatedAt = now();
    return allocation;
  }

  async createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.cashGateInputs.values()].some(
        (gate) =>
          gate.tenantId === input.tenantId &&
          gate.cycleId === input.cycleId &&
          gate.asOfDate === input.asOfDate,
      )
    ) {
      throw new ConflictError(
        `cash gate for ${input.asOfDate} already exists for the cycle`,
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    const gate: CashGateInput = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      asOfDate: input.asOfDate,
      safetyReserveMonths: formatDecimal(
        money(input.safetyReserveMonths),
      ),
      thirteenWeekForecastRef: input.thirteenWeekForecastRef,
      passesGate: input.passesGate,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt ?? now(),
      createdAt: now(),
    };
    this.cashGateInputs.set(gate.id, gate);
    return gate;
  }

  async listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.cashGateInputs.values()]
      .filter(
        (gate) =>
          gate.tenantId === tenantId &&
          (!cycleId || gate.cycleId === cycleId),
      )
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
  }

  async createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const key = [
      input.tenantId,
      input.sourceSystem,
      input.sourceRecordId,
      input.factType,
    ].join(":");
    const existing = this.financialFacts.get(key);
    const timestamp = now();
    const fact: FinancialFact = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId,
      factType: input.factType,
      amount: formatDecimal(money(input.amount)),
      currency: input.currency,
      qualityStatus: input.qualityStatus,
      ingestedAt: timestamp,
      payload: input.payload,
      createdAt: timestamp,
    };
    fact.periodStart = input.periodStart;
    fact.periodEnd = input.periodEnd;
    fact.amount = formatDecimal(money(input.amount));
    fact.currency = input.currency;
    fact.qualityStatus = input.qualityStatus;
    fact.sourceUpdatedAt = input.sourceUpdatedAt;
    fact.ingestedAt = timestamp;
    fact.payload = input.payload;
    this.financialFacts.set(key, fact);
    return fact;
  }

  async listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.financialFacts.values()]
      .filter(
        (fact) =>
          fact.tenantId === tenantId &&
          (!filter?.factType || fact.factType === filter.factType) &&
          (!filter?.sourceSystem ||
            fact.sourceSystem === filter.sourceSystem),
      )
      .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
  }

  private assertUserNotLinked(
    tenantId: string,
    userId: string,
    exceptPersonId?: string,
  ): void {
    const linked = [...this.persons.values()].find(
      (person) =>
        person.tenantId === tenantId &&
        person.userId === userId &&
        person.id !== exceptPersonId,
    );
    if (linked) {
      throw new ConflictError(
        `user ${userId} is already linked to person ${linked.id}`,
      );
    }
  }
}

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function decimalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  return text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
}

function money(value: string): bigint {
  try {
    return parseDecimal(value);
  } catch {
    throw new ConflictError(`invalid amount ${value}`);
  }
}

export class PgPlatformStore implements PlatformStore {
  constructor(private readonly pool: Pool) {}

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO tenants
          (id, name, slug, default_timezone, default_currency)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.name,
          input.slug,
          input.defaultTimezone ?? "UTC",
          input.defaultCurrency ?? "CNY",
        ],
      );
      return this.mapTenant(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(`tenant slug ${input.slug} already exists`);
      }
      throw error;
    }
  }

  async listTenants(): Promise<PlatformTenant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM tenants ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapTenant(row));
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, email, display_name, auth_subject)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [randomUUID(), input.email ?? null, input.displayName, input.authSubject],
      );
      return this.mapUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `auth subject ${input.authSubject} already exists`,
        );
      }
      throw error;
    }
  }

  async listUsers(): Promise<PlatformUser[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapUser(row));
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO memberships
          (id, tenant_id, user_id, status, role_codes, joined_at)
         VALUES ($1,$2,$3,'ACTIVE',$4,now())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET status='ACTIVE', role_codes=EXCLUDED.role_codes,
                       joined_at=COALESCE(memberships.joined_at, now()),
                       updated_at=now()
         RETURNING *`,
        [randomUUID(), input.tenantId, input.userId, input.roleCodes],
      );
      return this.mapMembership(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT m.*, u.display_name AS user_display_name,
              u.email AS user_email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapMembership(row));
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO people
          (id, tenant_id, user_id, employee_code, display_name,
           employment_status)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.userId ?? null,
          input.employeeCode,
          input.displayName,
          input.employmentStatus ?? "ACTIVE",
        ],
      );
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505") {
        if (constraint === "uq_people_tenant_user") {
          throw new ConflictError(
            `user ${input.userId} is already linked to a person in this tenant`,
          );
        }
        throw new ConflictError(
          `employee code ${input.employeeCode} already exists in tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM people WHERE tenant_id=$1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map((row) => this.mapPerson(row));
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `UPDATE people SET user_id=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId, input.userId],
      );
      if (!rows[0]) notFound("Person", input.personId);
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505" && constraint === "uq_people_tenant_user") {
        throw new ConflictError(
          `user ${input.userId} is already linked to a person in this tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`User ${input.userId} not found`);
      }
      throw error;
    }
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity> {
    const [{ rows: personRows }, { rows: membershipRows }] = await Promise.all([
      this.pool.query(
        `SELECT id FROM people
          WHERE tenant_id=$1 AND user_id=$2
          ORDER BY created_at
          LIMIT 1`,
        [input.tenantId, input.userId],
      ),
      this.pool.query(
        `SELECT role_codes FROM memberships
          WHERE tenant_id=$1 AND user_id=$2`,
        [input.tenantId, input.userId],
      ),
    ]);
    return {
      userId: input.userId,
      personId: personRows[0]?.id ?? undefined,
      roles: membershipRows[0]?.role_codes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode> {
    let parentPath: string | undefined;
    if (input.parentId) {
      const { rows } = await this.pool.query(
        "SELECT path FROM org_nodes WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.parentId],
      );
      if (!rows[0]) notFound("OrgNode", input.parentId);
      parentPath = rows[0].path ?? undefined;
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO org_nodes
          (id, tenant_id, parent_id, node_type, name, path)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.parentId ?? null,
          input.nodeType,
          input.name,
          parentPath ? `${parentPath}/${input.name}` : `/${input.name}`,
        ],
      );
      return this.mapOrgNode(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or parent org node not found");
      }
      throw error;
    }
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM org_nodes
        WHERE tenant_id=$1
        ORDER BY COALESCE(path, name), name`,
      [tenantId],
    );
    return rows.map((row) => this.mapOrgNode(row));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO person_org_assignments
          (id, tenant_id, person_id, org_node_id, valid_from, valid_to,
           allocation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.orgNodeId,
          input.validFrom,
          input.validTo ?? null,
          input.allocation ?? null,
        ],
      );
      return this.mapOrgAssignment(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23503") {
        throw new NotFoundError("person or org node not found");
      }
      if (code === "23514") {
        throw new ConflictError(
          "assignment violates date or allocation constraints",
        );
      }
      throw error;
    }
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql =
      "SELECT * FROM person_org_assignments WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY valid_from DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapOrgAssignment(row));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    const { rows: personRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);

    if (input.managerPersonId === null) {
      const { rows } = await this.pool.query(
        `UPDATE people SET manager_person_id=NULL, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId],
      );
      return this.mapPerson(rows[0]);
    }

    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const { rows: managerRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.managerPersonId],
    );
    if (!managerRows[0]) notFound("Person", input.managerPersonId);

    const { rows: cycleRows } = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_person_id
           FROM people
          WHERE tenant_id=$1 AND id=$2
         UNION ALL
         SELECT p.id, p.manager_person_id
           FROM people p
           JOIN chain c
             ON p.id = c.manager_person_id AND p.tenant_id=$1
       )
       SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,
      [input.tenantId, input.managerPersonId, input.personId],
    );
    if (cycleRows[0]) {
      throw new ConflictError("manager assignment would create a cycle");
    }
    const { rows } = await this.pool.query(
      `UPDATE people SET manager_person_id=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.personId, input.managerPersonId],
    );
    return this.mapPerson(rows[0]);
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employee_notices
          (id, tenant_id, policy_version_id, notice_type, title, body_ref,
           published_at, effective_from, acknowledgement_required)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId ?? null,
          input.noticeType,
          input.title,
          input.bodyRef,
          input.publishedAt ?? null,
          input.effectiveFrom,
          input.acknowledgementRequired,
        ],
      );
      return this.mapNotice(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or policy version not found");
      }
      throw error;
    }
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM employee_notices
        WHERE tenant_id=$1
        ORDER BY published_at DESC, created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapNotice(row));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const { rows } = await this.pool.query(
      "SELECT * FROM employee_notices WHERE tenant_id=$1 AND id=$2",
      [tenantId, noticeId],
    );
    if (!rows[0]) notFound("Notice", noticeId);
    return this.mapNotice(rows[0]);
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const { rows: personRows } = await this.pool.query(
      "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);
    const acknowledge = input.decision === "ACKNOWLEDGE";
    const { rows } = await this.pool.query(
      `INSERT INTO policy_acknowledgements
        (id, tenant_id, notice_id, person_id, acknowledged_at, signature_ref,
         declined_at, decline_reason)
       VALUES ($1,$2,$3,$4,
               CASE WHEN $5 THEN now() ELSE NULL END,
               $6,
               CASE WHEN $5 THEN NULL ELSE now() END,
               $7)
       ON CONFLICT (tenant_id, notice_id, person_id)
       DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at,
                     signature_ref = EXCLUDED.signature_ref,
                     declined_at = EXCLUDED.declined_at,
                     decline_reason = EXCLUDED.decline_reason
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        notice.id,
        input.personId,
        acknowledge,
        acknowledge ? (input.signatureRef ?? null) : null,
        acknowledge ? null : (input.declineReason ?? null),
      ],
    );
    return this.mapAcknowledgement(rows[0]);
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const [{ rows: acknowledgementRows }, { rows: personRows }] =
      await Promise.all([
        this.pool.query(
          `SELECT pa.*, p.employment_status AS person_employment_status
             FROM policy_acknowledgements pa
             JOIN people p
               ON p.tenant_id = pa.tenant_id AND p.id = pa.person_id
            WHERE pa.tenant_id=$1 AND pa.notice_id=$2
            ORDER BY pa.created_at DESC`,
          [tenantId, noticeId],
        ),
        this.pool.query(
          `SELECT count(*)::int AS count FROM people
            WHERE tenant_id=$1 AND employment_status='ACTIVE'`,
          [tenantId],
        ),
      ]);
    const acknowledgements = acknowledgementRows.map((row) =>
      this.mapAcknowledgement(row),
    );
    const activePersons = Number(personRows[0]?.count ?? 0);
    const activeAcknowledgements = acknowledgementRows.filter(
      (row) => row.person_employment_status === "ACTIVE",
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (row) => row.acknowledged_at,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (row) => row.declined_at,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersons,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersons - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersons > 0 && acknowledgedCount >= activePersons),
      },
      acknowledgements,
    };
  }

  async createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employee_representations
          (id, tenant_id, body_name, body_type, jurisdiction)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.bodyName,
          input.bodyType,
          input.jurisdiction,
        ],
      );
      return this.mapRepresentation(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listRepresentations(
    tenantId: string,
  ): Promise<EmployeeRepresentation[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM employee_representations
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapRepresentation(row));
  }

  async createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO policy_consultations
          (id, tenant_id, policy_version_id, representation_id,
           consultation_type, started_at, ended_at, minutes_ref,
           feedback_summary, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId,
          input.representationId ?? null,
          input.consultationType,
          input.startedAt,
          input.endedAt ?? null,
          input.minutesRef ?? null,
          input.feedbackSummary ?? null,
          input.outcome,
        ],
      );
      return this.mapConsultation(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          "policy version or employee representation not found",
        );
      }
      throw error;
    }
  }

  async listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM policy_consultations WHERE tenant_id=$1";
    if (policyVersionId) {
      params.push(policyVersionId);
      sql += " AND policy_version_id=$2";
    }
    sql += " ORDER BY started_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapConsultation(row));
  }

  async getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation> {
    const { rows } = await this.pool.query(
      "SELECT * FROM policy_consultations WHERE tenant_id=$1 AND id=$2",
      [tenantId, consultationId],
    );
    if (!rows[0]) notFound("PolicyConsultation", consultationId);
    return this.mapConsultation(rows[0]);
  }

  async concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation> {
    const consultation = await this.getConsultation(
      input.tenantId,
      input.consultationId,
    );
    if (consultation.outcome !== "PENDING") {
      throw new ConflictError(
        `consultation ${consultation.id} is already concluded`,
      );
    }
    if (
      Date.parse(input.endedAt) < Date.parse(consultation.startedAt)
    ) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    const { rows } = await this.pool.query(
      `UPDATE policy_consultations
          SET ended_at=$3,
              outcome=$4,
              minutes_ref=COALESCE($5, minutes_ref),
              feedback_summary=COALESCE($6, feedback_summary)
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.consultationId,
        input.endedAt,
        input.outcome,
        input.minutesRef ?? null,
        input.feedbackSummary ?? null,
      ],
    );
    return this.mapConsultation(rows[0]);
  }

  async createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO dpia_records
          (id, tenant_id, assessment_type, scope, risk_summary,
           mitigation_summary)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.assessmentType,
          input.scope,
          input.riskSummary ?? {},
          input.mitigationSummary ?? {},
        ],
      );
      return this.mapDpia(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listDpias(tenantId: string): Promise<DpiaRecord[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM dpia_records
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapDpia(row));
  }

  async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
    const { rows } = await this.pool.query(
      "SELECT * FROM dpia_records WHERE tenant_id=$1 AND id=$2",
      [tenantId, dpiaId],
    );
    if (!rows[0]) notFound("DpiaRecord", dpiaId);
    return this.mapDpia(rows[0]);
  }

  async approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord> {
    const dpia = await this.getDpia(input.tenantId, input.dpiaId);
    if (dpia.status === "APPROVED") {
      throw new ConflictError(`DPIA ${dpia.id} is already approved`);
    }
    try {
      const { rows } = await this.pool.query(
        `UPDATE dpia_records
            SET status='APPROVED', approved_by=$3, approved_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.dpiaId, input.approvedBy],
      );
      return this.mapDpia(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.approvedBy} not found`);
      }
      throw error;
    }
  }

  async createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO dsar_requests
          (id, tenant_id, person_id, request_type, due_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.requestType,
          input.dueAt ?? null,
        ],
      );
      return this.mapDsar(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or person not found");
      }
      throw error;
    }
  }

  async listDsars(
    tenantId: string,
    personId?: string,
  ): Promise<DsarRequest[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM dsar_requests WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY received_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapDsar(row));
  }

  async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
    const { rows } = await this.pool.query(
      "SELECT * FROM dsar_requests WHERE tenant_id=$1 AND id=$2",
      [tenantId, dsarId],
    );
    if (!rows[0]) notFound("DsarRequest", dsarId);
    return this.mapDsar(rows[0]);
  }

  async resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest> {
    const dsar = await this.getDsar(input.tenantId, input.dsarId);
    if (dsar.status !== "OPEN") {
      throw new ConflictError(`DSAR ${dsar.id} is already ${dsar.status}`);
    }
    const { rows } = await this.pool.query(
      `UPDATE dsar_requests
          SET status=$3, resolution_ref=$4, resolved_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.dsarId,
        input.resolution,
        input.resolutionRef,
      ],
    );
    return this.mapDsar(rows[0]);
  }

  async createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO retention_policies
          (id, tenant_id, data_category, retention_months, legal_basis,
           legal_hold)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.dataCategory,
          input.retentionMonths,
          input.legalBasis,
          input.legalHold,
        ],
      );
      return this.mapRetentionPolicy(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `retention policy for ${input.dataCategory} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM retention_policies
        WHERE tenant_id=$1
        ORDER BY data_category`,
      [tenantId],
    );
    return rows.map((row) => this.mapRetentionPolicy(row));
  }

  async setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    const { rows } = await this.pool.query(
      `UPDATE retention_policies
          SET legal_hold=$3
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.retentionPolicyId, input.legalHold],
    );
    if (!rows[0]) notFound("RetentionPolicy", input.retentionPolicyId);
    return this.mapRetentionPolicy(rows[0]);
  }

  async createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO approval_requests
          (id, tenant_id, action_type, target_type, target_id,
           target_version, requested_by_type, requested_by_id, risk_tier,
           required_approvals, expires_at, payload_hash, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.actionType,
          input.targetType,
          input.targetId,
          input.targetVersion,
          input.requestedByType,
          input.requestedById ?? null,
          input.riskTier,
          input.requiredApprovals,
          input.expiresAt ?? null,
          input.payloadHash,
          input.idempotencyKey,
        ],
      );
      return this.mapApprovalRequest(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const { rows } = await this.pool.query(
          `SELECT * FROM approval_requests
            WHERE tenant_id=$1 AND idempotency_key=$2`,
          [input.tenantId, input.idempotencyKey],
        );
        if (rows[0] && rows[0].payload_hash === input.payloadHash) {
          return this.mapApprovalRequest(rows[0]);
        }
        throw new ConflictError(
          `idempotency key ${input.idempotencyKey} was reused with a different payload`,
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM approval_requests WHERE tenant_id=$1";
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    if (filter?.targetType) {
      params.push(filter.targetType);
      sql += ` AND target_type=$${params.length}`;
    }
    if (filter?.targetId) {
      params.push(filter.targetId);
      sql += ` AND target_id=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapApprovalRequest(row));
  }

  async getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest> {
    const { rows } = await this.pool.query(
      "SELECT * FROM approval_requests WHERE tenant_id=$1 AND id=$2",
      [tenantId, requestId],
    );
    if (!rows[0]) notFound("ApprovalRequest", requestId);
    return this.mapApprovalRequest(rows[0]);
  }

  async listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]> {
    await this.getApprovalRequest(tenantId, requestId);
    const { rows } = await this.pool.query(
      `SELECT * FROM approval_decisions
        WHERE tenant_id=$1 AND request_id=$2
        ORDER BY decided_at`,
      [tenantId, requestId],
    );
    return rows.map((row) => this.mapApprovalDecision(row));
  }

  async decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM approval_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) notFound("ApprovalRequest", input.requestId);
      const request = this.mapApprovalRequest(rows[0]);
      if (request.status !== "PENDING") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
        await client.query(
          `UPDATE approval_requests SET status='EXPIRED'
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.requestId],
        );
        throw new ConflictError(
          `approval request ${request.id} has expired`,
        );
      }
      if (input.payloadHash !== request.payloadHash) {
        throw new ConflictError(
          "PAYLOAD_HASH_MISMATCH: the approved payload differs from the request",
        );
      }
      if (
        request.requestedByType === "USER" &&
        request.requestedById === input.approverPersonId
      ) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot approve their own request",
        );
      }
      try {
        await client.query(
          `INSERT INTO approval_decisions
            (id, tenant_id, request_id, decision, approver_person_id,
             payload_hash, reason, auth_context)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            randomUUID(),
            input.tenantId,
            input.requestId,
            input.decision,
            input.approverPersonId,
            input.payloadHash,
            input.reason ?? null,
            input.authContext,
          ],
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `approver ${input.approverPersonId} already decided this request`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Person ${input.approverPersonId} not found`,
          );
        }
        throw error;
      }
      const approvedCount =
        input.decision === "APPROVE"
          ? request.approvedCount + 1
          : request.approvedCount;
      const status: ApprovalStatus =
        input.decision === "REJECT"
          ? "REJECTED"
          : approvedCount >= request.requiredApprovals
            ? "APPROVED"
            : "PENDING";
      const { rows: updated } = await client.query(
        `UPDATE approval_requests
            SET approved_count=$3, status=$4
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.requestId, approvedCount, status],
      );
      return this.mapApprovalRequest(updated[0]);
    });
  }

  async consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM approval_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) notFound("ApprovalRequest", input.requestId);
      const request = this.mapApprovalRequest(rows[0]);
      if (request.status !== "APPROVED") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.consumedAt) {
        throw new ConflictError(
          `approval request ${request.id} was already consumed`,
        );
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE approval_requests
              SET consumed_at=now(), consumed_by=$3
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.requestId, input.consumedBy],
        );
        return this.mapApprovalRequest(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.consumedBy} not found`);
        }
        throw error;
      }
    });
  }

  async createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO settlement_exports
          (id, tenant_id, batch_id, export_ref, export_hash, exported_by,
           exported_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.batchId,
          input.exportRef,
          input.exportHash,
          input.exportedBy,
          input.exportedAt ?? null,
        ],
      );
      return this.mapSettlementExport(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          "settlement batch or exporting person not found",
        );
      }
      throw error;
    }
  }

  async listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM settlement_exports WHERE tenant_id=$1";
    if (batchId) {
      params.push(batchId);
      sql += " AND batch_id=$2";
    }
    sql += " ORDER BY exported_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapSettlementExport(row));
  }

  async getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport> {
    const { rows } = await this.pool.query(
      "SELECT * FROM settlement_exports WHERE tenant_id=$1 AND id=$2",
      [tenantId, exportId],
    );
    if (!rows[0]) notFound("SettlementExport", exportId);
    return this.mapSettlementExport(rows[0]);
  }

  async acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM settlement_exports
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.exportId],
      );
      if (!rows[0]) notFound("SettlementExport", input.exportId);
      const record = this.mapSettlementExport(rows[0]);
      if (record.acknowledgedAt) {
        throw new ConflictError(
          `settlement export ${record.id} was already acknowledged`,
        );
      }
      try {
        const { rows: acknowledgements } = await client.query(
          `INSERT INTO settlement_acknowledgements
            (id, tenant_id, export_id, external_reference,
             acknowledged_at, payload_hash)
           VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            record.id,
            input.externalReference,
            input.acknowledgedAt ?? null,
            record.exportHash,
          ],
        );
        const acknowledgement = this.mapSettlementAcknowledgement(
          acknowledgements[0],
        );
        await client.query(
          `UPDATE settlement_exports
              SET acknowledged_at=$3, acknowledgement_ref=$4
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            record.id,
            acknowledgement.acknowledgedAt,
            input.externalReference,
          ],
        );
        return acknowledgement;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `settlement export ${record.id} was already acknowledged`,
          );
        }
        throw error;
      }
    });
  }

  async createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO budget_pools
          (id, tenant_id, cycle_id, code, name, pool_type, currency,
           approved_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.code,
          input.name,
          input.poolType,
          input.currency,
          input.approvedAmount,
        ],
      );
      return this.mapBudgetPool(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `budget pool ${input.code} already exists for the cycle`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Cycle ${input.cycleId} not found`);
      }
      if (code === "23514") {
        throw new ConflictError("approvedAmount must not be negative");
      }
      throw error;
    }
  }

  async listBudgetPools(
    tenantId: string,
    cycleId?: string,
  ): Promise<BudgetPool[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM budget_pools WHERE tenant_id=$1";
    if (cycleId) {
      params.push(cycleId);
      sql += " AND cycle_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapBudgetPool(row));
  }

  async getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool> {
    const { rows } = await this.pool.query(
      "SELECT * FROM budget_pools WHERE tenant_id=$1 AND id=$2",
      [tenantId, poolId],
    );
    if (!rows[0]) notFound("BudgetPool", poolId);
    return {
      ...this.mapBudgetPool(rows[0]),
      allocations: await this.listBudgetAllocations(tenantId, poolId),
    };
  }

  async approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.poolId],
      );
      if (!rows[0]) notFound("BudgetPool", input.poolId);
      const pool = this.mapBudgetPool(rows[0]);
      if (pool.status !== "DRAFT") {
        throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE budget_pools
              SET status='APPROVED', approved_by=$3, approved_at=now(),
                  updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.poolId, input.approvedBy],
        );
        return this.mapBudgetPool(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.approvedBy} not found`);
        }
        throw error;
      }
    });
  }

  async createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.poolId],
      );
      if (!rows[0]) notFound("BudgetPool", input.poolId);
      const pool = this.mapBudgetPool(rows[0]);
      if (pool.status !== "APPROVED") {
        throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
      }
      const amount = money(input.amount);
      if (amount <= 0n) {
        throw new ConflictError("allocation amount must be positive");
      }
      const committed = money(pool.committedAmount);
      if (committed + amount > money(pool.approvedAmount)) {
        throw new ConflictError(
          `BUDGET_EXCEEDED: committed ${formatDecimal(committed)} + ${formatDecimal(amount)} > ${pool.approvedAmount}`,
        );
      }
      const { rows: allocations } = await client.query(
        `INSERT INTO budget_allocations
          (id, tenant_id, budget_pool_id, target_type, target_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          pool.id,
          input.targetType,
          input.targetId,
          formatDecimal(amount),
        ],
      );
      await client.query(
        `UPDATE budget_pools
            SET committed_amount=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, pool.id, formatDecimal(committed + amount)],
      );
      return this.mapBudgetAllocation(allocations[0]);
    });
  }

  async listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM budget_allocations
        WHERE tenant_id=$1 AND budget_pool_id=$2
        ORDER BY created_at DESC`,
      [tenantId, poolId],
    );
    return rows.map((row) => this.mapBudgetAllocation(row));
  }

  async releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_allocations
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.allocationId],
      );
      if (!rows[0]) notFound("BudgetAllocation", input.allocationId);
      const allocation = this.mapBudgetAllocation(rows[0]);
      if (allocation.status !== "RESERVED") {
        throw new ConflictError(
          `budget allocation ${allocation.id} is ${allocation.status}`,
        );
      }
      const { rows: pools } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, allocation.budgetPoolId],
      );
      if (!pools[0]) notFound("BudgetPool", allocation.budgetPoolId);
      const pool = this.mapBudgetPool(pools[0]);
      const committed = money(pool.committedAmount);
      const amount = money(allocation.amount);
      if (committed < amount) {
        throw new ConflictError("BUDGET_LEDGER_INCONSISTENT");
      }
      await client.query(
        `UPDATE budget_allocations SET status='RELEASED'
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, allocation.id],
      );
      await client.query(
        `UPDATE budget_pools
            SET committed_amount=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, pool.id, formatDecimal(committed - amount)],
      );
      return { ...allocation, status: "RELEASED" };
    });
  }

  async createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO cash_gate_inputs
          (id, tenant_id, cycle_id, as_of_date, safety_reserve_months,
           thirteen_week_forecast_ref, passes_gate, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.asOfDate,
          input.safetyReserveMonths,
          input.thirteenWeekForecastRef,
          input.passesGate,
          input.approvedBy,
          input.approvedAt ?? null,
        ],
      );
      return this.mapCashGateInput(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `cash gate for ${input.asOfDate} already exists for the cycle`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError("cycle or approving person not found");
      }
      throw error;
    }
  }

  async listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM cash_gate_inputs WHERE tenant_id=$1";
    if (cycleId) {
      params.push(cycleId);
      sql += " AND cycle_id=$2";
    }
    sql += " ORDER BY as_of_date DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapCashGateInput(row));
  }

  async createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO financial_facts
          (id, tenant_id, source_system, source_record_id, fact_type,
           period_start, period_end, amount, currency, quality_status,
           source_updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, source_system, source_record_id, fact_type)
         DO UPDATE SET period_start=EXCLUDED.period_start,
                       period_end=EXCLUDED.period_end,
                       amount=EXCLUDED.amount,
                       currency=EXCLUDED.currency,
                       quality_status=EXCLUDED.quality_status,
                       source_updated_at=EXCLUDED.source_updated_at,
                       ingested_at=now(),
                       payload=EXCLUDED.payload
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.sourceSystem,
          input.sourceRecordId,
          input.factType,
          input.periodStart ?? null,
          input.periodEnd ?? null,
          input.amount,
          input.currency,
          input.qualityStatus,
          input.sourceUpdatedAt ?? null,
          input.payload,
        ],
      );
      return this.mapFinancialFact(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM financial_facts WHERE tenant_id=$1";
    if (filter?.factType) {
      params.push(filter.factType);
      sql += ` AND fact_type=$${params.length}`;
    }
    if (filter?.sourceSystem) {
      params.push(filter.sourceSystem);
      sql += ` AND source_system=$${params.length}`;
    }
    sql += " ORDER BY ingested_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapFinancialFact(row));
  }

  private async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertTenant(tenantId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      "SELECT 1 FROM tenants WHERE id=$1",
      [tenantId],
    );
    if (!rowCount) notFound("Tenant", tenantId);
  }

  private mapTenant(row: QueryResultRow): PlatformTenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      defaultTimezone: row.default_timezone,
      defaultCurrency: String(row.default_currency).trim(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapUser(row: QueryResultRow): PlatformUser {
    return {
      id: row.id,
      email: row.email ?? undefined,
      displayName: row.display_name,
      authSubject: row.auth_subject,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapMembership(row: QueryResultRow): PlatformMembership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      status: row.status,
      roleCodes: row.role_codes ?? [],
      joinedAt: iso(row.joined_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      userDisplayName: row.user_display_name ?? undefined,
      userEmail: row.user_email ?? undefined,
    };
  }

  private mapPerson(row: QueryResultRow): PlatformPerson {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      employmentStatus: row.employment_status,
      managerPersonId: row.manager_person_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgNode(row: QueryResultRow): PlatformOrgNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? undefined,
      nodeType: row.node_type,
      name: row.name,
      path: row.path ?? undefined,
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgAssignment(row: QueryResultRow): PlatformOrgAssignment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      orgNodeId: row.org_node_id,
      validFrom: isoDate(row.valid_from) ?? "",
      validTo: isoDate(row.valid_to),
      allocation: decimalText(row.allocation),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapNotice(row: QueryResultRow): EmployeeNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id ?? undefined,
      noticeType: row.notice_type,
      title: row.title,
      bodyRef: row.body_ref,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      acknowledgementRequired: row.acknowledgement_required,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAcknowledgement(row: QueryResultRow): PolicyAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      noticeId: row.notice_id,
      personId: row.person_id,
      acknowledgedAt: iso(row.acknowledged_at),
      signatureRef: row.signature_ref ?? undefined,
      declinedAt: iso(row.declined_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapRepresentation(row: QueryResultRow): EmployeeRepresentation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      bodyName: row.body_name,
      bodyType: row.body_type,
      jurisdiction: row.jurisdiction,
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapConsultation(row: QueryResultRow): PolicyConsultation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      representationId: row.representation_id ?? undefined,
      consultationType: row.consultation_type,
      startedAt: iso(row.started_at) ?? new Date().toISOString(),
      endedAt: iso(row.ended_at),
      minutesRef: row.minutes_ref ?? undefined,
      feedbackSummary: row.feedback_summary ?? undefined,
      outcome: row.outcome,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDpia(row: QueryResultRow): DpiaRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      assessmentType: row.assessment_type,
      scope: row.scope,
      status: row.status,
      riskSummary: row.risk_summary ?? {},
      mitigationSummary: row.mitigation_summary ?? {},
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDsar(row: QueryResultRow): DsarRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      requestType: row.request_type,
      status: row.status,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      dueAt: iso(row.due_at),
      resolvedAt: iso(row.resolved_at),
      resolutionRef: row.resolution_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapRetentionPolicy(row: QueryResultRow): RetentionPolicy {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      dataCategory: row.data_category,
      retentionMonths: Number(row.retention_months),
      legalBasis: row.legal_basis,
      legalHold: row.legal_hold,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapApprovalRequest(row: QueryResultRow): ApprovalRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      actionType: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      targetVersion: Number(row.target_version),
      requestedByType: row.requested_by_type,
      requestedById: row.requested_by_id ?? undefined,
      riskTier: row.risk_tier,
      status: row.status,
      requiredApprovals: Number(row.required_approvals),
      approvedCount: Number(row.approved_count),
      expiresAt: iso(row.expires_at),
      payloadHash: row.payload_hash,
      idempotencyKey: row.idempotency_key,
      consumedAt: iso(row.consumed_at),
      consumedBy: row.consumed_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapApprovalDecision(row: QueryResultRow): ApprovalDecision {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestId: row.request_id,
      decision: row.decision,
      approverPersonId: row.approver_person_id,
      payloadHash: row.payload_hash,
      reason: row.reason ?? undefined,
      decidedAt: iso(row.decided_at) ?? new Date().toISOString(),
      authContext: row.auth_context ?? {},
    };
  }

  private mapSettlementExport(row: QueryResultRow): SettlementExport {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchId: row.batch_id,
      exportRef: row.export_ref,
      exportHash: row.export_hash,
      exportedBy: row.exported_by,
      exportedAt: iso(row.exported_at) ?? new Date().toISOString(),
      acknowledgedAt: iso(row.acknowledged_at),
      acknowledgementRef: row.acknowledgement_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapSettlementAcknowledgement(
    row: QueryResultRow,
  ): SettlementAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      exportId: row.export_id,
      externalReference: row.external_reference,
      acknowledgedAt:
        iso(row.acknowledged_at) ?? new Date().toISOString(),
      payloadHash: row.payload_hash,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapBudgetPool(row: QueryResultRow): BudgetPool {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      code: row.code,
      name: row.name,
      poolType: row.pool_type,
      currency: String(row.currency).trim(),
      approvedAmount: decimalText(String(row.approved_amount)) ?? "0",
      committedAmount:
        decimalText(String(row.committed_amount)) ?? "0",
      status: row.status,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapBudgetAllocation(row: QueryResultRow): BudgetAllocation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      budgetPoolId: row.budget_pool_id,
      targetType: row.target_type,
      targetId: row.target_id,
      amount: decimalText(String(row.amount)) ?? "0",
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapCashGateInput(row: QueryResultRow): CashGateInput {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      asOfDate: isoDate(row.as_of_date) ?? "",
      safetyReserveMonths:
        decimalText(String(row.safety_reserve_months)) ?? "0",
      thirteenWeekForecastRef: row.thirteen_week_forecast_ref,
      passesGate: row.passes_gate,
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapFinancialFact(row: QueryResultRow): FinancialFact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      factType: row.fact_type,
      periodStart: isoDate(row.period_start),
      periodEnd: isoDate(row.period_end),
      amount: decimalText(String(row.amount)) ?? "0",
      currency: String(row.currency).trim(),
      qualityStatus: row.quality_status,
      sourceUpdatedAt: iso(row.source_updated_at),
      ingestedAt: iso(row.ingested_at) ?? new Date().toISOString(),
      payload: row.payload ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
