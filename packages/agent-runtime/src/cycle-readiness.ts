import type { AgentContext } from "./types.js";

/**
 * NPV2-026：Cycle Readiness bounded workflow。
 *
 * 综合七类门禁（数据质量/政策/法律/评价/申诉/计算/审批）生成周期就绪
 * 报告，逐项引用来源（记录 id）。**红线：本工作流纯只读——不得自行锁账
 * 或结算**（lockRun/settle 属人工与审批路径）。
 */
export type ReadinessGateStatus = "PASS" | "BLOCKED" | "WARN" | "NOT_MEASURABLE";

export interface ReadinessCheck {
  gate:
    | "DATA"
    | "POLICY"
    | "LEGAL"
    | "EVALUATION"
    | "APPEAL"
    | "CALCULATION"
    | "APPROVAL";
  status: ReadinessGateStatus;
  detail: string;
  /** 逐项来源引用（记录 id）。 */
  sources: Array<{ type: string; id: string }>;
}

export interface CycleReadinessReport {
  cycleId: string;
  ready: boolean;
  checks: ReadinessCheck[];
  /** 红线声明：本报告不触发锁账/结算。 */
  note: string;
  generatedAt: string;
}

export interface CycleReadinessInput {
  cycleId: string;
  /** 政策/法律门禁校验的政策版本（缺省从该周期的 FORMAL run 推断）。 */
  policyVersionId?: string;
}

export class CycleReadinessWorkflow {
  constructor(private readonly context: AgentContext) {}

