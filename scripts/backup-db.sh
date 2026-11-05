#!/usr/bin/env bash
# Sao luu evc.db — an toan voi WAL.
#
#   bash scripts/backup-db.sh              # sao luu, giu 14 ban gan nhat
#   KEEP=30 bash scripts/backup-db.sh      # giu 30 ban
#   DEST=/d/sao-luu bash scripts/backup-db.sh
#
# ============================================================================
# VI SAO PHAI CO SCRIPT NAY — dung tu tay `cp` evc.db, doc doan nay truoc.
#
# evc.db chay WAL mode. Toan bo du lieu that nam trong `evc.db-wal` (~1,3 MB),
# con `evc.db` chi la cai vo 4 KB dung im tu ngay tao bang. Chep mot minh
# evc.db la duoc MOT FILE RONG — mo ra khong co bang vocab — va khong co gi
# bao cho biet la vua sao luu hut. Da dinh that ngay 02/09/2026.
#
# Script nay dung `VACUUM INTO` cua SQLite: doc xuyen qua ca WAL, ghi ra MOT
# file duy nhat va nhat quan, lam duoc ngay trong luc app dang chay — khong
# can dung container, khong can khoa DB. Sau do no MO LAI ban vua ghi va dem
# so tu; khong dem duoc thi bao loi chu khong de lai mot file gz vo dung.
#
# Phuc hoi:
#   docker compose stop evc-api
#   gunzip -c <ban-sao-luu>.db.gz > data/app/evc.db
#   rm -f data/app/evc.db-wal data/app/evc.db-shm   # WAL cu khong con khop
#   docker compose start evc-api
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${CONTAINER:-evc-api}"
DEST="${DEST:-/c/docker/backups/learningenglish}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_IN_CONTAINER="/app/data/.backup-tmp.db"
TMP_ON_HOST="$ROOT/data/app/.backup-tmp.db"

die() { echo "LOI: $*" >&2; exit 1; }

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "container $CONTAINER khong chay. Bat len roi chay lai."

mkdir -p "$DEST"
rm -f "$TMP_ON_HOST" "$TMP_ON_HOST.gz"

# --- 1. Ghi ban sao nhat quan, doc xuyen WAL -------------------------------
docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/app/data/evc.db', { readOnly: true });
  db.exec(\"VACUUM INTO '$TMP_IN_CONTAINER'\");
  db.close();
" || die "VACUUM INTO that bai."

# --- 2. Nghiem thu ngay tren ban vua ghi -----------------------------------
# Khong tin buoc 1 da chay dung: mo lai ban sao va dem that.
COUNT="$(docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('$TMP_IN_CONTAINER', { readOnly: true });
  const t = db.prepare(\"SELECT count(*) n FROM sqlite_master WHERE type='table'\").get().n;
  const v = db.prepare('SELECT count(*) n FROM vocab').get().n;
  process.stdout.write(t + ' ' + v);
")" || die "ban sao ghi ra khong mo lai duoc — KHONG dung no."

TABLES="${COUNT% *}"
VOCAB="${COUNT#* }"
[ "$TABLES" -ge 6 ] || die "ban sao chi co $TABLES bang, dang le >= 6. Bo."

# --- 3. Nen va dua ra ngoai thu muc du an ----------------------------------
# Boc trong `sh -c`: git-bash tren Windows doi mot doi so trong nhu
# /app/data/... thanh C:/Program Files/Git/app/data/... truoc khi docker nhin
# thay no. Nam trong chuoi lenh thi khong bi dong toi.
docker exec "$CONTAINER" sh -c "gzip -9 '$TMP_IN_CONTAINER'" || die "nen that bai."
OUT="$DEST/evc-$STAMP.db.gz"
mv "$TMP_ON_HOST.gz" "$OUT" || die "khong chuyen duoc ban sao ra $DEST."

# --- 4. Don ban cu ---------------------------------------------------------
mapfile -t OLD < <(ls -1t "$DEST"/evc-*.db.gz 2>/dev/null | tail -n "+$((KEEP + 1))")
if [ "${#OLD[@]}" -gt 0 ]; then
  rm -f "${OLD[@]}"
  echo "da xoa ${#OLD[@]} ban cu (giu $KEEP ban gan nhat)"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "OK  $OUT  ($SIZE | $TABLES bang | $VOCAB tu)"
