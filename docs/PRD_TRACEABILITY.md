# PRD V4.1 落地核对（2026-10-30）

**核对对象**：`docs/PRD_V4.1_评审修订版.md`（512 行，P0 基线）  
**代码基线**：`main` 分支，2026-10-30 工作树；核对后新增的缺口修复见文末“本轮已补”  
**验证**：`npm run typecheck`、`npm test`（267 个单元/API 测试）、`npm run web:build`、`npm run test:pg`（61 个 PostgreSQL 测试）均通过；关键流程已在浏览器中手工走通。

## 结论

**仍未宣称“全部 PRD 已落地”，但 P0 的核心闭环已经基本补齐。** 核心纵向切片、确定性金额路径、账本、审批、AI 评测门、法律门禁、员工确认/申诉、治理对象、HRIS/薪酬、集成、SPA 和大部分 P0 合规控制都已可运行，并有 API/PostgreSQL/前端构建验证。

对照 PRD 的 **P0 验收要求**，剩余缺口已收敛为：

1. **法律门禁的最后一公里**：LG-05 仍缺未来生效排期与外部电子签服务；LG-06 已有最低工资、扣款上限、deduction order/breakdown 与 tax/social 分列，但仍缺法定扣款类型/逐类型上限。
2. **AI 监督的边界**：已有独立先判、盲审、override 理由、audit sampling、高风险决策前第二复核、gold-set 注册与 canary/供应商变更回归；已有 reader/actor 进程级隔离、red-team 门禁与审阅分析；仍缺 per-task/per-tenant 强制隔离。
3. **激励护栏的剩余项**：已有 variable-share cap、clawback 条款、机动池委员会/观察员、年度审查；仍缺“未计价工作不得默认为 0”的强制规则（INC-06）。
4. **安全/隐私的剩余项**：已有威胁模型、RLS、payroll 字段 redaction + break-glass、导出水印/审批、provider policy、audit anchor；已有多资源 payroll field policy；仍缺跨资源通用 ABAC 引擎。DLP/批量导出限流与 audit redaction 已实现，自动 retention deletion 仍明确不启用。
5. **运营度量与组织证据**：ORG-01..05 已产品化；仍缺员工/经理 cycle-time 指标、DATA-05 的字段级最小化技术证明、受保护属性 subgroup impact。
6. **领域契约/审计耐久性**：TS/Zod/OpenAPI/SQL 仍是多份来源（DOM-01）；WORM/双副本/外部 TSA 已有 anchor + runbook，但实际部署证据不在仓库内（MON-07）。

> 结论口径：**核心 P0 可运行且大部分合规控制已落地；不能把剩余法律/安全/度量项称为“全部完成”**。这些剩余项中，LG-05 外部电子签、WORM 存储、供应商 DPA 证据和 subgroup 口径需要产品/法务/部署决策，不能只靠代码补齐。

## 逐项核对

图例：✅ 已实现；🟡 部分实现/口径不足；❌ 未实现或仅流程；⚪ 产品/商业决策或明确非目标。

