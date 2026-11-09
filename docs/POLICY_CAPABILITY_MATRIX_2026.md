# 2026 制度承接矩阵（条款 → 系统能力）

> 依据：安纳瑞发〔2026〕016/017/018 号、股权激励管理办法〔2026〕011 号、
> 产品技术中心专项激励政策〔2026〕008 号、销售激励制度〔2026〕003 号、
> 《任务制与 AI 原生组织推进说明》（2026-10-13）。
>
> 原则：制度中的**可计算规则**由确定性引擎计算并留痕；需要人工判断的事实、
> 责任、验收和纪律结论由主管/总经理确认，AI 只做归集、提示和预审；
> CRM/ERP/PingCode/Gitee/工单/AI 财务/Academy 的原始记录不被系统改写。

## 一、能力入口

| 能力 | 前端 | 后端 |
| --- | --- | --- |
| 制度计算中心 | `/console/institutions`（2026 制度中心） | `/api/v1/policy/*` |
| 任务制组织 | `/console/task-pods`（任务制组织） | `/api/v1/task-pods`、`/api/v1/ai-members`、`/api/v1/personal-task-inventories` |
| 绩效评分/目标卡/月明星 | 制度中心「绩效计分」 | `/policy/performance/*` |
| 激励分配 | 制度中心「激励分配」「专项奖励」 | `/policy/incentive/*` |
| 股权测算/授予流程 | 制度中心「股权测算」+ 期权股权页 | `/policy/equity/*` + `/equity-*` |
| 计算留痕 | 各页面结果 + 记录查询 | `policy_engine_records`（迁移 072） |

所有计算接口返回确定性结果；涉及金额、评分、授予、回购、奖励的请求会写入
`policy_engine_records`，保留 `recordType / personId / period / status / payload /
version / createdAt / updatedAt`，可审计、可追溯、不可静默覆盖。

## 二、《绩效考核与激励管理制度》（017）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 第三条 | 月度/季度/年度独立周期，不简单平均 | `PerformancePeriod` 三周期；评分分别计算，周期上限 110/150/105 | 已承接 |
| 第四条 | 系统不改写权威业务系统 | 仅读取/接收测量值；`dataSource`、`sourceFields` 必填 | 已承接（接口边界） |
| 第五、二十四条 | 采集→AI 预审→确定性评分→主管→总经理→锁定 | 既有 `evaluation-cycles` 状态机 + `pre-review` + `evaluation-drafts` + `policy/performance/score` | 已承接 |
| 第六、二十五条 | 权限、快照、版本、申诉、不覆盖 | 既有权属校验、版本化记录、申诉流程；新增记录 `version` 乐观锁 | 已承接 |
| 第七至十条 | M-001 70%、M-002 15%、M-003 15%；任务权重 1/2/3/5；N/A 不记 0 | `monthlyMetricTemplate()`；`scorePerformance()`；`/policy/performance/closure-rate` 从工作包取数（等级、验收、证据、时限） | 已承接 |
| M-003 | 事件分值 ±1~5/±5~10/−5~−15，钳制 0~110，人工核实 | `INTERVAL_EVENT` 评分函数；`eventAdjustment` 由人工核实后传入，AI 不单独认定 | 已承接 |
| 第十一至十三条 | 季度岗位指标 Q-S/Q-ED/Q-PM/Q-CS/Q-SC/Q-F，权重合计 100%，事前锁定 | `quarterlyMetricTemplate(role)`；`validatePerformanceMetricSet()`；`/policy/performance/goal-cards` 创建/锁定，锁定后拒绝覆盖 | 已承接 |
| 第十四、十五条 | 年度计分卡 20/30/20/30；单项封顶 120；S_company=min(105,…)；P_y≤0 时利润项 0 | `calculateAnnualScorecard()`；`/policy/performance/annual-scorecard` | 已承接 |
| 第十六、十八条 | Kp=S/100，至少 4 位小数；月/季/年上限 1.10/1.50/1.05 | `scorePerformance()` 输出 `kp`（4 位）；`calculateMonthlyPerformanceWage()` | 已承接 |
| 第十七条 | N/A 同比例归一；不足以评价时标记不完整 | `scorePerformance()` 权重归一化；全 N/A 返回 `complete:false` | 已承接 |
| 第十九、二十条 | 月度绩效工资 = 月工资总额 × 职级比例（20/30/40%）× Kp（≤1.10） | `calculateMonthlyPerformanceWage()`；`/policy/performance/monthly-wage` | 已承接（薪酬发放页可按结果制单） |
| 第二十一条 | 专项悬赏独立，不与绩效分数挂钩 | 悬赏模块 + `bounty-settlement` 系数；不写回绩效记录 | 已承接 |
| 第二十二、二十三条 | 多人归因、统一 contribution_id、防重复 | 既有 work package/claim/attribution/exposure 链；`evidenceRefs` | 已承接 |
| 第二十六条 | 系统故障人工应急、模型升级不追溯 | 既有版本化/锁定/审计；记录不原地覆盖 | 已承接 |
| 第二十七至二十九条 | 总经理/主管/员工职责 | 角色门禁（admin/manager/finance）+ 审批与审计 | 已承接（权限映射） |

