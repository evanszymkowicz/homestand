#!/usr/bin/env bash
# Approve a pending signup: ./approve.sh <email>
# Uses ADMIN_API_KEY from the environment (or app/.env) and HOMESTAND_ORIGIN
# (default http://localhost:8788).
set -euo pipefail

cd "$(dirname "$0")"
[ -f app/.env ] && set -a && . ./app/.env && set +a
ORIGIN="${HOMESTAND_ORIGIN:-http://localhost:8788}"
KEY="${ADMIN_API_KEY:?set ADMIN_API_KEY (it lives in app/.env)}"

[ -n "${1:-}" ] || { echo "usage: $0 <email>" >&2; exit 1; }
curl -fsS -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\"}" "$ORIGIN/api/admin/approve"; echo