### 1. 定位与 P0 范围

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| POS-01 定位 | ✅ | 订单 → 工作包 → 证据 → claim → attribution → 计算 → 账本 → 结算链路存在；`packages/domain`、`apps/api` |
| POS-02 买家/champion | ⚪ | 产品/商业判断，不在代码 |
| POS-03 非目标 | ⚪ | 本轮在用户授权下额外实现了薪酬、股权、悬赏、Agent Runtime，属于有意的范围扩张 |
| P0-01 最小闭环 | ✅ | 工作包/交付验收/claim/decision/计算/审批/确认/申诉/影子结算均可跑 |
| P0-02 工作包与承诺快照 | ✅ | `commitWorkPackage`、`work_package_versions`、版本查询 |
| P0-02 交付与验收 | ✅ | `deliverables` 生命周期、验收人≠交付人 |
| P0-02 申报/认定分离 | ✅ | `ContributionClaim` 与 `AttributionDecision` 分离，`assertAdjudicatorIsNotClaimant` |
| P0-02 证据 | ✅ | EvidenceNode/EvidenceLink、质量状态、反证/缺口、员工证据范围 |
| P0-02 Reference policy | ✅ | `packages/policy-dsl`、独立参照、golden fixtures、reconciliation |
| P0-02 确定性计算 | ✅ | decimal、舍入、封顶、最大余数分配、trace、result hash、`engine_version` |
| P0-02 法律门禁 | 🟡 | 五类 ref + policyApproved/minimumWageChecked 阻断 FORMAL；范围/合同/扣款/AI 解释未闭环 |
| P0-02 账本 | ✅ | append-only、幂等、锁定、冲销、adjustment、哈希链 |
| P0-02 员工端 | 🟡 | 旧 `/` 页面支持本人确认/申诉/claim/evidence/notice；新 `/console` 不是员工专用界面，也缺少团队聚合/独立角色导航 |
| P0-02 审计 | ✅ | `audit_events`、`/audit-events/verify`，本轮新增证据包导出 |
| P0-02 指标 | 🟡 | 覆盖率、对账差异、DQ、申诉率/统计、信任调查已有；本轮新增 work-package acceptance 与 claim-decision cycle time，员工/经理端到端耗时与细分角色耗时仍有缺口 |
| P0-03 明确不做 | ⚪ | 实际扩大了范围（用户明确授权），需要在产品文档中更新范围声明 |
| P0-04 成功指标 | 🟡 | 证据覆盖率、对账 0、正式门禁、申诉统计、信任调查、package/claim cycle time 可测；目标阈值与员工/经理端到端耗时仍不可由当前代码证明 |
| P0-05 不承诺项 | ⚪ | 产品沟通，不在代码 |

### 2. 法律生效门禁

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| LG-01 记录/阻断/审计 | ✅ | `legalGateBlockers`、`legal_gate_records`、门禁审计 |
| LG-02 法人/法域/员工类型 | ✅ | 发布 schema 必填 legalEntity/jurisdictions/workLocations/employeeCategories/workTimeTypes；memory/PG 持久化并在 store 层拒绝缺失；rollback 继承源版本适用性；console 显示 |
| LG-03 民主程序/员工代表 | ✅ | Representation、Consultation、legal gate ref、readiness 检查 |
| LG-04 告知/签收 | ✅ | EmployeeNotice、Acknowledgement/Decline、覆盖率门禁；沉默不视为同意 |
| LG-05 合同/薪酬方案变更 | 🟡 | 必填 consent signature、payPlanVersion、amendment history 已有；本轮新增未来生效排期（≤180 天）、SCHEDULED/APPLIED/CANCELLED 状态、取消和 payroll 到期自动应用；仍未接入外部电子签服务 |
| LG-06 最低工资/扣款 | 🟡 | 最低工资、总额扣款上限、tax/social 分列、deductionOrder/breakdown 已有；本轮新增 contract `deductionTypeCaps` 与 payroll 逐类型 cap 校验/违约列表，超出阻断行；法定扣款类型映射与执行令/员工同意的法律优先级仍待法务确认 |
| LG-07 PIP/不利决定 | ✅ | 新增 human-only adverse-action 工作流：DRAFT→LEGAL_REVIEW→APPROVED→ACTIVE→COMPLETED/CANCELLED，法律复核/批准分离；无 score→adverse-action 自动路径 |
| LG-08 个人信息保护 | 🟡 | DPIA、DSAR、retention、legal hold 有；本轮新增数据源登记（owner/SLA/存储区域/跨境/处理者）与字段级 data map；自动删除仍未启用 |
| LG-09 AI 告知/解释 | ✅ | 新增 `GET /me/ai-explanations` 和 console `My AI record`：员工可见 AI 使用、模型、notice/ack、草稿/决策、建议分数、人工复核与可申诉目标 |
| LG-10 证据包 | ✅ | 本轮新增 `GET /api/v1/evidence-packages/:cycleId` 和 console 下载：策略/法律门/测试/证据/claim/decision/计算/确认/申诉/结算/账本/DQ/审批/审计/哈希校验 |

