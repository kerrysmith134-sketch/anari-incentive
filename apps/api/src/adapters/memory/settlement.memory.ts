/**
 * NPV2-013：结算薪酬 Adapter（SettlementPort，方法体逐字平移）。
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  divRound,
  formatDecimal,
  parseDecimal,
  sha256,
} from "@anari/policy-dsl";
import type {
  Acceptance,
  AdverseActionCase,
  AiScoreProposal,
  AiSuggestionLog,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  AuditRedaction,
  BudgetAllocation,
  BudgetPool,
  Bounty,
  BreakGlassGrant,
  CashGateInput,
  ClawbackCase,
  CompensationTemplate,
  ConsultationOutcome,
  ConflictDeclaration,
  ConsultationType,
  DataSource,
  DataSourceField,
  Deliverable,
  DpiaAssessmentType,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  EmploymentContract,
  ESignEnvelope,
  EmploymentContractAmendment,
  EquityExercise,
  EquityGrant,
  EquityVesting,
  ExternalIdentity,
  FairnessCommitment,
  FinancialFact,
  CalibrationSession,
  ManagerTrainingRecord,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
  ModelProviderPolicy,
  PolicyEngineRecord,
  IncentiveAwardBatch,
  IncentiveAwardType,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  SubscriptionPlan,
  TenantInvoice,
  TenantInvoiceLineItem,
  TenantInvoiceStatus,
  TenantSubscription,
  TenantSubscriptionStatus,
  PayrollLine,
  PayrollRun,
  PilotEnrollment,
  PolicyAcknowledgement,
  PolicyConsultation,
  PolicyNotice,
  PolicyTestCase,
  PolicyTestRun,
  RepresentationBodyType,
  AppealEvidenceDisclosure,
  RetentionDisposalRequest,
  RetentionPolicy,
  WorkforceSubgroupAttribute,
  WorkforceSubgroupDimension,
  RuleChangeOrder,
  SettlementAcknowledgement,
  SettlementExport,
  SyncSchedule,
  StrategicPoolCase,
  SyncRun,
  TrustSurveyQuestion,
  TrustSurveyReport,
  TrustSurveyResponse,
  TrustSurveyRun,
  WebhookInboxMessage,
  WorkflowRun,
} from "@anari/domain";
import { adverseActionTransitions, assertTransition } from "@anari/domain";
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { SettlementPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemorySettlementMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements SettlementPort {
    
    async createCompensationTemplate(input: {
      tenantId: string;
      code: string;
      name: string;
      roleCode: string;
      employmentType: CompensationTemplate["employmentType"];
      currency: string;
      fixedSalaryMin: string;
      fixedSalaryMax: string;
      deductionCapRate: string;
      variableShareCapRate: string;
      smoothingThresholdRate: string;
      deductionOrder: string[];
      deductionTypeCaps: Record<string, string>;
    }): Promise<CompensationTemplate> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const min = parseDecimal(input.fixedSalaryMin);
      const max = parseDecimal(input.fixedSalaryMax);
      if (min < 0n || max < min) {
        throw new ConflictError("COMPENSATION_TEMPLATE_SALARY_RANGE_INVALID");
      }
      if (
        [...this.compensationTemplates.values()].some(
          (template) =>
            template.tenantId === input.tenantId &&
            template.code === input.code,
        )
      ) {
        throw new ConflictError(
          `compensation template ${input.code} already exists`,
        );
      }
      const timestamp = now();
      const template: CompensationTemplate = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        name: input.name,
        roleCode: input.roleCode,
        employmentType: input.employmentType,
        currency: input.currency,
        fixedSalaryMin: formatDecimal(min),
        fixedSalaryMax: formatDecimal(max),
        deductionCapRate: formatDecimal(parseDecimal(input.deductionCapRate)),
        variableShareCapRate: formatDecimal(
          parseDecimal(input.variableShareCapRate),
        ),
        smoothingThresholdRate: formatDecimal(
          parseDecimal(input.smoothingThresholdRate),
        ),
        deductionOrder: [...input.deductionOrder],
        deductionTypeCaps: { ...input.deductionTypeCaps },
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.compensationTemplates.set(template.id, template);
      return template;
    }
    
    async listCompensationTemplates(
      tenantId: string,
    ): Promise<CompensationTemplate[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.compensationTemplates.values()]
        .filter((template) => template.tenantId === tenantId)
        .sort((a, b) => a.code.localeCompare(b.code));
    }
    
    async getActiveCompensationTemplate(
      tenantId: string,
      code: string,
    ): Promise<CompensationTemplate | undefined> {
      return [...this.compensationTemplates.values()].find(
        (template) =>
          template.tenantId === tenantId &&
          template.code === code &&
          template.status === "ACTIVE",
      );
    }
    
    async retireCompensationTemplate(input: {
      tenantId: string;
      templateId: string;
    }): Promise<CompensationTemplate> {
      const template = this.compensationTemplates.get(input.templateId);
      if (!template || template.tenantId !== input.tenantId) {
        notFound("CompensationTemplate", input.templateId);
      }
      if (template.status === "RETIRED") {
        throw new ConflictError(
          `compensation template ${template.id} is already retired`,
        );
      }
      template.status = "RETIRED";
      template.updatedAt = now();
      return template;
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
    
    async createEmploymentContract(input: {
      tenantId: string;
      personId: string;
      contractCode: string;
      employmentType: EmploymentContract["employmentType"];
      startDate: string;
      endDate?: string;
      workLocation: string;
      legalEntity?: string;
      currency: string;
      fixedMonthlySalary: string;
      minimumMonthlyWage: string;
      taxRate: string;
      socialInsuranceRate: string;
      deductionCapRate: string;
      variableShareCapRate: string;
      deductionOrder: string[];
      deductionTypeCaps: Record<string, string>;
      smoothingThresholdRate: string;
      smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
      smoothingWindowPeriods?: number;
      smoothingMaxStepRate?: string;
      compensationTemplateCode?: string;
      bankAccountRef?: string;
      consentSignatureRef: string;
      consentSignedAt?: string;
    }): Promise<EmploymentContract> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (
        [...this.employmentContracts.values()].some(
          (contract) =>
            contract.tenantId === input.tenantId &&
            contract.contractCode === input.contractCode,
        )
      ) {
        throw new ConflictError(
          `employment contract ${input.contractCode} already exists`,
        );
      }
      if (parseDecimal(input.fixedMonthlySalary) < 0n) {
        throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
      }
      if (parseDecimal(input.minimumMonthlyWage) < 0n) {
        throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
      }
      if (
        parseDecimal(input.taxRate) < 0n ||
        parseDecimal(input.taxRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_TAX_RATE_OUT_OF_RANGE");
      }
      if (
        parseDecimal(input.socialInsuranceRate) < 0n ||
        parseDecimal(input.socialInsuranceRate) > 1_000_000n
      ) {
        throw new ConflictError(
          "CONTRACT_SOCIAL_INSURANCE_RATE_OUT_OF_RANGE",
        );
      }
      if (
        parseDecimal(input.deductionCapRate) < 0n ||
        parseDecimal(input.deductionCapRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_DEDUCTION_CAP_OUT_OF_RANGE");
      }
      if (
        parseDecimal(input.variableShareCapRate) < 0n ||
        parseDecimal(input.variableShareCapRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_VARIABLE_SHARE_CAP_OUT_OF_RANGE");
      }
      const deductionOrder =
        input.deductionOrder.length > 0
          ? [...input.deductionOrder]
          : ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"];
      for (const [type, rate] of Object.entries(input.deductionTypeCaps)) {
        const parsed = parseDecimal(rate);
        if (parsed < 0n || parsed > 1_000_000n) {
          throw new ConflictError(
            `CONTRACT_DEDUCTION_TYPE_CAP_OUT_OF_RANGE:${type}`,
          );
        }
      }
      const smoothingRate = parseDecimal(input.smoothingThresholdRate);
      if (smoothingRate < 0n || smoothingRate > 10_000_000n) {
        throw new ConflictError("CONTRACT_SMOOTHING_THRESHOLD_OUT_OF_RANGE");
      }
      if (
        input.endDate &&
        Date.parse(input.endDate) <= Date.parse(input.startDate)
      ) {
        throw new ConflictError("CONTRACT_END_BEFORE_START");
      }
      const timestamp = now();
      const contract: EmploymentContract = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        contractCode: input.contractCode,
        employmentType: input.employmentType,
        startDate: input.startDate,
        endDate: input.endDate,
        workLocation: input.workLocation,
        legalEntity: input.legalEntity,
        currency: input.currency,
        fixedMonthlySalary: formatDecimal(
          parseDecimal(input.fixedMonthlySalary),
        ),
        minimumMonthlyWage: formatDecimal(
          parseDecimal(input.minimumMonthlyWage),
        ),
        taxRate: formatDecimal(parseDecimal(input.taxRate)),
        socialInsuranceRate: formatDecimal(
          parseDecimal(input.socialInsuranceRate),
        ),
        deductionCapRate: formatDecimal(
          parseDecimal(input.deductionCapRate),
        ),
        variableShareCapRate: formatDecimal(
          parseDecimal(input.variableShareCapRate),
        ),
        deductionOrder,
        deductionTypeCaps: Object.fromEntries(
          Object.entries(input.deductionTypeCaps).map(([type, rate]) => [
            type,
            formatDecimal(parseDecimal(rate)),
          ]),
        ),
        smoothingThresholdRate: formatDecimal(smoothingRate),
        smoothingMode: input.smoothingMode ?? "BLOCK",
        smoothingWindowPeriods: input.smoothingWindowPeriods ?? 3,
        smoothingMaxStepRate: formatDecimal(
          parseDecimal(input.smoothingMaxStepRate ?? "0.5"),
        ),
        compensationTemplateCode: input.compensationTemplateCode,
        bankAccountRef: input.bankAccountRef,
        payPlanVersion: 1,
        consentSignatureRef: input.consentSignatureRef,
        consentSignedAt: input.consentSignedAt ?? timestamp,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.employmentContracts.set(contract.id, contract);
      return contract;
    }
    
    async listEmploymentContractAmendments(
      tenantId: string,
      contractId: string,
    ): Promise<EmploymentContractAmendment[]> {
      const contract = this.employmentContracts.get(contractId);
      if (!contract || contract.tenantId !== tenantId) {
        notFound("EmploymentContract", contractId);
      }
      return [...(this.contractAmendments.get(contractId) ?? [])].map(
        (amendment) => structuredClone(amendment),
      );
    }
    
    async applyDueContractAmendments(
      tenantId: string,
    ): Promise<EmploymentContractAmendment[]> {
      const applied: EmploymentContractAmendment[] = [];
      for (const contract of this.employmentContracts.values()) {
        if (contract.tenantId !== tenantId) continue;
        const amendments = this.contractAmendments.get(contract.id) ?? [];
        const due = amendments
          .filter(
            (amendment) =>
              amendment.status === "SCHEDULED" &&
              Date.parse(amendment.effectiveFrom) <= Date.now(),
          )
          .sort((a, b) =>
            a.effectiveFrom.localeCompare(b.effectiveFrom),
          );
        for (const amendment of due) {
          const terms = amendment.afterTerms as Record<string, unknown>;
          contract.fixedMonthlySalary = String(
            terms.fixedMonthlySalary ?? contract.fixedMonthlySalary,
          );
          contract.minimumMonthlyWage = String(
            terms.minimumMonthlyWage ?? contract.minimumMonthlyWage,
          );
          contract.taxRate = String(terms.taxRate ?? contract.taxRate);
          contract.socialInsuranceRate = String(
            terms.socialInsuranceRate ?? contract.socialInsuranceRate,
          );
          contract.deductionCapRate = String(
            terms.deductionCapRate ?? contract.deductionCapRate,
          );
          contract.variableShareCapRate = String(
            terms.variableShareCapRate ?? contract.variableShareCapRate,
          );
          if (Array.isArray(terms.deductionOrder)) {
            contract.deductionOrder = terms.deductionOrder as string[];
          }
          contract.bankAccountRef =
            typeof terms.bankAccountRef === "string"
              ? terms.bankAccountRef
              : undefined;
          contract.payPlanVersion = amendment.payPlanVersion;
          contract.consentSignatureRef = amendment.consentSignatureRef;
          contract.consentSignedAt = amendment.effectiveFrom;
          contract.version += 1;
          contract.updatedAt = now();
          amendment.status = "APPLIED";
          amendment.appliedAt = now();
          applied.push(structuredClone(amendment));
        }
      }
      return applied;
    }
    
    async cancelContractAmendment(input: {
      tenantId: string;
      contractId: string;
      amendmentId: string;
      reason: string;
    }): Promise<EmploymentContractAmendment> {
      const amendments = this.contractAmendments.get(input.contractId) ?? [];
      const amendment = amendments.find(
        (candidate) =>
          candidate.id === input.amendmentId &&
          candidate.tenantId === input.tenantId,
      );
      if (!amendment) notFound("EmploymentContractAmendment", input.amendmentId);
      if (amendment.status !== "SCHEDULED") {
        throw new ConflictError(
          `contract amendment is ${amendment.status}`,
        );
      }
      amendment.status = "CANCELLED";
      amendment.cancelledAt = now();
      amendment.cancelReason = input.reason;
      return structuredClone(amendment);
    }
    
    async getEmploymentContract(
      tenantId: string,
      contractId: string,
    ): Promise<EmploymentContract> {
      const contract = this.employmentContracts.get(contractId);
      if (!contract || contract.tenantId !== tenantId) {
        notFound("EmploymentContract", contractId);
      }
      return contract;
    }
    
    async createPayrollRun(input: {
      tenantId: string;
      cycleId: string;
      periodStart: string;
      periodEnd: string;
      currency: string;
      preparedBy: string;
    }): Promise<PayrollRun> {
      const preparer = this.persons.get(input.preparedBy);
      if (!preparer || preparer.tenantId !== input.tenantId) {
        notFound("Person", input.preparedBy);
      }
      if (Date.parse(input.periodEnd) <= Date.parse(input.periodStart)) {
        throw new ConflictError("PAYROLL_PERIOD_INVALID");
      }
      const timestamp = now();
      const run: PayrollRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        cycleId: input.cycleId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency,
        status: "DRAFT",
        preparedBy: input.preparedBy,
        totalGross: "0",
        totalDeductions: "0",
        totalTax: "0",
        totalSocialInsurance: "0",
        totalNet: "0",
        lineCount: 0,
        blockedCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.payrollRuns.set(run.id, run);
      return { ...run, lines: [] };
    }
    
    async listPayrollRuns(
      tenantId: string,
      cycleId?: string,
    ): Promise<PayrollRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.payrollRuns.values()]
        .filter(
          (run) =>
            run.tenantId === tenantId &&
            (!cycleId || run.cycleId === cycleId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((run) => ({
          ...run,
          lines: (this.payrollLines.get(run.id) ?? []).map((line) => ({
            ...line,
          })),
        }));
    }
    
    async getPayrollRun(
      tenantId: string,
      runId: string,
    ): Promise<PayrollRun> {
      const run = this.payrollRuns.get(runId);
      if (!run || run.tenantId !== tenantId) {
        notFound("PayrollRun", runId);
      }
      return {
        ...run,
        lines: (this.payrollLines.get(run.id) ?? []).map((line) => ({
          ...line,
        })),
      };
    }
    
    async savePayrollCalculation(input: {
      tenantId: string;
      runId: string;
      lines: Array<Omit<PayrollLine, "id" | "tenantId" | "runId" | "createdAt">>;
      totalGross: string;
      totalDeductions: string;
      totalTax: string;
      totalSocialInsurance: string;
      totalNet: string;
      blockedCount: number;
    }): Promise<PayrollRun> {
      const run = this.payrollRuns.get(input.runId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("PayrollRun", input.runId);
      }
      if (
        run.status !== "DRAFT" &&
        run.status !== "CALCULATED" &&
        run.status !== "BLOCKED"
      ) {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      const timestamp = now();
      const lines: PayrollLine[] = input.lines.map((line) => ({
        ...line,
        id: randomUUID(),
        tenantId: input.tenantId,
        runId: input.runId,
        createdAt: timestamp,
      }));
      this.payrollLines.set(input.runId, lines);
      run.status = input.blockedCount > 0 ? "BLOCKED" : "CALCULATED";
      run.totalGross = formatDecimal(parseDecimal(input.totalGross));
      run.totalDeductions = formatDecimal(
        parseDecimal(input.totalDeductions),
      );
      run.totalTax = formatDecimal(parseDecimal(input.totalTax));
      run.totalSocialInsurance = formatDecimal(
        parseDecimal(input.totalSocialInsurance),
      );
      run.totalNet = formatDecimal(parseDecimal(input.totalNet));
      run.lineCount = lines.length;
      run.blockedCount = input.blockedCount;
      run.updatedAt = timestamp;
      run.version += 1;
      return { ...run, lines: lines.map((line) => ({ ...line })) };
    }
    
    async approvePayrollRun(input: {
      tenantId: string;
      runId: string;
      approvedBy: string;
    }): Promise<PayrollRun> {
      const run = this.payrollRuns.get(input.runId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("PayrollRun", input.runId);
      }
      if (run.status !== "CALCULATED") {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      if (run.preparedBy === input.approvedBy) {
        throw new ConflictError(
          "PAYROLL_SELF_APPROVAL: the preparer cannot approve the run",
        );
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      run.status = "APPROVED";
      run.approvedBy = input.approvedBy;
      run.approvedAt = now();
      run.updatedAt = run.approvedAt;
      run.version += 1;
      return run;
    }
    
    async payPayrollRun(input: {
      tenantId: string;
      runId: string;
    }): Promise<PayrollRun> {
      const run = this.payrollRuns.get(input.runId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("PayrollRun", input.runId);
      }
      if (run.status !== "APPROVED") {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      run.status = "PAID";
      run.paidAt = now();
      run.updatedAt = run.paidAt;
      run.version += 1;
      return run;
    }
    
    async reversePayrollRun(input: {
      tenantId: string;
      runId: string;
      reason: string;
      reversedBy: string;
    }): Promise<PayrollRun> {
      const run = this.payrollRuns.get(input.runId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("PayrollRun", input.runId);
      }
      if (run.status !== "APPROVED" && run.status !== "PAID") {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      const person = this.persons.get(input.reversedBy);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.reversedBy);
      }
      run.status = "REVERSED";
      run.reversedAt = now();
      run.reversedBy = input.reversedBy;
      run.reversalReason = input.reason;
      run.updatedAt = run.reversedAt;
      run.version += 1;
      return run;
    }
    
    async cancelPayrollRun(input: {
      tenantId: string;
      runId: string;
    }): Promise<PayrollRun> {
      const run = this.payrollRuns.get(input.runId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("PayrollRun", input.runId);
      }
      if (
        run.status === "PAID" ||
        run.status === "REVERSED" ||
        run.status === "CANCELLED"
      ) {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      run.status = "CANCELLED";
      run.updatedAt = now();
      run.version += 1;
      return run;
    }
  };
}
