#!/usr/bin/env bash
# Sinh mau giong doc de nghe roi chon.
#
#   bash scripts/tts-voices.sh
#
# File ra: data/voice-samples/<voice>.mp3 — mo bang Explorer nghe thu, thich
# giong nao thi sua TTS_VOICE trong .env roi:
#   docker compose up -d --no-deps evc-api
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${SPEACHES_URL:-http://127.0.0.1:8010}"
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r"' ; }
MODEL="$(get TTS_MODEL)"; MODEL="${MODEL:-speaches-ai/Kokoro-82M-v1.0-ONNX}"
SPEED="$(get TTS_SPEED)"; SPEED="${SPEED:-0.95}"

# Cau thu co so, ten rieng va cum thuong mai — nghe duoc chat giong that su,
# khong phai mot cau chao chung chung.
LINE="Thanks for joining. Before we agree on the fifteen percent discount, let's walk through the payment terms one more time."

# Giong tieng Anh cua Kokoro v1.0. af/am = My (nu/nam), bf/bm = Anh (nu/nam).
VOICES="af_heart af_bella af_nova af_sky am_michael am_puck bf_emma bm_george"

mkdir -p data/voice-samples
echo "Cau mau: $LINE"
echo

for V in $VOICES; do
  printf '%-12s ' "$V"
  code=$(curl -s -o "data/voice-samples/$V.mp3" -w '%{http_code}' --max-time 120 \
    -X POST "$BASE/v1/audio/speech" -H 'Content-Type: application/json' \
    -d "$(printf '{"model":"%s","voice":"%s","input":"%s","response_format":"mp3","speed":%s}' \
          "$MODEL" "$V" "$LINE" "$SPEED")")
  if [ "$code" = "200" ]; then
    echo "ok  ($(wc -c < "data/voice-samples/$V.mp3") bytes)"
  else
    echo "loi http $code"
    rm -f "data/voice-samples/$V.mp3"
  fi
done

echo
echo "Nghe thu:  start data\\voice-samples   (Windows Explorer)"
echo "Chot roi:  sua TTS_VOICE trong .env  ->  docker compose up -d --no-deps evc-api"
