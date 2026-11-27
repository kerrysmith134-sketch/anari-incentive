# 2026-11-27 匿名影子 E2E 跑在真实 PostgreSQL 上

## 结论

**PASS**。同一套 14 步影子链路在 `PgStore` + `PgPlatformStore` + `buildApp`
上执行，390/390 条业务断言通过；新增的 PG 专属断言（唯一约束、事务回滚、
FORCE RLS、GL 平衡、金额守恒、ACK 后再支付 409）7/7 通过。

```text
shadow-e2e --pg isolated tenant <random-uuid> (shadow-e2e-xxxxxxxx)
[PASS] 01.fixtures          load anonymized fixtures (23 checks)
[PASS] 02.setup             seed tenant / persons and build app (3 checks)
[PASS] 03.contracts         import employment contracts across 2 legal entities (12 checks)
[PASS] 04.commercial-order  import Commercial account→quote→contract→order (22 checks)
[PASS] 05.work-items        import 2 PingCode work items (idempotent replay) (13 checks)
[PASS] 06.attribution       accepted work packages + claims + attribution decisions (30 checks)
[PASS] 07.policy            publish policy + legal gate + evaluation cycle (8 checks)
[PASS] 08.performance       locked goal cards + FROZEN snapshots + score-from-facts FORMAL (74 checks)
[PASS] 09.jev               JEV case human judgment → verify → decide → link (19 checks)
[PASS] 10.calculation       policy-DSL FORMAL calculation → ledger → confirmations → lock (40 checks)
[PASS] 11.award-batches     incentive award batches (CNY / USD) → approve → lock → export (41 checks)
[PASS] 12.payments-gl       line-level payments → reconciliation → balanced GL journals (53 checks)
[PASS] 13.ack               bank ACK → reconciliation closed → ACK cannot be re-paid (21 checks)
[PASS] 14.invariants        traceability + amount conservation + no duplicates + GL balance (31 checks)
checks: 390/390 passed; steps: 14
RESULT: PASS
```

```text
 ✓ apps/api/src/__tests__/shadow-e2e-pg.test.ts (7 tests)
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

---

## 1. 范围与变更边界

只动/新增了任务允许的文件：

| 类型 | 路径 |
| --- | --- |
| 新增 PG 测试 | `apps/api/src/__tests__/shadow-e2e-pg.test.ts` |
| 修改 PG 入口 | `scripts/shadow-e2e.ts`（新增 `--pg`、`bootstrapShadowPgTenant`、可选 `pg` 选项） |
| 新增审计文档 | `docs/audit/2026-11-27-shadow-e2e-pg.md` |
| 修改 `package.json` | 仅新增 `"shadow:e2e:pg"` 与 `"test:pg-shadow"` 两条 script |
| 修改 `scripts/test-pg.sh` | 仅在 vitest 文件列表末尾追加新测试（不改原有顺序） |

未修改业务代码、迁移、前端；未 commit；未改 lockfile；未新增迁移。

## 2. 运行方式

### 2.1 无 DB 时跳过

测试顶部使用与 `pg-store.test.ts` / `store-contract.test.ts` 相同的门控：

```ts
const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;
```

没有 `DATABASE_URL` 时整个 suite skip，**不启动 Docker**。

### 2.2 已有 PostgreSQL（推荐用 `test-pg.sh` 建好的库）

```bash
DATABASE_URL=postgres://anari_app:anari_app@localhost:PORT/anari_incentive \
  npx vitest run apps/api/src/__tests__/shadow-e2e-pg.test.ts
# 等价：
DATABASE_URL=... npm run test:pg-shadow
```

`DATABASE_URL` 应指向 `anari_app`（NOBYPASSRLS）角色；RLS 负向断言会显式
检查当前角色不是 superuser / BYPASSRLS，否则测试以明确错误失败。若传入
owner URL（`anari:anari`），测试会自动改写为 `anari_app:anari_app` 连接做
RLS 检查。

### 2.3 只跑脚本（不经过 vitest）

```bash
DATABASE_URL=postgres://anari_app:anari_app@localhost:PORT/anari_incentive \
  npx tsx scripts/shadow-e2e.ts --pg
