# PRD V4.1 落地核对（2026-11-05 更新）

**核对对象**：`docs/PRD_V4.1_评审修订版.md`（512 行，P0 基线）+ README 承诺的全部暂缓项
**代码基线**：`main` 分支 280e9b6（2026-11-05 定版）
**验证**：`npm run typecheck` 0 错误、`npm test` 417 单元/API、`npm run test:pg` 65 PostgreSQL、`npm run test:e2e` 18 E2E、`npm run web:build` 全部通过；PRD 逐项代码证据核对 64/64 通过（见下）。

# 2026-11-05 最终核对（定版结论）

对 PRD 全部条目 + README 承诺项做了一次逐项代码证据核对（grep 关键实现物 + 测试文件），**64/64 通过**，覆盖：P0-02 十一项最小闭环、LG-01..10、INC-02..12（含原非目标 INC-09）、ATT-01..09、AI-01..05、DOM-01..03、MON-01..08、DATA-01..05、ORG-01..05、SEC-01..06，以及四条扩张线（商业化、法定薪资、品牌、飞书）与平台加固。核对中发现的两个疑似缺口均为误报（账本表名为 amount_ledger；威胁模型位于 docs/security/threat-model.md）。

在“成熟产品收尾轮”之后又完成了两轮，至此开发项全部收口：

13. **前后端对齐轮（d4ea718）**：审计 console 全部 API 调用与后端 375 条路由的映射，修复 5 个后端有而 console 无入口的端点——个税申报 CSV 与银行 ICBC/CMB 格式下载、clawback 恢复生成弹窗、保留处置批量处理按钮、本租户订阅/发票只读面板、AI 模型摘要页签；动态命令路径（adverse actions / payroll actions / trust surveys / recalc / bounties / strategic pools）人工核实与后端枚举一致。
14. **品牌与飞书轮（280e9b6）**：
    - **品牌（anari-design-system）**：tokens.css 重写为提取的品牌令牌（ANARI 蓝 #1877f2 全系 + 炭黑 #342e2c 暖灰中性，暗色逐令牌重映射，旧 --accent* 别名兼容零组件改动）；官方 logo 三版本入 /brand（favicon、侧栏 icon 锁定、登录/注册页竖版），删除违规自绘 SVG；主题 storage key 对齐 anari-theme（兼容旧值）；AI 面板范式（引擎角标 + advisory 徽标 + 2px 置信度条三档着色）。
    - **飞书（feishu-integration）**：OAuth v2 浏览器登录（一次性 state 300s TTL 取出即删、code 换 user token、user_info 用 user token、首登只建基础 employee 角色、失败人话重定向、未配置 501）；HMAC session JWT + CompositeAuthenticator 与主认证共存；通讯录同步 FeishuDirectoryClient（部门父链、open_department_id 用户列表、open_id 去重、分页上限、code!=0 翻译）→ 部门映射 org 节点（org_nodes.external_id，迁移 069）、成员映射人员、leader 映射汇报线；dryRun 预览（父级可解析）、allowCreate 策略门控（默认关，开时仅基础角色）、职务永不影响角色、重复执行幂等；Integrations 页预览/应用卡片；登录页“Sign in with Feishu”消费 #feishu-token 回跳。

## 最终剩余清单（均为仓库外，代码无法关闭）

1. **部署配置**：飞书/HubSpot/电子签/模型供应商真实账号与密钥；生产 OIDC IdP；`AUDIT_WORM_URI` WORM 存储。
2. **运维证据**：MON-07 的 WORM/TSA 回执与 90 天恢复演练记录（工具已备：`npm run anchor:export`、durability 报告、backup-restore runbook）。
3. **法务确认**：LG-06 法定扣款类型映射的内容本身；LG-05 电子签模板；供应商 DPA。
4. **外部流水线**：AI-02 自动重训/重标（gold-set 刷新工作流已内建）。
5. **产品红线（永不实现）**：LLM 写金额/批准/结算、T3 自主执行、“绝对客观单一分”、通用 PM/HRIS/招聘/独立 IM。

# 2026-11-05 成熟产品收尾轮

在本轮之前，代码侧 P0 已闭环但 README 仍标注 "not production-ready"，且存在一批明确暂缓项。本轮按"全部执行完毕的成熟产品"口径收尾，全部改动均有测试（本轮结束时 406 unit/API + 65 PostgreSQL + 18 E2E 全绿）：

1. **生产加固**：`assertRuntimeConfig` 启动 fail-fast（生产 + dev 认证 / 内存 store 拒绝启动，覆盖标志须显式接受风险）；worker 生产环境缺凭证拒绝启动；Dockerfile 改多阶段（生产依赖、非 root、HEALTHCHECK、`npm run start`）；compose 开发栈显式 `NODE_ENV=development`；新增 `docs/operations/production-deployment.md` 与 `backup-restore.md`（RPO≤15min/RTO≤1h、恢复演练对齐 `AUDIT_RESTORE_DRILL_AT`）。
2. **SaaS 商业化（原 POS-03 暂缓项）**：`POST /api/v1/public/signup` 自助开通（租户+管理员+成员+人员+试用订阅；IP 限流、蜜罐、可关闭）；订阅计划目录 / 租户订阅（TRIALING/ACTIVE/PAST_DUE/CANCELED）/ 发票（DRAFT→ISSUED→PAID/VOID，两位小数金额）；席位强制（超出 402 SEAT_LIMIT_REACHED，仅 ACTIVE 占席）；平台管理 API + 租户自读（`/me/subscription`、`/me/invoices`）；迁移 066 + RLS；console Billing 页签与 `/console/signup`。
3. **法定个税闭环（原"完整法定薪资集成"暂缓项）**：`payrollTaxMode=STATUTORY_CN` 切换居民累计预扣法（同年 PAID run 聚合 YTD、5000 基本减除、税率/速算扣除、税款永不为负）；PayrollLine 持久化 tax_calculation_mode / ytd_taxable_income / ytd_tax_withheld / iit_rate_percent / iit_quick_deduction（迁移 067、实体注册表、PG 映射）；`GET /payroll-runs/:id/tax-filing` 申报 CSV（finance + 审批/DLP）；银行代发 `format=GENERIC|ICBC|CMB` 预设。
4. **INC-09 A 类池/战略池（原明确非目标，用户授权扩张）**：StrategicPoolCase DRAFT→COST_REVIEWED（标准成本 units×单价 + 转移定价引用必填）→FINANCE_APPROVED（审批人≠申请人、总池封顶、预算池可用额度校验、递延分期）→ACTIVE→SETTLED；迁移 068 + RLS；console Rewards 页签。
5. **INC-10 收尾**：`POST /clawback-cases/:id/generate-recovery` —— APPROVED 案例幂等地追加一笔锁定负向账本调整（按案例幂等键去重）并开启 RECOVERY 结算批次，负数行维持员工 SETTLEMENT 确认门；端到端 money-path 测试覆盖"工作包→申报→认定→正式计算→锁定→clawback→恢复→重复拒绝"。
6. **LG-06 机制收尾**：租户 `statutoryDeductionTypes` 注册表（类型分类、法定优先级、requiresCourtOrder/requiresConsent 标记、默认逐类型上限）；payroll breakdown 项带 statutory 标记，合同 cap 优先、注册表兜底；法定映射内容本身仍待法务确认（ADR-008 口径不变）。
7. **AI 模型适配器（原"model-backed scoring"暂缓项）**：`HttpModelScoringProvider`（OpenAI 兼容）——证据以不可信数据包裹、系统提示禁止执行证据内指令、输出严格 JSON schema 校验（0-5 维度分、置信度、缺维度拒绝）；`POST /ai/model-summary` 结果仅写入 AI suggestion log（advisory），未配置返回 501、坏输出 502；评测门禁与人工复核链路不变。
8. **Provider 拉取连接器**：HttpJsonConnector 支持 POST + body 游标；`buildHubspotSearchPullConfig`（CRM search `after` 分页）与 `buildFeishuBitablePullConfig`（多维表格 page_token 分页）预设 + 假 fetch 测试。
9. **Console 产品级身份（原暂缓项）**：`/console/login` 支持 OIDC bearer 与 dev-header 双模式，登录即验证 `/platform/identity` 后解锁；侧栏显示会话模式并提供切换入口；api client 已统一携带 authorization 头。
10. **SEC-06 自动处置执行器**：`POST /retention-disposal-requests:process` 批量完成到期已批准处置（legal-hold 类别跳过；与单条端点同一守卫：APPROVED+宽限期+法务保留），供集成角色定时调用；补齐平铺创建端点 `POST /retention-disposal-requests`（admin，嵌套端点保留）。ADR-008 的"默认不自动硬删除"不变——执行器只是把已审流程的最后一公里自动化。
11. **MON-07 anchor 归档 job**：`npm run anchor:export` 拉取 anchor 清单推送 `AUDIT_WORM_URI`（带认证头），未配置时落本地 `anchor-archive/` 回执链，供定时任务归档 WORM。
12. **契约与测试**：Zod 请求契约扩到 33 个并全部对齐 OpenAPI；新增 46 个测试（config 8、billing 10、statutory payroll 3+4、incentive extensions 4、model summary 3、retention disposal 1、connector preset 2、openapi 契约扩容），全量 406 unit/API + 65 PG + 18 E2E 通过。

