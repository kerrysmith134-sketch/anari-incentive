# PRD V4.1 落地核对（2026-10-30）

**核对对象**：`docs/PRD_V4.1_评审修订版.md`（512 行，P0 基线）  
**代码基线**：`main` 分支，2026-10-30 工作树；核对后新增的缺口修复见文末“本轮已补”  
**验证**：`npm run typecheck`、`npm test`（234 个单元/API 测试）、`npm run web:build`、`npm run test:pg`（46 个 PostgreSQL 测试）均通过；关键流程已在浏览器中手工走通。

## 结论

**没有全部落地。** 仓库已经不是“只有骨架”：核心纵向切片、确定性金额路径、账本、审批、AI 评测门、治理对象、集成、HRIS/薪酬、SPA 都已可运行，并且金额路径的数据库级不变量大体齐全。

但对照 PRD 的 **P0 验收要求**，仍有几类实质性缺口：

1. **法律门禁只完成了“记录/阻断”主干，未完成可执行的范围、合同变更、扣款上限、不利决定和员工 AI 解释流程**（LG-02、LG-05、LG-06、LG-07、LG-09）。
2. **证据/贡献运营化不足**：覆盖率的角色/订单维度本轮才补；员工/经理耗时、信任调查、同伴提名/经理证明、默认补证规则仍缺失（DATA-02/03/04、P0-04）。
3. **AI 人工监督不完整**：已有评测门禁和 harness 接入，但没有“人先独立判断再看 AI”、审阅耗时、打开证据数、盲审/双人复核和橡皮图章指标（AI-03）。
4. **激励护栏只完成了一部分**：最低工资、池上限、冲销/Recovery 已有；角色差异化结构、平滑阈值/不追溯、机动池治理、clawback 条件、年度制度审查缺失（INC-02/03/04/08/10/12）。
5. **安全/隐私仍是 RBAC+行级隔离，不是字段级 ABAC**；没有 break-glass、导出 DLP/水印/审批、模型供应商零留存/区域配置、正式威胁模型（SEC-01/03/04/05/06）。
6. **组织采用措施基本是产品外流程**：试点 volunteer、员工代表对规则的持续参与、无报复承诺、经理培训/校准会、信任调查均未产品化（ORG-01..05）。
7. **领域契约不是单一生成源**：状态机和类型有单一 TS 来源，OpenAPI/DDL/Zod 还有人工漂移风险；当前只有路由覆盖和部分字段测试（DOM-01）。
8. **审计链只有数据库 trigger + 哈希链**，没有 WORM/双副本/外部锚定；这是部署与运维要求，不是当前代码能证明的（MON-07）。

> 结论口径：**不是“全部 PRD 已开发落地”**；是“P0 的第一个完整可运行骨架 + 大量 P1/延伸能力已实现，但 P0 的合规、AI 监督、运营指标和部分安全控制仍需继续”。

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
| P0-02 指标 | 🟡 | 覆盖率、对账差异、DQ 有；员工/经理耗时、争议率、信任无完整测量 |
| P0-03 明确不做 | ⚪ | 实际扩大了范围（用户明确授权），需要在产品文档中更新范围声明 |
| P0-04 成功指标 | 🟡 | 证据覆盖率、对账 0、正式门禁可测；耗时/信任/争议率目标不可由当前代码证明 |
| P0-05 不承诺项 | ⚪ | 产品沟通，不在代码 |

