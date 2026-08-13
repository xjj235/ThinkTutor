$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath ".env.production")) { throw ".env.production is required" }
if (-not (Test-Path -LiteralPath ".env.migration")) { throw ".env.migration is required" }
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.production.yml up -d --remove-orphans
$baseUrl = if ($env:HEALTH_BASE_URL) { $env:HEALTH_BASE_URL } else { "http://127.0.0.1:3000" }
Invoke-RestMethod "$baseUrl/api/health/live"
Invoke-RestMethod "$baseUrl/api/health/ready"
