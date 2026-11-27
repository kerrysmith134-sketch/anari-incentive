# 试点影子周期运行手册（NPV2-009 / AUD-022）

P0 正式结算的 GO 门禁：先用 5–10 个**匿名真实订单**跑一轮影子周期，
五项业务验收全过才可进入正式结算审批。

本文档描述**工具链操作**；业务数据（匿名订单）由业务方提供，工具不生成
"真实"数据。

## 1. 导入匿名订单

CSV 列（UTF-8，可带 BOM）：

```csv
order_id,title,objective,owner_employee_code,participants,gross_profit,currency,period_start,period_end
SO-2026-001,储能柜海外订单 A,华东销售+产品中心联合交付,E001,E001:OWNER|E002:CONTRIBUTOR|E003:CONTRIBUTOR,128000.50,CNY,2026-10-01,2026-10-31
```

- `participants`：`员工编号:责任角色`，`|` 分隔；编号必须已在目录中
  （否则报错 `unknown employee code ... sync the directory first`）。
- `owner_employee_code` 必须作为唯一的 `OWNER` 成员；若参与人清单未列出负责人，
  导入器会补入负责人。重复订单号、重复成员、字段数错误、非法币种/金额/日期都会
  在写库前被拒绝。
- 文件支持 UTF-8 BOM。导入器先解析和验证整份 CSV，再核对人员目录、已存在工作包
  和 `PILOT_IMPORT/GROSS_PROFIT` 财务事实；不会因为某一行后续失败而先写入前面
  的有效行。
- 幂等恢复：相同订单的工作包与财务事实均存在且金额/币种/期间一致时跳过；若只存在
  一侧，仅补齐缺失的一侧。若已有财务事实与 CSV 的金额/币种/期间不同，则 fail-closed，
  不调用会追加财务修订记录的 upsert；应交由财务走受控更正/修订流程。
- 同一租户的导入进程使用 PostgreSQL advisory lock 串行化，避免两个导入命令并发
  创建同一批工作包。锁只约束此导入工具，不替代业务 API 的全局唯一约束。
- 导入命令必须指定 `--cycle <cycleId>`，且该周期必须存在。创建的毛利事实带有
  `payload.cycleId` 和强类型 `orderId`，确保不会仅凭期间重叠把同一月份其他订单
  混进该试点周期。
- 导入创建的财务事实是 `recognitionStatus=DRAFT`。按照 ERP 财务事实契约，
  **DRAFT 不得参加正式激励计算或财务对账**；财务必须通过授权的 ERP/财务流程，
  将真实来源事实确认为 `POSTED` 后，才可能通过财务差异门禁。导入 CSV 只用于建立
  可追溯的待核对候选记录，不代表会计确认。
- 导入只创建**工作包**和 DRAFT 试点毛利事实；申报、补证、归属、评价、影子计算、
  确认都在 UI 里由人完成。

先 dry-run（需要数据库读取权限，但不写数据）：

```bash
DATABASE_URL=postgres://... npm run pilot:import -- --cycle <cycleId> --orders fixtures/orders-anonymized/orders.example.csv --dry-run
```

实际导入：

```bash
DATABASE_URL=postgres://... npm run pilot:import -- --cycle <cycleId> --orders fixtures/orders-anonymized/orders.example.csv
# workPackagesCreated=N financialFactsCreated=M skippedComplete=K
```

## 2. 人工完成影子周期

按现有角色工作流（员工 / 主管 / 财务）：

1. 员工：提交贡献申报、补交证据（工作台行内动作）；
2. 主管：归属决定（裁决人 ≠ 申报人）、独立评价、揭示 AI 草稿；
3. 财务：录入财务事实、跑 SHADOW/FORMAL 计算（影子期用 SHADOW，验收需一个
   FORMAL APPROVED/LOCKED 运行作对账基准）、录入员工确认、审批运行。

## 3. 机械验收

```bash
DATABASE_URL=postgres://... npm run pilot:report -- --cycle <cycleId> [--json]
```

输出五项对照审计阈值（任一 FAIL → exit 1）：

| 指标 | 口径 | 阈值 |
|---|---|---|
| 财务差异 | 本周期明确标注 `payload.cycleId` 的财务事实（排除 INVALID/MISSING 与 DRAFT）− 每周期最新 FORMAL APPROVED/LOCKED 运行毛利；1e6 微单位整数运算 | = 0 |
| 证据覆盖 | 周期窗口内申报中「有 evidenceRefs 或该工作包有证据节点」的比例，按责任角色分层（角色样本 <3 标 N/A） | ≥ 70%（分层） |
| 员工补证 | 申报 `submittedAt` → 同工作包首份证据 `createdAt` 的中位分钟数 | ≤ 30 min |
| 经理复核 | 草案 `createdAt` → 独立决定 `createdAt` 的中位分钟数（含等待，口径保守） | ≤ 2 h |
| 争议率 | 窗口内 `DISPUTED` 申报 / 申报总数 | < 10% |

试点 CLI 只把 `payload.cycleId` 精确等于目标周期的财务事实送入指标计算；
不会用“期间重叠”兜底纳入同月其它订单。缺少周期归属的事实不会参与本次报告。
申报按 `createdAt` 落在周期窗口 `[startsAt, endsAt]` 内计数（申报本身不带
cycleId）。

## 4. 影子结算对账（逐人金额）

person 级金额对账走既有脚本：

```bash
npm run shadow:settle -- --engine <engine.json> --finance <finance.csv> [--tolerance 0]
```

非零 exit = 存在逐人/币种差异或缺失，需财务确认后才能 GO。

## 5. GO 判定

- `pilot:report` 结论 PASS；
- `shadow:settle` exit 0（财务差异=0）；
- 争议率超标时需有经批准的整改决议（记录到任务/审计）。

三项齐备后按 `docs/v2/PRD_V4.2_DECISIONS.md` D-07 走正式结算 GO 审批。
