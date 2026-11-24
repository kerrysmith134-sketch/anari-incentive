#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${CONTAINER:-anari-incentive-pg-test}"
PORT="${PORT:-$((55000 + RANDOM % 1000))}"
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
DATABASE_URL="$MIGRATION_URL" npm run db:migrate
# AUD-018：活动库 RLS 质量检查（FORCE RLS / 宽策略 / BYPASSRLS 角色属性）。
DATABASE_URL="$MIGRATION_URL" npx tsx scripts/migration-manifest.ts --check
DATABASE_URL="$MIGRATION_URL" npm run db:seed
DATABASE_URL="postgres://anari_app:anari_app@localhost:${PORT}/anari_incentive" \
  CI=1 npx vitest run apps/api/src/__tests__/pg-store.test.ts \
    apps/api/src/__tests__/store-contract.test.ts \
    apps/api/src/__tests__/integration-pg-contract.test.ts < /dev/null