## 三、《绩效考核制度配套附件》（018）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| A.1 | 指标字典字段齐全；权重 100%；周期前锁定 | `PerformanceMetricSpec`（metricId/name/period/applicableRoles/weight/type/dataSource/sourceFields/calculationRule/target/anchors/owner/evidence/applicability/exception/approval/version）；`validatePerformanceMetricSet()` | 已承接 |
| A.2 | 月度 M-001/M-002/M-003 与任务等级 | `monthlyMetricTemplate()`；closure-rate 按 `packageType` 映射 1/2/3/5，按期+验收+证据 | 已承接 |
| A.3–A.8 | 销售、执行总监、产品经理、客服、采购供应链、财务季度指标与权重 | `quarterlyMetricTemplate()` 六套模板，权重与附件一致 | 已承接 |
| A.9 | 年度公司级计分卡 | `annualMetricTemplate()` + `calculateAnnualScorecard()` | 已承接 |
| B.1/B.2 | 五类评分函数：A 正向线性、B 反向线性、C 分段线性、D 加权验收、E 区间事件 | `scoreMetric()` 五种类型；分段线性锚点插值；反向线性支持锚点/目标 | 已承接 |
| B.3 | N/A 权重重分配；不足以评价不强行生成系数 | `scorePerformance()` 归一化与 `complete` 标记 | 已承接 |
| B.4/B.5 | 单项 ≤150%；周期上限 110/150/105 | `maxScore`（默认 150，考试/事件按制度收窄）；`PERFORMANCE_CYCLE_CAPS` | 已承接 |
| B.6/B.7 | 异常样本、防刷分 | 评分输入要求 evidenceRefs/sampleSize；异常进入既有 data-quality/申诉流程；AI 异常提示不构成违规认定 | 部分承接（检测规则可扩展） |
| C.1/C.2 | Kp/Kq 基线、资格门槛分开 | `scorePerformance()`（Kp）；`calculateFunctionalQuarterlyBonus()`（S>100 才有资格，Kq≤1.5） | 已承接 |
| C.3/C.4 | 结果分字段记录；月度绩效工资口径 | 记录分离分数/系数/金额；`calculateMonthlyPerformanceWage()` | 已承接 |
| D.1–D.4 | 预审输出、主管/总经理审核、申诉时限 | 既有 pre-review/draft/decision 流程 + AI suggestion logs；时限可由工作流 SLA 字段承载 | 已承接（流程）；时限提醒为既有通知能力 |