## 2026-11-05 之后的剩余项

代码可关闭项已清零。剩余均为仓库外证据/决策：LG-05 真实电子签账号与模板、LG-06 法定映射的法务确认、MON-07 WORM/TSA 部署回执与 90 天恢复演练记录、AI-02 外部重训/重标流水线、供应商 DPA 证据、生产 IdP 接入。按 ADR-008 保持禁用的项（LLM 写金额、T3 自主执行、自动硬删除默认开启、绝对客观分）为产品红线，不属于缺口。

---

# 2026-11-02 核对记录（存档）

## 结论

**仍未宣称“全部 PRD 已落地”，但 P0 的核心闭环已经基本补齐。** 核心纵向切片、确定性金额路径、账本、审批、AI 评测门、法律门禁、员工确认/申诉、治理对象、HRIS/薪酬、集成、SPA 和大部分 P0 合规控制都已可运行，并有 API/PostgreSQL/前端构建验证。

对照 PRD 的 **P0 验收要求**，剩余缺口已收敛为：

1. **法律门禁的最后一公里**：LG-05 已具备未来排期与 provider callback 适配，实际电子签账号/合同由部署配置；LG-06 已有最低工资、扣款上限、deduction order/breakdown、逐类型上限、tax/social 分列与 clawback 逐期校验，ADR-008 固定扣款顺序；执行令/员工授权的最终法律映射仍待法务确认。
2. **AI 监督的边界**：已有独立先判、盲审、override 理由、audit sampling、高风险决策前第二复核、gold-set 注册与 canary/供应商变更回归；reader/actor per-task 隔离、red-team 门禁与审阅分析均已落地。
3. **激励护栏的剩余项**：已有 variable-share cap、clawback 条款与逐期工资保护、机动池委员会/观察员、年度审查；INC-06 已通过 zero-score rationale 强制。
4. **安全/隐私的剩余项**：已有威胁模型、RLS、payroll 字段 redaction + break-glass、导出水印/审批/默认 DLP、provider policy、audit anchor 与 durability readiness；`fieldAccessPolicies` 已覆盖六类资源并可管理，通用 `redactResourceFields` 便于继续扩展；对象式策略与 6 类 `match` 谓词已实现（服务端上下文、fail-closed、admin/本人无条件放行）。自动 retention deletion 仍明确不启用，保留 reviewed disposal。
5. **运营度量与组织证据**：ORG-01..05 已产品化；cycle-time 已覆盖 acceptance/claim/confirmation/payroll/appeal，并按 responsibilityCode 细分全部五个阶段；证据覆盖率已有按月与按任务类型的趋势；员工专用首页已补齐；DATA-05 对结构化活动量字段与明确监控措辞均有技术阻断（自由文本的隐晦表述仍依赖 DLP/人工审查）；subgroup impact 在单独同意标签下可聚合（小样本抑制/4-5 规则），无标签时明确不可用；剩余是产品目标阈值。
6. **领域契约/审计耐久性**：请求契约由 Zod 生成并校验 OpenAPI；实体契约升级为列级注册表，生成 persisted TS 类型、访问 scope manifest，手写接口只保留视图字段，DDL 测试逐列校验（DOM-01 请求、实体类型、权限 scope 与 SQL 部分已闭环）；WORM/双副本/外部 TSA 已有 anchor + runbook，但实际部署证据不在仓库内（MON-07）。

> 结论口径：**核心 P0 可运行且大部分合规控制已落地；不能把剩余法律/安全/度量项称为“全部完成”**。这些剩余项中，LG-05 外部电子签、WORM/TSA 存储、供应商 DPA 证据、执行令法律映射和细分角色目标需要产品/法务/部署决策或外部证据，不能只靠仓库代码证明。

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
| P0-02 员工端 | ✅/🟡 | 旧 `/` 页面支持本人确认/申诉/claim/evidence/notice；新 `/console` 增加角色感知导航，非 privileged 用户进入专用 My overview（本人工作包、确认记录、申诉、AI proposal、团队聚合抑制视图），不再加载租户级 payroll/approval/audit 数据；员工端深度操作仍可继续完善 |
| P0-02 审计 | ✅ | `audit_events`、`/audit-events/verify`，本轮新增证据包导出 |
| P0-02 指标 | ✅/🟡 | 覆盖率、对账差异、DQ、申诉率/统计、信任调查已有；新增 acceptance/claim/confirmation/payroll-approval/appeal cycle time、按责任角色的 acceptance/claim 耗时与 success-metrics 阈值报告，Policy coverage 展示；confirmation/payroll/appeal 的角色细分仍缺 |
| P0-03 明确不做 | ⚪ | 实际扩大了范围（用户明确授权），需要在产品文档中更新范围声明 |
| P0-04 成功指标 | ✅/🟡 | 新增 `GET /reports/success-metrics`：evidence coverage ≥70%、claim decision ≤2h（proxy）、dispute rate <10%、reconciliation differences=0，带 PASS/FAIL；acceptance/claim 已有责任角色细分；employee evidence supplement time 明确 UNAVAILABLE（不采集 session timing），其余流程角色细分仍缺 |
| P0-05 不承诺项 | ⚪ | 产品沟通，不在代码 |

### 2. 法律生效门禁

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| LG-01 记录/阻断/审计 | ✅ | `legalGateBlockers`、`legal_gate_records`、门禁审计 |
| LG-02 法人/法域/员工类型 | ✅ | 发布 schema 必填 legalEntity/jurisdictions/workLocations/employeeCategories/workTimeTypes；memory/PG 持久化并在 store 层拒绝缺失；rollback 继承源版本适用性；console 显示 |
| LG-03 民主程序/员工代表 | ✅ | Representation、Consultation、legal gate ref、readiness 检查 |
| LG-04 告知/签收 | ✅ | EmployeeNotice、Acknowledgement/Decline、覆盖率门禁；沉默不视为同意；linked policy notices 未完成时 FORMAL 计算硬阻断；payroll 逐员工未签收时该行阻断（迁移 065） |
| LG-05 合同/薪酬方案变更 | ✅ | 必填 consent signature、payPlanVersion、amendment history、未来排期/自动应用已有；本轮新增 e-sign envelope + HMAC provider callback，SIGNED 回调写回合同 consent signature；外部 provider 账号/合同仍由部署配置 |
| LG-06 最低工资/扣款 | 🟡 | 最低工资、总额扣款上限、tax/social 分列、deductionOrder/breakdown 已有；本轮新增 contract `deductionTypeCaps` 与 payroll 逐类型 cap 校验/违约列表，超出阻断行；法定扣款类型映射与执行令/员工同意的法律优先级仍待法务确认 |
| LG-07 PIP/不利决定 | ✅ | 新增 human-only adverse-action 工作流：DRAFT→LEGAL_REVIEW→APPROVED→ACTIVE→COMPLETED/CANCELLED，法律复核/批准分离；无 score→adverse-action 自动路径 |
| LG-08 个人信息保护 | 🟡 | DPIA、DSAR、retention、legal hold、字段级 data map、ADR-008 推荐保留期与 Settings 预填创建已有；本轮新增个人数据包 `GET /me/data-package` 与 `GET /dsar-requests/:id/package`（本人 profile/contracts/work role/claims/evidence/confirmations/appeals/evaluation/AI/DSAR/consent/acknowledgements + hash），删除/更正仍走人工复核；自动硬删除未启用 |
| LG-09 AI 告知/解释 | ✅ | 新增 `GET /me/ai-explanations` 和 console `My AI record`：员工可见 AI 使用、模型、notice/ack、草稿/决策、建议分数、人工复核与可申诉目标 |
| LG-10 证据包 | ✅ | `GET /api/v1/evidence-packages/:cycleId` 和 console 下载：策略/法律门/测试/证据/claim/decision/计算/确认/申诉/结算/账本/DQ/审批/审计/哈希校验；支持 `legalEntity`/`jurisdiction` 过滤并返回 `scope`，无匹配 run 时拒绝空包 |

