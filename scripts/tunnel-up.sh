#!/usr/bin/env bash
# Start the existing tunnel only after verifying the public/private boundary.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:-english.duytruongphatco.com}"
check_boundary() {
  local base="$1" public_code private_code coach_code
  public_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$base/")
  private_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$base/api/today")
  coach_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$base/coach")
  [ "$public_code" = 200 ] || { echo "Public page returned $public_code, expected 200"; return 1; }
  [ "$private_code" = 401 ] || { echo "Private API returned $private_code, expected 401"; return 1; }
  case "$coach_code" in 302|401) ;; *) echo "Private coach returned $coach_code, expected 302/401"; return 1 ;; esac
  echo "Verified: public learning open, personal pages and API require login."
}
check_boundary http://127.0.0.1:4323
docker compose -f docker-compose.cloudflared.yml up -d
for i in $(seq 1 20); do
  if docker logs cloudflared-learningenglish 2>&1 | grep -q 'Registered tunnel connection'; then break; fi
  sleep 3
done
check_boundary "https://$HOST"
echo "Ready: https://$HOST"