## 四、《激励分配制度》（016）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 第二条 | 提成不乘 Kp；职能季度奖金用 Kq；年度利润分享以净利润目标达成为前提 | 三个独立计算器；互不混用 | 已承接 |
| 第三条 | 业务中心/职能部门归属以总经理批准清单为准 | 人员组织归属 + 角色；岗位清单由既有组织模块维护 | 已承接（主数据） |
| 第四、六条 | DBCP = 毛利 − 业务费用 − 人工差旅 − 分摊费用 − 分摊后端工资 − 5% 管理计提 | `calculateDbcp()`；5% 默认、可配置基数 | 已承接 |
| 第七条 | 净回款为基数；DBCP 利润率分档 0/1/1.5/2/2.5/3%；整笔适用；不乘 Kp | `calculateBusinessUnitCommission()`；默认档位与制度一致，支持模拟覆盖 | 已承接 |
| 第八条 | 营销奖励 M、执行总监补差 G=DBCP×2%×K管理−M、剩余池 R=B−M−G、比例合计 100%、未分配留存 | `calculateExecutiveSupplement()`；`calculateInternalSplit()`（校验合计 100%、不超池） | 已承接 |
| 第九条 | 月明星：排名第一、M-003≥110、正向事件证据、无严重违规；500 元；连续三月自第三月起 1000；每年≤3 次；不递补 | `evaluateMonthlyStar()`；阈值可配置；记录评选结果 | 已承接（评选）；奖励发放走结算/薪酬制单 |
| 第十、十一条 | 职能季度奖金基数=固定月工资×10%；S>100 才有资格；Kq 封顶 1.50 | `calculateFunctionalQuarterlyBonus()` | 已承接 |
| 第十二条 | 年度利润分享：P_y≥T_NP 且 >0；池比例 5–10%；点数=岗位价值点×有效季度 Kp 加权×在岗比例；预算硬约束 | `calculateAnnualProfitSharing()`；预留预算余额约束；尾差按最大点数调整 | 已承接 |
| 第十三条 | 悬赏载明内容/成果/负责人/日期/金额/验收/证据；验收后兑现 | 既有 bounty 生命周期 + `calculateBountySettlement()` | 已承接 |
| 第十四条 | 时间系数 0.90/0.75/0.50/0；质量系数 1.00/0.95/0.80/0.50/0；核定金额公式；延期批准除外 | `calculateBountySettlement()`；支持延长批准、关键里程碑失效、个人贡献比例 | 已承接 |
| 第十五条 | 各激励核算周期与支付节奏 | 结算批次/薪酬发放模块承载；报告导出 | 已承接（流程编排） |
| 第十六至十八条 | 财务/HR/主管/总经理职责；数据、公式、审批、支付留痕；申诉 | 角色门禁 + `policy_engine_records` + 既有审计链/申诉 | 已承接 |

## 五、《股权激励管理办法（2026）》（011）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 第2、5条 | 工具矩阵：实股 LP、期权、RSU、Refresh、虚拟股/分红权 | `EquityInstrument`；既有授予类型 + 扩展授予流程；虚拟股/分红权作为工具枚举 | 已承接（工具建模） |
| 第6条 | 资格：劳动合同、关键岗位、战略贡献、绩效 A 及以上、协议/保密/竞业、配偶确认函 | `EquityGrantCase` 流程 + `married/spouseConfirmationSigned/agreementSigned/riskAcknowledged` 门禁；绩效等级输入 | 已承接（流程门禁） |
| 第8–13条 | 配股=岗位基准×绩效×司龄；岗位矩阵 L1–L5×融资阶段；绩效 S/A/B/C/D；司龄 1.2/1.0/0.8/0.5；饱和上限 10/5/1/0.5/0.2% | `calculateEquityGrant()`；矩阵、系数、饱和检查；`isRefresh` 支持 Refresh | 已承接 |
| 第12条 | 行权价=最近优先股价格×(1−折扣率)，按融资阶段 | `calculateOptionStrikePrice()` | 已承接 |
| 第15–17条 | 股东会/GP 决策权限；8 步授予流程；差异化增授 | `/policy/equity/grant-cases` 八步状态机（资格→配股→方案→股东会→协议→工商→税务→台账），拒绝跳步；股东会决议编号门禁 | 已承接 |
| 第18条 | 年度 Refresh：按等级比例、绩效门槛、独立 4 年 vesting、总量控制 | `calculateEquityGrant(isRefresh)`；A 轮前不 Refresh、C/D 不 Refresh；归属用同一 vesting 引擎 | 已承接（计算）；年度总量报告可由 Cap Table 汇总 |
| 第19–21条 | 4 年/1 年 cliff/按月 1/48；双触发、身故/失能、退休、IPO、清算 | `calculateVestingSchedule()`；各加速场景；IPO 不自动加速 | 已承接 |
| 第22–25条 | 回购矩阵 A–E；12 个月最低持有；公允价值三级；20% 流动性折扣；最低 5 万；超 50 万分 24 期；年度 50 万上限 | `calculateRepurchase()`；情形价格/通知/完成时限；最低价与年度上限标记 | 已承接 |
| 第26、27条 | 过错认定警告→15 工作日整改→股东会决议；12 个月除斥期间 | 回购结果给出门槛与时限；过错认定由既有不利决定/申诉流程承载 | 已承接（计算+治理流程） |
| 第29–33条 | 递延纳税备案、替代安排、代扣代缴、税务示例与风险告知 | `calculateEquityTax()`（递延/未递延）；授予流程税务备案步骤与风险知悉门禁 | 已承接 |
| 第34–36条 | Cap Table、期权池、Vesting 进度、饱和度报告、年度报告、工商变更 | `calculateCapTableSnapshot()`；既有授予/归属查询；工商变更作为流程步骤 | 部分承接（报告导出可扩展） |
| 第37–41条 | 融资前评估、期权池扩容、反稀释、上市前架构调整 | Cap Table/饱和度数据支撑；架构调整为人工治理事项 | 部分承接（决策支持） |

