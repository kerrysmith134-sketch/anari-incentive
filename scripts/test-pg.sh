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
for file in db/migrations/001_core_schema.sql db/migrations/002_governance_schema.sql db/migrations/003_money_path_invariants.sql db/migrations/004_policy_succession.sql db/migrations/005_ledger_sequence.sql db/migrations/006_settlement_rls.sql db/migrations/007_agent_task_state.sql db/seed/001_demo.sql; do
  echo "applying $file"
  docker exec -i "$CONTAINER" psql -U anari -d anari_incentive -v ON_ERROR_STOP=1 < "$file" >/dev/null
done
DATABASE_URL="postgres://anari_app:anari_app@localhost:${PORT}/anari_incentive" \
  npx vitest run apps/api/src/__tests__/pg-store.test.ts