### 3. 激励设计护栏

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| INC-01 可配置≠正确 | ✅ | Policy Pack + 护栏文档/原则 |
| INC-02 角色差异化结构 | ✅ | Policy Pack roles + contract employment type 已有；本轮新增 CompensationTemplate（roleCode/employmentType/currency/salary range/deduction/variable/smoothing/order/caps），合同引用模板时强制类型/币种/薪资区间校验，console 可录入 template code |
| INC-03 平滑阈值/不追溯 | ✅ | 已有 ACKNOWLEDGED 结算周期禁止 ledger adjustment/reversal；“本轮新增 contract `smoothingThresholdRate`，payroll 对比上一期 incentive，变化超阈阻断行并记录 prior/change rate；跨周期分摊策略仍可由合同阈值表达，但 signed-cycle 全面锁定仍靠结算 guard |
| INC-04 浮动上限/最低工资 | ✅ | Pool cap、最低工资、合同级 ledger 扣款上限；本轮新增 `variableShareCapRate`，按 gross 计算个体浮动占比上限，超出则 payroll 行与 run 阻断 |
| INC-05 团队池 | ✅ | Policy DSL 支持池分配/多人权重 |
| INC-06 保护未计价工作 | 🟡 | Rubric dimensions 可配置，但无“未计价工作不得默认为 0”的强制规则 |
| INC-07 不排名/不展示同事金额 | ✅ | 员工数据范围过滤；计算行/订单经济性脱敏 |
| INC-08 机动/战略池治理 | ✅ | BudgetPool/Allocation 审批已有；本轮新增 discretionary pool review：≥2 人委员会、独立员工观察员、公开 selection criteria 与 decision notes、reviewer 记录，console 可录入 |
| INC-09 A 类池/成本核算 | ⚪ | 明确非目标，未实现 |
| INC-10 Clawback | 🟡 | 冲销/Recovery 与 no-retroactive 阻断已有；本轮新增 clawback case：书面同意必填、1–12 期分期、hardship 理由、requester≠approver、waive/cancel；仍未自动生成 recovery batch 或强制最低工资逐期校验 |
| INC-11 评价与发展/奖惩分离 | ✅ | EvaluationDecision、AttributionDecision、Ledger 分模型 |
| INC-12 年度制度审查 | 🟡 | 新增 `GET /reports/policy-review` 与 console Annual review：滚动 12 个月的制度发布、告知签收、申诉/SLA/结果、评价决策、AI 接受/override/盲审、DQ、DSAR/DPIA、harness 证据；信任调查已接入年度报告（最近关闭期与 baseline）；子群体影响仍未采集，不能视为完整签收 |
| INC-13 Policy Pack 契约 | ✅ | `policyPackManifestSchema` 覆盖 id/name/version/status/description/corePolicyCode/policy/fixtures/applicability/roles/workPackageTemplates/evidenceRequirements/simulationData/seed；三个 vertical pack 均通过 manifest 测试 |

### 4. 贡献认定

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ATT-01 申报≠认定 | ✅ | Claim/Decision 分离、人工 decision |
| ATT-02 回避 | ✅ | 新增 `conflict_declarations` 关联登记/撤销；创建 attribution decision（含 batch）前检查双向 active 冲突并返回 `ADJUDICATOR_CONFLICT_OF_INTEREST`；console Settings 可维护 |
| ATT-03 例外/补录 | ✅ | ContributionClaim 新增 `claimMode`（STANDARD/EXCEPTION/BACKFILL）与必填 `exceptionReason`；memory/PG 持久化，console 申报表单可标记并在列表展示 |
| ATT-04 覆盖率分层 | ✅/🟡 | 本轮新增按 responsibilityCode 和订单类型分层；任务类型维度仍缺 |
| ATT-05 证据不足不默认 0 | ✅ | 评分结果新增 `insufficientEvidence`；默认 `evidenceDefaultRule=BLOCK` 拒绝缺失维度评分的 AI proposal，只有显式设为 `ZERO` 才允许落 0；测试覆盖 block/override |
| ATT-06 先独立判断/AI 草稿/盲审 | ❌ | 无独立判断记录、盲审样本、校准会；AI proposal 直接展示给 reviewer |
| ATT-07 申诉由非原决定人/SLA/证据披露 | 🟡 | 非原决定人复核 + 本轮新增 dueAt/evidenceRefs/SLA skill；无正式证据披露/无报复承诺流程 |
| ATT-08 贡献/绩效分离 | ✅ | 独立对象和 API |
| ATT-09 子群体/一致性审计 | 🟡 | 本轮新增 quarterly policy-review `reviewConsistency`：按评审人统计 decision/confirmed/partial/rejected 比例、平均决策天数、重复决策与结果变化数，console Annual review 展示；受保护属性的 subgroup impact 仍未采集，明确标注不可用 |