### 3. 激励设计护栏

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| INC-01 可配置≠正确 | ✅ | Policy Pack + 护栏文档/原则 |
| INC-02 角色差异化结构 | ✅ | Policy Pack roles + contract employment type 已有；本轮新增 CompensationTemplate（roleCode/employmentType/currency/salary range/deduction/variable/smoothing/order/caps），合同引用模板时强制类型/币种/薪资区间校验，console 可录入 template code |
| INC-03 平滑阈值/不追溯 | ✅ | 已有 ACKNOWLEDGED 结算周期禁止 ledger adjustment/reversal；“本轮新增 contract `smoothingThresholdRate`，payroll 对比上一期 incentive，变化超阈阻断行并记录 prior/change rate；跨周期分摊策略仍可由合同阈值表达，但 signed-cycle 全面锁定仍靠结算 guard |
| INC-04 浮动上限/最低工资 | ✅ | Pool cap、最低工资、合同级 ledger 扣款上限；本轮新增 `variableShareCapRate`，按 gross 计算个体浮动占比上限，超出则 payroll 行与 run 阻断 |
| INC-05 团队池 | ✅ | Policy DSL 支持池分配/多人权重 |
| INC-06 保护未计价工作 | ✅ | AI scoring 对任何 0 分维度要求 `zeroScoreRationale`，否则 409；0 分理由持久化并在 proposal 中可见，避免未计价/未观察工作被静默默认为 0 |
| INC-07 不排名/不展示同事金额 | ✅ | 员工数据范围过滤；计算行/订单经济性脱敏 |
| INC-08 机动/战略池治理 | ✅ | BudgetPool/Allocation 审批已有；本轮新增 discretionary pool review：≥2 人委员会、独立员工观察员、公开 selection criteria 与 decision notes、reviewer 记录，console 可录入 |
| INC-09 A 类池/成本核算 | ⚪ | 明确非目标，未实现 |
| INC-10 Clawback | 🟡 | clawback case：书面同意、1–12 期、hardship、requester≠approver、waive/cancel 已有；本轮新增 `GET /clawback-cases/:id/schedule`：按有效合同逐期计算金额、20% 扣款上限、最低工资余额，输出 blockedCount/scheduleHash，console 显示；仍未自动生成 recovery batch 或写入结算 |
| INC-11 评价与发展/奖惩分离 | ✅ | EvaluationDecision、AttributionDecision、Ledger 分模型 |
| INC-12 年度制度审查 | ✅/🟡 | `GET /reports/policy-review` 与 console Annual review 覆盖制度发布、告知签收、申诉/SLA/结果、评价决策、AI 接受/override/盲审/风险 SLA、DQ、DSAR/DPIA、harness、信任调查；子群体影响在存在同意标签时标记 available 并可查看抑制聚合报告；无标签时明确标注，不能视为完整签收 |
| INC-13 Policy Pack 契约 | ✅ | `policyPackManifestSchema` 覆盖 id/name/version/status/description/corePolicyCode/policy/fixtures/applicability/roles/workPackageTemplates/evidenceRequirements/simulationData/seed；三个 vertical pack 均通过 manifest 测试 |

### 4. 贡献认定

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ATT-01 申报≠认定 | ✅ | Claim/Decision 分离、人工 decision |
| ATT-02 回避 | ✅ | 新增 `conflict_declarations` 关联登记/撤销；创建 attribution decision（含 batch）前检查双向 active 冲突并返回 `ADJUDICATOR_CONFLICT_OF_INTEREST`；console Settings 可维护 |
| ATT-03 例外/补录 | ✅ | ContributionClaim 新增 `claimMode`（STANDARD/EXCEPTION/BACKFILL）与必填 `exceptionReason`；memory/PG 持久化，console 申报表单可标记并在列表展示 |
| ATT-04 覆盖率分层 | ✅ | 按 responsibilityCode、订单类型和 task/package type 三层统计证据覆盖率；packageType 随 work package 持久化并在 console 录入/展示 |
| ATT-05 证据不足不默认 0 | ✅ | 评分结果新增 `insufficientEvidence`；默认 `evidenceDefaultRule=BLOCK` 拒绝缺失维度评分的 AI proposal，只有显式设为 `ZERO` 才允许落 0；测试覆盖 block/override |
| ATT-06 先独立判断/AI 草稿/盲审 | ✅ | decision 必填 independentScores/reviewStartedAt/evidenceOpened；override 必须有理由；AI console 默认隐藏 AI 分数直到 reveal；audit sample 由服务端按 override/随机率抽取，盲审 flag 与 audit agreement 记录；校准会已接入 annual review |
| ATT-07 申诉由非原决定人/SLA/证据披露 | ✅/🟡 | 非原决定人复核、dueAt/evidenceRefs/SLA 已有；本轮新增正式证据披露：披露人≠申诉人、只能披露申诉所附证据、记录 method/note/time，申诉人可查看，有证据的申诉在披露前 resolve 返回 409；no-retaliation 以已发布的 FairnessCommitment 表达 |
| ATT-08 贡献/绩效分离 | ✅ | 独立对象和 API |
| ATT-09 子群体/一致性审计 | ✅ | 既有 reviewer consistency；本轮新增自愿、单独同意、伪名化的子群体标签（GENDER/AGE_BAND/REGION/TENURE_BAND/EMPLOYMENT_TYPE）与 `GET /reports/subgroup-impact`：<10 抑制、10–29 仅定性、≥30 输出均值/选择率/4-5 规则比；harness 只对 ≥30 的组计算误差 gap，小样本列为 qualitative；标签不进入个人决策，撤回即删除；console Annual review 展示 |

### 5. AI / Agent

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| AI-01 评测前移 | ✅ | 未通过 EvaluationGate 禁止 numeric scoring；`scoreEvidence` 强制 gate |
| AI-02 评测要求 | ✅ | harness、holdout、AI-human ≤ human-human、gold-set 注册/强制校验、canary/vendor-change 回归阻断已实现；本轮新增 minSubgroupSize=30 的误差 gap 门禁（小样本只做定性，不参与 gap）、按组误差/样本量输出、refresh-due 与版本化 refresh；自动重训/重标仍属于外部训练流水线 |
| AI-03 人工监督 | ✅ | 独立先判/理由/时长/证据打开/override 理由、rubber-stamp 预警、override 必抽 + 随机盲审、audit agreement、HIGH/CRITICAL 决策前强制第二复核（不一致 409）均已落地；本轮新增系统级风险自动分级（零分→CRITICAL、低置信/无证据→HIGH、调用方不可降级）、8h/24h 第二复核 SLA、dueAt/breach 记录与年度审查指标；AI console 展示风险信号与复核截止时间 |
| AI-04 Agent 范围 | ✅ | 主动 Runtime、7 个 skill、T0–T3、T3 人工、幂等/重试/死信/审计 |
| AI-05 安全 | ✅ | Evidence 作为输入、schema/权限、provider policy、red-team run 门禁已有；tools READ/WRITE access、`AGENT_ROLE` 默认角色与 per-task `actorRole=READER/ACTOR` 均已持久化，READER 任务不能执行 WRITE 工具（返回/审计 REJECTED） |

