#!/usr/bin/env bash
set -euo pipefail

test -f .env.production || { echo '.env.production is required' >&2; exit 1; }
test -f .env.migration || { echo '.env.migration is required' >&2; exit 1; }
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.production.yml up -d --remove-orphans
bash deploy/scripts/health-check.sh
