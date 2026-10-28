# N-Perform PRD V4.1（评审修订版）

**版本**：4.1  
**日期**：2026-10-27  
**状态**：开发基线候选版（首个纵向切片已启动）  
**上游基线**：`Anari_Performance_Incentive_OS_PRD_V4.0_Final.docx`  
**修订依据**：`docs/REVIEW_2026-10-27.md`（N-Perform 全面评审）  
**修订性质**：不是重写 V4.0。V4.0 的产品原则、五层模型、LLM 零金额、证据图谱、贡献认定、追加式账本继续有效；本文件只修改**范围、合规门禁、AI 评测顺序、领域契约、金额路径不变量和验收标准**。未修订部分以 V4.0 为准。

> **一句话定位**：N-Perform 不是“AI 给每个人打分”的绩效 OS，而是**制度无关、AI-native 的多人贡献认定与激励结算 assurance layer**——让企业能解释“谁对什么结果做了什么贡献、为什么得到这笔钱”，并在争议、审计、复算时拿得出证据。

> **定位澄清（2026-10-28）**：N-Perform 是独立产品，核心不包含任何行业概念（充电桩、EPC、销售提成等）。行业、岗位、指标、政策、证据源都是**租户配置包（Policy Pack）**，放在 `examples/verticals/`，不是产品边界。Anari 的充电桩设备销售只是首个设计伙伴的配置包；核心必须能在不改代码的情况下运行第二个、第三个不同制度的租户。AI-native 也不是“加一个聊天框”，而是**主动式 Agent**：持续观察、发现缺口、生成计划、执行低风险动作、请求人工批准高影响动作、追踪闭环、升级阻塞。

---

## 0. 修订摘要

| # | V4.0 的问题 | V4.1 的修改 | 对应评审章节 |
|---|---|---|---|
| 1 | P0 是平台，不是 MVP；15 项能力/20 多个对象同时进 P0 | P0 收缩为“多人订单贡献的影子结算 + 争议闭环”；12 周、单租户、单订单类型、20–50 人 | §4.4、§5.4 |
| 2 | 合规原则多，但缺可执行门禁 | 新增法律生效门禁（LG-01..08）：民主程序、告知/签收、合同/薪酬方案同意、最低工资/扣款、PIP/adverse action、DPIA/DSAR | §4.1、§5.1 |
| 3 | Evaluation Agent 在 P0，模型/评价质量评测在 P1 | 评测前移到 P0；未通过前 Agent 只做证据整理，不做评分建议；新增 release gate | §4.3、§5.6 |
| 4 | 首个租户制度未固化，reference policy pack 跑不通 | 新增 reference policy pack 要求（INC-01..08），首个租户必须先冻结一套可执行配置 | §5.5 |
| 5 | 四份规范状态机/对象/API 漂移 | 新增 normative domain contract（DOM-01..06）；状态机/API/DB 从单一来源生成或校验 | §5.7 |
| 6 | 金额路径缺数据库级不变量 | 新增 MON-01..08：审批消费、结算行完整性、计算行唯一、账本不可变、快照、RLS、哈希链 | §5.7.3 |
| 7 | “没有数据≠没有贡献”缺运营化 | 新增 DATA-01..05：证据覆盖率、员工负担、默认规则、数据质量 owner/SLA | §5.8 |
| 8 | 商业化/买家/竞争未回答 | 明确定位、买家、wedge、非目标、竞争假设 | §5.4 |
| 9 | 变革管理不足 | 新增组织采用要求（ORG-01..05）：员工代表、试点 volunteer、信任测量、AI 承诺 | §5.9 |
| 10 | 安全/隐私控制不具体 | 新增 SEC-01..06：威胁模型、RLS、字段级权限、导出 DLP、模型供应商、Agent 安全 | §5.10 |

---

## 1. 定位、买家与非目标

### 1.1 定位（POS-01）

**N-Perform = 多人贡献认定与激励结算的 assurance layer。**

它连接 CRM/ERP/飞书/工单/财务等业务事实，形成“订单/项目 → 工作包 → 交付物 → 验收 → 贡献申报 → 贡献认定 → 评价 → 确定性计算 → 审批 → 员工确认/申诉 → 影子结算/结算”的可追溯链路。

### 1.2 买家与 champion（POS-02）

- **经济买家**：CFO/COO（关心少付错钱、少打官司、财务敢签字）。
- **champion**：销售运营/财务/RevOps（关心对账、周期、争议）。
- **gatekeeper**：HR/法务（关心程序、合规、员工关系）。
- **不把 CHRO 当唯一买家**：绩效管理软件已经拥挤；本产品的差异化是“贡献/结算的可审计性”，不是“又一个绩效表单”。

