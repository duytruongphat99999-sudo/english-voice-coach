#!/usr/bin/env bash
# Nap kho ~500 tu tieng Phap (api/content/fr/deck.json) vao HANG DOI on tu.
#
#   bash scripts/backup-db.sh          # LUON sao luu truoc — lenh nay ghi DB that
#   bash scripts/seed-fr-deck.sh
#
# Tu vao hang doi (kind='deck', due_date 9999-12-31). App tu mo 15 tu/ngay
# (store.releaseFrNew) — Duy chot 12/09. Chay lai bao nhieu lan cung duoc:
# tu da co thi bo qua (ON CONFLICT DO NOTHING), khong reset lich on cua tu nao.
#
# Thu tu vao hang doi = thu tu mo ra. Xen ke cac nhom (tung tu mot, lan luot
# tung nhom) de moi ngay 15 tu co ca dong tu, tinh tu, tu nho va tu tinh huong,
# thay vi 3 ngay lien toan dong tu.
set -euo pipefail
CONTAINER="${CONTAINER:-evc-api}"

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || { echo "LOI: container $CONTAINER khong chay." >&2; exit 1; }

docker exec -i "$CONTAINER" node --input-type=module --no-warnings - <<'MJS'
import { FR_DECK, TOPICS_FR } from '/app/dist/config.js';
import { seedFrDeck, frDeckSummary } from '/app/dist/store.js';

if (!FR_DECK.words.length) {
  console.log('Khong co api/content/fr/deck.json (hoac rong) — khong nap gi.');
  process.exit(0);
}
const lesson = new Set(TOPICS_FR.flatMap((t) => t.vocab.map((v) => v.word.trim().toLowerCase())));
const groups = new Map();
for (const w of FR_DECK.words) {
  // Tu da co trong bai hoc thi vao kho qua duong bai hoc (hoc xong chang 1), khong qua hang doi.
  if (lesson.has(w.word.trim().toLowerCase())) continue;
  if (!groups.has(w.group)) groups.set(w.group, []);
  groups.get(w.group).push(w);
}
const lists = [...groups.values()];
const order = [];
for (let i = 0; lists.some((l) => i < l.length); i += 1) for (const l of lists) if (i < l.length) order.push(l[i]);

const added = seedFrDeck(order);
const s = frDeckSummary();
console.log(`Nap moi ${added}/${order.length} tu (${order.length - added} da co san).`);
console.log(`Kho tieng Phap: ${s.total} the · dang cho mo ${s.waiting} · hom nay den han ${s.due} (tu moi ${s.due_new}) · ${s.per_day} tu moi/ngay`);
MJS