### 2. 法律生效门禁

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| LG-01 记录/阻断/审计 | ✅ | `legalGateBlockers`、`legal_gate_records`、门禁审计 |
| LG-02 法人/法域/员工类型 | ✅ | 发布 schema 必填 legalEntity/jurisdictions/workLocations/employeeCategories/workTimeTypes；memory/PG 持久化并在 store 层拒绝缺失；rollback 继承源版本适用性；console 显示 |
| LG-03 民主程序/员工代表 | ✅ | Representation、Consultation、legal gate ref、readiness 检查 |
| LG-04 告知/签收 | ✅ | EmployeeNotice、Acknowledgement/Decline、覆盖率门禁；沉默不视为同意 |
| LG-05 合同/薪酬方案变更 | 🟡 | 新增必填 consent signature、payPlanVersion 和 amendment history；amend 需同意证据且拒绝未来生效日期。仍未接入真正电子签服务，也不支持未来生效排期 |
| LG-06 最低工资/扣款 | 🟡 | 本轮新增 contract 级 ledger 扣款上限（默认 20%）并在 payroll 行阻断；仍无扣款类型/顺序与税费分类 |
| LG-07 PIP/不利决定 | ✅ | 新增 human-only adverse-action 工作流：DRAFT→LEGAL_REVIEW→APPROVED→ACTIVE→COMPLETED/CANCELLED，法律复核/批准分离；无 score→adverse-action 自动路径 |
| LG-08 个人信息保护 | 🟡 | DPIA、DSAR、retention、legal hold 有；本轮新增数据源登记（owner/SLA/存储区域/跨境/处理者）与字段级 data map；自动删除仍未启用 |
| LG-09 AI 告知/解释 | ✅ | 新增 `GET /me/ai-explanations` 和 console `My AI record`：员工可见 AI 使用、模型、notice/ack、草稿/决策、建议分数、人工复核与可申诉目标 |
| LG-10 证据包 | ✅ | 本轮新增 `GET /api/v1/evidence-packages/:cycleId` 和 console 下载：策略/法律门/测试/证据/claim/decision/计算/确认/申诉/结算/账本/DQ/审批/审计/哈希校验 |

### 3. 激励设计护栏

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| INC-01 可配置≠正确 | ✅ | Policy Pack + 护栏文档/原则 |
| INC-02 角色差异化结构 | 🟡 | Contract 有 employment type；Policy Pack 未提供 roles/薪酬结构模板契约 |
| INC-03 平滑阈值/不追溯 | 🟡 | Policy simulation 可看边际变化；无 signed-cycle 锁定/追溯调整阻断 |
| INC-04 浮动上限/最低工资 | ✅ | Pool cap、最低工资、合同级 ledger 扣款上限；本轮新增 `variableShareCapRate`，按 gross 计算个体浮动占比上限，超出则 payroll 行与 run 阻断 |
| INC-05 团队池 | ✅ | Policy DSL 支持池分配/多人权重 |
| INC-06 保护未计价工作 | 🟡 | Rubric dimensions 可配置，但无“未计价工作不得默认为 0”的强制规则 |
| INC-07 不排名/不展示同事金额 | ✅ | 员工数据范围过滤；计算行/订单经济性脱敏 |
| INC-08 机动/战略池治理 | 🟡 | BudgetPool/Allocation 有审批；无双人/委员会、员工代表观察、公开标准与复盘记录 |
| INC-09 A 类池/成本核算 | ⚪ | 明确非目标，未实现 |
| INC-10 Clawback | 🟡 | 冲销/Recovery 有；无书面同意、分期/困难豁免、最低工资与不追溯已签周期 |
| INC-11 评价与发展/奖惩分离 | ✅ | EvaluationDecision、AttributionDecision、Ledger 分模型 |
| INC-12 年度制度审查 | 🟡 | 新增 `GET /reports/policy-review` 与 console Annual review：滚动 12 个月的制度发布、告知签收、申诉/SLA/结果、评价决策、AI 接受/override/盲审、DQ、DSAR/DPIA、harness 证据；员工信任调查与子群体影响仍未采集，不能视为完整签收 |
| INC-13 Policy Pack 契约 | 🟡 | `pack.json` 有 policy/fixtures；缺 roles、workPackageTemplates、evidenceRequirements、simulationData、seed 的契约与校验 |

### 4. 贡献认定

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ATT-01 申报≠认定 | ✅ | Claim/Decision 分离、人工 decision |
| ATT-02 回避 | ✅ | 新增 `conflict_declarations` 关联登记/撤销；创建 attribution decision（含 batch）前检查双向 active 冲突并返回 `ADJUDICATOR_CONFLICT_OF_INTEREST`；console Settings 可维护 |
| ATT-03 例外/补录 | ✅ | ContributionClaim 新增 `claimMode`（STANDARD/EXCEPTION/BACKFILL）与必填 `exceptionReason`；memory/PG 持久化，console 申报表单可标记并在列表展示 |
| ATT-04 覆盖率分层 | ✅/🟡 | 本轮新增按 responsibilityCode 和订单类型分层；任务类型维度仍缺 |
| ATT-05 证据不足不默认 0 | 🟡 | NEEDS_EVIDENCE、DQ 阻断存在；默认规则不可配置，证据覆盖评分仍可落为 0 |
| ATT-06 先独立判断/AI 草稿/盲审 | ❌ | 无独立判断记录、盲审样本、校准会；AI proposal 直接展示给 reviewer |
| ATT-07 申诉由非原决定人/SLA/证据披露 | 🟡 | 非原决定人复核 + 本轮新增 dueAt/evidenceRefs/SLA skill；无正式证据披露/无报复承诺流程 |
| ATT-08 贡献/绩效分离 | ✅ | 独立对象和 API |
| ATT-09 子群体/一致性审计 | 🟡 | AI 模型有 subgroup metrics；贡献评审人一致性/季度报告未实现 |