### 1.3 非目标（POS-03）

- 不做通用 HRIS、工资个税计算、发薪执行、招聘、独立 IM；
- 不做完整通用项目管理（甘特图/资源排程/工时）；
- 不承诺“绝对客观的单一贡献分”；
- 不让 LLM 写正式金额、批准、结算；
- 首版不做多租户自助开通、股权/期权台账、悬赏市场、战略池/A 类池自动化；
- 不把活动量（在线时长、消息数、会议数、工单数）当贡献。

---

## 2. P0 范围：12 周验证 sprint

### 2.1 P0 目标（P0-01）

用一个真实租户、一个法人、一种跨部门订单类型、20–50 人、5–10 个真实订单、一个月度周期，跑通：

> **工作包/交付/验收 → 贡献申报 → 贡献认定 → 确定性计算 → 审批 → 员工确认/申诉 → 影子结算（不产生付款效力）**

### 2.2 P0 必须做（P0-02）

| 能力 | 最小要求 | 验收 |
|---|---|---|
| 工作包与承诺快照 | 创建、提交时冻结快照、变更留版本 | 改期/改范围不能覆盖原承诺 |
| 交付与验收 | 交付物、验收人、验收结论、利益冲突回避 | 本人不能验收自己的交付 |
| 贡献申报/认定 | Claim 与 Decision 分离；申报不自动成为认定 | 自我申报不能自动通过；裁决人≠申报人 |
| 证据 | 证据引用、来源、时间、质量状态；支持反证/缺口 | 每个正式认定可追溯到证据 |
| Reference policy | 一个简单、可解释、可复算的订单贡献政策 | 同输入同输出；独立参照一致 |
| 确定性计算 | decimal、舍入、封顶、分摊余数、trace | 差异为 0；边界测试通过 |
| 法律门禁 | 告知/签收、最低工资、民主程序引用、DPIA 引用 | FORMAL 缺门禁则阻断；SHADOW 可跑 |
| 账本 | 追加式、幂等、锁定、冲销/调整 | 锁定后不可改；重放不重复入账 |
| 员工端 | 查看本人依据、确认/异议、申诉 | 员工能理解金额怎么来的 |
| 审计 | 关键动作、审批、计算、锁账留痕 | 可导出证据包 |
| 指标 | 证据覆盖率、员工耗时、经理耗时、争议率、对账差异 | 每周期测量 |

### 2.3 P0 明确不做（P0-03）

- AI 评分（只做证据摘要/缺口检测/草稿，不做分数建议）；
- Agent 自主执行/Agent Runtime；
- 多租户/自助开通/计费；
- 股权/期权台账；
- 悬赏市场/战略池/A 类池自动化；
- 通用项目管理/甘特图/资源排程；
- 对话式员工端/洞察大屏；
- 全量 HRIS/PM/薪资系统。

### 2.4 P0 成功指标（P0-04）

| 指标 | 目标 | 说明 |
|---|---|---|
| 证据覆盖率 | ≥70%（按角色分层） | 低于 50% 触发 kill criteria |
| 员工补充证据时间 | ≤30 分钟/周期（目标 ≤15） | 超过则重设计流程 |
| 经理复核时间 | ≤2 小时/周期 | 超过则减负 |
| 贡献争议率 | <10% | 申诉/复核占比 |
| 财务对账差异 | 0 | 系统 vs 人工/独立参照 |
| 员工信任/程序公平 | 不低于基线 | 基线调查 |
| 正式结算前置门禁 | 100% 通过 | 缺一不出账 |

### 2.5 P0 明确不承诺（P0-05）

- 不承诺“完全客观”；
- 不承诺“AI 提高绩效”；
- 不承诺“所有岗位/所有订单类型通用”；
- 不承诺“10 周上线”；
- 不承诺“多租户 SaaS 就绪”。

---

## 2.6 首个设计伙伴与配置包（不是产品边界）

首个设计伙伴是 Anari。它的业务是**充电桩设备销售**，但这只是第一个 `Policy Pack`，不是产品定义。核心必须保持制度无关：

