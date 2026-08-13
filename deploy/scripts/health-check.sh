#!/usr/bin/env bash
set -euo pipefail

base_url="${HEALTH_BASE_URL:-https://thinktutor.example.com}"
curl --fail --silent --show-error "$base_url/api/health/live"
curl --fail --silent --show-error "$base_url/api/health/ready"
echo 'ThinkTutor health checks passed.'