### 5. AI / Agent

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| AI-01 评测前移 | ✅ | 未通过 EvaluationGate 禁止 numeric scoring；`scoreEvidence` 强制 gate |
| AI-02 评测要求 | 🟡 | 本轮新增 harness 端点、holdout 阈值、AI-human ≤ human-human 检查；gold set 标注管理/季度刷新/canary/供应商变更回归仍无 |
| AI-03 人工监督 | 🟡 | 已强制先录独立分数/理由再揭示 AI，记录时长/证据打开/override 理由/盲审标记，并提供 >95% rubber-stamp 预警；本轮新增盲审抽样（所有 override 必抽 + 可配置随机比例）、第二复核人独立评分、AGREE/DISAGREE 与一致率指标；仍是决策后抽样，不是决策前强制双人复核 |
| AI-04 Agent 范围 | ✅ | 主动 Runtime、7 个 skill、T0–T3、T3 人工、幂等/重试/死信/审计 |
| AI-05 安全 | 🟡 | Evidence 作为输入、schema/权限有；无 reader/actor 隔离的强制实现、egress allowlist、供应商 DPA/零留存/区域推理配置、红队记录 |

### 6. 领域契约与金额路径

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DOM-01 单一契约 | 🟡 | TS/Zod/OpenAPI/SQL 四份；有 route coverage、RLS/约束测试，但无字段级生成/一致性校验 |
| DOM-02 状态机 | ✅ | `packages/domain/src/states.ts` 与 PRD 状态一致 |
| DOM-03 必须对象 | ✅ | MetricDefinition、Snapshot、Notice、Recalculation、Budget、RuleChangeOrder、ModelEvaluationRun、SettlementExport、AuditChain、Integration 对象均存在 |
| MON-01 审批一次性 | ✅ | consumed_at/by、target 校验、payload hash、consume |
| MON-02 结算只处理锁定账本 | ✅ | settlement_lines trigger + line/ledger 校验 |
| MON-03 同一 ledger 不重复结算 | ✅ | partial unique active index |
| MON-04 计算行唯一 | ✅ | `calculation_lines` unique constraint |
| MON-05 账本不重复入账 | ✅ | `calculation_line_id + entry_type` unique |
| MON-06 锁定账本不可变 | ✅ | trigger 禁止 UPDATE/DELETE |
| MON-07 审计可验证 | 🟡 | prev/entry hash、sequence、trigger、RLS、verify；无 WORM/双副本/外部锚定 |
| MON-08 输入可重放 | ✅ | `engine_version`、input_snapshot、input_snapshot_hash、policy content hash |

### 7. 数据质量与证据覆盖

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DATA-01 分层覆盖率 | ✅/🟡 | 本轮新增角色/订单类型；任务类型、周期趋势仍缺 |
| DATA-02 被动+自报+同伴+经理证明 | 🟡 | 被动 ingestion、员工自报有；同伴提名/经理证明无独立入口/模型 |
| DATA-03 证据不足不默认 0 | 🟡 | NEEDS_EVIDENCE + DQ blocking；没有可配置默认补证策略 |
| DATA-04 owner/SLA/升级 | ✅ | 新增 `data_sources` 登记：owner/backup owner、响应 SLA、criticality、90 天复核到期与逾期统计；DQ 的 assignee/dueAt/escalate 继续独立存在 |
| DATA-05 不采集活动量/最小化 | 🟡 | 新增字段级 data map（用途、分类、保留期）、跨境/处理者清单与最小化登记；仍无技术层面的活动量采集阻断或字段级最小化证明 |