### 6. 领域契约与金额路径

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DOM-01 单一契约 | ✅ | 请求契约：22 个 Zod schema → 生成 manifest → 校验 OpenAPI。实体契约：`CORE_ENTITY_CONTRACTS` 声明 9 张核心表的列、TS 字段名/类型、可空性、暴露与分类；`CORE_ENTITY_ACCESS` 声明 read/write scope（self + 角色）并生成 `docs/generated/access-contracts.json`；`contracts:entities` 同时刷新列、生成类型与访问 manifest；接口只 `extends *Persisted`，DDL 逐列一致。迁移按 ADR-009 保持手写并由测试校验 |
| DOM-02 状态机 | ✅ | `packages/domain/src/states.ts` 与 PRD 状态一致 |
| DOM-03 必须对象 | ✅ | MetricDefinition、Snapshot、Notice、Recalculation、Budget、RuleChangeOrder、ModelEvaluationRun、SettlementExport、AuditChain、Integration 对象均存在 |
| MON-01 审批一次性 | ✅ | consumed_at/by、target 校验、payload hash、consume |
| MON-02 结算只处理锁定账本 | ✅ | settlement_lines trigger + line/ledger 校验 |
| MON-03 同一 ledger 不重复结算 | ✅ | partial unique active index |
| MON-04 计算行唯一 | ✅ | `calculation_lines` unique constraint |
| MON-05 账本不重复入账 | ✅ | `calculation_line_id + entry_type` unique |
| MON-06 锁定账本不可变 | ✅ | trigger 禁止 UPDATE/DELETE |
| MON-07 审计可验证 | 🟡 | prev/entry hash、sequence、trigger、RLS、verify、`/audit-events/anchor` root hash 清单已有；本轮新增 `/audit-events/durability`：检查 `AUDIT_WORM_URI`/`AUDIT_MIRROR_URI`/`AUDIT_TSA_URL`/90 天内恢复演练配置并在 Audit console 提示；实际 WORM/TSA 仍由部署提供，代码不能证明已启用 |
| MON-08 输入可重放 | ✅ | `engine_version`、input_snapshot、input_snapshot_hash、policy content hash |

### 7. 数据质量与证据覆盖

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| DATA-01 分层覆盖率 | ✅/🟡 | 角色/订单类型/task package type 分层已覆盖；周期趋势仍缺 |
| DATA-02 被动+自报+同伴+经理证明 | ✅ | 被动 ingestion、员工自报已有；本轮新增 peer/manager attestation（主体须为工作包参与者、不能自证、MANAGER 须为直属经理），可带证据引用、仅 attester 可撤回，console Contribution 可录入/查看 |
| DATA-03 证据不足不默认 0 | ✅ | NEEDS_EVIDENCE + DQ blocking；新增可配置 `evidenceDefaultRule`（默认 BLOCK，显式 ZERO 才允许 0 分），AI scoring 在 proposal 前阻断缺失证据维度 |
| DATA-04 owner/SLA/升级 | ✅ | 新增 `data_sources` 登记：owner/backup owner、响应 SLA、criticality、90 天复核到期与逾期统计；DQ 的 assignee/dueAt/escalate 继续独立存在 |
| DATA-05 不采集活动量/最小化 | ✅/🟡 | 字段级 data map、用途/分类/保留期、跨境/处理者清单、minimization 报告已有；技术阻断覆盖结构化活动量字段（keystroke/mouse/screen-time/app-usage/location/webcam 等键）与自由文本中的明确监控措辞（`findActivityMonitoringText`，中英文短语），evidence 与 data-source 返回 409；隐晦/改写表述仍依赖 DLP/人工审查 |

### 8. 组织采用与安全

| ID | 状态 | 代码证据 / 缺口 |
|---|---|---|
| ORG-01 试点 volunteer/员工代表 | ✅ | Representation/Consultation 已有；本轮新增 pilot enrollment（volunteer、scope、consent signature、ACTIVE/WITHDRAWN、撤回原因），console Settings 可录入/撤回 |
| ORG-02 透明/本人数据/团队聚合 | ✅ | 本人数据过滤、团队聚合报告、角色感知导航、My AI record 入口、员工只能读取本人 manager 的团队聚合；非 privileged 用户看到 My overview 而非租户运营总览，团队 <3 人仍抑制，不展示同事金额/姓名 |
| ORG-03 无报复/申诉统计公开 | ✅ | 新增 fairness commitment 版本化发布（新版本 supersede 旧版本）与 `/reports/appeal-stats` 聚合（申诉数、开放/逾期/关闭、结果分布、平均处理天数、申诉率、无个人标识）；Dashboard 对所有登录用户展示承诺与统计 |
| ORG-04 经理培训/模板/校准会 | ✅ | 新增 manager training records（code/title/completed/expiry/evidence）与 calibration sessions（facilitator/attendees/notes/policy ref）；console Settings 可录入，年度审查报告含计数 |
| ORG-05 信任/程序公平调查 | ✅ | 新增匿名 trust survey（草稿/开放/关闭）、伪名 hash 响应、维度/题目均值、分布与同 code 上一期 baseline；年度审查报告读取最近关闭期 |
| SEC-01 威胁模型 | ✅ | 新增 `docs/security/threat-model.md`：资产、信任边界/数据流、STRIDE 表、滥用案例与测试映射、残余风险/非目标 |
| SEC-02 RLS | ✅ | FORCE RLS、app.tenant_id、platform_admin pool、负向测试、治理表 RLS |
| SEC-03 字段级 ABAC/break-glass | 🟡 | payroll bank/金额字段 redaction 与 break-glass 已有；跨资源 `fieldAccessPolicies` 已覆盖 6 类资源，接入计算行、合同列表与修订历史、evidence 列表、结算批次行、AI proposal 列表/详情/审计队列，payroll 视图同时消费矩阵与旧 `payrollFieldPolicies`；evidence package 导出同样按矩阵过滤 evidence/calculation/settlement 字段（`packageHash` 仍按完整规范包计算，避免过滤后哈希漂移）；对象式策略支持 6 个 `match` 谓词（`isSubjectManager`/`sameOrgNode`/`sameLegalEntity`/`legalHoldActive`/`subjectEmploymentActive`/`viewerEmploymentActive`），谓词上下文服务端派生、每请求缓存、缺失 fail-closed；条件只收窄，admin/本人无条件放行；未支持的条件键写入时 400 |
| SEC-04 导出 DLP/水印/审批/限流 | ✅ | 角色、CSV 公式中和、水印/SHA-256、字段 redaction、导出审批、per-tenant/actor export limit 已有；DLP 扫描身份证/银行卡/手机号，命中要求 `SENSITIVE_EXPORT` 审批，覆盖 payroll CSV/bank 与 evidence package；本轮改为默认启用（仅显式 `exportDlpEnabled=false` 可关闭），避免安全控制默认失效 |
| SEC-05 模型供应商控制 | ✅ | 新增 model provider policy：zero-retention、DPA ref、inference region、egress allowlist、审批人；当 tenant setting `requireModelProviderPolicy=true` 时，AI proposal 与 prompt activation 强制校验 active 且完整策略；实际供应商合同/审计仍由采购与法务保存 |
| SEC-06 保留/DSR/法务保留/审计脱敏 | 🟡 | retention/DSAR/legal hold、audit redaction、reviewed retention disposal 已有；DSAR/本人数据包导出（限流 + hash，省略其他员工明细）；字段访问策略变更写入审计链（`FIELD_ACCESS_POLICIES_UPDATED`，before/after 内容哈希，memory 与 PostgreSQL 均校验链）；自动硬删除仍未启用，删除/更正执行保持人工/受控 |

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
10. 测试覆盖持续扩展（证据包、AI agreement、未验证评测拒绝、申诉 SLA 持久化、扣款上限、适用性校验、合同修订、adverse action、年度审查报告、数据源登记/data map、variable-share cap、PG 合同同意/修订、PG adverse action、PG 数据源），当前 **279 unit/API + 64 PG** 全绿。

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

46. **SEC-04 export DLP**：新增 DLP 扫描（身份证/银行卡/手机号），命中时要求 `SENSITIVE_EXPORT` 审批并消费；覆盖 payroll CSV/bank 与 evidence package；后续改为默认启用（见 68）。

47. **SEC-03 payroll field policies**：tenant `payrollFieldPolicies` 支持 `PAYROLL_LINE.<field>` 角色白名单，默认 bankAccountRef 仍仅 finance/admin/本人；按行返回 `redactedFields`，console 显示 Redacted。仍是 payroll 范围，跨资源 ABAC 保留。

48. **INC-02 compensation templates**：新增 role compensation template registry 与合同引用校验（类型/币种/薪资区间），迁移 `056_compensation_templates.sql`，console 合同表单可填 template code。