- **核心不知道“充电桩/EPC/销售提成”**。行业字段、角色、工作包模板、证据要求、政策公式、fixtures 都在 pack 里；
- **Policy Pack 契约**：`id`、`name`、`version`、`policy`、`fixtures`、`roles`、`workPackageTemplates`、`evidenceRequirements`、`simulationData`、`seed`；
- **首个 pack**：`examples/verticals/charging-equipment-sales/`（DC 快充桩直销，含渠道/信用/售后规则）；
- **第二参考 pack**：`examples/verticals/professional-services/` 已加入，用专业服务利润池验证核心不改代码；`tests/pack-conformance.test.ts` 作为“制度无关”的回归门槛；
- **pack 不能 fork 引擎**：如果 pack 需要新原语，先把原语加入受限 DSL、版本化、补 conformance test，再让 pack 使用；不能为一个客户改核心分支。

**明确不做**：把某个行业的字段、公式、角色、工作包写进核心；用“行业版本”代替 `Policy Pack`；让核心代码出现 `if (industry === "charging")`。

---

## 2.7 AI-native：主动式 Agent，不是静态 SaaS

AI-native 的核心不是聊天，而是**主动闭环**：

```
observe → detect → plan → act (low risk) → request approval (high impact)
        → verify → escalate → learn
```

P0 必须有的 Agent 能力：

- **触发**：事件、定时、阈值、人工；调度器可 `tick`、`emit`、`evaluateThresholds`，重复触发有幂等键；
- **技能**：证据缺口、结算就绪、贡献异常、数据质量、申诉 SLA、制度漂移；
- **工具分级**：T0 只读、T1 低风险写入（建待办/催证据/提醒）、T2 业务流程动作（升级/指派/发起复核）、T3 高影响（正式认定/评价/规则发布/金额批准/锁账）；
- **人类批准**：T3 必须人类批准；T2 按租户策略可自动或需批准；Agent 不能自批；
- **可恢复**：幂等键、重试、死信、checkpoint、人工接管、AI 关闭降级；
- **可审计**：任务、计划、工具调用、输入/输出、批准人、结果、失败原因全部留痕；
- **可学习**：Agent 可以提出政策改进建议、用历史/代表样本模拟影响（`simulatePolicyChange`），但不能自动发布；`publish_policy` 是 T3，人类批准后才形成新版本。

**验收指标**：发现到关闭的中位时长、自动解决率、升级率、误报率、人工改判率、每闭环成本、AI 关闭时人工可完成率。不是“AI 采纳率”。

**调度与提案**：`AgentScheduler` 支持 schedule/event/threshold 三类触发；`apps/worker` 轮询事务性 outbox 并把领域事件分发给 Agent；`PolicyProposalSkill` 可基于模拟提出政策变更，`publish_policy` 必须 T3 人工批准。

---

## 3. 保留的 V4.0 原则

以下原则继续有效，V4.1 不修改：

1. **五层模型**：L1 业务结果、L2 工作包与责任、L3 交付与证据、L4 贡献认定、L5 评价与激励。
2. **订单是业务结果对象，不是个人绩效**；必须拆工作包/里程碑/交付物。
3. **不承诺通用贡献百分比**；只有租户政策明确要求分池时才计算。
4. **LLM 零金额**：正式金额只由版本化、确定性规则引擎计算；LLM 不写金额、不批准、不结算。
5. **贡献申报 ≠ 贡献认定**；AI 只起草，授权人确认。
6. **证据优先且可反驳**；每个正式结论有证据、标准、周期、责任人。
7. **人工实质审核**；涉及本人利益回避；申诉由非原决定人复核。
8. **追加式审计与账本**；更正通过新事件/冲销/重算，不覆盖历史。
9. **最小权限与租户隔离**；权限贯穿 API、DB、Agent、缓存、异步、导出、日志、模型上下文。
10. **系统进化不自动生效**；AI 可建议/模拟/解释，授权人审批后才能发布新配置。
11. **AI 关闭可降级**；核心流程人工可完成。
12. **不把活动量当贡献**；未覆盖工作必须被看见。

---

## 4. 法律生效门禁（P0）

### 4.1 设计原则（LG-01）

产品负责**记录、阻断、可审计**；租户/法务负责**法律充分性**。产品不得宣称“自动合规”。

### 4.2 门禁对象与要求

