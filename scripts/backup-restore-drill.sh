#!/usr/bin/env bash
# =============================================================================
# ANARI incentive — backup / restore drill (migration baseline 001–121)
#
# 演练内容（全临时容器，不触碰任何既有数据库）：
#   1. docker postgres:16 启动源库 → 应用 001–121 迁移 → seed；
#   2. 写入代表性业务数据：财务事实 / GL 凭证 / JEV case+record /
#      奖励批次+支付 / raw ledger（amount_ledger 用应用同款哈希函数生成）；
#   3. pg_dump 逻辑全量备份 → 恢复到全新库（新 database + 新容器）；
#   4. 校验：迁移版本与 checksum、schema/RLS/触发器/索引指纹、行数与数据指纹、
#      GL 借贷平衡、JEV record、audit hash chain、amount_ledger hash chain、
#      以及恢复库上的 RLS 实际隔离行为；
#   5. 输出 PASS/FAIL 与可复核证据；失败非零退出；退出时清理容器。
#
# 用法：
#   bash scripts/backup-restore-drill.sh
#   DRILL_KEEP_ARTIFACTS=1 bash scripts/backup-restore-drill.sh   # 保留 dump/日志
#
# 依赖：docker、node（仓库 node_modules 已安装）、python3（可选，用于毫秒计时）
# 说明：这是逻辑备份演练，不包含 WAL 归档；RPO/RTO 口径见
#       docs/runbooks/backup-restore-drill-2026-11-27.md。
# =============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC_CONTAINER="${SRC_CONTAINER:-anari-backup-drill-src}"
DST_CONTAINER="${DST_CONTAINER:-anari-backup-drill-dst}"
SRC_DB="${SRC_DB:-anari_incentive}"
DST_DB="${DST_DB:-anari_restore}"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
TENANT="00000000-0000-4000-8000-000000000001"
# Drill baseline pinned to the 121 migration release. Override to include later
# migrations that may exist in the working tree (e.g. 122).
MAX_MIGRATION="${DRILL_MAX_MIGRATION:-121}"
TSX="$ROOT/node_modules/.bin/tsx"
KEEP_ARTIFACTS="${DRILL_KEEP_ARTIFACTS:-0}"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/anari-backup-drill.XXXXXX")"
DUMP="$WORKDIR/dump.sql"
LOG="$WORKDIR/drill.log"
SRC_FP="$WORKDIR/source.fingerprint"
DST_FP="$WORKDIR/restore.fingerprint"
FAILURES=0
CURRENT_STEP="initialise"
DRILL_START_MS=0

# ---------------------------------------------------------------------------
# output helpers
# ---------------------------------------------------------------------------
section() {
  printf '\n== %s ==\n' "$*"
}
say() {
  printf '%s\n' "$*" | tee -a "$LOG"
}
pass() {
  printf '[PASS] %s\n' "$*" | tee -a "$LOG"
}
fail() {
  FAILURES=$((FAILURES + 1))
  printf '[FAIL] %s\n' "$*" | tee -a "$LOG" >&2
}
record() {
  printf '       %s\n' "$*" | tee -a "$LOG"
}
now_ms() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    printf '%s000\n' "$(date +%s)"
  fi
}
fmt_ms() {
  awk -v ms="$1" 'BEGIN { printf "%.3fs", ms / 1000 }'
}
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# ---------------------------------------------------------------------------
# failure / cleanup traps
# ---------------------------------------------------------------------------
on_error() {
  local code=$?
  printf '\n[FAIL] step "%s" failed at line %s (exit %s)\n' \
    "$CURRENT_STEP" "${BASH_LINENO[0]:-?}" "$code" | tee -a "$LOG" >&2
  if [ -f "$WORKDIR/migrate.log" ]; then
    printf '%s\n' '--- migrate.log (tail) ---' >&2
    tail -15 "$WORKDIR/migrate.log" >&2 || true
  fi
  if [ -f "$WORKDIR/restore.log" ]; then
    printf '%s\n' '--- restore.log (tail) ---' >&2
    tail -15 "$WORKDIR/restore.log" >&2 || true
  fi
  printf '\nRESULT: FAIL\n' | tee -a "$LOG" >&2
  exit "$code"
}
trap on_error ERR

