# 备份 / 恢复演练 — 121 迁移基线（2026-11-27）

- **结论：PASS（退出码 0）**
- **演练对象**：ANARI incentive，PostgreSQL 16，迁移基线 **001–121**
- **执行时间**：2026-11-27 20:31 EAT（2026-11-27T17:31Z）
- **执行人**：backup-drill（自动化演练，非生产操作）
- **脚本**：`scripts/backup-restore-drill.sh`
- **是否提交**：否（按要求只改工作树，不 commit）

本次演练在临时 Docker 容器里从零启动源库，应用 001–121 迁移、加载 seed、写入代表性业务数据，执行 `pg_dump` 逻辑备份，再恢复到**全新 database + 全新容器**，逐项校验迁移版本、schema/RLS/触发器、行数与数据指纹、GL 借贷平衡、JEV record、审计与账本哈希链。**所有检查通过，脚本退出码 0，容器与临时文件已清理。**

---

## 1. 演练范围

| 项目 | 内容 |
| --- | --- |
| 数据库镜像 | `postgres:16`（容器内 PostgreSQL 16.16，Debian） |
| 迁移基线 | 001–121；`schema_migrations` 恢复后 121/121，version + checksum 全部匹配仓库文件 |
| 种子数据 | `scripts/seed.ts`（`db/seed/001_demo.sql`、`002_metrics.sql`） |
| 代表性数据 | 财务事实（INVOICE/PAYMENT，POSTED）、GL 凭证与分录（2 张凭证 / 5 行）、JEV case/evidence/judgment/verification/record/link、奖励批次 + 明细 + 来源占用 + 2 条 PAID 支付回执、raw_source_records / raw_events、amount_ledger（应用同款哈希）、audit_events（触发器生成链）、121 的 FROZEN 指标快照 |
| 备份方式 | `pg_dump --format=plain --no-owner`（在线逻辑全量） |
| 恢复方式 | `psql --single-transaction` 重放到全新库 `anari_restore`（新容器，新 database） |
| 校验方式 | 源库/恢复库执行同一段指纹 SQL 后 diff；另做恢复库语义断言与 RLS 实际行为测试 |
| 环境 | Darwin arm64；Docker Engine 29.8.2；Node v22.22.3；tsx v4.23.15 |

> 说明：演练时工作树中除了 121 还存在并发新增的 `122_decision_subject_unique.sql`。为严格对应“121 迁移版本”，脚本默认 `DRILL_MAX_MIGRATION=121`，会显式排除 122 并在启动日志中提示；若发布基线包含 122，可设 `DRILL_MAX_MIGRATION=122` 复跑。

---

## 2. 实际执行命令

```bash
cd /Users/kerrychu/anari-incentive

# 本次验收使用的命令
bash scripts/backup-restore-drill.sh
# 退出码：0

# 等价的 npm script（已加入 package.json）
# npm run drill:backup-restore

# 排查时保留 dump / 日志（容器仍会清理）
# DRILL_KEEP_ARTIFACTS=1 bash scripts/backup-restore-drill.sh

# 若要把并发新增的 122 一并纳入演练
# DRILL_MAX_MIGRATION=122 bash scripts/backup-restore-drill.sh
```

脚本内部的关键命令（节选，均以临时容器/临时目录为边界）：

```bash
# 源库：临时容器 + 迁移 + seed
docker run -d --name anari-backup-drill-src ... -p 127.0.0.1::5432 postgres:16
DATABASE_URL="postgres://anari:anari@127.0.0.1:<port>/anari_incentive" \
  node_modules/.bin/tsx scripts/migrate.ts --until 121
DATABASE_URL="postgres://anari:anari@127.0.0.1:<port>/anari_incentive" \
  node_modules/.bin/tsx scripts/seed.ts

# 代表性数据：psql + 应用同款 hashLedgerEntry 生成 amount_ledger 链
docker exec -i anari-backup-drill-src psql -U anari -d anari_incentive -v ON_ERROR_STOP=1 < representative-data.sql
NODE_PATH="/Users/kerrychu/anari-incentive/node_modules" DATABASE_URL="..." node_modules/.bin/tsx seed-ledger.ts

# 备份
docker exec anari-backup-drill-src pg_dump -U anari -d anari_incentive \
  --no-owner --format=plain > dump.sql

# 恢复：全新容器 + 全新 database + 先建 cluster-level 角色
docker exec anari-backup-drill-dst psql -U anari -d postgres \
  -c "CREATE ROLE anari_app LOGIN PASSWORD 'anari_app' NOBYPASSRLS"
docker exec anari-backup-drill-dst psql -U anari -d postgres \
  -c "CREATE DATABASE anari_restore OWNER anari"
docker exec -i anari-backup-drill-dst psql -U anari -d anari_restore \
  -q -v ON_ERROR_STOP=1 --single-transaction < dump.sql
```