49. **INC-06 zero-score protection**：0 分维度必须提供 `zeroScoreRationale`，否则 409；理由持久化到 proposal。迁移 `057_zero_score_rationale.sql`。

50. **AI-05 per-task actor roles**：AgentTask 增加 `actorRole=READER/ACTOR`，持久化到 agent_tasks；READER 任务不能执行 WRITE 工具，`AGENT_ROLE` 作为默认角色；runtime/PG 测试覆盖。迁移 `058_agent_actor_role.sql`。

51. **AI-02 gold-set refresh workflow**：新增 refresh-due 报告与版本化 refresh（旧版本 retire、新版本 active），AI console 可操作；自动训练/标注仍属外部流水线。

52. **LG-05 e-sign adapter**：新增 e-sign envelope 与 HMAC provider callback，SIGNED 回调写回合同 consent signature；迁移 `059_esign_envelopes.sql`。外部 provider 账号/合同仍由部署配置。

53. **SEC-06 retention disposal workflow**：新增 retention disposal request（legal hold 阻断、requestedBy≠approvedBy、默认 30 天 grace、complete 记录/取消），Settings 可操作；迁移 `060_retention_disposal.sql`。自动硬删除仍未启用。

54. **System policy defaults（ADR-008）**：新增 `docs/adr/ADR-008-system-policy-defaults.md`，把保留期、扣款顺序/20% 上限、子群体小样本规则（<10 抑制、10–29 仅定性、≥30 定量、4/5 规则）、AI 风险分级与复核 SLA、导出/DLP、电子签名/WORM、gold-set 季度刷新、READER/ACTOR 默认等系统级决策固定下来；其中 AI 风险分级与第二复核 SLA 已实现并测试。

55. **ATT-09/INC-12 subgroup fairness**：新增 `workforce_subgroup_attributes`（单独同意、可撤回、RLS）、录入/列出/撤回 API 与 `GET /reports/subgroup-impact` 聚合报告（<10 抑制、10–29 定性、≥30 定量、4/5 规则）；harness 排除 <30 组的定量误差 gap。迁移 `062_workforce_subgroup_attributes.sql`，Policy Annual review 展示；无同意标签时明确不可用。

56. **INC-10 installment wage protection**：新增 clawback schedule 预览，按有效合同逐期校验 20% 上限与最低工资余额，返回 blockedCount/hash；无有效合同时明确不可校验。未自动生成 recovery batch，保持“先审后收”。

57. **SEC-03 cross-resource field matrix**：tenant `fieldAccessPolicies` 支持 `PAYROLL_LINE.*` 与 `CALCULATION_LINE.*`；calculation run API 对非 finance/admin 应用默认/租户覆盖策略并返回脱敏字段；新增通用 `redactCalculationRunFields` 测试。其余资源尚未接入。

58. **ORG-02 role-aware console navigation**：AppShell 按 `/platform/identity` 返回角色过滤导航；员工只保留 Overview/My AI record，manager/finance/admin 分别显示可访问模块，非 admin 隐藏 Settings/Integrations/Adverse actions 入口。路由级权限仍由 API 强制。

59. **DATA-05 activity-field block**：新增 `findActivityMetricKeys`，在 evidence 创建与 data-source 登记时拒绝活动量/监控字段（keystrokes、screen time、app usage、location、webcam 等），返回 409；合法交付/订单证据不受影响。自由文本仍需 DLP。

60. **ORG-02 employee team aggregate**：`GET /reports/team-aggregate` 不再要求 manager 角色；无特权员工只能读取自己 manager 的聚合，指定其他 manager 返回 403，团队 <3 人仍抑制；新增共享 platform store 测试验证。

61. **P0-02/P0-04 cycle time expansion**：operations coverage 新增 calculation→confirmation、payroll created→approved、appeal created→resolved 平均小时数，Policy coverage 展示；端到端员工/经理细分角色耗时与目标阈值仍待产品定义。

62. **ATT-04/DATA-01 package-type coverage**：WorkPackage 新增 `packageType`（默认 ORDER_DELIVERY，复用既有 `package_type` 列），coverage report 增加按 package type 的分层，Contribution 表单/列表与 Policy coverage 展示；无迁移。

63. **ATT-07 appeal evidence disclosure**：新增 `appeal_evidence_disclosures`（RLS）、POST/GET `/appeals/:id/evidence-disclosures`、披露人≠申诉人、证据子集校验；有 evidenceRefs 的申诉未披露时 resolve 返回 409。Exceptions UI 增加披露按钮，迁移 `063_appeal_evidence_disclosures.sql`。

64. **ADR-008 retention defaults**：新增 `GET /retention-policies/recommended`（系统推荐类别/月数/法律依据/configured 标记）与 Settings 预填创建 modal；推荐值不自动落库，需租户确认法律依据后创建；legal hold 始终优先。

65. **P0-02 employee home**：Dashboard 按 identity 角色分流；非 privileged 用户只调用本人 work-package/confirmation/appeal/AI/team-aggregate 接口并展示 My overview，管理员/经理/财务继续使用运营总览；避免员工首屏加载租户级 payroll/approval/audit 数据。

66. **MON-07 durability readiness**：新增 `GET /audit-events/durability` 和 Audit console 提示，按 `AUDIT_WORM_URI`/`AUDIT_MIRROR_URI`/`AUDIT_TSA_URL`/`AUDIT_RESTORE_DRILL_AT` 报告配置就绪度；文档明确这只是配置存在性，不等于控制有效，`ready:false` 不能宣称 MON-07 完成。

67. **SEC-03 field matrix management**：新增 `GET/PUT /field-access-policies`（defaults/configured/effective）与 Settings 编辑 matrix（JSON），PUT 合并写入 tenant settings 且保留其他设置；OpenAPI/测试覆盖。仍仅 payroll_line/calculation_line 两个资源。

68. **SEC-04 DLP default-on**：`assertExportDlp` 默认启用，只有 tenant 显式设置 `exportDlpEnabled=false` 才关闭；继续保持命中时 `SENSITIVE_EXPORT` 审批/一次性消费；现有导出测试全绿。

69. **P0-04 success metrics**：新增 `GET /reports/success-metrics`，按 PRD 阈值计算 evidence coverage/claim decision/dispute rate/reconciliation differences，返回 PASS/FAIL/PARTIAL 与 UNAVAILABLE（员工补证时间）；Policy coverage 展示，OpenAPI/测试覆盖。

70. **P0-02 responsibility cycle times**：operations coverage `cycleTimes.byResponsibility` 按 responsibilityCode 输出 acceptance/claim-decision 平均小时与样本数，Policy coverage 展示；本项先覆盖这两个阶段，其余阶段见第 72 项。

71. **LG-08 DSAR data package**：新增 `GET /me/data-package` 与 `GET /dsar-requests/:id/package`，聚合本人档案/合同/工作角色/claim/提交 evidence/confirmation/appeal/评价/AI proposal/DSAR/同意标签/notice acknowledgement，返回 `packageHash` 并走 export limiter；员工只能读本人，DSAR 读取需 admin/finance。Employee home 增加下载按钮。

72. **P0-02 responsibility cycle times（全阶段）**：`cycleTimes.byResponsibility` 在 acceptance/claim-decision 之外新增 confirmation（按确认人角色）、payroll approval（按 run 内工资条人员角色）、appeal resolution（按申诉人角色）三个阶段的小时数与样本数，Policy coverage 同步展示；`rolesOfPerson` 统一从工作包成员/owner 派生责任角色，无法归属时明确计为 `UNKNOWN`；新增端到端测试覆盖三个阶段。

73. **DATA-01 coverage trend**：operations coverage 新增 `workPackages.coverageTrend`（按验收月份 `YYYY-MM` 的接受工作包证据覆盖率）与 `coverageTrendByPackageType`（同一月份桶按 packageType 分层），Policy coverage 展示最近 6 个月及按任务类型的单行趋势；趋势口径与现有覆盖率一致，仍以验收时 `updatedAt` 作为周期桶。

