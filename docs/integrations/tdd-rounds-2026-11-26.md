# Local Provider TDD Rounds（2026-11-26）

执行 37 个 TDD 场景，覆盖：

- Commercial：账户/报价/订单派生父链、缺 customer_name 回退、缺 quotation 跳过、行金额不一致跳过、确定性 ID。
- Ticketing：默认项目桶、closed+resolved→DONE、closed 无 resolved→CANCELLED、未知 type 跳过、非 UUID assignee 省略。
- PingCode：page_index、completed→DONE、未知 type 跳过、秒级时间戳转 ISO。
- ERP：AP 原币金额、AR 订单引用、POSTED 开关。
- Finance：API key 前缀、voucher periodStart。
- HR：人员幂等导入映射、缺 display_name 跳过、法人只读。
- CRM：Won 映射、未知 stage 省略、company 映射、contacts 只读。
- 注册表：7 个 provider 齐全。

红→绿修复：`firstText` 返回 `""` 时 `??` 不回退，导致报价/订单缺 `customer_name` 被误判为空而整条丢弃；改为 `||` 回退到 `Customer <id>`。

结果：37/37 通过；连续 5 轮重复运行均通过；全量 `npm test` 1649 passed / 111 skipped。