| ID | 门禁 | 产品要求 | 阻断点 |
|---|---|---|---|
| LG-02 | 法人/法域/员工类型 | 政策版本必须声明适用法人、工作地、员工类别、工时类型 | 未声明不得发布 |
| LG-03 | 民主程序/员工代表 | 记录职工代表大会/全体职工讨论、工会/职工代表协商、意见反馈、公示、评论期 | 未完成不得 FORMAL 结算 |
| LG-04 | 告知/签收 | 制度文本、版本、生效日、员工告知/签收记录；沉默不等于同意 | 未签员工不得按新规则扣减 |
| LG-05 | 合同/薪酬方案变更 | 薪酬结构版本、个体同意/电子签署、生效日 | 未同意不得单方变更 |
| LG-06 | 最低工资/扣款 | 按法人/工作地维护最低工资；计算后校验固定+浮动不低于底线；扣款类型/上限/顺序硬校验 | 不过不出账 |
| LG-07 | PIP/不利决定 | 低分不自动触发解除/降职/降薪；PIP、培训/调岗、adverse action 走独立人工/法务流程 | AI/规则不得自动执行 |
| LG-08 | 个人信息保护 | 数据地图、DPIA/PIPIA、DSR、告知/同意、保留/法务保留、跨境/供应商清单 | 未完成不得 FORMAL |
| LG-09 | AI 告知/解释 | 员工知道 AI 参与了什么、依据、申诉方式；重大影响决定提供说明 | 不得以商业秘密拒绝一切解释 |
| LG-10 | 证据包 | 可按法域导出制度公示/协商/签收/计算/审批/申诉证据 | 审计/仲裁可读 |

### 4.3 法条映射（非法律意见）

- 中国《劳动合同法》第 4 条：涉及劳动报酬等切身利益的制度，须经职工代表大会/全体职工讨论，与工会/职工代表平等协商确定，并公示/告知。
- 第 35 条：变更劳动合同约定内容应协商一致并书面化。
- 第 40 条：不能胜任工作需先培训或调整岗位，不能直接以绩效分数解除。
- 《最低工资规定》第 12 条：绩效工资不属于可剔除项；正常劳动下剔除加班/特殊津贴/法定福利后不得低于当地最低工资。
- 《工资支付暂行规定》第 16 条：因劳动者本人原因造成经济损失的扣除，每月不超过当月工资 20%，且不低于最低工资；该条不应泛化为所有绩效扣减。
- 《个人信息保护法》第 24 条：自动化决策应透明、公平、公正，不得不合理差别待遇；重大影响决定个人有权要求说明并拒绝仅自动化决策。第 55 条：自动化决策等场景做个人信息保护影响评估。
- 国办发〔2026〕29 号：规范人工智能在人力资源管理领域应用，依法治理算法歧视、虚假招聘、侵犯隐私权休息权等；民主程序/可复核的直接依据仍是《劳动合同法》第 4 条与《个人信息保护法》第 24 条。
- 如面向欧盟：AI Act Annex III 第 4 点将绩效评估/任务分配/员工监控列为高风险；高风险义务经 Digital Omnibus（Regulation (EU) 2026/1744）推迟至 2027-12-02，但禁止性/透明度/AI 素养义务更早生效；GDPR 第 22 条要求人工干预、表达意见、异议；EU 2023/970 薪酬透明指令转化截止 2026-06-07。

> 上述为产品需求映射，不构成法律意见。上线前必须由执业律师/劳动法顾问按法人、工作地、员工类型和制度文本确认。

---

## 5. 激励设计护栏（P0）

### 5.1 设计原则（INC-01）

V4.0 把具体制度降为“租户配置实例”，这是正确的产品方向；但产品必须提供**副作用护栏**，不能把“可配置”当成“设计正确”。

### 5.2 护栏要求

| ID | 要求 | 验收 |
|---|---|---|
| INC-02 | 角色差异化薪酬结构；不把同一固定/浮动比例套所有岗位 | 配置模板按角色区分 |
| INC-03 | 平滑阈值；减少“0.01 分跳档”；已签周期不追溯下调 | 阈值模拟显示边际变化 |
| INC-04 | 浮动薪酬占比上限；最低工资底线；0 系数不导致低于法定底线 | 计算后硬校验 |
| INC-05 | 相互依赖交付用团队池；个人定价只用于边界清晰交付 | 政策模板支持团队池 |
| INC-06 | 保护未计价工作：质量/带教/风险预防/协作进入记分卡或保护产能 | 未计价工作不被默认为 0 |
| INC-07 | 不做强制分布/相对排名/同事金额展示 | 员工端只显示本人+规则+团队聚合 |
| INC-08 | 机动份额/追认/战略池：公开标准、上限、双人/委员会审批、员工代表观察、事后复盘 | 裁量池有审计与公示 |
| INC-09 | A 类池/贡献利润：先做成本核算/转移定价审计；标准成本；总池封顶；延迟支付/clawback | 财务签字 |
| INC-10 | Clawback：书面同意、最低工资底线、分期/困难豁免、不追溯已签周期 | 法务确认 |
| INC-11 | 绩效评价与发展/薪酬决策适度分离 | 评价模板区分发展/奖惩 |
| INC-12 | 年度制度审查：员工调查、申诉统计、子群体影响、副作用指标 | 年度报告 |