### 5. AI / Agent

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| AI-01 评测前移 | ✅ | 未通过 EvaluationGate 禁止 numeric scoring；`scoreEvidence` 强制 gate |
| AI-02 评测要求 | 🟡 | harness、holdout、AI-human ≤ human-human 已有；gold-set 注册与强制校验、canary/vendor-change 对比（kappa/subgroup gap/injection/stability 回归阻断）已实现；季度刷新仍只记录 due date，不自动重训/重标 |
| AI-03 人工监督 | ✅ | 独立先判/理由/时长/证据打开/override 理由、rubber-stamp 预警、override 必抽 + 随机盲审、audit agreement、HIGH/CRITICAL 决策前强制第二复核（不一致 409）均已落地；AI console 展示平均审阅时长/打开证据/盲审数 |
| AI-04 Agent 范围 | ✅ | 主动 Runtime、7 个 skill、T0–T3、T3 人工、幂等/重试/死信/审计 |
| AI-05 安全 | 🟡 | Evidence 作为输入、schema/权限、provider policy、red-team run 门禁已有；本轮 tools 增加 READ/WRITE access，`AGENT_ROLE=READER` 时 WRITE 工具直接 REJECTED；仍是进程级角色，不是 per-task/per-tenant 强制隔离 |

### 6. 领域契约与金额路径

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DOM-01 单一契约 | 🟡 | TS/Zod/OpenAPI/SQL 四份；路由覆盖、RLS/约束测试之外，新增关键请求 schema 的 required 字段级 OpenAPI↔Zod 对齐测试；仍非单一生成源 |
| DOM-02 状态机 | ✅ | `packages/domain/src/states.ts` 与 PRD 状态一致 |
| DOM-03 必须对象 | ✅ | MetricDefinition、Snapshot、Notice、Recalculation、Budget、RuleChangeOrder、ModelEvaluationRun、SettlementExport、AuditChain、Integration 对象均存在 |
| MON-01 审批一次性 | ✅ | consumed_at/by、target 校验、payload hash、consume |
| MON-02 结算只处理锁定账本 | ✅ | settlement_lines trigger + line/ledger 校验 |
| MON-03 同一 ledger 不重复结算 | ✅ | partial unique active index |
| MON-04 计算行唯一 | ✅ | `calculation_lines` unique constraint |
| MON-05 账本不重复入账 | ✅ | `calculation_line_id + entry_type` unique |
| MON-06 锁定账本不可变 | ✅ | trigger 禁止 UPDATE/DELETE |
| MON-07 审计可验证 | 🟡 | prev/entry hash、sequence、trigger、RLS、verify；新增 `/audit-events/anchor` root hash 清单与 `docs/operations/audit-durability.md`（WORM/双副本/TSA/恢复演练）；实际 WORM/TSA 仍由部署提供，代码不能证明已启用 |
| MON-08 输入可重放 | ✅ | `engine_version`、input_snapshot、input_snapshot_hash、policy content hash |

### 7. 数据质量与证据覆盖

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DATA-01 分层覆盖率 | ✅/🟡 | 本轮新增角色/订单类型；任务类型、周期趋势仍缺 |
| DATA-02 被动+自报+同伴+经理证明 | ✅ | 被动 ingestion、员工自报已有；本轮新增 peer/manager attestation（主体须为工作包参与者、不能自证、MANAGER 须为直属经理），可带证据引用、仅 attester 可撤回，console Contribution 可录入/查看 |
| DATA-03 证据不足不默认 0 | ✅ | NEEDS_EVIDENCE + DQ blocking；新增可配置 `evidenceDefaultRule`（默认 BLOCK，显式 ZERO 才允许 0 分），AI scoring 在 proposal 前阻断缺失证据维度 |
| DATA-04 owner/SLA/升级 | ✅ | 新增 `data_sources` 登记：owner/backup owner、响应 SLA、criticality、90 天复核到期与逾期统计；DQ 的 assignee/dueAt/escalate 继续独立存在 |
| DATA-05 不采集活动量/最小化 | 🟡 | 字段级 data map、用途/分类/保留期、跨境/处理者清单已有；本轮新增 minimization 报告（personal fields / with retention / missing retention），Settings 展示缺口；仍无活动量字段采集的技术阻断 |

