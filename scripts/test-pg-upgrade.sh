#!/usr/bin/env bash
# NPV2-010 / AUD-018：升级路径实测。
#
# 生产是滚动升级：库中已有上一版基线（默认到 089），新版本再应用增量
# 迁移（090+）并保持 schema 不变量。本脚本在全新容器里复现这条路径：
#   1) 应用 --until 基线（PREVIOUS_RELEASE，默认 089）；
#   2) 全量应用（幂等：已应用跳过、checksum 必须一致）；
#   3) 活动 RLS 门禁（migration-manifest --check，需 DATABASE_URL）；
#   4) 增量 schema 不变量冒烟（090/091/092 的表/列/索引/触发器 + FORCE RLS）；
#   5) 在升级后的库上跑 store 契约套件（Memory/PG 双跑中的 PG 侧）。
set -euo pipefail

CONTAINER="${CONTAINER:-anari-incentive-pg-upgrade}"
PORT="${PORT:-$((56500 + RANDOM % 500))}"
PREVIOUS_RELEASE="${PREVIOUS_RELEASE:-089}"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=anari \
  -e POSTGRES_PASSWORD=anari \
  -e POSTGRES_DB=anari_incentive \
  -p "${PORT}:5432" \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" psql -U anari -d anari_incentive -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" psql -U anari -d anari_incentive -c 'select 1' >/dev/null

MIGRATION_URL="postgres://anari:anari@localhost:${PORT}/anari_incentive"
APP_URL="postgres://anari_app:anari_app@localhost:${PORT}/anari_incentive"

echo "== phase 1: apply baseline up to ${PREVIOUS_RELEASE} (previous release) =="
DATABASE_URL="$MIGRATION_URL" npx tsx scripts/migrate.ts --until "$PREVIOUS_RELEASE"
BASELINE_COUNT=$(docker exec "$CONTAINER" psql -U anari -d anari_incentive -tAc \
  'select count(*) from schema_migrations')
echo "baseline applied: ${BASELINE_COUNT} migrations"

echo "== phase 2: rolling upgrade (apply remainder, idempotent) =="
DATABASE_URL="$MIGRATION_URL" npm run db:migrate
# 二次幂等：全部 skip，checksum 必须一致（历史迁移不可变）
DATABASE_URL="$MIGRATION_URL" npm run db:migrate | grep -q "migrations complete"
TOTAL_COUNT=$(docker exec "$CONTAINER" psql -U anari -d anari_incentive -tAc \
  'select count(*) from schema_migrations')
echo "after upgrade: ${TOTAL_COUNT} migrations (baseline ${BASELINE_COUNT})"
if [ "$TOTAL_COUNT" -le "$BASELINE_COUNT" ]; then
  echo "upgrade did not apply any new migration" >&2
  exit 1
fi

echo "== phase 3: live RLS / manifest gate on upgraded schema =="
DATABASE_URL="$MIGRATION_URL" npx tsx scripts/migration-manifest.ts --check

echo "== phase 4: incremental schema invariants (090/091/092) =="
docker exec "$CONTAINER" psql -U anari -d anari_incentive -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  missing text;
BEGIN
  -- 091：notifications.idempotency_key + 部分唯一索引
  SELECT string_agg(item, ',') INTO missing FROM (
    SELECT 'notifications.idempotency_key' AS item
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='notifications'
          AND column_name='idempotency_key')
    UNION ALL
    SELECT 'uq_notifications_idempotency'
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_notifications_idempotency')
  ) gaps;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing after upgrade: %', missing;
  END IF;

  -- 092：三张可观测性表存在且 FORCE RLS
  SELECT string_agg(t, ',') INTO missing FROM (
    SELECT t FROM unnest(ARRAY[
      'agent_feedback_labels','agent_model_usage','agent_ai_off_baseline']) AS t
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.relname = t AND c.relrowsecurity AND c.relforcerowsecurity)
  ) gaps;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables missing or not FORCE RLS: %', missing;
  END IF;

  -- 090：contribution_events append-only 触发器
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = 'contribution_events' AND NOT tg.tgisinternal
       AND tg.tgname LIKE '%append_only%'
  ) THEN
    RAISE EXCEPTION 'contribution_events append-only trigger missing';
  END IF;

  -- 089：metric snapshot 不可变触发器
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = 'metric_measurement_snapshots' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'metric snapshot immutability trigger missing';
  END IF;
END $$;
SQL
echo "incremental invariants OK"

echo "== phase 5: store contract on the upgraded database =="
DATABASE_URL="$MIGRATION_URL" npm run db:seed
DATABASE_URL="$APP_URL" npx vitest run \
  apps/api/src/__tests__/pg-store.test.ts \
  apps/api/src/__tests__/store-contract.test.ts

echo "upgrade path OK: ${BASELINE_COUNT} -> ${TOTAL_COUNT} migrations"