### 5.3 Policy Pack 契约与首个设计伙伴配置（INC-13）

首个租户必须先冻结一套可执行配置，至少包括：

- 适用法人/工作地/员工类型/周期；
- 薪酬结构（固定/浮动比例、上限、底线）；
- 岗位/角色与指标；
- 订单/工作包模板、验收标准、证据要求；
- 贡献认定维度、权重、评审人、回避规则；
- 计算规则（基数、比例、封顶、分池、舍入、币种、退款/坏账）；
- 预算/现金门槛（如适用）；
- 告知/签收/申诉/确认流程；
- 测试用例（正常/边界/异常/历史回放）。

**核心要求**：核心必须通过 `Policy Pack` 运行不同制度，不改代码。第一个 pack 是 `examples/verticals/charging-equipment-sales/`（Anari 充电桩设备销售），第二个 pack 必须制度明显不同（如专业服务/制造/渠道分销）。以下是首个 pack 的示例政策，不是核心公式：

```
basePool = min(订单毛利 × 3.5%, 120,000)
cashFactor = min(1, 已回款 / 开票额)
cashAdjustedPool = basePool × (50% + 50% × cashFactor)
afterSalesReserve = cashAdjustedPool × 3%       # 售后/退货准备金，暂不分配
payablePool = cashAdjustedPool − afterSalesReserve
channelPool = payablePool × 渠道分成比例
internalPool = payablePool − channelPool
个人金额 = internalPool × 经确认的贡献权重
```

质量/信用门禁：信用未批准、质量冻结、渠道分成但无渠道伙伴 → 阻断。该政策是首个 pack 的可执行示例，不是 Anari 最终制度，也不是核心公式；数值需财务回测、法务审查、员工程序后生效。EPC 项目 pack 仅作为后续扩展示例。

**如果首个租户制度无法映射到现有 schema/规则引擎，应明确 descope，而不是用 JSONB 假装支持。**

---

## 6. 贡献认定（P0）

| ID | 要求 | 验收 |
|---|---|---|
| ATT-01 | 贡献申报与贡献认定分离；申报不自动成为认定 | 自我申报不能自动通过 |
| ATT-02 | 裁决人≠申报人；涉及本人/亲属/利益关联回避 | 自评/自批被阻断 |
| ATT-03 | 每个正式认定关联工作包或说明例外；事后补录标记原因 | 例外可审计 |
| ATT-04 | 证据覆盖按角色/任务类型测量；低覆盖不直接扣分 | 覆盖率仪表 |
| ATT-05 | 证据不足进入待补证/人工认定，不默认 0 | 默认规则可配置 |
| ATT-06 | 评审人先独立判断，再看 AI 草稿；抽样盲审；校准会 | 记录独立判断/修改理由 |
| ATT-07 | 申诉由非原决定人复核；时限/证据披露/无报复 | 申诉 SLA |
| ATT-08 | 贡献认定与绩效评价分离；贡献分不直接当绩效分 | 数据模型分离 |
| ATT-09 | 子群体误差/评审人一致性审计 | 季度报告 |

---

## 7. AI / Agent（P0）

### 7.1 评测前移（AI-01）

**Evaluation Agent 与模型/评价质量评测必须同时进入 P0。** 未通过评测前，Agent 只做证据检索/摘要/缺口检测，不做评分建议。

### 7.2 评测要求（AI-02）

| 项 | 要求 |
|---|---|
| Gold set | 每个角色/订单类型 100–300 个案例，专家按 rubric 标注，分层覆盖证据质量/角色/资历/结果；留 holdout；季度刷新 |
| Inter-rater reliability | 2+ 独立人类评分；Cohen's/Fleiss' kappa 或 ICC；AI-human 一致性不应高于 human-human |
| 子群体公平 | 按角色/性别/年龄/地区/司龄/用工类型/证据覆盖看分数/误差/选择率；小样本转定性 |
| Counterfactual | 交换姓名/性别/年龄/地区；改变长度/顺序/无关证据；分数应稳定 |
| Adversarial | prompt injection、伪造证据、矛盾证据、越权工具、数据外泄 |
| Drift | 模型/提示词/检索版本化；变更前回归；canary；rollback |
| Human oversight | review time、打开证据数、override rate/理由、盲审、双人复核、申诉改判率 |