---

## 3. 实际输出（2026-11-27 复跑，未删改）

```text

== ANARI backup/restore drill — baseline 001–121 ==
workspace:        /Users/kerrychu/anari-incentive
postgres image:   postgres:16
source container: anari-backup-drill-src
restore container:anari-backup-drill-dst
started:          2026-11-27T17:31:21Z
migration files:  121 (baseline through 121; latest 121_metric_snapshot_consumption)
note: working tree also contains 1 migration(s) after 121; excluded by DRILL_MAX_MIGRATION

== 1/8 start source postgres:16 ==
source ready on 127.0.0.1:32779 (anari_incentive)
source version: PostgreSQL 16.16 (Debian 16.16-1.pgdg13+1) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit

== 2/8 apply migrations 001–121 ==
[PASS] migrations applied: 121/121 (latest: 121_metric_snapshot_consumption)
       migration time: 1.774s

== 3/8 seed reference data ==
seed: seed complete
[PASS] reference seed loaded (tenants/people/policies/metrics)
       seed time: 0.251s

== 4/8 insert representative data ==
       financial_facts: 2 row(s)
       gl_journals: 2 row(s)
       gl_journal_lines: 5 row(s)
       incentive_award_batches: 1 row(s)
       incentive_award_payments: 2 row(s)
       decision_cases: 1 row(s)
       decision_records: 1 row(s)
       raw_source_records: 1 row(s)
       amount_ledger: 2 row(s)
       audit_events: 3 row(s)
       metric_measurement_snapshots: 1 row(s)
[PASS] representative data inserted (financial facts / GL / JEV / award + payments / raw ledger / audit)
       data time: 0.475s

== 5/8 pg_dump logical backup ==
[PASS] pg_dump complete: 570661 bytes, sha256 f6c27ff0732146ebd39337fdbd4a00aad65b1ba0d477148adf1f5caeb399bc8c
       dump time: 0.232s
       dump file: /var/folders/km/zh7vk5mn10qg9wytn_l2pxsc0000gn/T//anari-backup-drill.Xi59rS/dump.sql

== 6/8 restore into fresh postgres:16 ==
restore target ready on 127.0.0.1:32780
[PASS] fresh database anari_restore created; application role anari_app (NOBYPASSRLS) created
[PASS] dump replayed into fresh database: 121/121 migrations
       restore time: 1.536s

== 7/8 verify backup / restore ==
[PASS] migration manifest: 121 version+checksum rows match repository files
[PASS] source/restore fingerprints identical (76 keys: schema objects, rows, hashes, balances)
[PASS] audit_chain_ok
[PASS] audit_sequence_ok
[PASS] amount_ledger_links
[PASS] gl_balanced
[PASS] award_payments_match_lines
[PASS] jev_record_link
[PASS] jev_final_judgment_ok
[PASS] jev_evidence_hash
[PASS] jev_verification_binding
[PASS] schema objects restored: 148 tables, 144 RLS policies, 144 FORCE-RLS tables, 29 triggers
[PASS] row counts compared across 23 representative tables
[PASS] GL trial balance: debit=3060.000000 credit=3060.000000
[PASS] JEV records restored: 1 case(s), 1 record(s)
[PASS] audit hash chain: 3 event(s) verified (sequence + prev_hash + event_hash)
[PASS] amount_ledger hash chain recomputed on restored data: amount_ledger chain OK: 2 entries
       ledger rows: 2
[PASS] RLS enforced after restore: tenant sees 2 GL journal(s), foreign tenant sees 0; anari_app BYPASSRLS=false

== 8/8 summary ==
dump:               0.232s
restore:            1.536s
verification:       1.290s
dump → restored DB queryable: 1.768s
total drill:        16.097s
RPO:                point-in-time of the logical dump (no WAL archive in this drill)
RTO (this dataset): 1.768s backup→queryable, excluding offsite copy and production data volume

RESULT: PASS — 121 migrated, dumped, restored and verified.
Evidence: 23 representative tables compared, 144 RLS policies, 29 triggers, GL debit=3060.000000 credit=3060.000000.
```

---

## 4. 校验项与证据

