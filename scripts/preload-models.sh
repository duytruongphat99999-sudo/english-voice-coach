#!/usr/bin/env bash
# Tai truoc model STT + TTS vao speaches.
#
# BAT BUOC chay mot lan sau `docker compose up -d`. Khong chay thi moi request
# STT/TTS deu 404: speaches khong tu tai model khi co request den.
#
# Chay tu Git Bash tren Windows:   bash scripts/preload-models.sh
# Khong can uv/uvx/pip — chi curl.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Khong thay .env. Copy tu .env.example truoc."; exit 1; }

# Doc .env ma khong eval (tranh chay nham noi dung trong gia tri).
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r"' ; }

BASE="${SPEACHES_URL:-http://127.0.0.1:8010}"
STT_MODEL="$(get STT_MODEL)"; STT_MODEL="${STT_MODEL:-Systran/faster-whisper-small}"
TTS_MODEL="$(get TTS_MODEL)"; TTS_MODEL="${TTS_MODEL:-speaches-ai/Kokoro-82M-v1.0-ONNX}"

echo "speaches : $BASE"
echo "STT      : $STT_MODEL"
echo "TTS      : $TTS_MODEL"
echo

echo "== Doi speaches san sang =="
for i in $(seq 1 60); do
  if curl -sf "$BASE/health" >/dev/null 2>&1; then echo "  san sang."; break; fi
  if [ "$i" = 60 ]; then
    echo "  KHONG len sau 5 phut. Xem log: docker compose logs evc-speaches"
    exit 1
  fi
  printf '  cho... (%d/60)\r' "$i"; sleep 5
done

installed() {
  curl -s "$BASE/v1/models" | tr ',' '\n' | grep -q "\"id\":\"$1\"" && return 0 || return 1
}

pull() {
  local id="$1" label="$2"
  if installed "$id"; then
    echo "== $label: da co, bo qua =="
    return 0
  fi
  echo "== $label: dang tai (lan dau vai tram MB, cham) =="
  local code
  # speaches tra ve khi tai xong; timeout rong cho mang VN.
  code=$(curl -s -o /tmp/evc-pull.log -w '%{http_code}' --max-time 3600 -X POST "$BASE/v1/models/$id")
  if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "409" ]; then
    echo "  THAT BAI (http $code):"; sed -n '1,10p' /tmp/evc-pull.log; exit 1
  fi
  if installed "$id"; then echo "  xong."; else echo "  BAO OK nhung khong thay trong /v1/models — kiem tra lai."; exit 1; fi
}

pull "$STT_MODEL" "STT"
pull "$TTS_MODEL" "TTS"

echo
echo "== Model dang co =="
curl -s "$BASE/v1/models" | tr '{' '\n' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | sed 's/^/  - /'

echo
echo "== Thu TTS mot cau =="
mkdir -p data/voice-samples
VOICE="$(get TTS_VOICE)"; VOICE="${VOICE:-af_heart}"
http=$(curl -s -o "data/voice-samples/_check.mp3" -w '%{http_code}' -X POST "$BASE/v1/audio/speech" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$TTS_MODEL\",\"voice\":\"$VOICE\",\"input\":\"Let me walk you through the numbers.\",\"response_format\":\"mp3\"}")
if [ "$http" = "200" ]; then
  echo "  OK -> data/voice-samples/_check.mp3 ($(wc -c < data/voice-samples/_check.mp3) bytes)"
else
  echo "  TTS loi http $http"; exit 1
fi

echo
echo "Xong. Gio co the: docker compose up -d --build evc-api evc-web"