### 7.3 人工监督（AI-03）

- 强制“人先独立判断，再看 AI”；
- 记录独立判断、修改幅度、修改理由；
- 随机盲审；高风险评价双人复核；
- 采纳率 >95% 触发橡皮图章审查；
- 复核人必须有权限、能力、信息、改判权。

### 7.4 Agent 范围（AI-04）

- P0 不做自主 Agent；只做 3 个 bounded workflows：证据缺口检测、草稿生成、数据质量跟进；
- 高影响/不可逆动作必须人类审批；
- 工具分级 T0–T3；T3 不得自动；
- Agent 可关闭；模型不可用时人工流程可跑。

### 7.5 安全（AI-05）

- 所有证据文档视为不可信输入；内容/指令分离；
- 不让检索内容触发工具调用；reader/actor 分离；
- 输出过 schema；最小权限；egress 白名单；
- 红队：OWASP LLM01/LLM06；间接 prompt injection；
- 模型供应商：零留存/不训练、DPA、区域推理、字段白名单。

---

## 8. 领域契约与金额路径（P0）

### 8.1 Normative domain contract（DOM-01）

建立单一来源的领域契约，至少包含：

- 对象、字段、枚举、状态转换；
- API 命令/事件/错误码；
- DB 表/约束/索引；
- 权限/数据范围；
- 测试用例。

OpenAPI、JSON Schema、SQL、TypeScript 类型应从契约生成或校验；CI 做 contract test。**不允许四份规范各自定义状态机。**

### 8.2 状态机（DOM-02）

采用以下 canonical 状态（与 `packages/domain/src/states.ts` 一致）：

- WorkPackage：DRAFT、COMMITTED、IN_PROGRESS、BLOCKED、SUBMITTED、ACCEPTED、REJECTED、CANCELLED、REOPENED。
- ContributionClaim：DRAFT、SUBMITTED、NEEDS_EVIDENCE、UNDER_REVIEW、ACCEPTED、PARTIALLY_ACCEPTED、REJECTED、APPEALED、WITHDRAWN。
- AttributionDecision：DRAFT、UNDER_REVIEW、CONFIRMED、PARTIALLY_CONFIRMED、REJECTED、APPEALED、SUPERSEDED。
- CalculationRun：CREATED、RUNNING、CALCULATED、BLOCKED、NEEDS_REVIEW、RECONCILIATION_REQUIRED、APPROVED、LOCKED、REVERSED。
- SettlementBatch：DRAFT、RECONCILING、PENDING_APPROVAL、APPROVED、LOCKED、EXPORTED、ACKNOWLEDGED、CANCELLED、ADJUSTMENT_REQUIRED。
- AppealCase：OPEN、TRIAGED、UNDER_REVIEW、DECIDED、RECALCULATION_REQUIRED、CLOSED。
- DataQualityIssue：OPEN、ASSIGNED、IN_PROGRESS、RESOLVED、WAIVED_WITH_APPROVAL、REOPENED。

### 8.3 必须补齐的对象（DOM-03）

- MetricDefinition；
- WorkPackageVersion/CommitmentSnapshot；
- EmployeeNotice/Confirmation/PolicyAcknowledgement；
- RecalculationRequest；
- BudgetPool/BudgetAllocation/CashGateInput/FinancialFact；
- RuleChangeOrder/PolicyTestCase/PolicyNotice；
- ModelEvaluationRun；
- SettlementExport/Acknowledgement；
- AuditHashChain；
- IntegrationConnection/SyncRun/ExternalIdentityMap/WebhookInbox。

### 8.4 金额路径不变量（MON-01..08）

| ID | 不变量 | 实现要求 |
|---|---|---|
| MON-01 | 审批一次性消费 | `approval_requests` 加 `consumed_at`/`consumed_by`/target action FK；动作接收 `approval_request_id`；payload hash 变更失效 |
| MON-02 | 结算只处理锁定账本 | `settlement_lines` 要求 ledger.status=LOCKED；person/amount/currency 一致 |
| MON-03 | 同一 ledger 不重复结算 | active settlement 对 ledger_id 做 partial unique |
| MON-04 | 计算行唯一 | `UNIQUE(tenant_id, calculation_run_id, person_id, incentive_type, source_key)` |
| MON-05 | 账本不重复入账 | `UNIQUE(tenant_id, calculation_line_id, entry_type)`；idempotency 从 calculation line 派生 |
| MON-06 | 锁定账本不可变 | trigger/privilege 禁止 UPDATE/DELETE；更正追加 adjustment/reversal |
| MON-07 | 审计可验证 | prev_hash/chain_hash/sequence；WORM/双副本；RLS |
| MON-08 | 输入可重放 | 保存 input/evidence/financial fact 快照；同快照+规则+引擎版本→同结果 |

