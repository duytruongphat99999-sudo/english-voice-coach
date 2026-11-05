#!/usr/bin/env bash
# Dat mat khau vao app.
#
#   bash scripts/set-password.sh                  # tu sinh mat khau manh
#   bash scripts/set-password.sh 'matkhaucuatoi'  # tu dat
#   bash scripts/set-password.sh --logout-all     # giu mat khau, da moi thiet bi ra
#
# Ghi APP_PASSWORD va APP_SECRET vao .env.
#   APP_PASSWORD — thu go o trang dang nhap
#   APP_SECRET   — khoa ky cookie phien. Doi no = moi thiet bi phai dang nhap lai.
#                  Chi sinh mot lan; muon da het ra thi dung --logout-all.
#
# Sua .env bang Node chu khong bang sed: mat khau co the chua & / \ | va cac
# ky tu sed dien giai, thay vi escape cho du thi tranh han.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Khong thay .env. Copy tu .env.example truoc."; exit 1; }
command -v openssl >/dev/null || { echo "Khong co openssl. Git Bash thuong co san."; exit 1; }

ROTATE_SECRET=0
PASS=""
case "${1:-}" in
  --logout-all) ROTATE_SECRET=1 ;;
  "")           ;;
  *)            PASS="$1" ;;
esac

if [ -z "$PASS" ] && [ "$ROTATE_SECRET" = 0 ]; then
  # Bo cac ky tu de nhin nham khi go tay tren dien thoai: 0/O, 1/l/I.
  #
  # KHONG dung `... | head -c 20`: head dong ong ngay khi du 20 ky tu, tr an
  # SIGPIPE, va `set -o pipefail` bien no thanh loi 141. Loc het roi cat bang
  # bash substring thi khong co ong nao bi dong som.
  RAW="$(openssl rand -base64 60 | LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9')"
  PASS="${RAW:0:20}"
  [ "${#PASS}" -eq 20 ] || { echo "Sinh mat khau that bai."; exit 1; }
fi

NEW_SECRET="$(openssl rand -hex 32)"

PASS="$PASS" NEW_SECRET="$NEW_SECRET" ROTATE_SECRET="$ROTATE_SECRET" node -e '
const fs = require("fs");
const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/);

function setVar(name, value) {
  const i = lines.findIndex((l) => l.startsWith(name + "="));
  if (i >= 0) lines[i] = name + "=" + value;
  else lines.push(name + "=" + value);
}
function getVar(name) {
  const l = lines.find((x) => x.startsWith(name + "="));
  return l ? l.slice(name.length + 1).trim() : "";
}

const pass = process.env.PASS;
if (pass) setVar("APP_PASSWORD", pass);

// Chi sinh APP_SECRET khi chua co, hoac khi duoc yeu cau da het ra.
const had = getVar("APP_SECRET");
const rotate = process.env.ROTATE_SECRET === "1";
if (!had || rotate) setVar("APP_SECRET", process.env.NEW_SECRET);

fs.writeFileSync(".env", lines.join("\n"));
console.log(JSON.stringify({ passChanged: !!pass, secretChanged: !had || rotate }));
' > /tmp/evc-setpass.json

CHANGED_SECRET="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/evc-setpass.json","utf8")).secretChanged)')"
rm -f /tmp/evc-setpass.json

echo "Da cap nhat .env"
echo
if [ -n "$PASS" ]; then
  echo "  mat khau : $PASS"
  echo
  echo "GHI LAI NGAY. .env co luu ban ro, nhung dung de no la cho duy nhat."
fi
[ "$CHANGED_SECRET" = "true" ] && echo "  APP_SECRET moi -> moi thiet bi se phai dang nhap lai."
echo
echo "Ap dung:"
echo "  docker compose up -d --no-deps evc-api"