### 8. 组织采用与安全

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ORG-01 试点 volunteer/员工代表 | ✅ | Representation/Consultation 已有；本轮新增 pilot enrollment（volunteer、scope、consent signature、ACTIVE/WITHDRAWN、撤回原因），console Settings 可录入/撤回 |
| ORG-02 透明/本人数据/团队聚合 | 🟡 | 本人数据过滤有；本轮新增团队聚合报告（直接下属、评价覆盖率、维度均值、claim/appeal/work-package 计数，禁止个人金额/姓名，少于 3 人抑制）并接入 Dashboard；console 仍未按角色隐藏导航 |
| ORG-03 无报复/申诉统计公开 | ✅ | 新增 fairness commitment 版本化发布（新版本 supersede 旧版本）与 `/reports/appeal-stats` 聚合（申诉数、开放/逾期/关闭、结果分布、平均处理天数、申诉率、无个人标识）；Dashboard 对所有登录用户展示承诺与统计 |
| ORG-04 经理培训/模板/校准会 | ✅ | 新增 manager training records（code/title/completed/expiry/evidence）与 calibration sessions（facilitator/attendees/notes/policy ref）；console Settings 可录入，年度审查报告含计数 |
| ORG-05 信任/程序公平调查 | ✅ | 新增匿名 trust survey（草稿/开放/关闭）、伪名 hash 响应、维度/题目均值、分布与同 code 上一期 baseline；年度审查报告读取最近关闭期 |
| SEC-01 威胁模型 | ✅ | 新增 `docs/security/threat-model.md`：资产、信任边界/数据流、STRIDE 表、滥用案例与测试映射、残余风险/非目标 |
| SEC-02 RLS | ✅ | FORCE RLS、app.tenant_id、platform_admin pool、负向测试、治理表 RLS |
| SEC-03 字段级 ABAC/break-glass | 🟡 | payroll `bankAccountRef` redaction、break-glass grant 已有；本轮新增 tenant `payrollFieldPolicies`，可按 `PAYROLL_LINE.<field>` 配置允许角色，对 gross/tax/net 等任意 line 字段生效并返回 `redactedFields`；仍是 payroll 范围，不是跨资源通用 ABAC 引擎 |
| SEC-04 导出 DLP/水印/审批/限流 | ✅ | 角色、CSV 公式中和、水印/SHA-256、字段 redaction、导出审批、per-tenant/actor export limit 已有；本轮新增可配置 `exportDlpEnabled`，扫描身份证/银行卡/手机号命中时要求 `SENSITIVE_EXPORT` 审批，覆盖 payroll CSV/bank 与 evidence package |
| SEC-05 模型供应商控制 | ✅ | 新增 model provider policy：zero-retention、DPA ref、inference region、egress allowlist、审批人；当 tenant setting `requireModelProviderPolicy=true` 时，AI proposal 与 prompt activation 强制校验 active 且完整策略；实际供应商合同/审计仍由采购与法务保存 |
| SEC-06 保留/DSR/法务保留/审计脱敏 | 🟡 | retention/DSAR/legal hold 有；本轮新增双人 audit reason redaction overlay（不改哈希，读 API/证据包应用替换）；自动 retention deletion 仍明确未启用 |

## 本轮已补的缺口

