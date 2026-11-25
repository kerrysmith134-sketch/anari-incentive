# P0 资金安全整改（2026-11-26）

依据实际系统行为修复，不再用政策文档参数判断对错。

## 年度利润分享
- 改为最小货币单位向下取整 + 最大余数法（Hamilton）。
- 0.50 元 / 100 人等权：50 人 0.01，50 人 0，总额 0.50，无负数。
- 重复人员直接拒绝；负数 reservedBudgetBalance 视为未设置；工资/系数/出勤为负拒绝。

## 技术中心池
- 不再逐人 HALF_UP 后直接发；改为按币种最小单位向下取整 + 最大余数。
- 分配总额必须 ≤ 池；JPY 0 位、KWD 3 位由 `currencyMinorUnits` 决定。
- 超额即抛 `TECH_CENTER_POOL_OVER_ALLOCATED`。

## 悬赏/技术奖励
- 悬赏金额改用 `currencyMinorUnits`，JPY 不再输出小数。
- `personalContributionShare`、`personalShare` 限定 0–1，越界拒绝。
- 技术交付负延期比例不再增加奖金（clamp 0–1）。

## 海外销售
- `NEW_CUSTOMER_STAR` 必须有已核实的 `qualifiedNewCustomerCount`；不再回退普通客户数。
- `KA_BREAKTHROUGH` 必须显式 `kaQualified: true`；缺省视为未确认。
- `badDebtLoss` 负数按 0 处理。

## 奖励批次
- 新增迁移 116 `incentive_award_source_reservations`，以 `(tenant_id, source_record_id)` 主键原子占用。
- PG 创建批次在事务内先插入占用；冲突即拒绝，关闭“先查后插”并发窗口。
- 现有 `/api/v1/incentive-award-batches` 生命周期路由保留。

## 验证
- 新增 11 个 P0 金额测试（年度/技术池/悬赏/技术奖励/海外资格）。
- 全量 1660 passed / 111 skipped。
- PG 124 passed；升级 89 → 116 / 110 passed。