  async run(input: CycleReadinessInput): Promise<CycleReadinessReport> {
    const checks: ReadinessCheck[] = [];
    const runs = (await this.context.listRuns()).filter(
      (run) => run.cycleId === input.cycleId,
    );
    const formalRun = runs.find((run) => run.mode === "FORMAL");
    const policyVersionId =
      input.policyVersionId ??
      formalRun?.policyVersionId ??
      (runs[0]?.policyVersionId as string | undefined);

    // 1) 数据质量门禁：BLOCKING 级未关闭问题即阻断。
    const issues = await this.context.listDataQualityIssues({
      cycleId: input.cycleId,
    });
    const blockingIssues = issues.filter(
      (issue) => issue.severity === "BLOCKING" && issue.status !== "RESOLVED",
    );
    checks.push({
      gate: "DATA",
      status: blockingIssues.length > 0 ? "BLOCKED" : "PASS",
      detail:
        blockingIssues.length > 0
          ? `${blockingIssues.length} blocking data-quality issue(s) open`
          : "no blocking data-quality issues",
      // 来源引用全部已扫描问题（含非阻断）——证明扫描发生过。
      sources: issues.map((issue) => ({
        type: "DATA_QUALITY_ISSUE",
        id: issue.id,
      })),
    });

    // 2) 政策门禁：周期内 run 引用的政策版本存在已发布定义。
    if (policyVersionId) {
      try {
        const policy = await this.context.getPolicy(policyVersionId);
        checks.push({
          gate: "POLICY",
          status: "PASS",
          detail: `policy ${policy.code} v${policy.version} is published`,
          sources: [{ type: "POLICY_VERSION", id: policyVersionId }],
        });
      } catch {
        checks.push({
          gate: "POLICY",
          status: "BLOCKED",
          detail: `policy version ${policyVersionId} is not published`,
          sources: [{ type: "POLICY_VERSION", id: policyVersionId }],
        });
      }
    } else {
      checks.push({
        gate: "POLICY",
        status: "NOT_MEASURABLE",
        detail: "no calculation run in this cycle references a policy version",
        sources: [],
      });
    }

    // 3) 法律门禁：FORMAL run 必须有已记录的法务门禁。
    if (policyVersionId && formalRun?.mode === "FORMAL") {
      let gate: Awaited<
        ReturnType<AgentContext["getLegalGate"]>
      > = undefined;
      try {
        gate = await this.context.getLegalGate(policyVersionId);
      } catch {
        gate = undefined;
      }
      checks.push({
        gate: "LEGAL",
        status: gate ? "PASS" : "BLOCKED",
        detail: gate
          ? `legal gate recorded (${gate.democraticProcedureRef})`
          : "FORMAL run has no recorded legal gate",
        sources: gate
          ? [{ type: "LEGAL_GATE", id: gate.policyVersionId }]
          : [{ type: "POLICY_VERSION", id: policyVersionId }],
      });
    } else {
      // AUD-012：无法度量也要出检查项（必需门禁缺失不可静默）。
      checks.push({
        gate: "LEGAL",
        status: "NOT_MEASURABLE",
        detail:
          "no FORMAL run / policy version to measure the legal gate against",
        sources: [],
      });
    }

    // 4) 评价门禁：SUBMITTED 未决草案 = 阻断；全部已决 = 通过。
    const drafts = await this.context.listEvaluationDrafts({
      cycleId: input.cycleId,
    });
    const pendingDrafts = drafts.filter(
      (draft) => draft.status === "SUBMITTED",
    );
    checks.push({
      gate: "EVALUATION",
      status:
        pendingDrafts.length > 0
          ? "BLOCKED"
          : drafts.length === 0
            ? "NOT_MEASURABLE"
            : "PASS",
      detail:
        pendingDrafts.length > 0
          ? `${pendingDrafts.length} submitted draft(s) awaiting decision`
          : drafts.length === 0
            ? "no evaluation drafts in this cycle"
            : "all evaluation drafts decided",
      sources: drafts.map((draft) => ({
        type: "EVALUATION_DRAFT",
        id: draft.id,
      })),
    });

    // 5) 申诉门禁：未结申诉 = 警告（不阻断，但须披露）。
    const appeals = await this.context.listAppeals();
    const openAppeals = appeals.filter(
      (appeal) => appeal.status !== "DECIDED" && appeal.status !== "CLOSED",
    );
    checks.push({
      gate: "APPEAL",
      status: openAppeals.length > 0 ? "WARN" : "PASS",
      detail:
        openAppeals.length > 0
          ? `${openAppeals.length} open appeal(s) may affect attributed amounts`
          : "no open appeals",
      // 来源引用全部已扫描申诉（含已决）——证明扫描确实发生过。
      sources: appeals.map((appeal) => ({
        type: "APPEAL",
        id: appeal.id,
      })),
    });

    // 6) 计算门禁：周期内存在 APPROVED/LOCKED 的 **FORMAL** 运行
    // （AUD-012：影子/草稿运行不得充当正式计算门禁）。
    const formalRuns = runs.filter((run) => run.mode === "FORMAL");
    const settledRuns = formalRuns.filter(
      (run) => run.status === "APPROVED" || run.status === "LOCKED",
    );
    checks.push({
      gate: "CALCULATION",
      status:
        formalRuns.length === 0
          ? "NOT_MEASURABLE"
          : settledRuns.length > 0
            ? "PASS"
            : "BLOCKED",
      detail:
        formalRuns.length === 0
          ? runs.length === 0
            ? "no calculation runs in this cycle"
            : "no FORMAL calculation run in this cycle (shadow runs do not satisfy the gate)"
          : `${settledRuns.length}/${formalRuns.length} FORMAL run(s) approved or locked`,
      sources: runs.map((run) => ({ type: "CALCULATION_RUN", id: run.id })),
    });

    // 7) 审批门禁：运行登记的 blockers（未满足条件，含审批/确认类）= 阻断。
    const blockedRuns = runs.filter((run) => run.blockers.length > 0);
    checks.push({
      gate: "APPROVAL",
      status: blockedRuns.length > 0 ? "BLOCKED" : runs.length === 0 ? "NOT_MEASURABLE" : "PASS",
      detail:
        blockedRuns.length > 0
          ? `${blockedRuns.length} run(s) with unresolved blockers: ${[
              ...new Set(blockedRuns.flatMap((run) => run.blockers)),
            ]
              .slice(0, 3)
              .join("; ")}`
          : runs.length === 0
            ? "no calculation runs in this cycle"
            : "no unresolved blockers",
      sources: runs.map((run) => ({
        type: "CALCULATION_RUN",
        id: run.id,
      })),
    });

    // AUD-012：必需门禁（政策/法务/计算/审批）NOT_MEASURABLE 视同未就绪——
    // 只有无阻断且全部必需门禁 PASS 才可判 ready。DATA/APPEAL 保持披露不阻断。
    const requiredGates: ReadonlyArray<ReadinessCheck["gate"]> = [
      "POLICY",
      "LEGAL",
      "CALCULATION",
      "APPROVAL",
    ];
    const requiredSatisfied = requiredGates.every((gate) => {
      const check = checks.find((entry) => entry.gate === gate);
      return check?.status === "PASS";
    });
    const ready =
      checks.every((check) => check.status !== "BLOCKED") &&
      requiredSatisfied;
    return {
      cycleId: input.cycleId,
      ready,
      checks,
      note:
        "Read-only readiness report. The agent does not lock runs or settle batches — those remain human/approval-gated actions.",
      generatedAt: new Date().toISOString(),
    };
  }
}