1. **LG-10 证据包**：`GET /api/v1/evidence-packages/:cycleId`，聚合 policy/legal gate/tests/evidence/claims/decisions/calculations/confirmations/appeals/settlements/ledger/approvals/notices/privacy/audit，并返回 `packageHash` 与审计/账本校验；console 的 Cycles 页面可直接下载 JSON。
2. **ATT-07 申诉 SLA/证据披露**：AppealCase 新增 `dueAt`、`evidenceRefs`；创建时默认 10 天 SLA；SLA skill 使用 dueAt；Exceptions 页面显示到期/逾期；迁移 `027_appeal_sla.sql`。
3. **DATA-01/ATT-04**：operations coverage 新增按责任角色、订单类型的覆盖率，以及申诉总数/开放/逾期/关闭/申诉率；Policy 页面展示。
4. **LG-02 policy applicability**：Policy Version 发布必填法人/法域/工作地/员工类别/工时类型，memory 与 PostgreSQL 持久化，rollback 继承源版本；console 展示适用性。
5. **LG-05 contract consent**：合同创建必填同意/电子签引用；新增 amendment 端点与 before/after 历史，拒绝未来生效排期；console 支持创建与修订。
6. **LG-06 deduction cap**：EmploymentContract 新增 `deductionCapRate`（默认 0.2），PayrollLine 记录 cap 金额/是否通过；超过上限的行阻断 run；console 合同表单可配置。
7. **LG-07 adverse actions**：新增 human-only PIP/调岗/降薪/解除工作流，法律复核与批准必须由不同人完成，无自动触发路径。
8. **LG-09 / AI-03**：新增员工 AI 透明记录页；AI 评分必须先独立打分/写理由再揭示，记录时长、证据打开数、盲审标记、override 理由，并提供 rubber-stamp 监控。
9. **AI-02 门禁强化**：新增 `POST /api/v1/model-evaluation-runs:evaluate`，由服务端 harness 计算 passed/blockers/metrics；增加 holdout 阈值、AI-human 一致率不得高于 human-human 的 blocker；prompt activation 和 score proposal 拒绝非 harness 生成的记录；AI 页面新增 Evaluation runs 列表。
10. 测试覆盖持续扩展（证据包、AI agreement、未验证评测拒绝、申诉 SLA 持久化、扣款上限、适用性校验、合同修订、adverse action、年度审查报告、数据源登记/data map、variable-share cap、PG 合同同意/修订、PG adverse action、PG 数据源），当前 **267 unit/API + 61 PG** 全绿。

11. **DATA-04 / DATA-05 data source registry**：新增 `data_sources`（owner/backup owner、SLA、criticality、存储区域、跨境、处理者、字段分类/用途/保留期）与 `GET /data-map`，console 的 Settings 可登记并查看 90 天复核逾期；迁移 `033_data_sources.sql`。

12. **INC-04 variable-share cap**：EmploymentContract/PayrollLine 增加浮动占比上限、实际占比与 cap 金额；税前 gross 口径，超出上限阻断行与 run；迁移 `034_variable_share_cap.sql`，合同创建/修订与 console 均可配置。

13. **ATT-03 exception/backfill provenance**：申报新增 claim mode 与强制原因；迁移 `035_claim_exception_mode.sql`，console 可录入并显示。

14. **AI-03 audit sampling**：AI proposal 增加 audit sample、第二复核人、第二套独立分数/理由、复核时长/证据数、AGREE/DISAGREE 与一致率；所有 override 自动入样，其他决策按租户 `aiAuditSampleRate`（默认 10%）随机入样；新增 audit queue / audit-review API、指标与 console Audit queue；迁移 `036_ai_audit_sampling.sql`。

15. **ATT-02 conflict registry**：新增关联方冲突声明、查询、撤销和双向 active 检查；申报认定（单条/批量）在创建前阻断冲突裁决人；迁移 `037_conflict_declarations.sql`，console 可维护。

16. **ORG-05 trust surveys**：新增匿名信任/程序公平调查（DRAFT→OPEN→CLOSED）、伪名响应 hash、维度/题目均值、分布与同 code 上一期 baseline；年度审查报告读取最近关闭期；迁移 `038_trust_surveys.sql`，console Settings 可创建/开放/关闭/响应/查看报告。

17. **ORG-02 team aggregate**：新增 `/reports/team-aggregate`，按 manager 直接下属聚合评价覆盖率、维度均值、claim/appeal/work-package 计数；个人金额/姓名不返回，少于 3 人抑制；Dashboard 增加团队面板。

18. **ORG-03 fairness commitment / public stats**：新增版本化 no-retaliation commitment、公开申诉聚合统计与 Dashboard/Settings 界面；迁移 `039_fairness_commitments.sql`。

19. **SEC-01 / MON-07**：新增正式威胁模型与审计耐久性 runbook；新增 `GET /audit-events/anchor` 返回序列窗口、root hash 与首尾事件 hash，供外部 TSA/WORM 归档；WORM 存储与 TSA 配置仍属于部署证据。

20. **DATA-02 peer/manager attestations**：新增 contribution attestations（PEER/MANAGER）、参与关系与直属经理校验、证据引用、仅 attester 可撤回；迁移 `040_contribution_attestations.sql`，console Contribution 新增 Attestations 视图。

21. **ORG-04 manager enablement**：新增培训记录与校准会记录，含完成/到期/证据、facilitator/attendees/notes；年度审查报告输出计数；迁移 `041_manager_enablement.sql`，Settings 可录入。

