#!/usr/bin/env bash
# Do do tre THUC TE cua tung model Gemini tu may nay.
#
#   bash scripts/bench-gemini.sh
#
# Vi sao can: do tre cua Google doi theo ngay va theo model. Ngay 18/08/2026
# gemini-3.5-flash mat 9-28s con flash-lite chi 0.9s — chenh 30 lan cho cung
# mot viec. Dung doan, chay cai nay roi sua GEMINI_MODEL trong .env.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="$(grep -E '^GEMINI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r"')"
[ -n "$KEY" ] || { echo "Thieu GEMINI_API_KEY trong .env"; exit 1; }

MODELS="${*:-gemini-3.5-flash-lite gemini-2.5-flash gemini-3.5-flash gemini-3.7-flash}"
RUNS=3

PAYLOAD='{"contents":[{"role":"user","parts":[{"text":"You are a procurement manager. Reply in two short sentences and end with a question."}]}],"generationConfig":{"temperature":0.7}}'

printf '%-26s %-7s %s\n' "MODEL" "OK/TOT" "do tre (ms)"
printf '%-26s %-7s %s\n' "--------------------------" "-------" "-----------"

for M in $MODELS; do
  ok=0; times=""
  for _ in $(seq 1 $RUNS); do
    s=$(date +%s%N)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 \
      -X POST "https://generativelanguage.googleapis.com/v1beta/models/$M:generateContent?key=$KEY" \
      -H 'Content-Type: application/json' -d "$PAYLOAD")
    e=$(date +%s%N)
    ms=$(( (e - s) / 1000000 ))
    [ "$code" = "200" ] && ok=$((ok+1))
    times="$times $ms"
  done
  printf '%-26s %-7s %s\n' "$M" "$ok/$RUNS" "$times"
done

echo
echo "Chon model co do tre thap NHAT ma van du chat luong sua loi."
echo "Sua GEMINI_MODEL trong .env roi: docker compose up -d --no-deps evc-api"