| 要求 | 实际校验 | 结果 / 证据 |
| --- | --- | --- |
| 迁移版本 | 恢复库 `schema_migrations` 与 `db/migrations/*.sql` 逐条比对 version + sha256 checksum | 121/121 匹配；最新 `121_metric_snapshot_consumption` |
| schema | 源库/恢复库 76 项指纹 diff 为空：列、默认值、索引、触发器定义、策略、约束身份、序列值 | `source/restore fingerprints identical (76 keys)` |
| RLS 策略数 | `pg_policies` 计数 + 每表 `relrowsecurity/relforcerowsecurity` | 144 条策略；144 张表 FORCE RLS；148 张表总计 |
| 触发器 | 非内部触发器计数 + `pg_get_triggerdef` 指纹 + 数据约束行为 | 29 个触发器，恢复前后一致 |
| GL 借贷平衡 | 凭证头 `total_debit = total_credit`、分录合计 = 凭证明细合计、全表借贷合计 | debit = credit = **3060.000000**（发票 1060 + 奖励支付 2000） |
| JEV record | case→record 一一对应；record 的 final_judgment 属于同一 case；evidence content 重算 hash；verification 绑定完整且与 record 证据承诺一致 | 1 case / 1 record；4 项 JEV 断言全 PASS |
| hash 链 | audit_events 逐条重算 `event_hash` + `prev_hash` + 连续 sequence；amount_ledger 用 `@anari/ledger.hashLedgerEntry` 重算每条 `entry_hash` 并核对 `prev_hash` | audit 3 条、ledger 2 条全部通过 |
| 行数 | 23 张代表性表 count + 整表 `to_jsonb` 全行 SHA-256 指纹，源库/恢复库 diff | 23/23 一致（含 tenants/people/policies/financial_facts/GL/奖励/JEV/raw/ledger/audit/指标快照） |
| 恢复后 RLS 行为 | 以 `anari_app`（NOBYPASSRLS）连接：本租户可见 2 张 GL 凭证，切换其他 tenant 可见 0 行 | 通过；`rolbypassrls = false` |
| 失败处理 | 任一检查失败累加 failure 并以非零退出；命令失败由 ERR trap 打印步骤与日志尾并退出 | 脚本 exit 0（PASS） |
| 清理 | EXIT trap 删除两个容器；默认删除临时目录 | 已确认无残留容器/临时目录 |

代表性数据量（恢复前后一致）：

```text
financial_facts 2, gl_journals 2, gl_journal_lines 5,
incentive_award_batches 1, incentive_award_lines 2,
incentive_award_source_reservations 2, incentive_award_payments 2,
decision_cases 1, decision_evidence 1, decision_judgments 2,
decision_verifications 1, decision_records 1, decision_case_links 1,
raw_source_records 1, raw_events 1, amount_ledger 2, audit_events 3,
metric_measurement_snapshots 1, calculation_runs 1
```

---

## 5. RPO / RTO 口径

### RPO（恢复点目标）

- 本次使用 **逻辑全量 `pg_dump`**。PostgreSQL 在 dump 开始时取一致性快照，**恢复点 = dump 开始时刻**；dump 开始之后提交的数据不在备份内。
- 演练中写完代表性数据后即开始 dump、无并发写入，因此对该数据集而言“备份内数据无丢失”；**这不等于生产 RPO=0**。
- 本演练**没有启用 WAL 归档，也没有 `pg_basebackup` / PITR 证据**。因此：
  - 只有每日逻辑全量时，生产最坏 RPO ≈ 备份间隔（例如 24 小时）；
  - 若未来配置连续 WAL 归档 + 基备，RPO 可到秒/分钟级，但**必须用归档链路实测证明**，不能引用本演练声称 RPO=0。
- 结论：**本演练只能证明“dump 时刻的数据可完整恢复”，不能证明 RPO=0。**

### RTO（恢复时间目标）

本次实测（数据量约 570 KB，单机 Docker，本机 SSD）。总时长包含容器启动/迁移等波动；核心 RTO 口径是 dump→恢复库可查询：

| 阶段 | 实测 |
| --- | --- |
| `pg_dump` | 0.232 s |
| 恢复到全新库（含建库/角色、单事务重放） | 1.536 s |
| **dump → 恢复库可查询（RTO 观察值）** | **1.768 s** |
| 恢复后全部校验 | 1.290 s |
| 整个演练（建库+迁移+seed+数据+dump+恢复+校验） | 16.097 s |

同日验收复跑（2026-11-27 20:32 EAT）实测：dump 0.172 s、restore 1.052 s、dump→queryable **1.224 s**，结果同为 PASS。容器启动、镜像缓存与主机负载会带来秒级波动，上表保留一次完整的原始输出。

该 1.768 s **不能当作生产 RTO 承诺**，未覆盖：异地/对象存储传输、镜像拉取、容器调度、凭据/DNS 切换、生产数据量导致的索引与 COPY 时间、应用连接池预热、人工决策与回滚窗口。生产 RTO 需用生产规模副本单独演练。