74. **SEC-03 contract field policy**：新增通用 `redactResourceFields`，按 `RESOURCE.field` 策略对任意扁平资源脱敏（`*Ref` 字段移除、decimal string 归零、其他替换为 `[REDACTED]`），支持本人例外与 tenant 覆盖；`EMPLOYMENT_CONTRACT.bankAccountRef` 默认仅 finance/admin 可见，合同列表与 amendment `beforeTerms`/`afterTerms` 对 manager 返回 `redactedFields`（修订历史不能绕过合同列表规则）；策略 key 正则与 OpenAPI 同步扩展，单元与 HTTP 测试覆盖。

75. **DOM-01 drift test expansion**：OpenAPI↔Zod 请求契约测试覆盖从 6 个 schema 扩到 22 个（工作包、合同/修订、工资 run/审批、claim、申诉/解决、evidence、确认、DSAR、保留策略、法律门、DQ、data source、审批、AI 评分、结算、clawback、策略发布、子群体标签、字段矩阵），required 由 Zod `isOptional()` 自动推导并逐字段校验 OpenAPI properties 覆盖；修复发现的 `CreateWorkPackage.packageType` 缺失与申诉解决接口无具名 schema 两处漂移。

76. **SEC-03 资源扩展**：字段矩阵新增 `EVIDENCE.normalizedPayload/sourceUri`、`SETTLEMENT_LINE.amount/personName/personCode`、`AI_PROPOSAL.scores/rationale/gateMetrics`，默认允许 manager/finance/admin（不改变现有可见性），租户可收紧；evidence 列表、结算批次列表/详情、AI proposal 列表/详情/审计队列均接入，本人数据豁免；新增请求级策略缓存避免每条记录重复读 tenant settings，并新增 `redactSettlementBatchFields`。

77. **DOM-01 请求契约单一来源**：新增 `requestSchemaRegistry` 与 `describeRequestSchema`，把 22 个请求 schema 收敛为 Zod 单一来源；新增 `npm run contracts:manifest` 生成 `docs/generated/request-contracts.json`，测试校验生成物与 Zod 完全一致，并继续校验 OpenAPI required/properties。TS 领域类型与 SQL DDL 仍为独立来源，列为后续。

78. **DOM-01 DDL 契约测试**：新增 `tests/ddl-contract.test.ts`，按文件名顺序解析全部迁移的 `CREATE TABLE` 与 `ALTER TABLE ... ADD COLUMN`，校验 9 张资金路径/审计表（合同、工资 run/line、计算 run/line、账本、结算 batch/line、审计事件）关键列仍存在、同一列不被定义两次、`ALTER` 的目标表必须由某个迁移创建；不依赖数据库即可在单元测试中运行。

79. **ADR-009 契约与字段访问路线**：新增 ADR，固定三项决策：请求契约保持 Zod 单一来源；实体/SQL 采用三阶段（现有 DDL 守卫 → 实体注册表生成校验 → 分批迁移），迁移本身仍手写不生成；条件式字段访问采用对象策略（`allowRoles`/`allowSelf`/`match`/`onDeny`），条件只能收窄不能放大、谓词白名单、拒绝行为显式；自动 retention 硬删除维持 ADR-008 的禁用决定。

80. **SEC-03 对象式字段策略**：策略值兼容旧的角色数组与新的对象 `{ allowRoles?, allowSelf?, onDeny? }`；实现 `normalizeFieldPolicy`/`fieldPolicyAllows`/`deniedFieldValue`，payroll、calculation、通用资源三条脱敏路径统一使用；`onDeny` 显式支持 `OMIT`/`ZERO`/`REDACT`，缺省时保持旧推断行为；`allowSelf:false` 可拒绝本人访问；未实现的条件键（如 `match`）与空对象在写入时返回 `VALIDATION_ERROR`；OpenAPI 增加 `FieldAccessPolicyObject`，新增单元与 HTTP 校验测试。

81. **SEC-03 match 谓词**：对象策略新增 `match`，支持 `isSubjectManager`、`sameOrgNode`、`sameLegalEntity`、`subjectEmploymentActive`、`viewerEmploymentActive`；谓词输入由服务端派生并按请求缓存，且仅按实际使用的谓词按需加载（isSubjectManager→persons、sameOrgNode→org assignments、sameLegalEntity/employment→contracts、legalHoldActive→retention policies）；条件只收窄、缺少上下文时 fail-closed；admin 与本人访问为无条件放行，谓词只约束角色路径；contracts、evidence、settlement、AI proposal、payroll、calculation 六条读取路径均传入 subject 与上下文；payroll 视图同时合并旧 `payrollFieldPolicies` 与矩阵；未知谓词写入时 400；新增 fail-closed 单元测试与经理/组织节点/法人实体 HTTP 测试。

82. **DOM-01 Phase 2 实体契约**：新增 `packages/domain/src/entity-contracts.ts`（`CORE_ENTITY_CONTRACTS`）声明 9 张核心表的完整列集合与 PII/FINANCIAL/AUDIT 分类；新增 `npm run contracts:entities` 生成 `docs/generated/entity-contracts.json`；DDL 测试改为从注册表读取并**逐列完全一致**校验，同时校验生成物新鲜度。迁移仍手写；TS 类型尚未从注册表生成。

83. **SEC-03 法人实体谓词**：`EmploymentContract` 新增可选 `legalEntity`（迁移 064、memory/PostgreSQL 持久化与映射、创建 schema/OpenAPI、console 合同表单与列表显示）；`sameLegalEntity` 谓词比较 viewer 与主体的 ACTIVE 合同法人实体，任一侧缺失即 fail-closed；实体契约注册表同步新增 `legal_entity` 列。

84. **SEC-03 legalHoldActive 谓词**：新增资源→保留期类别映射（`PAYROLL_LINE→PAYROLL_RECORDS`、`CALCULATION_LINE/SETTLEMENT_LINE→ACCOUNTING_RECORDS`、`EMPLOYMENT_CONTRACT→LABOR_CONTRACTS`、`EVIDENCE/AI_PROPOSAL→AI_EVALUATION_EVIDENCE`），谓词检查该类别当前是否存在 `legalHold=true` 的保留策略；上下文加载一次性读取 retention policies；HTTP 测试覆盖 hold 开启时放行、解除后拒绝，且本人访问不受影响。

85. **DOM-01 领域接口漂移测试**：新增 `tests/domain-entity-interface.test.ts`，从 `packages/domain/src/types.ts` 解析 9 个核心接口字段并转 snake_case，与 `CORE_ENTITY_CONTRACTS` 双向校验；view-only 字段（`lines`/`redactedFields`/`personCode` 等）、别名（`calculatedAt→finished_at`）与 DB-only 列显式声明，测试同时防止这些例外变成陈旧声明。

86. **SEC-03 evidence package 字段过滤**：`GET /evidence-packages/:cycleId` 过去直接返回原始 evidence/calculation/settlement，绕过读路径的字段矩阵；现按 viewer 角色、tenant 策略与 match 上下文过滤 evidence nodes、calculation runs 与 settlement batches，`packageHash` 仍基于完整规范包计算，DLP 扫描针对过滤后的导出内容；新增 manager/admin 对照测试（manager 被脱敏、admin 完整）。

87. **DOM-01 实体类型生成**：`CORE_ENTITY_CONTRACTS` 升级为列级契约（`column`/`field`/`tsType`/`optional`/`exposed`/`classification`）；新增 `renderEntityTypes` 与 `scripts/generate-entity-types.ts`，从注册表生成 `packages/domain/src/entity-types.generated.ts`（9 个 `*Persisted` 接口），`types.ts` 中对应接口改为 `extends *Persisted` 只保留视图字段（`lines`/`redactedFields`/`personCode` 等）；`contracts:entities` 同时刷新 JSON manifest 与生成类型；测试校验生成物新鲜度、接口保持 thin、未暴露列不生成。

88. **前端覆盖补齐**：控制台新增/扩展计算 run 创建-审批-锁定、重算请求、规则变更单、告知签收、政策咨询与员工代表、交付物提交/验收、现金门禁与财务事实、Agent 任务/审批门/工作流/建议日志、指标与薪酬模板注册表、电子签 envelope、外部身份映射、字段矩阵结构化编辑器（角色/本人/拒绝模式/6 个谓词）、同意标签与撤回、站内通知；`/admin` 与 `/admin/governance` 服务端页面继续覆盖平台与批量运维。已完成 12 个页面与 7 个弹窗/表单的浏览器冒烟，无 JS 错误，字段矩阵保存成功。