## 六、《产品技术中心专项激励政策》（008）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 二(一) | 发明专利受理 2000/授权 5000；实用新型/软著 200/1000；外观 100 | `calculateTechCenterAward()` 固定标准 | 已承接 |
| 二(二) | 技术突破 3000/5000；特殊贡献总经理核定 | 同上；`SPECIAL_TECH_CONTRIBUTION` 使用核定金额 | 已承接 |
| 二(三) | 客户定制项目定制费 30%–50% | 同上；默认下限 30%，负责人可核定上限 | 已承接 |
| 二(四) | 成本优化年度节约 1%–2%，上限 10000 | 同上；比率与上限校验 | 已承接 |
| 三(一) | 交流桩 2000/项目、直流桩 5000/项目，按延期比例扣减 | 同上；`delayRatio` 扣减 | 已承接 |
| 三(二) | 软件里程碑 1000/节点；GA 稳定 30 天 3000–5000 | 同上 | 已承接 |
| 三(三) | 战略级项目单独方案报总经理 | 通过专项悬赏/特殊贡献核定承载 | 已承接（走审批） |
| 四(一) | 月度 SLA 全达标（P0≤30 分钟、P1≤2 小时、P2≤1 工作日）500 元 | `SLA_MONTH` | 已承接（SLA 数据由工单系统提供） |
| 四(二) | 知识贡献 50–100/条，季度上限 1000 | `KNOWLEDGE_CONTRIBUTION` 上限校验 | 已承接 |
| 四(三) | 客户满意度≥90% 500/季度；促成战略客户 1000–3000 | `CUSTOMER_SATISFACTION_QUARTER`、`STRATEGIC_CUSTOMER_SUPPORT` | 已承接（需业务书面确认） |
| 五 | 半年度技术骨干 3000/人 | `TEAM_EXCELLENCE` | 已承接 |
| 六 | 季度奖金池=业务提成总额 19%；岗位系数 1.2/1.0/1.0±0.2；项目贡献×绩效；负责人四项考核 +0.1/−0.2 | `calculateTechCenterPool()`；四项考核按制度判定 | 已承接 |
| 七 | 全年目标≥101% 参与职能年终奖池 | 年度计分卡/利润分享资格条件承载 | 已承接 |
| 八 | 奖励追回、合规取消、争议仲裁 | 既有 clawback/不利决定/申诉模块 | 已承接（治理流程） |
| 九 | 数据依据（官方通知/验收/工单/实际回款）、发放时间、季度复盘 | 输入字段与结算批次承载；报告导出 | 已承接（流程） |

