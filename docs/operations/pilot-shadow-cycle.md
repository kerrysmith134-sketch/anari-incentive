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
- 幂等：同一 `order_id` 重复导入只会跳过（标题「试点订单 <order_id>」已存在）。
- 导入只创建**工作包**（含成员/角色）；申报、补证、归属、评价、影子计算、
  确认都在 UI 里由人完成。

```bash
DATABASE_URL=postgres://... npm run pilot:import -- --orders fixtures/orders-anonymized/orders.example.csv
# created=N skipped=M
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
| 财务差异 | 财务事实（payload.cycleId 优先，否则期间重叠；排除 INVALID/MISSING）− 每周期最新 FORMAL APPROVED/LOCKED 运行毛利；1e6 微单位整数运算 | = 0 |
| 证据覆盖 | 周期窗口内申报中「有 evidenceRefs 或该工作包有证据节点」的比例，按责任角色分层（角色样本 <3 标 N/A） | ≥ 70%（分层） |
| 员工补证 | 申报 `submittedAt` → 同工作包首份证据 `createdAt` 的中位分钟数 | ≤ 30 min |
| 经理复核 | 草案 `createdAt` → 独立决定 `createdAt` 的中位分钟数（含等待，口径保守） | ≤ 2 h |
| 争议率 | 窗口内 `DISPUTED` 申报 / 申报总数 | < 10% |

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
