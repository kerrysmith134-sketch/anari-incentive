#!/usr/bin/env bash
# Local/CI verification entry point.
#
# Runs in order: install, typecheck, unit/API tests, compose validation and
# PostgreSQL integration tests. Set CI_SKIP_PG=1 to skip Docker-backed tests.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

npm run typecheck
npm test

if command -v docker >/dev/null 2>&1; then
  docker compose config >/dev/null
else
  echo "docker not found: skipping compose validation"
fi

if [ "${CI_SKIP_PG:-0}" = "1" ]; then
  echo "CI_SKIP_PG=1: skipping PostgreSQL integration tests"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  npm run test:pg
else
  echo "docker daemon unavailable: skipping PostgreSQL integration tests"
fi

echo "CI checks passed"