22. **ORG-01 pilot enrollment**：新增 volunteer pilot enrollment（scope、consent signature、withdraw reason），唯一约束防止重复 active enrollment；迁移 `042_pilot_enrollments.sql`，Settings 可录入/撤回。

23. **SEC-03 payroll field redaction / break-glass**：非 finance/admin 查看 payroll run/export 时隐藏他人 `bankAccountRef`；新增最长 24h、理由必填、grantee≠grantedBy 的 break-glass grant，console Settings 可授予/撤销；迁移 `043_break_glass.sql`。

24. **INC-03 no-retroactive guard**：对已有 ACKNOWLEDGED settlement batch 的 cycle，ledger adjustment/reversal 直接返回 `RETROACTIVE_ADJUSTMENT_BLOCKED`，要求新建 correction cycle；平滑阈值仍未实现。

25. **SEC-04 export controls**：payroll CSV/bank-file 响应增加 `x-export-classification`、`x-export-watermark`、`x-export-hash`；非 finance/admin 的 CSV 仍走字段 redaction；支持 `PAYROLL_EXPORT` / `PAYROLL_BANK_FILE` 审批动作与一次性消费。内容 DLP 与批量限流仍未实现。

26. **INC-10 clawback terms**：新增 clawback case（consent signature、installment、hardship、批准/豁免/取消、requester≠approver）；迁移 `044_clawback_cases.sql`，Settings 可录入/批准/豁免；执行仍走 settlement recovery，未与最低工资逐期校验打通。

27. **INC-08 discretionary pool governance**：新增 committee（≥2）/independent observer/selection criteria/decision notes 的 discretionary review；迁移 `045_discretionary_pool_reviews.sql`，Settings 可录入并查看。

28. **SEC-05 model-provider policies**：新增 provider 级 zero-retention/DPA/region/egress allowlist 与审批；tenant 开启 `requireModelProviderPolicy` 后，AI score proposal 与 prompt activation 强制校验；迁移 `046_model_provider_policies.sql`，Settings 可维护。

29. **AI-02 gold-set registry**：新增 versioned gold set（sample/holdout/label source/owner/refresh due），`requireRegisteredGoldSet=true` 时 evaluation harness 拒绝未注册 datasetRef；迁移 `047_model_evaluation_datasets.sql`，AI 页面可维护；canary 仍未实现。

30. **ATT-05 / DATA-03 evidence default rule**：`scoreEvidence` 返回 `insufficientEvidence`；默认 tenant `evidenceDefaultRule=BLOCK` 时 AI proposal 拒绝无证据维度，显式 `ZERO` 才允许 0 分；新增 scoring/API 测试。

31. **LG-06 deduction order/breakdown**：EmploymentContract 增加 `deductionOrder`，PayrollLine 增加按类型分组的 `deductionBreakdown`，payroll 按合同顺序排序并在 CSV/console 展示；迁移 `048_deduction_order.sql`。法定扣款类型/逐类型上限仍未实现。

32. **ATT-09 reviewer consistency**：年度审查报告新增按 adjudicator 的一致性/结果/时长统计与重复决策/结果变化计数，Policy Annual review 展示；子群体影响仍因不采集受保护属性而不可用。

33. **LG-05 future-dated amendments**：合同修订支持 ≤180 天未来生效；SCHEDULED 不改变当前条款，payroll 计算前自动应用到期修订，支持取消；迁移 `049_contract_amendment_scheduling.sql`。外部电子签仍缺。

34. **AI-03 pre-decision high-risk review**：AI proposal 增加 `riskTier`；HIGH/CRITICAL 必须在 decide 时提供第二复核人独立分数/理由，第二结论不一致返回 `AI_SECOND_REVIEW_DISAGREES`，并记录复核字段；迁移 `050_ai_high_risk_review.sql`，console 复核弹窗支持填写。

35. **P0-02/P0-04 cycle-time metrics**：operations coverage 增加 work-package created→accepted 与 claim submitted→decision 平均小时数，Policy coverage 展示；目标阈值和端到端角色耗时仍待产品定义。

36. **DOM-01 field-level contract test**：新增 OpenAPI required 字段与 Zod 关键 schema 的对齐测试（合同、claim、data source、AI proposal、settlement、clawback）。