# 等价：
DATABASE_URL=... npm run shadow:e2e:pg
```

`--pg` 会先调用 `bootstrapShadowPgTenant` 创建一次性随机租户，再执行 14 步。
`--json` 仍可用。

### 2.4 全量 PG 回归

```bash
CI=1 ./scripts/test-pg.sh
```

`scripts/test-pg.sh` 的 vitest 文件列表现已追加
`apps/api/src/__tests__/shadow-e2e-pg.test.ts`（保留原有三个文件的顺序，新测试
排在最后），因此一次 `test-pg.sh` 会建库、迁移、seed、检查 RLS 质量，再跑
`pg-store` / `store-contract` / `integration-pg-contract` / `shadow-e2e-pg`
四个文件。

## 3. 租户隔离模型（不污染 seed）

PG 的 `people.id`、`rubrics.id`、`policy_versions.id` 都是**全局主键**，不能
像 Memory 一样在每次运行里复用 fixture 的固定 UUID。`bootstrapShadowPgTenant`
的做法：

1. `PgPlatformStore.createTenant` 创建随机租户（slug `shadow-e2e-<8hex>`），
   设置 `{modules:["PAYROLL"], settlementGo:true}`；
2. 为 3 名 fixture 员工**每次新生成** person UUID，写入该租户；
3. 为 fixture rubric 生成新的 rubric UUID（`RUBRIC_VERSION_ID` 只是 fixture
   里的逻辑键）；
4. 为 fixture policy version 生成新的 UUID（`POLICY_VERSION_ID` 同理）；
5. 返回 `personIdMap`（fixture person id → 本次 person id），脚本在加载
   fixtures 后递归重写所有 person 引用（employees / commercial owner_id /
   expected participants / work item 引用），因此后续请求、JEV、计算、
   奖励、支付全部使用本次租户内的 ID。

每次运行都是不同的随机租户，重复运行互不冲突；演示租户
`00000000-0000-4000-8000-000000000001` 不被读写。测试在运行前后对演示租户的
`incentive_award_batches` 与 `people` 计数做对比，确认 seed 未被污染。

测试库由 `test-pg.sh` 每次新建并在退出时删除；直接对长期开发库运行时，随机
租户会保留（隔离、不覆盖），需要清理时按 `tenants.slug LIKE 'shadow-e2e-%'`
识别，最稳妥的方式是重建测试容器。

## 4. Memory vs PostgreSQL 差异

这些差异是本次在真实 PG 上跑通时逐项确认的，不是推测。

| # | 差异 | Memory 行为 | PG 行为 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | 主键作用域 | Store 进程内 Map，可复用 fixture UUID | `people.id` / `rubrics.id` / `policy_versions.id` 全局 PK | 每次随机租户 + 新 ID + `personIdMap` 重写 |
| 2 | 计算发起人 | 缺省即可 | `requested_by` 有 `(tenant_id, person_id)` FK；缺省回落到 demo 请求人 → 新租户里 404（FK 23503） | 请求显式带 `requestedBy = E001` |
| 3 | Commercial 订单返回映射 | `mapOrder` 返回 `sourceSystem` / `externalOrderId` | `mapOrder` 只返回 `orderNumber` 等，**不回显** source/external id | 脚本在 PG 下断言 `orderNumber`；PG 测试直接查 `commercial_orders.source_system/external_order_id`，确认落库 |
| 4 | 奖励批次读取行 | `lines` 随批次返回 | `getIncentiveAwardBatch` / `listIncentiveAwardBatches` 用裸 pool 读 `incentive_award_lines`，没有 `app.tenant_id` → FORCE RLS 过滤为 `[]`；创建路径在同一事务 client 上读，能返回行 | 脚本保留创建响应的 `lines` 继续支付；PG 测试直接查 `incentive_award_lines` 验证 3 行 |
| 5 | 案件唯一性（migration 122） | 新的 subject 幂等索引让 `score-from-facts` 自动建案与手工 JEV 建案合并 | 迁移 122 的 partial unique index 同样合并；旧 schema 则允许两个案件 | 脚本用 `context.flow === "PERFORMANCE_SCORE"` 判断是否复用：复用时期望 3 条证据，否则 2 条 |
| 6 | 租户隔离 | 无 RLS，靠单进程 | 表 `FORCE ROW LEVEL SECURITY`；无 `app.tenant_id` 时 0 行，跨租户写 42501 | PG 测试显式断言（见 5.3） |
| 7 | 唯一约束 | 内存 Map 去重 | 数据库 UNIQUE / 23505 | PG 测试显式插入重复 people / policy version / payment，断言 23505 |
| 8 | 事务 | 内存修改立即可见，无回滚 | `transactionFor` 用真实事务，异常 ROLLBACK | PG 测试断言失败请求不留下支付行/GL 凭证，并做一次“先写一行再违反唯一键 → ROLLBACK → 行不存在” |
| 9 | 金额文本 | 格式化字符串 | `numeric(20,6)` 经 `pg` 返回 `"5000.000000"` 这类文本 | 脚本用 `parseDecimal` 比较；测试用 `::text` 精确断言 |
| 10 | GL | 内存凭证对象 | `gl_journals` 有 `CHECK (total_debit = total_credit)`；`gl_journal_lines` 每行仅借或贷 | 测试直接查表并逐张凭证校验借贷相等 |

### 仍待业务代码修复的 PG 缺口（本次不改）

1. `apps/api/src/adapters/postgres/commercial.postgres.ts` 的 `mapOrder`
   没有映射 `sourceSystem` / `externalOrderId`，API 客户端拿不到来源追踪。
2. `loadIncentiveAwardBatch(this.pool, ...)` 在 `getIncentiveAwardBatch` /
   `listIncentiveAwardBatches` 中缺少租户上下文，RLS 下行明细为空。
   正确做法是走 `transactionFor(tenantId, ...)` 或在同一 client 上设置
   `app.tenant_id`。
3. `createCalculationRunInTx` 的 `requestedBy` 缺省回落到 `DEMO_REQUESTER_ID`，
   在多租户下会 FK 失败；缺省值应改为当前 actor 或直接必填。

以上缺口由脚本/测试做了**显式、可追溯的规避**，没有改业务代码；修复后脚本里
的 PG 分支可以删除，测试仍可作为回归。

## 5. 14 步与 PG 专属断言

### 5.1 链路

与 `scripts/shadow-e2e.ts` 完全相同的 14 步：fixtures → 劳动合同 → Commercial
订单 → PingCode 工作项 → 工作包/申报/归属 → 政策+法务门禁+周期 → 锁定目标卡+
FROZEN 快照+score-from-facts → JEV → policy-DSL FORMAL 计算+台账+确认+锁定 →
奖励批次（CNY/USD）→ 行级支付+GL → ACK → 全局不变量。

`runShadowE2E({ pg: { pool, tenantId, personIdMap, rubricVersionId,
policyVersionId } })` 内部仍然用 `buildApp` + `app.inject`，所以 Fastify 路由、
Zod、鉴权、状态机、policy-DSL 全部真实执行。

### 5.2 唯一约束（`shadow-e2e-pg.test.ts`）

- `people (tenant_id, employee_code)` 重复插入 → `23505`；
- `policy_versions (tenant_id, policy_code, version)` 重复插入 → `23505`；
- 支付回执 `(tenant_id, batch_id, line_id, payment_ref)` 重复插入 → `23505`，
  同时验证事务回滚。

### 5.3 FORCE RLS 跨租户

用 NOBYPASSRLS 的 `anari_app` 连接：

- 当前角色 `rolsuper/rolbypassrls` 必须为 false，否则测试明确失败；
- 在另一个租户的 `app.tenant_id` 下：只看得到本租户 1 人，查影子租户 0 行；
- 在另一个租户上下文里往影子租户 `people` 插入 → `42501`；
- 没有 `app.tenant_id` 时 `people` 返回 0 行；
- 影子租户上下文下 `people` 恰好 3 行，查其他租户 0 行。

### 5.4 事务回滚

- 业务层：同一请求提交两笔支付，第二笔金额不匹配 → `ConflictError`；
  随后 `incentive_award_payments` 中该批次 0 行，`gl_journals` 的 PAYMENT
  凭证数不变，批次仍为 `EXPORTED`（第一笔没有被提前提交）。
- 数据库层：先插入一笔合法支付，再插入同一 `(batch, line, payment_ref)`
  触发 23505，然后 `ROLLBACK`；两行都不存在。

### 5.5 GL 平衡与金额守恒（直接读表）

| 表 | 断言 |
| --- | --- |
| `amount_ledger` | 3 行、3 个不同 idempotency key、合计 USD 5,000 |
| `incentive_award_lines` | CNY 2 行 28,400；USD 1 行 1,000 |
| `incentive_award_batches` | CNY 28,400 / 2 行；USD 1,000 / 1 行；均 `ACKNOWLEDGED` |
| `incentive_award_payments` | CNY 2 笔 28,400；USD 1 笔 1,000 |
| `gl_journals` | 3 张：CNY 2 张 28,400、USD 1 张 1,000，每张 `total_debit = total_credit` |
| `gl_journal_lines` | 每张凭证借方合计 = 贷方合计 |
| 守恒 | 28,400 CNY ÷ 7.10 + 1,000 USD = 5,000 USD = 计算池 = 台账 |

### 5.6 ACK 后再支付 409

- 脚本第 13 步已断言：重复 ACK 409、ACK 后重新支付 409
  （`AWARD_BATCH_ALREADY_ACKNOWLEDGED`）、ACK 后重放原 paymentRef 409；
- 测试另外用 `buildApp` + `PgStore` 直接对已 ACK 的 CNY 批次再发一笔
  `PAID` 支付，断言 HTTP 409、响应包含 `AWARD_BATCH_ALREADY_ACKNOWLEDGED`；
- 数据库确认 `payment_ref = BANK-CN-REPAY-AFTER-ACK-TEST` 0 行，批次
  `status=ACKNOWLEDGED`、`acknowledged_at` 非空、`payment_ref` 为
  `BANK-ACK-CN-2026-11`。

## 6. 验收记录

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `DATABASE_URL=postgres://anari_app:anari_app@localhost:PORT/anari_incentive npx vitest run apps/api/src/__tests__/shadow-e2e-pg.test.ts` | 7/7 通过 |
| `DATABASE_URL=... npx tsx scripts/shadow-e2e.ts --pg` | 390/390 checks，14/14 steps，PASS |
| `CI=1 ./scripts/test-pg.sh` | 通过；4 个测试文件，124 + 7 = 131 tests 全绿（新测试实际执行） |

## 7. 复现步骤（手工起库）

```bash
docker run -d --name anari-shadow-pg \
  -e POSTGRES_USER=anari -e POSTGRES_PASSWORD=anari \
  -e POSTGRES_DB=anari_incentive -p 56500:5432 postgres:16-alpine

DATABASE_URL=postgres://anari:anari@localhost:56500/anari_incentive npm run db:migrate
DATABASE_URL=postgres://anari:anari@localhost:56500/anari_incentive npm run db:seed

DATABASE_URL=postgres://anari_app:anari_app@localhost:56500/anari_incentive \
  npx tsx scripts/shadow-e2e.ts --pg

DATABASE_URL=postgres://anari_app:anari_app@localhost:56500/anari_incentive \
  npx vitest run apps/api/src/__tests__/shadow-e2e-pg.test.ts
```

测试会创建 `shadow-e2e-<8hex>` 租户；重复执行每次新建一个，互不影响。