89. **DATA-05 自由文本阻断**：新增 `findActivityMonitoringText`，递归扫描字符串值中的明确监控措辞（keystroke logging、screen monitoring、webcam monitoring、键盘记录、屏幕监控等中英文短语），evidence `normalizedPayload` 与 data-source 名称/字段命中返回 409 `DATA_MINIMIZATION_ACTIVITY_TEXT_BLOCKED`；短语级匹配避免把正常交付描述（screenshot、recording 等）误判，隐晦改写仍由 DLP/人工兜底。

90. **SEC-06 字段策略变更审计**：`IncentiveStore` 新增 `recordAuditEvent`（memory 实现哈希链、PostgreSQL 复用 appendAudit + 链触发）；`PUT /field-access-policies` 与平台设置接口（同租户或 resolver 可解析时）均记录 `FIELD_ACCESS_POLICIES_UPDATED`，含 actor、tenant、before/after 内容哈希与 override 数量；memory 验证会重算每个 event hash，memory 与 PG 测试均校验 `verifyAuditChain()` 仍为 true。

91. **Shadow settlement CLI**：`packages/ledger` 新增 `compareShadowSettlement`（按 person+currency 聚合、绝对容差、缺失双边、总额/差异、reportHash），`scripts/shadow-settlement.ts` 读取 engine JSON 与 finance CSV，输出 JSON 报告并在差异/缺失时以非零退出；夹具 `shadow-engine-001.json` / `shadow-finance-*.csv` 与 6 个单元测试覆盖。

92. **CRM/ERP connector 编排**：`buildHttpJsonConnectorConfig` 将连接配置（endpoint/headers）与 mapping（字段映射/recordsPath/分页）合并并校验必需字段；`scripts/sync-runner.ts` 现在会认领计划、创建 sync run、实际 pull HTTP/JSON 数据、调用 ingestion batch，并以 SUCCEEDED/FAILED 收尾；integration 角色可读连接并创建/结束 sync run；3 个配置单元测试覆盖。

93. **Admin SPA 迁移**：新增 `/console/platform`（租户/用户/成员/组织节点/租户设置）与 `/console/governance` 治理入口；`/admin`、`/admin/governance` 改为 302 到 SPA，删除遗留 `public/admin.html`、`public/governance.html` 及其启动时读取；相关测试改为断言重定向。

94. **Playwright E2E**：新增 `playwright.config.ts` 与 `e2e/console.spec.ts`（17 个测试），覆盖首页、14 个模块页、计算 run 弹窗、字段矩阵保存与 admin 重定向；CI 增加 e2e job（安装 chromium、失败上传报告）；`npm run test:e2e` 本地全绿。

95. **剩余 9 项前端缺口补齐**：Policy 增加政策影响模拟（新增 `GET /policy-versions/:id` 读取当前定义、samples JSON、结果/差异/blockers）与政策-告知关联；AI 页增加服务端 harness 评测弹窗与 gold-set 30 天到期提示；Audit 页增加外部 anchor 清单/下载；Settlements 增加导出证据确认与账本调整记录；Settings 保留期表增加 cutoff/可处置状态；Payroll 合同增加“应用到期修订”；OpenAPI 补充新路由；E2E 新增治理面覆盖（18 个场景）。至此仅剩 worker/provider/bulk 类接口为 API-only。

96. **法律门禁硬闭环 + 逐员工签收**：FORMAL 计算（单条与批量）在创建前加载 policy-notice 关联，任何 acknowledgementRequired 通知未全员签收即 `CALCULATION_BLOCKED`；已关联咨询存在但均未结论时阻断。payroll 计算按 cycle 的 policy version 计算每位员工未签收通知，`PayrollLine` 新增 `noticeAcknowledgementPassed/Missing`（迁移 065、实体注册表/生成类型/PostgreSQL 映射），未签收行计入 blockedCount，console 显示徽标。

97. **P0-04 指标补齐**：success-metrics 由 5 项扩为 6 项：经理复核时间改为“有直接下属的人做出的最新 claim 决策”耗时（无样本则 UNAVAILABLE）；员工补证时间改为已解决 evidence 类 DQ issue 的创建→解决时长代理（明确不用行为埋点）；新增信任 vs 上一份同 code 已关闭调查基线的维度均值比较。

98. **Agent 验收指标**：新增 `GET /reports/agent-metrics` 与 `summarizeAgentMetrics`，输出关闭任务中位时长、自动解决率、升级率、人工改判率、平均尝试次数；误报率、每闭环成本、AI 关闭人工可完成率在无外部数据时明确为 null；Agent ops 新增 Acceptance metrics 页签，3 个单元测试覆盖。

99. **INC-03 边际阈值模拟**：新增 `simulateMarginalChange` 与 `POST /policy-simulations:marginal`，对指定参与人的 attributionWeight 或 evaluationMultiplier 以 0.01 级步长扫描，输出总额、目标人金额与逐步 delta（含 targetDelta），用于暴露封顶/舍入/权重归一化造成的跳档；Policy 页新增 Marginal sweep 弹窗与结果表，单元测试覆盖线性与拒绝非法步长。

100. **LG-10 法域证据包**：`GET /evidence-packages/:cycleId` 支持 `legalEntity`/`jurisdiction` 查询，按 policy applicability 过滤 run 与关联证据/claim/计算/结算；无匹配 run 返回 `EVIDENCE_PACKAGE_SCOPE_EMPTY`，包内新增 `scope` 元数据；Cycles 页下载前可填法人/法域。

101. **DOM-01 权限/数据范围契约**：新增 `CORE_ENTITY_ACCESS`（9 个核心实体的 read/write scope：self + 角色），`npm run contracts:entities` 生成 `docs/generated/access-contracts.json`；测试校验 manifest 新鲜度、核心实体全覆盖、读写 scope 非空，以及 payroll self-access 与 audit 角色限定。路由守卫仍是执行点，契约负责声明与漂移校验。

## 仍建议按 P0 顺序补做

1. **LG-05 外部电子签**：未来生效排期、到期自动应用与 provider callback 已完成；剩余是部署时接入真实电子签账号与合同模板。
2. **LG-06 statutory deduction types**：执行令/员工同意/法定优先顺序、逐类型上限与税务/社保分类的完整映射。
3. **AI residual**：自动重训/重标流水线（gold-set 刷新流程与 due 报告已落地）。
4. **DATA/ORG residual**：DATA-05 字段级最小化技术证明、受保护属性 subgroup impact（需法务口径）；cycle-time 角色细分与覆盖率趋势已落地。
5. **SEC residual**：ADR-009 设计的 6 个 `match` 谓词已全部实现；后续新增受策略保护的资源时需同时登记资源→保留期类别映射，自动 retention deletion 仍明确不启用。
6. **INC residual**：无（INC-02/03/04/06/08/10 已落地；A 类池仍为明确非目标）。
7. **DOM-01 residual**：无代码缺口；请求、实体列/TS 类型与访问 scope 均由注册表/ manifest 生成或校验，迁移按 ADR-009 手写并由测试校验。
8. **MON-07 deployment evidence**：在目标环境启用 WORM/双副本/外部 TSA，保存恢复演练与 anchor 回执。

这些剩余项里，有些是产品/法务/部署决策，不能只靠代码“补完”；在当前代码基线上，**核心 P0 闭环和大部控制已可运行，但仍不能宣称完整 P0 全部落地**。

# 2026-11-06 链路自动化轮（44c0f2a）

针对「链路是断的」审计的收尾，打通四段链路的最后断点：

15. **周期状态机**：`evaluationCycleTransitions`（DRAFT→COLLECTING→AI_PRE_REVIEW→HUMAN_REVIEW→DECIDED→CALCULATING→SETTLED）落 domain；`POST /evaluation-cycles/:id/advance` 经 assertTransition 校验跃迁，HUMAN_REVIEW 前必须有 AGENT 预审草稿、DECIDED 前所有草稿必须已决策；推进写入审计哈希链。跳段/终态回退/非法值均 409/400。
16. **worker 自动推进**：每 30 分钟将 endsAt 已过的 COLLECTING 周期自动推入 AI_PRE_REVIEW（ bearer/dev 自适应认证）——"周期结束→自动进入评价"不再依赖人点。
17. **CRM/ERP→计算适配**：`POST /calculation-runs:from-ingestion` 将摄取的 ORDER 证据按外部身份映射物化为影子计算批次；同一外部订单幂等（ALREADY_MATERIALIZED）、无映射（NO_IDENTITY_MAPPING）/无毛利（NO_GROSS_PROFIT）跳过并给因；账本锁定仍走审批。
18. **仪表盘视觉**：通知折叠（最近 3 条+查看全部）、AI 工作台改真输入框（边框/placeholder/禁用态）、面包屑与 H1 统一。
19. **TDD R149–R160（12 轮全绿）**：状态机全程/跳段/终态/非法值、预审联动门禁、摄取物化/跳过/幂等、推进审计留痕与链校验。