37. **AI-02 canary/vendor regression**：新增 baseline vs candidate harness 对比，阻断 kappa/subgroup gap/prompt-injection/stability 回归；迁移 `051_model_canary_runs.sql`，AI 页面可查看。

38. **SEC-06 audit redaction**：新增 audit reason 双人 redaction overlay，不改原 event hash，`GET /audit-events` 与证据包读取时应用替换；迁移 `052_audit_redactions.sql`，Settings 可维护；自动 retention deletion 仍未启用。

39. **AI-05 red-team evidence**：新增 model red-team run（provider/model/prompt version/scope/tests/findings/artifact），失败必须列 findings；tenant 开启 `requireRedTeamRun` 时 prompt activation 强制校验；迁移 `053_model_red_team_runs.sql`，AI 页面可维护。

40. **LG-06 per-type deduction caps**：EmploymentContract 新增 `deductionTypeCaps`，PayrollLine 记录 `deductionTypeCapPassed/Breaches`，逐类型 cap 超出阻断行并在 CSV/console 展示；迁移 `054_deduction_type_caps.sql`。

41. **INC-03 incentive smoothing**：EmploymentContract 增加 `smoothingThresholdRate`，PayrollLine 记录 prior incentive、change rate 与 passed；payroll 自动取上一期 CALCULATED/APPROVED/PAID run 对比，超阈阻断；迁移 `055_incentive_smoothing.sql`。

42. **AI-05 reader/actor role isolation**：AgentTool 增加 READ/WRITE access；`AgentRuntimeOptions.role`（`AGENT_ROLE`）为 READER 时 WRITE 工具返回 `READER_ROLE_CANNOT_WRITE` 并审计；新增 runtime 测试。仍是进程级模式，per-task/per-tenant 强制隔离保留为后续。

43. **SEC-04 bulk export limit**：新增 per-tenant/actor export limiter（默认 30/min），覆盖 payroll CSV/bank-file、evidence package 与 settlement EXPORT，超限 429；内容 DLP 仍待规则定义。

44. **DATA-05 minimization report**：data map 增加 personal fields 保留期覆盖与 missing-retention 计数，Settings 展示；仍无活动量字段采集阻断。

45. **AI-03 review analytics UI**：Audit queue 面板展示平均审阅时长、平均打开证据数、盲审数与 agreement；AI-03 前端分析项补齐。

46. **SEC-04 export DLP**：新增 `exportDlpEnabled` 扫描（身份证/银行卡/手机号），命中时要求 `SENSITIVE_EXPORT` 审批并消费；覆盖 payroll CSV/bank 与 evidence package；默认关闭以免阻断合法财务导出。

47. **SEC-03 payroll field policies**：tenant `payrollFieldPolicies` 支持 `PAYROLL_LINE.<field>` 角色白名单，默认 bankAccountRef 仍仅 finance/admin/本人；按行返回 `redactedFields`，console 显示 Redacted。仍是 payroll 范围，跨资源 ABAC 保留。

48. **INC-02 compensation templates**：新增 role compensation template registry 与合同引用校验（类型/币种/薪资区间），迁移 `056_compensation_templates.sql`，console 合同表单可填 template code。

## 仍建议按 P0 顺序补做

1. **LG-05 future-dated consent/e-signature**：合同未来生效排期、到期自动应用与外部电子签服务对接。
2. **LG-06 statutory deduction types**：执行令/员工同意/法定优先顺序、逐类型上限与税务/社保分类的完整映射。
3. **AI residual**：per-task/per-tenant reader/actor 强制隔离、gold-set 自动刷新。
4. **DATA/ORG residual**：员工/经理 cycle-time、任务类型覆盖率趋势、DATA-05 字段级最小化技术证明、受保护属性 subgroup impact（需法务口径）。
5. **SEC residual**：跨资源通用 ABAC 引擎；自动 retention deletion 仍明确不启用。
6. **INC residual**：INC-06 未计价工作强制规则。
7. **DOM-01**：从单一 schema 生成/校验 OpenAPI、DDL 与 Zod，补齐字段级契约漂移测试。
8. **MON-07 deployment evidence**：在目标环境启用 WORM/双副本/外部 TSA，保存恢复演练与 anchor 回执。

这些剩余项里，有些是产品/法务/部署决策，不能只靠代码“补完”；在当前代码基线上，**核心 P0 闭环和大部控制已可运行，但仍不能宣称完整 P0 全部落地**。
