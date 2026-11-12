# AI Scoring / Contribution Assessment V2 设计规范

## 1. 现状判断

`packages/ai-gate/src/scoring.ts` 的 `scoreEvidence()` 将 evidence quality 权重（VALID=1、UNVERIFIED=0.5、STALE=0.25、CONFLICTED/INVALID=0）相加，再除以 3 映射到 0–5 分；它衡量的是证据覆盖 proxy，不是员工贡献价值。`apps/api/src/app.ts:10218–10330` 会先检查模型 Evaluation Run 和 Provider Policy，但之后将请求体 evidence 传入 `scoreEvidence()`，并把结果保存为 `scores/overallScore`。因此 Model Evaluation Gate 与这次数字分数的实际生成算法不是一回事。

## 2. 必须区分的四层量

| 层 | 定义 | 输出 | 决策含义 |
|---|---|---|---|
| Evidence Coverage | 要求的证据是否有覆盖 | 覆盖率、缺口清单、角色/工作包分层 | 仅说明系统是否掌握信息 |
| Evidence Reliability | 来源与证据是否可信、及时、可验证 | provenance、freshness、corroboration、conflict、confidence band | 仅说明事实可信度 |
| Contribution Assessment | 某人对某业务结果做了哪些有意义的贡献 | 贡献事实、作用机制、支持/反证、不确定性、候选归因理由 | AI 草稿，需授权人裁决 |
| Performance Assessment | 在岗位/周期/rubric 下表现如何 | 各维度判断、标准引用、解释、适用性状态 | 独立评价流程，需实质人工决定 |

**严禁**将 evidence 数量、coverage、confidence、工时、消息量、任务数直接映射为 contribution 或 performance 分值。

## 3. 建议数据结构

### 3.1 EvidenceCoverageAssessment

- `subjectType/subjectId/cycleId`
- `requirementSetVersion`
- `requiredEvidenceCount` / `presentEvidenceCount`
- `coverageByRole` / `coverageByWorkPackageType` / `coverageBySource`
- `missingRequirements[]`
- `staleEvidenceRefs[]` / `conflictedEvidenceRefs[]`
- `computedAt` / `evidenceSnapshotHash`

### 3.2 EvidenceReliabilityAssessment

每个 evidence ref 单独评估：

- source identity 与 source authentication
- 原始记录 hash、抓取时间、业务发生时间
- 是否可独立复核/是否有多源佐证
- freshness / completeness / consistency
- 是否为本人自报、同伴证明、经理证明或被动业务系统事实
- counter-evidence refs 和 conflict code
- reliability band（不可当贡献分）

### 3.3 ContributionAssessmentDraft

- `personId`, `businessOutcomeRef`, `workPackageRefs`
- `contributionEvents[]`
- `claimRefs[]`, `evidenceRefs[]`, `counterEvidenceRefs[]`
- `contributionMechanism`（解决问题、产生收入、降低成本、降低风险、提高质量、协调交付等，可由租户配置）
- `impactNarrative`（不得虚构金额；财务事实引用独立 FinancialFact）
- `uncertainties[]`, `missingInformation[]`, `alternativeExplanations[]`
- `proposedAttributionRationale`（不默认输出百分比）
- `rubricVersion`, `model/provider/prompt/retrieval versions`
- `humanReviewStatus`；AI 不得写正式 `AttributionDecision`

### 3.4 PerformanceDimensionAssessment

字段包含 `dimensionCode`、`status`、`rubricAnchor`、`evidenceRefs`、`metricSnapshotRefs`、`assessmentNarrative`、`uncertainty`、`assessor`、`reviewedAt`。状态枚举：`ASSESSED / INSUFFICIENT_EVIDENCE / NOT_OBSERVED / NOT_APPLICABLE / DISPUTED / PENDING_REVIEW`。

## 4. 端到端评分流程

1. 服务端从周期和政策解析应评价维度及证据要求，不能信任前端传入的任意维度清单。
2. 获取冻结的 evidence/metric snapshots；AI 输入只拿到经权限过滤的最小字段。
3. 先运行确定性的 Coverage & Reliability Assessment。
4. 如果证据缺口阻断，则创建补证任务，不创建数字评分提案。
5. AI 对有足够证据的维度生成带引用草稿；每个 claim 都必须有 evidence refs。
6. 自动检查：引用存在、引用属于本租户/本周期/该主体可见范围、无 prompt injection 造成越权、无 unsupported claims。
7. Counter Evidence Agent 查找反证、冲突和替代解释。
8. 人类先独立完成分维度判断和理由，再揭示 AI 草稿。
9. 高风险/大幅改判/偏差触发第二独立复核。
10. 人工 Decision 写入 EvaluationDecision / AttributionDecision；AI Proposal 永不自动提升为 Decision。

## 5. 模型启用门槛

对每个角色/工作类型建立 Gold Set 与 holdout；至少双人独立标注；记录人-人一致性；评估 AI-human agreement，不允许把“超过人类一致率”当成唯一目标；同时检查系统性偏差、反事实稳定性、证据引用精确率、遗漏率、校准与不同证据覆盖组的误差。具体样本量由产品/法务/研究评审确定，不能用一个通用阈值掩盖小样本。

模型、prompt、检索版本和 rubric 任何变化均需评测、canary、rollback。未过 Gate 时 fallback 为证据整理，不得回退到 evidence-count numeric score。

## 6. 测试案例

- 空 evidence：状态 `INSUFFICIENT_EVIDENCE`，无数字分。
- 证据缺失但指标不适用：`NOT_APPLICABLE`，不扣分。
- 本周期没有观察机会：`NOT_OBSERVED`，转人工/等待补充。
- 两条低质量证据 vs 一条强业务结果证据：Coverage 与 Contribution 不得出现简单单调关系。
- 一条关键证据有反证：状态 `DISPUTED` 或增加不确定性，不得平均掉反证。
- 员工自报无系统佐证：保留自报来源，不自动降为无效，也不自动视为已证实。
- AI 引用不存在的 evidence id：阻断提案。
- AI 提及模型上下文外数据：阻断并记录。
- 名称/性别/地区替换、证据顺序/文本长度变化：无关属性变化不得显著改变判断。
- 主管覆写 AI：必须保留先独立判断、依据、幅度和理由。