## 七、《销售激励制度（海外）》（003）

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 三(1)(1) | 开发明星：季度≥8 个新客户（首单≥10 万、回款周期≤50 天）奖 1 万；6 个月内退款/坏账按比例扣减 | `calculateOverseasSalesAward(NEW_CUSTOMER_STAR)`；坏账按损失 50% 扣减（制度“按比例”默认口径，可扩展） | 已承接 |
| 三(1)(2) | KA：行业前 50/地区头部；年度订单≥500 万；首签 500 万奖 3 万、1000 万奖 5 万 | `KA_BREAKTHROUGH`；首签与金额门槛 | 已承接（KA 资格由业务确认） |
| 三(1)(3) | 重要客户首签且年度≥300 万奖 1 万 | `IMPORTANT_CUSTOMER_BREAKTHROUGH` | 已承接 |
| 三(2) | 季度销冠 1 万；年度销冠 5 万+称号 | `QUARTERLY_CHAMPION`/`ANNUAL_CHAMPION`；排名与超额条件 | 已承接 |
| 四 | 坏账/退款按损失 50% 扣减；KA 次年订单下滑>30% 追回 50%；禁止恶意抢单 | 输出 `deduction/recoverableAmount/disqualified`；与 clawback 流程衔接 | 已承接 |
| 五 | 合同签署+首付款到账为节点；奖金基数以回款为准；次月 18 日发放；季度复盘 | 输入字段为合同/回款口径；结算批次与报告承接发放节奏 | 已承接（数据由商务/财务提供） |

## 八、《任务制与 AI 原生组织推进说明》

| 条款 | 制度要求 | 系统承接 | 状态 |
| --- | --- | --- | --- |
| 三 | 围绕具体任务组建；跨地区；人+AI；达成即解散/转入下一任务；人人可发起；发起人对结果负责 | `/task-pods`：`title/objective/initiator/members(PERSON|AI)/status/successorTaskPodId`；发起人必须是成员；完成/解散/继任 | 已承接 |
| 四(一) | Q4 任务透明化：个人任务清单、人/AI/人机协同标注、选一项 AI 化改造、入库评审 | `/personal-task-inventories`：逐项 `mode/aiWorkflow/aiTransformationCandidate`；校验必填；提交/验收/退回 | 已承接 |
| 四(二) | 虚拟岗位/虚拟团队；AI 成员有名字、职责、版本；按结果考核 | `/ai-members` 登记簿（name/role/aiVersion/responsibilities/active）；任务组记录 AI 版本快照 | 已承接 |
| 四(三) | 组织即网络；按任务动态组队；部门培养能力、任务组交付 | 任务组可跨人员/AI 组合；部门/岗位主数据保留 | 已承接（组织模型） |
| 阶段验收 | Q4 清单入库；2027 H1 首批虚拟岗位；2027 H2 任务组为主要协作方式 | 清单与任务组记录可查询、可统计；后续阶段以数据积累推进 | 已承接（数据底座） |

## 九、边界与人工治理事项

1. **权威数据源**：系统不修改 CRM/ERP/PingCode/Gitee/工单/AI 财务/Academy 原始记录；
   M-002 正式考试成绩、SLA、客户满意度、KA 资格等由对应系统/业务确认后传入。
2. **人工判断**：M-003 事件认定、贡献归因、验收、过错认定、差异化增授、特殊技术贡献、
   战略级项目方案等必须由主管/总经理/股东会确认；AI 仅提示。
3. **支付执行**：本系统输出应发金额与计算留痕；实际银行支付、个税申报由薪酬/财务流程执行。
4. **报告导出**：结算单/周期报告已支持中文 HTML；股权年度报告、饱和度报告可按
   Cap Table 数据扩展导出。
5. **版本治理**：制度参数变更通过既有政策版本/规则变更单流程；计算记录不原地覆盖。

## 十、验证

```bash
npm test -- packages/policy-dsl/src/__tests__/policy-institutions.test.ts
npm test -- apps/api/src/__tests__/policy-institutions-api.test.ts
npm run typecheck
npm run web:build
```