### 8. 组织采用与安全

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ORG-01 试点 volunteer/员工代表 | 🟡 | Representation/Consultation 有；volunteer 同意/试点范围无 |
| ORG-02 透明/本人数据/团队聚合 | 🟡 | 本人数据过滤有；团队聚合视图无，且 console 未按角色隐藏导航 |
| ORG-03 无报复/申诉统计公开 | ❌ | 无承诺记录、无公开统计 |
| ORG-04 经理培训/模板/校准会 | ❌ | 无培训/校准记录 |
| ORG-05 信任/程序公平调查 | ❌ | 无基线/季度调查对象或报表 |
| SEC-01 威胁模型 | ❌ | 无正式威胁模型/STRIDE/数据流图 |
| SEC-02 RLS | ✅ | FORCE RLS、app.tenant_id、platform_admin pool、负向测试、治理表 RLS |
| SEC-03 字段级 ABAC/break-glass | ❌ | 只有角色 + 对象/本人过滤；无字段级策略、break-glass 期限/理由/审计 |
| SEC-04 导出 DLP/水印/审批/限流 | 🟡 | 角色、CSV 公式中和、rate limit、now 证据包；无 DLP/水印/导出审批/批量限流 |
| SEC-05 模型供应商控制 | ❌ | 无零留存/DPA/区域推理/字段白名单配置与校验 |
| SEC-06 保留/DSR/法务保留/审计脱敏 | 🟡 | retention/DSAR/legal hold 有；自动删除未启用，audit 脱敏未实现 |

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
10. 测试覆盖持续扩展（证据包、AI agreement、未验证评测拒绝、申诉 SLA 持久化、扣款上限、适用性校验、合同修订、adverse action、年度审查报告、数据源登记/data map、variable-share cap、PG 合同同意/修订、PG adverse action、PG 数据源），当前 **234 unit/API + 46 PG** 全绿。

11. **DATA-04 / DATA-05 data source registry**：新增 `data_sources`（owner/backup owner、SLA、criticality、存储区域、跨境、处理者、字段分类/用途/保留期）与 `GET /data-map`，console 的 Settings 可登记并查看 90 天复核逾期；迁移 `033_data_sources.sql`。

12. **INC-04 variable-share cap**：EmploymentContract/PayrollLine 增加浮动占比上限、实际占比与 cap 金额；税前 gross 口径，超出上限阻断行与 run；迁移 `034_variable_share_cap.sql`，合同创建/修订与 console 均可配置。

13. **ATT-03 exception/backfill provenance**：申报新增 claim mode 与强制原因；迁移 `035_claim_exception_mode.sql`，console 可录入并显示。

14. **AI-03 audit sampling**：AI proposal 增加 audit sample、第二复核人、第二套独立分数/理由、复核时长/证据数、AGREE/DISAGREE 与一致率；所有 override 自动入样，其他决策按租户 `aiAuditSampleRate`（默认 10%）随机入样；新增 audit queue / audit-review API、指标与 console Audit queue；迁移 `036_ai_audit_sampling.sql`。

15. **ATT-02 conflict registry**：新增关联方冲突声明、查询、撤销和双向 active 检查；申报认定（单条/批量）在创建前阻断冲突裁决人；迁移 `037_conflict_declarations.sql`，console 可维护。

## 仍建议按 P0 顺序补做

1. **future-dated consent/e-signature**：合同未来生效排期与外部电子签服务。
2. **扣款与不利决定**：扣款类型/顺序与税费分类；PIP/培训/调岗/adverse action 独立人工流程。
3. **AI-03 residual**：随机盲审抽样、高风险双人复核、审阅耗时/证据打开的前端分析面板。
5. **DATA/ORG**：同伴提名/经理证明、员工/经理耗时与信任调查。
6. **SEC**：威胁模型、字段级 ABAC、break-glass、导出 DLP/水印、供应商与 egress 策略。
7. **INC**：角色薪酬模板、平滑阈值/不追溯、机动池治理、clawback 条件；年度审查已有一致性报告，但员工信任调查和子群体影响仍缺。
8. **DOM-01/MON-07**：字段级契约校验、WORM/双副本/外部锚定。

这些缺口里，有些是产品/法务决策（LG-05/07/08、INC-12 的调查口径、ORG），不能只靠代码“补完”；在当前代码基线上，**只能说核心 P0 闭环已可运行，不能宣称完整 P0 已落地**。