---

## 9. 数据质量与证据覆盖（P0）

| ID | 要求 | 验收 |
|---|---|---|
| DATA-01 | 按角色/任务类型/订单类型统计证据覆盖率 | 每周期仪表；≥70% |
| DATA-02 | 被动采集 + 轻量自报 + 同伴提名 + 管理者证明 | 员工补充 ≤30 分钟/周期 |
| DATA-03 | 证据不足进入待补证/人工认定，不默认 0 | 默认规则可配置 |
| DATA-04 | 每类数据源有 owner/SLA/升级；阻断问题阻断正式计算 | owner/SLA 清单 |
| DATA-05 | 不采集活动量；员工可查看本人数据；数据最小化 | 数据地图/权限测试 |

---

## 10. 组织采用与安全（P0）

### 10.1 组织采用（ORG-01..05）

- 试点 volunteer；员工代表/工会参与规则、申诉、数据使用；
- 透明规则/本人数据/团队聚合；不展示同事金额/个人排名；
- 无报复承诺；申诉统计公开；
- 经理培训/模板/校准会；经理时间 ≤2 小时/周期；
- 信任/程序公平基线+季度调查；纳入 Go/No-Go；
- 试点期不因 AI 采用裁员；AI 成绩单不进入员工奖惩；AI 使用政策公开。

### 10.2 安全/隐私（SEC-01..06）

- 威胁模型：跨租户、越权、字段级、导出、缓存、异步、Agent、prompt injection、供应链、内部人；
- RLS：产品化前 `FORCE` + `NOBYPASSRLS` + tenant context + 负向测试；
- 字段级 ABAC；break-glass 有期限/理由/审计；
- 导出 DLP/水印/审批/限流；
- 模型供应商零留存/DPA/区域推理；
- 保留/删除/DSR/法务保留；审计脱敏。

---

## 11. 12 周计划与 Go/No-Go

### 11.1 12 周计划

| 周 | 动作 | 产出 |
|---|---|---|
| W1–2 | 选 5–10 个真实订单；访谈；梳理证据源 | 订单—工作包—证据映射；基线 |
| W3–4 | 法律/合规评审；员工沟通/民主程序；DPIA；最低工资测算 | 合规备忘录；告知/签收方案 |
| W5–6 | 最小证据工作台 + 一个真实连接器；工作包/claim/decision/员工查看 | 可运行证据链；10 个样本 |
| W7–8 | reference policy + 确定性引擎 + 独立对照 + 账本 + 影子结算 | 差异 0；差异归类 |
| W9–10 | 20–50 人跑一个周期；测覆盖率/耗时/争议/信任 | 试点数据 |
| W11–12 | 财务对账、申诉演练、成本、Go/No-Go | 试点报告；继续/停止 |

### 11.2 Go 条件（GO-01）

- 5–10 个订单可映射；证据覆盖率 ≥70%；
- 员工 ≤30 分钟/周期；经理 ≤2 小时/周期；
- 争议率 <10%；财务对账差异 0；
- 法律门禁通过；员工信任不低于基线；
- AI 评测通过（如使用评分建议）；金额路径不变量测试通过；
- 3 个付费设计伙伴中 ≥2 个愿意继续（产品化判断）。

### 11.3 No-Go / Kill（GO-02）

- 覆盖率 <50%；员工 >30 分钟；争议率 >10%；
- 财务无法对账；法律硬伤；信任显著下降；
- 重复付款/审批复用/账本可改等 P0 缺陷；
- AI 评测未通过但业务坚持用 AI 评分。

---

## 12. 与 V4.0 的差异清单

| V4.0 | V4.1 |
|---|---|
| P0 15 项能力 | P0 收缩为 12 周 wedge；其余延后 |
| 合规原则 | 法律生效门禁 + 证据包 |
| Evaluation Agent P0 / 评测 P1 | 评测 P0；未通过只做证据整理 |
| 制度无关但无 reference policy | 首个租户 reference policy pack 必须先冻结 |
| 状态机/对象/API 四份规范 | 单一 domain contract + contract test |
| 金额路径原则 | 8 条数据库级不变量 |
| 工作覆盖监测 | 覆盖率/员工负担/默认规则/owner SLA |
| 商业化未回答 | 定位/买家/wedge/竞争假设 |
| 变革管理原则 | 员工代表/试点/信任/AI 承诺 |
| 安全原则 | 威胁模型/RLS/字段级/导出/供应商/Agent |