至此 PRD 四段链路（员工自主申报 → AI 预审 → 人工复审 → 自动计算）的代码闭环全部到位；剩余为部署侧配置（真实 CRM 凭据、金标集标注）。

# 2026-11-09 实际制度承接轮

以公司 7 份正式制度文件为准（016 激励分配、017 绩效考核与激励管理、018 配套附件、
011 股权激励、008 产品技术中心、003 海外销售激励、任务制与 AI 原生组织说明），
逐条建立“条款 → 系统能力”矩阵，见 `docs/POLICY_CAPABILITY_MATRIX_2026.md`。

20. **绩效引擎**：`scorePerformance` 支持 A 正向线性/B 反向线性/C 分段线性/
    D 加权验收/E 区间事件五类评分函数；N/A 同比例归一；月/季/年周期封顶
    110/150/105；Kp=S/100 保留 4 位；人工调整必须说明理由。M-001/M-002/M-003
    月度模板与六个岗位季度模板、年度计分卡模板落 `policy-dsl`。
21. **M-001 取数**：`POST /policy/performance/closure-rate` 从工作包按任务等级
    1/2/3/5 取权重，只有“已验收 + 按期 + 有证据”计入有效闭环；无应完成任务
    标记 N/A 而非 0。
22. **目标卡**：`POST /policy/performance/goal-cards` 校验权重合计 100%、目标/
    锚点/数据源齐全；锁定后再次锁定返回 409，禁止静默覆盖。
23. **激励引擎**：DBCP（5% 管理计提）、净回款利润率档位提成（8%-25% 六档）、
    执行总监管理补差、内部份额 R=B−M−G、职能季度奖金 Kq、年度利润分享
    （净利润目标/5%-10%/岗位价值点/预算硬约束）、月明星、悬赏时间/质量系数、
    产品技术中心 19% 季度池与专项奖励、海外销售开发明星/KA/销冠及追回。
24. **股权引擎**：四维配股、岗位饱和上限、Refresh、4 年/1 年 cliff/按月归属、
    双触发/身故/退休/清算加速、回购 A–E 矩阵、公允价值三级、流动性折扣、
    最低 5 万、年度 50 万上限、递延/未递延税务测算、Cap Table 饱和度、
    八步授予流程（股东会决议/协议/配偶确认/风险知悉/税务备案/台账门禁）。
25. **任务制与 AI 原生**：任务组（发起人负责、人 + AI 成员、完成/解散/继任）、
    AI 成员登记（名称/职责/版本，纳入任务组版本快照）、个人任务清单
    （人/AI/人机协同标注 + 每人一项 AI 化改造对象，提交/验收/退回）。
26. **持久化与界面**：通用 `policy_engine_records`（迁移 072，memory + PostgreSQL，
    version 乐观锁）；新增中文“2026 制度中心”和“任务制组织”页面；OpenAPI 补齐
    35 条制度路由。
27. **验证**：新增 34 条引擎条款测试 + 16 条 API 测试 + 1 条 PG 持久化测试；
    全量 659 单测/API + 66 PG 全绿，typecheck 0，web build 通过；真实服务冒烟
    验证评分、DBCP、AI 成员与任务组创建。


# 2026-11-09 全功能审计轮（第二阶段）

对“页面是否有入口、计算是否能出账”做了第二轮审计，修复并补齐：
28. **周期流程入口**：Cycles 页新增“AI 预审 / 推进到下一状态 / 周期报告”，
    HUMAN_REVIEW/DECIDED 门禁在页面可见，409 原因直接展示。
29. **绩效目标卡与正式评分**：Performance 页新增“目标卡与评分”页签，支持载入
    岗位指标模板、创建/锁定目标卡、录入测量值生成正式评分并查询评分记录。
30. **股权授予流程**：Equity 页新增“授予决策流程”，八步推进并校验股东会决议、
    协议、配偶确认、风险知悉、税务备案与 Cap Table。
31. **激励发放批次**：新增 `/incentive-award-batches`（迁移 073，内存 + PG），
    支持提交、审批（创建人不得自批）、锁定、导出、回执、取消；来源 record
    唯一占用，防止同一计算重复发奖；新增中文“奖励发放”页面。
32. **财务闭环入口**：Settlements 页新增预算分配创建、账本调整/冲销；员工端
    新增计算确认/异议；通知中心改为批量已读接口。
33. **合规入口**：Settings 页 DPIA 新建/批准、DSAR 新建/处理；Policy 页回归
    用例新建/单条运行/停用；AI 页提示词登记/激活/退役。
34. **制度中心**：新增月度绩效工资、职能季度奖金、期权行权价、Cap Table 测算。
35. **LG-06**：注册过的法定扣款类型不再被折叠为 OTHER，逐类型上限与执行令/
    同意标记可以命中（仍需法务确认类型与依据字段）。

以上代码缺口已在同一轮关闭：
- INC-03：`smoothingMode`（NONE/BLOCK/MOVING_AVERAGE/RAMP）+ 窗口/单期限幅；payroll line 增加 raw/smoothed/delta/mode 双值与 UI；
- LG-06：法定扣款类型注册表 API/页面、执行令/同意依据 API/页面，缺少依据时薪酬行阻断；
- SEC-04：租户自定义 DLP 规则、JSON 数据包 DLP/水印/哈希、结算导出 DLP、导出规则管理 API；
- AI-02：金标集样本落库、`/:id/samples`、仅凭 datasetRef 复跑、标注任务与训练运行/回调 API；
- INC-12：年度审查快照 `:finalize`、签核、哈希、HTML 导出；
- ATT-09：多评审成对一致率/±1 一致率/Cohen's kappa、季度快照 API 与页面；
- DATA-05：`RESOURCE_RETENTION_CATEGORY` + `dataGovernanceCoverage()` CI 门禁、数据地图暴露覆盖、员工隐私中心页面。


# 2026-11-09 全功能审计第三阶段（代码缺口清零）

36. **INC-03**：合同支持 NONE/BLOCK/MOVING_AVERAGE/RAMP；移动平均按窗口取历史，
    RAMP 按单期最大变化限幅；薪酬行同时保存原始值、平滑值、差额与模式；
    合同表单与薪酬行 UI 可见。
37. **LG-06**：新增 `/statutory-deduction-types` 与 `/deduction-legal-bases`
    读写 API/页面；注册类型不再折叠 OTHER；requiresCourtOrder/requiresConsent
    缺少依据时 `deductionLegalBasisPassed=false` 并阻断薪酬行。
38. **SEC-04**：DLP 支持租户自定义正则；个人数据包与 DSAR 包做 DLP/水印/哈希；
    结算导出补 DLP；新增 `/export-dlp-rules` 管理 API。
39. **AI-02**：金标集样本持久化（迁移 076）；支持 `GET /datasets/:id/samples`；
    评测只传 datasetRef 即可复跑；新增标注任务与训练运行/回调接口；AI 页支持导入 JSON。
40. **INC-12**：年度审查 `:finalize` 生成哈希快照与签核，列表与 HTML 导出；Policy 页新增“审计报告”。
41. **ATT-09**：按周期+对象聚合多评审，计算完全一致率、±1 一致率与 Cohen's kappa；
    样本不足显式 `INSUFFICIENT`；支持季度快照。
42. **DATA-05**：核心实体表→保留类别静态映射与 `dataGovernanceCoverage()`，
    测试确保每个 PII 列所在表有保留映射；数据地图返回覆盖；新增员工隐私中心 `/console/privacy`。
43. **验证**：676 单测/API + 67 PG 全绿，typecheck 0，web build 通过；新增 5 条审计闭包测试、
    平滑/法定门禁/数据治理测试；真实服务冒烟新页面与年度导出通过。