---

## 6. 已知限制 / 本次未覆盖

1. **仅逻辑备份**：未测试 WAL 归档、PITR、崩溃恢复、磁盘损坏、误删单表等场景；不能替代物理备份/HA 演练。
2. **角色不在 dump 内**：`pg_dump` 不导出 cluster 级角色。恢复前必须先创建 `anari_app`（本脚本已自动做），否则 dump 中的 `GRANT` 会失败。生产恢复需同时管理角色、密码、membership 与默认权限。
3. **owner 映射**：使用 `--no-owner`，恢复对象归执行恢复的 `anari`；若生产要求特定 owner/表空间，需要额外的映射步骤（本次未覆盖表空间）。
4. **扩展依赖**：目标集群必须能创建 `pgcrypto`、`citext`、`btree_gist`；跨大版本或缺少 contrib 会失败（本次同版本 16）。
5. **约束指纹是结构级**：`pg_dump` 会重新 deparse CHECK 表达式，括号/隐式 CAST 表示可能不同（例如 `funcformat 2 → 1`），因此指纹比对约束身份、列、引用表、可延迟性与 `convalidated`，不比对表达式文本。表达式语义由迁移 checksum 与数据不变量断言覆盖，但不是对所有 CHECK 的穷举证明。
6. **RLS 行为测试覆盖有限**：实际连接测试只针对 `gl_journals`（本租户 2 行 / 外租户 0 行）；策略数量与定义指纹覆盖全部 144 张表，但没有逐表做正负向注入。
7. **哈希链范围**：`audit_events` 用 SQL 原式重算；`amount_ledger` 用仓库 `@anari/ledger` 的应用哈希重算（依赖 `node_modules` 与当前代码版本）。若应用哈希算法变更，演练会失败——这是期望行为，但说明它不是独立于代码的校验器。
8. **审计哈希的时区敏感性**：`event_hash` 覆盖 `occurred_at::text`，重算必须与写入会话相同的 `TimeZone`/DateStyle。本演练统一 UTC；生产若使用其他时区，校验端必须固定同一时区，否则会出现“链看起来断了”的假警报。
9. **规模不代表生产**：约 570 KB、单租户、无并发；RTO 数字不能线性外推到生产。大表、索引重建、TOAST、锁等待都未覆盖。
10. **备份介质安全**：dump 落在本机临时目录（默认演练后删除），未测试加密、异地复制、保留策略、WORM/不可变存储、访问审计；dump 内含业务数据，生产需按数据分级保护。
11. **121 基线固定**：工作树并发出现 122 时默认排除（`DRILL_MAX_MIGRATION=121`）。若 122 进入发布，必须用 `DRILL_MAX_MIGRATION=122` 重跑，否则演练不覆盖该迁移。
12. **未覆盖应用层恢复**：只验证数据库可查询与约束/RLS，不启动 API/worker 做端到端读写、队列重放、outbox 消费或缓存失效。

---

## 7. 复跑与故障排查

```bash
# 标准复跑
bash scripts/backup-restore-drill.sh

# 保留证据（dump.sql、fingerprint、日志）
DRILL_KEEP_ARTIFACTS=1 bash scripts/backup-restore-drill.sh

# 端口冲突时脚本已使用 127.0.0.1::5432 的随机映射，无需手工指定端口
# 容器固定名：anari-backup-drill-src / anari-backup-drill-dst；
# 脚本启动时会先删除同名残留容器。
```

常见失败点：

- 镜像未就绪/拉取失败 → 先 `docker pull postgres:16`；
- 迁移 checksum 不匹配 → 历史迁移被改写，先修工作树，不要改演练期望；
- 恢复阶段 `GRANT` 报角色不存在 → 检查恢复前 `CREATE ROLE anari_app` 步骤；
- 指纹 diff 出现 `digest.constraints` 之外的大量差异 → 先用 `DRILL_KEEP_ARTIFACTS=1` 保留 `*.fingerprint` 与 `dump.sql` 定位。

---

## 8. 交付边界

本次只新增/修改以下文件，未改业务、迁移、前端，未 commit：

- `scripts/backup-restore-drill.sh`（新建）
- `docs/runbooks/backup-restore-drill-2026-11-27.md`（本文件）
- `package.json`（本次仅新增 `drill:backup-restore` script）

> 工作树中 `package.json` 另有一条并发任务新增的 `audit` script，不属于本次改动；另有其他并发任务对业务/前端/迁移 122 的改动，也不属于本次演练交付。