---

## 13. 开放问题（需在 W1–W4 关闭）

| # | 问题 | 责任 | 关闭条件 |
|---|---|---|---|
| OQ-1 | 首个 wedge 的行业/订单类型/法人 | CEO/CFO | W1 |
| OQ-2 | 首个租户制度参数（固定/浮动、系数、池、封顶、clawback） | 财务/法务 | W2 |
| OQ-3 | 民主程序/员工代表/告知/签收方案 | 法务/HR | W4 |
| OQ-4 | 最低工资/扣款/工时/假期规则 | 财务/法务 | W4 |
| OQ-5 | DPIA/PIPIA/跨境/供应商 | 法务/DPO | W4 |
| OQ-6 | 证据源与覆盖率基线 | 产品/数据 | W2 |
| OQ-7 | AI 评测集/标注人/指标门槛 | 产品/AI | W6 |
| OQ-8 | 独立参照实现与 golden cases | 财务/工程 | W6 |
| OQ-9 | 试点人群/对照/信任调查 | HR/产品 | W4 |
| OQ-10 | 商业化设计伙伴/定价 | CEO | W8 |

---

## 14. 附录：首个纵向切片的实现范围

当前仓库已启动的纵向切片（见 `README.md`）：

- `packages/domain`：canonical 状态机、类型、核心不变量；
- `packages/policy-dsl`：确定性 decimal、订单贡献池计算、独立参照、哈希；
- `packages/ledger`：追加式账本、幂等、锁定、冲销、哈希链；
- 结算批次：从锁定账本按周期生成批次，显式 RECONCILE/SUBMIT/APPROVE/LOCK/EXPORT/ACKNOWLEDGE/CANCEL 命令，CSV 财务导出，行与账本强校验；
- `packages/ai-gate`：评测门禁 + 非评分证据助手 + kappa/子群体/反事实/注入评测；
- `apps/api`：工作包→evidence→claim→decision→legal gate→calculation→confirmation→appeal→approve→lock 的最小 API；内存与 PostgreSQL 两种存储，按认证租户解析 store 与 Agent Runtime；`/` 提供最小员工确认页，`/admin` 提供政策模拟与 Agent 审批页；
- `packages/auth`：OIDC/JWT 与开发头认证；所有 `/api/v1` 路由默认要求认证；高风险命令按 `admin/manager/finance/integration` 角色授权；
- `packages/connectors`：通用 Connector 接口 + CSV 连接器 + 分页 HTTP/JSON 连接器（字段映射、cursor、headers 可配）；`POST /api/v1/ingestion/events:batch` 幂等入库并投影为 evidence；
- `db/migrations`：核心 schema、治理 schema、金额路径不变量；
- `db/seed`：demo tenant/people/cycle/policy + RLS app role；
- `packages/agent-runtime`：主动式 Agent Runtime、工具分级、审批门禁、审计；`publish_policy` 为 T3，只有人工批准后才真正写入政策版本，并关闭前一版本的有效窗口；
- `packages/agent-persistence`：Agent 任务、发现/动作/结果、批准与审计持久化到 PostgreSQL；API/Worker 重启后按幂等键恢复；Worker 支持静态 token 或 OIDC client credentials；
- `examples/verticals/`：Policy Pack 目录；`charging-equipment-sales/`（首个设计伙伴）、`professional-services/`（制度无关 conformance pack）与 `charging-epc/`（后续扩展示例）；
- `fixtures`：核心通用 order policy + 5 个订单 fixture；reconciliation CSV；
- `scripts/reconcile.ts`：独立 CSV 对账脚本；
- `docs/openapi.yaml`：OpenAPI 3.1 契约；`tests/openapi.test.ts` 校验路由覆盖与 `$ref`；
- `scripts/ci.sh`：安装→类型检查→测试→compose 校验→PostgreSQL 集成测试；
- `/ready` 依赖检查、`/metrics` Prometheus 指标（按注册路由模式，低基数）；
- `docs/adr`：关键架构决策。

该切片**不是**完整 P0；它是 P0 的第一个可运行骨架，用于验证领域契约、金额路径和测试方式。