cleanup() {
  local code=$?
  docker rm -f "$SRC_CONTAINER" "$DST_CONTAINER" >/dev/null 2>&1 || true
  if [ "$KEEP_ARTIFACTS" = "1" ]; then
    printf '\nArtifacts kept at %s\n' "$WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
  exit "$code"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# postgres container helpers
# ---------------------------------------------------------------------------
STARTED_PORT=""
start_pg() {
  local name="$1" db="$2" port=""
  docker rm -f "$name" >/dev/null 2>&1 || true
  if ! docker run -d --name "$name" \
    -e POSTGRES_USER=anari \
    -e POSTGRES_PASSWORD=anari \
    -e POSTGRES_DB="$db" \
    -p 127.0.0.1::5432 \
    "$PG_IMAGE" >/dev/null; then
    say "failed to start container $name with image $PG_IMAGE" >&2
    return 1
  fi
  if ! port="$(docker port "$name" 5432/tcp | head -1 | awk -F: '{print $NF}')"; then
    say "could not read mapped port for $name" >&2
    return 1
  fi
  if [ -z "$port" ]; then
    say "could not determine mapped port for $name" >&2
    return 1
  fi
  for _ in $(seq 1 90); do
    if docker exec "$name" psql -U anari -d "$db" -qAt -c 'select 1' \
      >/dev/null 2>&1; then
      STARTED_PORT="$port"
      return 0
    fi
    sleep 1
  done
  say "postgres container $name did not become ready within 90s" >&2
  return 1
}

src_psql() {
  docker exec -i "$SRC_CONTAINER" psql -U anari -d "$SRC_DB" -qAt "$@"
}
dst_psql() {
  docker exec -i "$DST_CONTAINER" psql -U anari -d "$DST_DB" -qAt "$@"
}

# ---------------------------------------------------------------------------
# fingerprint: schema + representative table data.
# 同一段 SQL 分别在源库/恢复库执行，diff 为空才算一致。
# ---------------------------------------------------------------------------
fingerprint_sql() {
  cat <<'SQL'
SET TIME ZONE 'UTC';
SET DateStyle = 'ISO, MDY';

-- migration ledger
SELECT 'migrations.count=' || count(*) FROM schema_migrations;
SELECT 'migrations.max=' || max(version) FROM schema_migrations;
SELECT 'migrations.digest=' || encode(digest(
  string_agg(version || ':' || checksum, ',' ORDER BY version), 'sha256'), 'hex')
  FROM schema_migrations;

-- schema objects
SELECT 'schema.tables=' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r';
SELECT 'schema.rls_forced=' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relrowsecurity AND c.relforcerowsecurity;
SELECT 'schema.rls_policies=' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT 'schema.triggers=' || count(*)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal;
SELECT 'schema.functions=' || count(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public';
SELECT 'schema.columns=' || count(*)
  FROM information_schema.columns WHERE table_schema = 'public';
SELECT 'schema.sequences=' || count(*) FROM pg_sequences WHERE schemaname = 'public';

SELECT 'digest.columns=' || encode(digest(string_agg(
  table_name || '.' || column_name || ':' || data_type || ':' || is_nullable ||
  ':' || COALESCE(column_default, ''), ',' ORDER BY table_name, column_name), 'sha256'), 'hex')
  FROM information_schema.columns WHERE table_schema = 'public';
SELECT 'digest.policies=' || encode(digest(string_agg(
  tablename || '.' || policyname || ':' || COALESCE(qual, '') || ':' ||
  COALESCE(with_check, ''), ',' ORDER BY tablename, policyname), 'sha256'), 'hex')
  FROM pg_policies WHERE schemaname = 'public';
SELECT 'digest.triggers=' || encode(digest(string_agg(
  c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid), E'\n' ORDER BY c.relname, t.tgname), 'sha256'), 'hex')
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal;
SELECT 'digest.indexes=' || encode(digest(string_agg(
  indexdef, E'\n' ORDER BY indexname), 'sha256'), 'hex')
  FROM pg_indexes WHERE schemaname = 'public';
-- CHECK expression text is re-deparsed by a dump/restore round-trip (extra
-- parentheses / implicit CAST format), so the fingerprint compares constraint
-- identity, columns, target table, deferrability and validation state instead.
SELECT 'digest.constraints=' || encode(digest(string_agg(
  conrelid::regclass::text || '.' || conname || ':' || contype::text || ':' ||
  condeferrable::text || ':' || condeferred::text || ':' || convalidated::text || ':' ||
  COALESCE(conkey::text, '') || ':' || COALESCE(confkey::text, '') || ':' ||
  COALESCE(NULLIF(confrelid, 0)::regclass::text, ''),
  E'\n' ORDER BY conrelid::regclass::text, conname), 'sha256'), 'hex')
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
SELECT 'digest.sequences=' || encode(digest(string_agg(
  sequencename || ':' || COALESCE(last_value::text, 'null'), ',' ORDER BY sequencename), 'sha256'), 'hex')
  FROM pg_sequences WHERE schemaname = 'public';

-- row counts (evidence) and full-row digests (equality) for representative tables
SELECT 'rows.tenants=' || count(*) FROM tenants;
SELECT 'data.tenants=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM tenants t;
SELECT 'rows.people=' || count(*) FROM people;
SELECT 'data.people=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM people t;
SELECT 'rows.policy_versions=' || count(*) FROM policy_versions;
SELECT 'data.policy_versions=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM policy_versions t;
SELECT 'rows.financial_facts=' || count(*) FROM financial_facts;
SELECT 'data.financial_facts=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM financial_facts t;
SELECT 'rows.gl_accounts=' || count(*) FROM gl_accounts;
SELECT 'data.gl_accounts=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM gl_accounts t;
SELECT 'rows.gl_journals=' || count(*) FROM gl_journals;
SELECT 'data.gl_journals=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM gl_journals t;
SELECT 'rows.gl_journal_lines=' || count(*) FROM gl_journal_lines;
SELECT 'data.gl_journal_lines=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM gl_journal_lines t;
SELECT 'rows.incentive_award_batches=' || count(*) FROM incentive_award_batches;
SELECT 'data.incentive_award_batches=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM incentive_award_batches t;
SELECT 'rows.incentive_award_lines=' || count(*) FROM incentive_award_lines;
SELECT 'data.incentive_award_lines=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM incentive_award_lines t;
SELECT 'rows.incentive_award_source_reservations=' || count(*) FROM incentive_award_source_reservations;
SELECT 'data.incentive_award_source_reservations=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY tenant_id, source_record_id), ''), 'sha256'), 'hex') FROM incentive_award_source_reservations t;
SELECT 'rows.incentive_award_payments=' || count(*) FROM incentive_award_payments;
SELECT 'data.incentive_award_payments=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM incentive_award_payments t;
SELECT 'rows.decision_cases=' || count(*) FROM decision_cases;
SELECT 'data.decision_cases=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_cases t;
SELECT 'rows.decision_evidence=' || count(*) FROM decision_evidence;
SELECT 'data.decision_evidence=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_evidence t;
SELECT 'rows.decision_judgments=' || count(*) FROM decision_judgments;
SELECT 'data.decision_judgments=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_judgments t;
SELECT 'rows.decision_verifications=' || count(*) FROM decision_verifications;
SELECT 'data.decision_verifications=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_verifications t;
SELECT 'rows.decision_records=' || count(*) FROM decision_records;
SELECT 'data.decision_records=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_records t;
SELECT 'rows.decision_case_links=' || count(*) FROM decision_case_links;
SELECT 'data.decision_case_links=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM decision_case_links t;
SELECT 'rows.raw_source_records=' || count(*) FROM raw_source_records;
SELECT 'data.raw_source_records=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM raw_source_records t;
SELECT 'rows.raw_events=' || count(*) FROM raw_events;
SELECT 'data.raw_events=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM raw_events t;
SELECT 'rows.amount_ledger=' || count(*) FROM amount_ledger;
SELECT 'data.amount_ledger=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM amount_ledger t;
SELECT 'rows.audit_events=' || count(*) FROM audit_events;
SELECT 'data.audit_events=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM audit_events t;
SELECT 'rows.metric_measurement_snapshots=' || count(*) FROM metric_measurement_snapshots;
SELECT 'data.metric_measurement_snapshots=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM metric_measurement_snapshots t;
SELECT 'rows.calculation_runs=' || count(*) FROM calculation_runs;
SELECT 'data.calculation_runs=' || encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex') FROM calculation_runs t;

-- money / governance invariants
SELECT 'money.financial_facts_total=' || COALESCE(sum(amount), 0)::text FROM financial_facts;
SELECT 'money.gl_journal_debit=' || COALESCE(sum(debit), 0)::text FROM gl_journal_lines;
SELECT 'money.gl_journal_credit=' || COALESCE(sum(credit), 0)::text FROM gl_journal_lines;
SELECT 'money.award_lines_total=' || COALESCE(sum(amount), 0)::text FROM incentive_award_lines;
SELECT 'money.award_paid_total=' || COALESCE(sum(amount), 0)::text FROM incentive_award_payments WHERE status = 'PAID';

SELECT 'check.audit_chain_ok=' || COALESCE((
  WITH ordered AS (
    SELECT sequence, prev_hash, event_hash,
           lag(event_hash) OVER (ORDER BY sequence) AS previous_hash,
           encode(digest(
             prev_hash || '|' || tenant_id::text || '|' || action || '|' ||
             COALESCE(object_type, '') || '|' || COALESCE(object_id::text, '') || '|' ||
             COALESCE(before_hash, '') || '|' || COALESCE(after_hash, '') || '|' ||
             COALESCE(correlation_id::text, '') || '|' || occurred_at::text,
             'sha256'), 'hex') AS recomputed
      FROM audit_events
     WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  )
  SELECT bool_and(prev_hash = COALESCE(previous_hash, 'GENESIS') AND event_hash = recomputed)
    FROM ordered), false);
SELECT 'check.audit_sequence_ok=' || (
  SELECT count(*) = max(sequence) AND min(sequence) = 1
    FROM audit_events
   WHERE tenant_id = '00000000-0000-4000-8000-000000000001');

SELECT 'check.amount_ledger_links=' || NOT EXISTS (
  SELECT 1 FROM (
    SELECT prev_hash, lag(entry_hash) OVER (ORDER BY ledger_seq) AS previous_hash
      FROM amount_ledger
     WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  ) chain
  WHERE prev_hash <> COALESCE(previous_hash, 'GENESIS'));

SELECT 'check.gl_balanced=' || (
  (SELECT COALESCE(sum(debit), 0) FROM gl_journal_lines WHERE tenant_id = '00000000-0000-4000-8000-000000000001')
    = (SELECT COALESCE(sum(credit), 0) FROM gl_journal_lines WHERE tenant_id = '00000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (
    SELECT 1 FROM gl_journals j
     WHERE j.tenant_id = '00000000-0000-4000-8000-000000000001'
       AND (j.total_debit <> j.total_credit
         OR j.total_debit <> COALESCE((SELECT sum(l.debit) FROM gl_journal_lines l
              WHERE l.tenant_id = j.tenant_id AND l.journal_id = j.id), 0)
         OR j.total_credit <> COALESCE((SELECT sum(l.credit) FROM gl_journal_lines l
              WHERE l.tenant_id = j.tenant_id AND l.journal_id = j.id), 0))));

SELECT 'check.award_payments_match_lines=' || (
  (SELECT COALESCE(sum(amount), 0) FROM incentive_award_payments
    WHERE tenant_id = '00000000-0000-4000-8000-000000000001' AND status = 'PAID')
  = (SELECT COALESCE(sum(amount), 0) FROM incentive_award_lines
      WHERE tenant_id = '00000000-0000-4000-8000-000000000001'));

SELECT 'check.jev_record_link=' || NOT EXISTS (
  SELECT 1 FROM decision_cases c
  LEFT JOIN decision_records r
    ON r.tenant_id = c.tenant_id AND r.case_id = c.id
  WHERE c.tenant_id = '00000000-0000-4000-8000-000000000001'
    AND c.status = 'DECIDED' AND r.id IS NULL);

SELECT 'check.jev_final_judgment_ok=' || NOT EXISTS (
  SELECT 1 FROM decision_records r
  LEFT JOIN decision_judgments j
    ON j.tenant_id = r.tenant_id AND j.id = r.final_judgment_id
   AND j.case_id = r.case_id
  WHERE r.tenant_id = '00000000-0000-4000-8000-000000000001'
    AND j.id IS NULL);

SELECT 'check.jev_evidence_hash=' || NOT EXISTS (
  SELECT 1 FROM decision_evidence e
  WHERE e.tenant_id = '00000000-0000-4000-8000-000000000001'
    AND e.content IS DISTINCT FROM NULL
    AND e.content_hash <> 'sha256:' || encode(digest(e.content, 'sha256'), 'hex'));

SELECT 'check.jev_verification_binding=' || NOT EXISTS (
  SELECT 1 FROM decision_records r
  JOIN decision_verifications v
    ON v.tenant_id = r.tenant_id AND v.case_id = r.case_id
  WHERE r.tenant_id = '00000000-0000-4000-8000-000000000001'
    AND (v.verified_case_version IS NULL
      OR v.evidence_hash IS NULL
      OR v.judgments_hash IS NULL
      OR v.evidence_hash <> r.evidence_hash));
SQL
}

# ---------------------------------------------------------------------------
# 1. preflight
# ---------------------------------------------------------------------------
DRILL_START_MS=$(now_ms)
section "ANARI backup/restore drill — baseline 001–121"
say "workspace:        $ROOT"
say "postgres image:   $PG_IMAGE"
say "source container: $SRC_CONTAINER"
say "restore container:$DST_CONTAINER"
say "started:          $(date -u +%Y-%m-%dT%H:%M:%SZ)"

CURRENT_STEP="preflight"
command -v docker >/dev/null 2>&1 || {
  say "docker is required" >&2
  exit 2
}
[ -x "$TSX" ] || {
  say "missing $TSX — run npm install first" >&2
  exit 2
}
EXPECTED_MIGRATIONS=0
EXPECTED_MAX=""
for file in db/migrations/*.sql; do
  version="$(basename "$file" | cut -d_ -f1)"
  if [ "$((10#$version))" -le "$((10#$MAX_MIGRATION))" ]; then
    EXPECTED_MIGRATIONS=$((EXPECTED_MIGRATIONS + 1))
    EXPECTED_MAX="$(basename "$file" .sql)"
  fi
done
if [ "$EXPECTED_MIGRATIONS" -eq 0 ]; then
  say "no migration files found in db/migrations" >&2
  exit 2
fi
say "migration files:  $EXPECTED_MIGRATIONS (baseline through ${MAX_MIGRATION}; latest ${EXPECTED_MAX})"
TOTAL_MIGRATION_FILES="$(find db/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
if [ "$TOTAL_MIGRATION_FILES" -ne "$EXPECTED_MIGRATIONS" ]; then
  say "note: working tree also contains $((TOTAL_MIGRATION_FILES - EXPECTED_MIGRATIONS)) migration(s) after ${MAX_MIGRATION}; excluded by DRILL_MAX_MIGRATION" >&2
fi

# ---------------------------------------------------------------------------
# 2. source database
# ---------------------------------------------------------------------------
CURRENT_STEP="start source postgres"
section "1/8 start source postgres:16"
start_pg "$SRC_CONTAINER" "$SRC_DB"
SRC_PORT="$STARTED_PORT"
SRC_URL="postgres://anari:anari@127.0.0.1:${SRC_PORT}/${SRC_DB}"
say "source ready on 127.0.0.1:${SRC_PORT} (${SRC_DB})"
say "source version: $(src_psql -c 'select version()')"

CURRENT_STEP="apply migrations"
section "2/8 apply migrations 001–121"
MIGRATE_START_MS=$(now_ms)
DATABASE_URL="$SRC_URL" "$TSX" scripts/migrate.ts --until "$MAX_MIGRATION" \
  > "$WORKDIR/migrate.log" 2>&1
MIGRATE_MS=$(($(now_ms) - MIGRATE_START_MS))
MIGRATION_COUNT="$(src_psql -c 'select count(*) from schema_migrations')"
MIGRATION_MAX="$(src_psql -c 'select max(version) from schema_migrations')"
if [ "$MIGRATION_COUNT" = "$EXPECTED_MIGRATIONS" ]; then
  pass "migrations applied: ${MIGRATION_COUNT}/${EXPECTED_MIGRATIONS} (latest: ${MIGRATION_MAX})"
else
  fail "expected ${EXPECTED_MIGRATIONS} migrations, database has ${MIGRATION_COUNT}"
fi
record "migration time: $(fmt_ms "$MIGRATE_MS")"

CURRENT_STEP="seed reference data"
section "3/8 seed reference data"
SEED_START_MS=$(now_ms)
DATABASE_URL="$SRC_URL" "$TSX" scripts/seed.ts > "$WORKDIR/seed.log" 2>&1
SEED_MS=$(($(now_ms) - SEED_START_MS))
say "seed: $(tail -1 "$WORKDIR/seed.log")"
pass "reference seed loaded (tenants/people/policies/metrics)"
record "seed time: $(fmt_ms "$SEED_MS")"

# ---------------------------------------------------------------------------
# 3. representative business data
# ---------------------------------------------------------------------------
CURRENT_STEP="insert representative data"
section "4/8 insert representative data"
DATA_START_MS=$(now_ms)
docker exec -i "$SRC_CONTAINER" psql -U anari -d "$SRC_DB" \
  -q -v ON_ERROR_STOP=1 > "$WORKDIR/data.log" 2>&1 <<'SQL'
BEGIN;

-- Audit event hashes cover occurred_at::text, so pin the session rendering
-- before inserting the audit chain seed (deterministic UTC hashes).
SET TIME ZONE 'UTC';
SET DateStyle = 'ISO, MDY';

SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true);

-- GL chart of accounts for the demo tenant (112 seeds only tenants existing at migration time).
INSERT INTO gl_accounts (tenant_id, code, name, account_type, normal_balance)
VALUES
  ('00000000-0000-4000-8000-000000000001','AR','Accounts Receivable','ASSET','DEBIT'),
  ('00000000-0000-4000-8000-000000000001','REVENUE','Revenue','REVENUE','CREDIT'),
  ('00000000-0000-4000-8000-000000000001','TAX_PAYABLE','Tax Payable','LIABILITY','CREDIT'),
  ('00000000-0000-4000-8000-000000000001','CASH','Cash','ASSET','DEBIT'),
  ('00000000-0000-4000-8000-000000000001','INCENTIVE_EXPENSE','Incentive Expense','EXPENSE','DEBIT'),
  ('00000000-0000-4000-8000-000000000001','PAYABLE','Accounts Payable','LIABILITY','CREDIT')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- A posted invoice and its payment (financial facts).
INSERT INTO financial_facts (
  id, tenant_id, source_system, source_record_id, fact_type,
  period_start, period_end, amount, currency, quality_status, payload,
  document_type, document_id, legal_entity_id, order_id, contract_ref,
  instrument_type, recognition_status, accounting_period, source_version,
  functional_currency, functional_amount, tax_rate, tax_amount
) VALUES
  ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001',
   'LOCAL_ERP','INV-2026-001','REVENUE', DATE '2026-11-01', DATE '2026-11-30',
   1060.000000,'CNY','VALID','{"drill":true,"doc":"INV-2026-001"}'::jsonb,
   'INVOICE','INV-2026-001','CN01','ORD-2026-001','CTR-2026-001',
   'INVOICE','POSTED','2026-11','v1','CNY',1060.000000,6.000000,60.000000),
  ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000001',
   'LOCAL_ERP','PAY-2026-001','REVENUE', DATE '2026-11-05', DATE '2026-11-05',
   1060.000000,'CNY','VALID','{"drill":true,"doc":"PAY-2026-001"}'::jsonb,
   'PAYMENT','PAY-2026-001','CN01','ORD-2026-001','CTR-2026-001',
   'PAYMENT','POSTED','2026-11','v1','CNY',1060.000000,NULL,NULL);

-- Balanced double-entry journals: invoice and award payment.
INSERT INTO gl_journals
  (id, tenant_id, journal_no, document_type, document_id, legal_entity_id,
   accounting_period, currency, description, source_fact_id,
   total_debit, total_credit)
VALUES
  ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000001',
   'JE-INVOICE-INV-2026-001','INVOICE','INV-2026-001','CN01','2026-11','CNY',
   'Drill invoice journal','00000000-0000-4000-8000-000000000040',1060.000000,1060.000000),
  ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000001',
   'JE-PAYMENT-PAY-2026-001','PAYMENT','PAY-2026-001','CN01','2026-11','CNY',
   'Drill award payment journal','00000000-0000-4000-8000-000000000041',2000.000000,2000.000000);

INSERT INTO gl_journal_lines
  (id, tenant_id, journal_id, line_no, account_code, debit, credit, currency)
VALUES
  ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000080',1,'AR',1060.000000,0,'CNY'),
  ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000080',2,'REVENUE',0,1000.000000,'CNY'),
  ('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000080',3,'TAX_PAYABLE',0,60.000000,'CNY'),
  ('00000000-0000-4000-8000-000000000085','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000084',1,'INCENTIVE_EXPENSE',2000.000000,0,'CNY'),
  ('00000000-0000-4000-8000-000000000086','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000084',2,'CASH',0,2000.000000,'CNY');

-- Award batch → lines → source reservations → PAID payment receipts.
INSERT INTO incentive_award_batches
  (id, tenant_id, batch_no, award_type, period, cycle_id, currency, status,
   total_amount, line_count, source_record_ids, created_by, approved_by,
   approved_at, locked_at, exported_at, acknowledged_at)
VALUES
  ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000001',
   'AWARD-2026-11-001','PERFORMANCE','2026-11','00000000-0000-4000-8000-000000000020','CNY','ACKNOWLEDGED',
   2000.000000,2,'["SRC-2026-001","SRC-2026-002"]'::jsonb,'drill','drill-approver',
   '2026-11-26T10:00:00Z','2026-11-26T10:05:00Z','2026-11-26T10:10:00Z','2026-11-26T10:20:00Z');

INSERT INTO incentive_award_lines
  (id, tenant_id, batch_id, person_id, amount, currency, source_record_id, source_line_ref, note)
VALUES
  ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000001',1200.000000,'CNY','SRC-2026-001','SRC-2026-001-L1','drill line 1'),
  ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000002',800.000000,'CNY','SRC-2026-002','SRC-2026-002-L1','drill line 2');

INSERT INTO incentive_award_source_reservations (tenant_id, source_record_id, batch_id)
VALUES
  ('00000000-0000-4000-8000-000000000001','SRC-2026-001','00000000-0000-4000-8000-000000000060'),
  ('00000000-0000-4000-8000-000000000001','SRC-2026-002','00000000-0000-4000-8000-000000000060');

INSERT INTO incentive_award_payments
  (id, tenant_id, batch_id, line_id, person_id, amount, currency, payment_ref,
   status, paid_at, legal_entity_id, accounting_period, credit_account)
VALUES
  ('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000001',1200.000000,'CNY','BANK-2026-11-0001','PAID','2026-11-27T02:00:00Z','CN01','2026-11','CASH'),
  ('00000000-0000-4000-8000-000000000064','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000002',800.000000,'CNY','BANK-2026-11-0002','PAID','2026-11-27T02:05:00Z','CN01','2026-11','CASH');

-- JEV decision record: case → evidence → judgments → verification → record → link.
INSERT INTO decision_cases
  (id, tenant_id, kind, subject_type, subject_id, context, status, version, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000001','INCENTIVE_ELIGIBILITY','INCENTIVE_AWARD_BATCH','00000000-0000-4000-8000-000000000060','{"drill":true,"period":"2026-11"}'::jsonb,'DECIDED',4,'drill-reviewer');

INSERT INTO decision_evidence
  (id, tenant_id, case_id, source_type, source_id, content_hash, supports, weight, content)
VALUES
  ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','INCENTIVE_AWARD_BATCH','00000000-0000-4000-8000-000000000060','sha256:'||encode(digest('{"batchId":"00000000-0000-4000-8000-000000000060","currency":"CNY","total":"2000.000000"}'::text,'sha256'),'hex'),'FOR',1.000000,'{"batchId":"00000000-0000-4000-8000-000000000060","currency":"CNY","total":"2000.000000"}');

INSERT INTO decision_judgments
  (id, tenant_id, case_id, actor_type, actor_id, model_ref, independent_scores,
   independent_rationale, dimension_states, confidence)
VALUES
  ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','HUMAN','drill-human-reviewer',NULL,'{"eligibility":0.95}'::jsonb,'Evidence and batch totals reconcile.','{"coverage":"OK"}'::jsonb,0.9500),
  ('00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','AI_MODEL','drill-ai-model','drill-model-v1','{"eligibility":0.90}'::jsonb,'Model confirms batch totals are consistent.','{"coverage":"OK"}'::jsonb,0.9000);

INSERT INTO decision_verifications
  (id, tenant_id, case_id, checks, findings, passed, verified_by, verified_at,
   verified_case_version, evidence_hash, judgments_hash)
VALUES
  ('00000000-0000-4000-8000-000000000074','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070',
   '{"conflictOfInterest":"PASS","evidenceCoverage":"PASS","ruleCheck":"PASS"}'::jsonb,'[]'::jsonb,true,'drill-verifier','2026-11-27T03:00:00Z',4,
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

INSERT INTO decision_records
  (id, tenant_id, case_id, final_judgment_id, decided_by, rationale, evidence_hash, version, decided_at)
VALUES
  ('00000000-0000-4000-8000-000000000075','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000072','drill-decider',
   'Batch is eligible: evidence and payment receipts reconcile.','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'2026-11-27T03:05:00Z');

INSERT INTO decision_case_links
  (id, tenant_id, case_id, resource_type, resource_id, note, linked_by)
VALUES
  ('00000000-0000-4000-8000-000000000076','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','INCENTIVE_ELIGIBILITY','00000000-0000-4000-8000-000000000060','drill link','drill');

-- Raw ledger: versioned raw source record + raw event.
INSERT INTO raw_source_records
  (id, tenant_id, source_system, external_record_id, payload_encrypted,
   mapping_version, retention_class, source_version, payload_hash)
VALUES
  ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000001','LOCAL_ERP','RAW-2026-001','base64:ZHJpbGwtcGF5bG9hZA==',1,'FINANCIAL','1','sha256:'||encode(digest('{"raw":"drill"}'::text,'sha256'),'hex'));

INSERT INTO raw_events
  (id, tenant_id, source_system, source_record_id, source_event_version,
   event_type, occurred_at, payload, payload_hash)
VALUES
  ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000001','LOCAL_ERP','RAW-2026-001','1','INVOICE_POSTED','2026-11-27T04:00:00Z','{"raw":"drill"}'::jsonb,'sha256:'||encode(digest('{"raw":"drill"}'::text,'sha256'),'hex'));

-- Migration 121: rubric + FROZEN metric snapshot (insert guard must accept FROZEN only).
INSERT INTO rubrics (id, tenant_id, code, name, dimensions, scoring_anchors, scope, status, version, effective_from)
VALUES ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000001','DRILL_RUBRIC','Drill rubric','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'PUBLISHED',1, DATE '2026-01-01');

INSERT INTO metric_measurement_snapshots
  (id, tenant_id, cycle_id, person_id, rubric_version_id, measurements,
   content_hash, frozen_by, status)
VALUES
  ('00000000-0000-4000-8000-000000000095','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000099','{"EVIDENCE_COVERAGE":{}}'::jsonb,'sha256:'||encode(digest('{"EVIDENCE_COVERAGE":{}}'::text,'sha256'),'hex'),'00000000-0000-4000-8000-000000000001','FROZEN');

-- FK anchor for amount_ledger.
INSERT INTO calculation_runs
  (id, tenant_id, cycle_id, policy_version_id, mode, engine_version,
   input_snapshot_hash, input_snapshot, status, requested_by)
VALUES
  ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000100','SHADOW','drill-engine-v1','sha256:'||encode(digest('{"drill":true}'::text,'sha256'),'hex'),'{"drill":true}'::jsonb,'CALCULATED','00000000-0000-4000-8000-000000000003');

-- Audit chain seed; 003 trigger computes sequence / prev_hash / event_hash.
INSERT INTO audit_events
  (tenant_id, sequence, actor_type, actor_id, action, object_type, object_id,
   before_hash, after_hash, reason, correlation_id, occurred_at, prev_hash, event_hash)
VALUES
  ('00000000-0000-4000-8000-000000000001',0,'USER','00000000-0000-4000-8000-000000000001','BACKUP_DRILL_SEED','INCENTIVE_AWARD_BATCH','00000000-0000-4000-8000-000000000060',NULL,NULL,'drill seed','00000000-0000-4000-8000-0000000000c1','2026-11-27T05:00:00Z','',''),
  ('00000000-0000-4000-8000-000000000001',0,'USER','00000000-0000-4000-8000-000000000001','BACKUP_DRILL_PAYMENT','INCENTIVE_AWARD_PAYMENT','00000000-0000-4000-8000-000000000063',NULL,'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','drill payment','00000000-0000-4000-8000-0000000000c2','2026-11-27T05:00:01Z','',''),
  ('00000000-0000-4000-8000-000000000001',0,'SYSTEM',NULL,'BACKUP_DRILL_VERIFY','DECISION_CASE','00000000-0000-4000-8000-000000000070',NULL,NULL,'drill verify','00000000-0000-4000-8000-0000000000c3','2026-11-27T05:00:02Z','','');

COMMIT;
SQL

# amount_ledger is append-only + hash-chained by the application layer. Generate
# the rows with the same hash function the app uses, never a hand-written hash.
cat > "$WORKDIR/seed-ledger.ts" <<'TS'
import { Pool } from "pg";
import { hashLedgerEntry } from "@anari/ledger";

const tenantId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000001";
const cycleId = "00000000-0000-4000-8000-000000000020";
const runId = "00000000-0000-4000-8000-000000000030";
const createdAt = new Date("2026-11-27T06:00:00.000Z").toISOString();
const rows = [
  { id: "00000000-0000-4000-8000-000000000050", entryType: "INCENTIVE", amount: "1200.000000", sourceEntryId: null, idempotencyKey: "drill-ledger-1" },
  { id: "00000000-0000-4000-8000-000000000051", entryType: "REVERSAL", amount: "-1200.000000", sourceEntryId: "00000000-0000-4000-8000-000000000050", idempotencyKey: "drill-ledger-2" },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let prevHash = "GENESIS";
    for (const row of rows) {
      const entryHash = hashLedgerEntry({
        id: row.id,
        tenantId,
        personId,
        cycleId,
        calculationRunId: runId,
        calculationLineId: undefined,
        entryType: row.entryType as "INCENTIVE" | "REVERSAL",
        amount: row.amount,
        currency: "CNY",
        sourceEntryId: row.sourceEntryId ?? undefined,
        idempotencyKey: row.idempotencyKey,
        prevHash,
        createdAt,
      });
      await pool.query(
        `INSERT INTO amount_ledger
           (id, tenant_id, person_id, cycle_id, calculation_run_id, entry_type,
            amount, currency, status, source_entry_id, idempotency_key,
            entry_hash, prev_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CNY','PROVISIONAL',$8,$9,$10,$11,$12)`,
        [row.id, tenantId, personId, cycleId, runId, row.entryType, row.amount,
         row.sourceEntryId, row.idempotencyKey, entryHash, prevHash, createdAt],
      );
      prevHash = entryHash;
    }
    console.log(`seeded ${rows.length} amount_ledger rows`);
  } finally {
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
TS
NODE_PATH="$ROOT/node_modules" DATABASE_URL="$SRC_URL" \
  "$TSX" "$WORKDIR/seed-ledger.ts" >> "$WORKDIR/data.log" 2>&1
DATA_MS=$(($(now_ms) - DATA_START_MS))

# Pre-dump sanity: data insertion must actually be present (a rolled-back
# transaction would otherwise make the source/destination diff trivially pass).
pre_count() {
  local table="$1" expected="$2" got
  got="$(src_psql -c "select count(*) from ${table}")"
  if [ "$got" = "$expected" ]; then
    record "${table}: ${got} row(s)"
  else
    fail "${table}: expected ${expected} row(s), found ${got}"
  fi
}
pre_count financial_facts 2
pre_count gl_journals 2
pre_count gl_journal_lines 5
pre_count incentive_award_batches 1
pre_count incentive_award_payments 2
pre_count decision_cases 1
pre_count decision_records 1
pre_count raw_source_records 1
pre_count amount_ledger 2
pre_count audit_events 3
pre_count metric_measurement_snapshots 1
pass "representative data inserted (financial facts / GL / JEV / award + payments / raw ledger / audit)"
record "data time: $(fmt_ms "$DATA_MS")"

# ---------------------------------------------------------------------------
# 4. backup
# ---------------------------------------------------------------------------
CURRENT_STEP="pg_dump"
section "5/8 pg_dump logical backup"
DUMP_START_MS=$(now_ms)
docker exec "$SRC_CONTAINER" pg_dump -U anari -d "$SRC_DB" \
  --no-owner --format=plain > "$DUMP"
DUMP_MS=$(($(now_ms) - DUMP_START_MS))
DUMP_BYTES="$(wc -c < "$DUMP" | tr -d ' ')"
DUMP_SHA="$(file_sha256 "$DUMP")"
if [ "$DUMP_BYTES" -gt 0 ]; then
  pass "pg_dump complete: ${DUMP_BYTES} bytes, sha256 ${DUMP_SHA}"
else
  fail "pg_dump produced an empty file"
fi
record "dump time: $(fmt_ms "$DUMP_MS")"
record "dump file: ${DUMP}"

# ---------------------------------------------------------------------------
# 5. restore into a brand-new database on a brand-new container
# ---------------------------------------------------------------------------
CURRENT_STEP="restore into fresh database"
section "6/8 restore into fresh postgres:16"
start_pg "$DST_CONTAINER" postgres
DST_PORT="$STARTED_PORT"
DST_URL="postgres://anari:anari@127.0.0.1:${DST_PORT}/${DST_DB}"
say "restore target ready on 127.0.0.1:${DST_PORT}"

# Roles are cluster-level and are not part of pg_dump. A fresh cluster needs the
# application role before the dump's GRANT statements can be replayed.
docker exec "$DST_CONTAINER" psql -U anari -d postgres -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE anari_app LOGIN PASSWORD 'anari_app' NOBYPASSRLS"
docker exec "$DST_CONTAINER" psql -U anari -d postgres -q -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${DST_DB} OWNER anari"
pass "fresh database ${DST_DB} created; application role anari_app (NOBYPASSRLS) created"

RESTORE_START_MS=$(now_ms)
docker exec -i "$DST_CONTAINER" psql -U anari -d "$DST_DB" -q \
  -v ON_ERROR_STOP=1 --single-transaction < "$DUMP" \
  > "$WORKDIR/restore.log" 2>&1
RESTORE_MS=$(($(now_ms) - RESTORE_START_MS))
RESTORED_MIGRATIONS="$(dst_psql -c 'select count(*) from schema_migrations')"
if [ "$RESTORED_MIGRATIONS" = "$EXPECTED_MIGRATIONS" ]; then
  pass "dump replayed into fresh database: ${RESTORED_MIGRATIONS}/${EXPECTED_MIGRATIONS} migrations"
else
  fail "restored migration count ${RESTORED_MIGRATIONS}, expected ${EXPECTED_MIGRATIONS}"
fi
record "restore time: $(fmt_ms "$RESTORE_MS")"

# ---------------------------------------------------------------------------
# 6. verify
# ---------------------------------------------------------------------------
CURRENT_STEP="verify migrations"
section "7/8 verify backup / restore"
VERIFY_START_MS=$(now_ms)

# 6a. every migration file must be present in the restored ledger with the
# same checksum (immutability check survives the dump).
DRILL_MAX_MIGRATION="$MAX_MIGRATION" node -e '
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const max = Number(process.env.DRILL_MAX_MIGRATION);
for (const file of fs.readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  const version = file.replace(/\.sql$/, "");
  if (Number(version.split("_")[0]) > max) continue;
  const body = fs.readFileSync(path.join("db/migrations", file));
  console.log(`${version} ${crypto.createHash("sha256").update(body).digest("hex")}`);
}
' > "$WORKDIR/files.migrations"
dst_psql -c "select version || ' ' || checksum from schema_migrations order by version" \
  > "$WORKDIR/db.migrations"
if diff -u "$WORKDIR/files.migrations" "$WORKDIR/db.migrations" > "$WORKDIR/migrations.diff"; then
  pass "migration manifest: ${EXPECTED_MIGRATIONS} version+checksum rows match repository files"
else
  fail "migration manifest mismatch (restored schema_migrations vs db/migrations/*.sql)"
  head -20 "$WORKDIR/migrations.diff" | while IFS= read -r line; do record "$line"; done
fi

# 6b. schema + data fingerprints
CURRENT_STEP="verify fingerprints"
fingerprint_sql | docker exec -i "$SRC_CONTAINER" psql -U anari -d "$SRC_DB" \
  -qAt -v ON_ERROR_STOP=1 > "$SRC_FP"
fingerprint_sql | docker exec -i "$DST_CONTAINER" psql -U anari -d "$DST_DB" \
  -qAt -v ON_ERROR_STOP=1 > "$DST_FP"
if diff -u "$SRC_FP" "$DST_FP" > "$WORKDIR/fingerprint.diff"; then
  FP_KEYS="$(wc -l < "$DST_FP" | tr -d ' ')"
  pass "source/restore fingerprints identical (${FP_KEYS} keys: schema objects, rows, hashes, balances)"
else
  fail "source/restore fingerprint mismatch"
  head -40 "$WORKDIR/fingerprint.diff" | while IFS= read -r line; do record "$line"; done
fi

fp_value() {
  local key="$1" file="$2"
  grep "^${key}=" "$file" | head -1 | cut -d= -f2-
}
expect_fp() {
  local key="$1" expected="$2" got
  got="$(fp_value "$key" "$DST_FP")"
  if [ "$got" = "$expected" ]; then
    return 0
  fi
  fail "${key}: expected '${expected}', got '${got}'"
  return 1
}
assert_true() {
  local key="$1"
  if expect_fp "$key" "true"; then
    pass "${key#check.}"
  fi
}

assert_true check.audit_chain_ok
assert_true check.audit_sequence_ok
assert_true check.amount_ledger_links
assert_true check.gl_balanced
assert_true check.award_payments_match_lines
assert_true check.jev_record_link
assert_true check.jev_final_judgment_ok
assert_true check.jev_evidence_hash
assert_true check.jev_verification_binding

RLS_TABLES="$(fp_value schema.tables "$DST_FP")"
RLS_POLICIES="$(fp_value schema.rls_policies "$DST_FP")"
RLS_FORCED="$(fp_value schema.rls_forced "$DST_FP")"
TRIGGERS="$(fp_value schema.triggers "$DST_FP")"
if [ -n "$RLS_POLICIES" ] && [ "$RLS_POLICIES" -gt 0 ] && \
   [ "$RLS_FORCED" -gt 0 ] && [ "$TRIGGERS" -gt 0 ]; then
  pass "schema objects restored: ${RLS_TABLES} tables, ${RLS_POLICIES} RLS policies, ${RLS_FORCED} FORCE-RLS tables, ${TRIGGERS} triggers"
else
  fail "schema object counts are empty (policies=${RLS_POLICIES:-?}, forced=${RLS_FORCED:-?}, triggers=${TRIGGERS:-?})"
fi

ROWS_CHECKED="$(grep -c '^rows\.' "$DST_FP" || true)"
pass "row counts compared across ${ROWS_CHECKED} representative tables"

# 6c. GL / JEV / chain evidence values
GL_DEBIT="$(fp_value money.gl_journal_debit "$DST_FP")"
GL_CREDIT="$(fp_value money.gl_journal_credit "$DST_FP")"
JEV_CASES="$(fp_value rows.decision_cases "$DST_FP")"
JEV_RECORDS="$(fp_value rows.decision_records "$DST_FP")"
AUDIT_ROWS="$(fp_value rows.audit_events "$DST_FP")"
LEDGER_ROWS="$(fp_value rows.amount_ledger "$DST_FP")"
if [ "$GL_DEBIT" = "$GL_CREDIT" ] && [ -n "$GL_DEBIT" ]; then
  pass "GL trial balance: debit=${GL_DEBIT} credit=${GL_CREDIT}"
else
  fail "GL trial balance mismatch: debit=${GL_DEBIT:-?} credit=${GL_CREDIT:-?}"
fi
if [ "${JEV_CASES:-0}" -ge 1 ] && [ "${JEV_RECORDS:-0}" -ge 1 ]; then
  pass "JEV records restored: ${JEV_CASES} case(s), ${JEV_RECORDS} record(s)"
else
  fail "JEV record missing after restore (cases=${JEV_CASES:-?}, records=${JEV_RECORDS:-?})"
fi
if [ "${AUDIT_ROWS:-0}" -ge 1 ]; then
  pass "audit hash chain: ${AUDIT_ROWS} event(s) verified (sequence + prev_hash + event_hash)"
else
  fail "audit_events empty after restore"
fi

# 6d. amount_ledger full hash recompute with the application's own function.
CURRENT_STEP="verify amount_ledger hash chain"
cat > "$WORKDIR/verify-ledger.ts" <<'TS'
import { Pool } from "pg";
import { hashLedgerEntry } from "@anari/ledger";

function normalizeAmount(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const normalized = `${whole}.${(fraction + "000000").slice(0, 6)}`;
  const isZero = /^0+$/.test(normalized.replace(".", ""));
  return negative && !isZero ? `-${normalized}` : normalized;
}

async function main() {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT * FROM amount_ledger WHERE tenant_id=$1 ORDER BY ledger_seq",
      [tenantId],
    );
    let prevHash = "GENESIS";
    for (const row of rows) {
      if (row.prev_hash !== prevHash) {
        throw new Error(`prev_hash mismatch at ${row.id}`);
      }
      const recomputed = hashLedgerEntry({
        id: row.id,
        tenantId: row.tenant_id,
        personId: row.person_id,
        cycleId: row.cycle_id,
        calculationRunId: row.calculation_run_id,
        calculationLineId: row.calculation_line_id ?? undefined,
        entryType: row.entry_type,
        amount: normalizeAmount(String(row.amount)),
        currency: row.currency,
        sourceEntryId: row.source_entry_id ?? undefined,
        idempotencyKey: row.idempotency_key,
        prevHash: row.prev_hash,
        createdAt: new Date(row.created_at).toISOString(),
      });
      if (recomputed !== row.entry_hash) {
        throw new Error(`entry_hash mismatch at ${row.id}`);
      }
      prevHash = row.entry_hash;
    }
    console.log(`amount_ledger chain OK: ${rows.length} entries`);
  } finally {
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
TS
if NODE_PATH="$ROOT/node_modules" DATABASE_URL="$DST_URL" \
  "$TSX" "$WORKDIR/verify-ledger.ts" > "$WORKDIR/ledger.log" 2>&1; then
  pass "amount_ledger hash chain recomputed on restored data: $(tail -1 "$WORKDIR/ledger.log")"
else
  fail "amount_ledger hash chain verification failed"
  tail -5 "$WORKDIR/ledger.log" | while IFS= read -r line; do record "$line"; done
fi
record "ledger rows: ${LEDGER_ROWS}"

# 6e. RLS behaviour on the restored database (not just policy counts).
CURRENT_STEP="verify restored RLS behaviour"
RLS_TENANT_ROWS="$(docker exec -i "$DST_CONTAINER" psql -U anari -d "$DST_DB" -qAt -v ON_ERROR_STOP=1 \
  -c "SET ROLE anari_app; SET app.tenant_id = '${TENANT}'; SELECT count(*) FROM gl_journals;" | tail -1)"
RLS_OTHER_ROWS="$(docker exec -i "$DST_CONTAINER" psql -U anari -d "$DST_DB" -qAt -v ON_ERROR_STOP=1 \
  -c "SET ROLE anari_app; SET app.tenant_id = '00000000-0000-4000-8000-0000000000ff'; SELECT count(*) FROM gl_journals;" | tail -1)"
RLS_BYPASS="$(dst_psql -c "select rolbypassrls from pg_roles where rolname = 'anari_app'")"
if [ "${RLS_TENANT_ROWS:-0}" -ge 2 ] && [ "${RLS_OTHER_ROWS:-1}" = "0" ] && [ "$RLS_BYPASS" = "f" ]; then
  pass "RLS enforced after restore: tenant sees ${RLS_TENANT_ROWS} GL journal(s), foreign tenant sees 0; anari_app BYPASSRLS=false"
else
  fail "RLS not enforced after restore (tenant=${RLS_TENANT_ROWS:-?}, foreign=${RLS_OTHER_ROWS:-?}, bypassrls=${RLS_BYPASS:-?})"
fi

# ---------------------------------------------------------------------------
# 7. summary / RTO evidence
# ---------------------------------------------------------------------------
CURRENT_STEP="summary"
DRILL_MS=$(($(now_ms) - DRILL_START_MS))
VERIFY_MS=$(($(now_ms) - VERIFY_START_MS))
BACKUP_TO_QUERYABLE_MS=$((DUMP_MS + RESTORE_MS))

section "8/8 summary"
say "dump:               $(fmt_ms "$DUMP_MS")"
say "restore:            $(fmt_ms "$RESTORE_MS")"
say "verification:       $(fmt_ms "$VERIFY_MS")"
say "dump → restored DB queryable: $(fmt_ms "$BACKUP_TO_QUERYABLE_MS")"
say "total drill:        $(fmt_ms "$DRILL_MS")"
say "RPO:                point-in-time of the logical dump (no WAL archive in this drill)"
say "RTO (this dataset): $(fmt_ms "$BACKUP_TO_QUERYABLE_MS") backup→queryable, excluding offsite copy and production data volume"

if [ "$FAILURES" -eq 0 ]; then
  printf '\nRESULT: PASS — %s migrated, dumped, restored and verified.\n' "$EXPECTED_MIGRATIONS"
  printf 'Evidence: %s representative tables compared, %s RLS policies, %s triggers, GL debit=%s credit=%s.\n' \
    "$ROWS_CHECKED" "$RLS_POLICIES" "$TRIGGERS" "$GL_DEBIT" "$GL_CREDIT"
  exit 0
fi
printf '\nRESULT: FAIL — %s check(s) failed.\n' "$FAILURES"
exit 1
