#!/usr/bin/env bash
# Dung san toan bo clip giong doc, de lan bam nut nghe DAU TIEN cung tuc thi.
#
#   bash scripts/pregen-tts.sh              # dung het: kho on tap + 240 tu + de PTE + shadowing
#   ONLY=deck  bash scripts/pregen-tts.sh   # CHI the dang co trong kho on tap (nhanh nhat)
#   ONLY=words bash scripts/pregen-tts.sh   # chi bo noi dung 20 chu de
#   ONLY=pte   bash scripts/pregen-tts.sh   # chi de PTE
#   ONLY=shadow bash scripts/pregen-tts.sh  # moi cau shadowing: giong mau + moc tung chu
#   ONLY=listen bash scripts/pregen-tts.sh  # moi bai nghe PTE (them 12/09)
#   ONLY=open   bash scripts/pregen-tts.sh  # bai Noi/Viet co nghe: sst, rl, rts, sgd (them 12/09)
#   ONLY=fr     bash scripts/pregen-tts.sh  # tieng Phap: 8 chu de + kho 500 tu, giong ff_siwis (them 12/09)
#
# ⚠️ KHONG sua file nay trong luc no dang chay — bash doc file tung doan khi chay,
#    sua giua chung la no chay mot dong rac (da dinh 12/09).
#
# ONLY=shadow (them 11/09): moi cau shadowing can HAI thu — clip giong mau va
# moc thoi gian tung chu (Whisper nghe lai clip mau, luu o /app/data/shadow-cache).
# Do that 11/09: 478/498 cau chua co moc -> lan dau moi cau mat ~1,9 giay, va
# cau Doc doan (ra) con chua co ca clip -> 3,4-7 giay. Chay ~15-20 phut.
#
# ============================================================================
# VI SAO CAN — doc truoc khi bo qua.
#
# speaches KHONG cache gi. Do that 06/09/2026: cung mot clip goi ba lan van mat
# 2,34 / 1,94 / 2,06 giay. tts.ts nay da co cache dia nen lan nghe THU HAI tro
# di chi con ~0,007 giay, nhung lan DAU cua moi clip thi van phai cho tong hop.
#
# Script nay di goi truoc tat ca, luc khong ai dung, de nguoi hoc khong bao gio
# phai cho. Chay mot lan sau khi doi noi dung hoac doi giong (TTS_VOICE).
#
# ⚠️ NO GIANH CPU VOI evc-speaches. Trong luc chay, cac man khac (/chat,
#    /review, /learn) se cham theo. Dung chay luc dang hoc.
#
# ⚠️ Doi TTS_VOICE / TTS_SPEED / TTS_MODEL la moi clip cu thanh vo dung (ten
#    file la hash cua ca bon thu do). Chung nam lai vo hai, nhung phai chay lai
#    script nay. Muon don rac: xoa han thu muc data/app/tts-cache roi chay lai.
# ============================================================================
set -euo pipefail

CONTAINER="${CONTAINER:-evc-api}"
ONLY="${ONLY:-all}"
TMP="${TMPDIR:-/tmp}/pregen-tts.$$.mjs"

die() { echo "LOI: $*" >&2; exit 1; }

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "container $CONTAINER khong chay. Bat len roi chay lai."

cat > "$TMP" <<'MJS'
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { synthesize } from '/app/dist/tts.js';
import { sayAsFor } from '/app/dist/config.js';

const ONLY = process.env.ONLY || 'all';
const DIR = '/app/content';
const jobs = [];
// Clip TIENG PHAP (giong ff_siwis). Tach rieng vi `jobs` doc bang giong mac dinh
// tieng Anh — ma giong nam trong khoa cache, doc sai giong la cache truot.
const JOBS_FR = [];

// --- Kho on tap that (bang vocab) -----------------------------------------
//
// PHAI QUET DB, khong duoc chi quet api/content. The 'mined' (Gemini dao ra tu
// /chat) CHI ton tai trong DB, khong co trong file noi dung nao — ma do lai
// dung la nhung the nguoi hoc cham vao moi ngay o man On tu. Ban dau script
// nay chi quet content nen bo sot ca 10 the dang co trong kho, tuc bo dung
// phan nguoi dung cham nhat. Da dinh that 06/09.
if (ONLY === 'all' || ONLY === 'deck') {
  try {
    const db = new DatabaseSync('/app/data/evc.db', { readOnly: true });
    const rows = db.prepare('SELECT word, example_en, lang FROM vocab').all();
    db.close();
    for (const r of rows) {
      // Dung DUNG chuoi ma routes/review.ts gui cho TTS.
      const sayWord = sayAsFor(r.word) ?? r.word;
      // The tieng Phap (12/09): review.ts doc bang giong 'fr' — dung giong do.
      const dst = r.lang === 'fr' ? JOBS_FR : jobs;
      if (sayWord) dst.push(sayWord);
      if (r.example_en) dst.push(`${sayWord}. ${r.example_en}`);
    }
    console.log(`[pregen] kho on tap: ${rows.length} the.`);
  } catch (e) {
    console.warn(`[pregen] khong doc duoc bang vocab: ${e.message}`);
  }
}

if (ONLY === 'all' || ONLY === 'words') {
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json') || f === 'index.json' || f.startsWith('pte-')) continue;
    const j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
    for (const v of j.vocab || []) {
      // Dung DUNG chuoi ma route gui cho TTS, neu khong thi hash khac va cache truot.
      // review.ts: ?part=word -> sayWord ; khong co part -> "sayWord. example_en"
      const sayWord = v.say_as ?? v.word;
      if (sayWord) jobs.push(sayWord);
      if (v.example_en) jobs.push(`${sayWord}. ${v.example_en}`);
      // learn.ts doc example_en tran (khong ghep tu o dau).
      if (v.example_en) jobs.push(v.example_en);
    }
    for (const s of j.sentences || []) if (s.en) jobs.push(s.en);
    for (const t of j.translate || []) if (t.en_ref) jobs.push(t.en_ref);
  }
}

// Bai nghe PTE (them 12/09): goi DUNG spokenText() ma /pte/listening/say dung,
// nen ten file cache khop tuyet doi. Bai dai (~150 tu) mat 30-40 giay moi bai.
if (ONLY === 'all' || ONLY === 'listen') {
  try {
    const { LISTENING, spokenText } = await import('/app/dist/pte-listening.js');
    for (const it of LISTENING) jobs.push(spokenText(it));
    console.log(`[pregen] bai nghe PTE: ${LISTENING.length} bai.`);
  } catch (e) {
    console.warn(`[pregen] khong nap duoc pte-listening: ${e.message}`);
  }
}

// Bai Noi/Viet co nghe (them 12/09): sst, rl, rts va TUNG luot sgd (giong rieng
// tung nguoi). Goi thang synthesize() voi dung giong — khong qua `jobs` vi jobs
// chi mang chuoi, dung giong mac dinh.
const JOBS_GIONG = [];
if (ONLY === 'all' || ONLY === 'open') {
  try {
    const { OPEN, spokenText } = await import('/app/dist/pte-open.js');
    for (const it of OPEN) {
      if (it.type === 'sgd') it.turns.forEach((_, i) => JOBS_GIONG.push(spokenText(it, i)));
      else { const s = spokenText(it); if (s) JOBS_GIONG.push(s); }
    }
    console.log(`[pregen] bai Noi/Viet co nghe: ${JOBS_GIONG.length} clip.`);
  } catch (e) {
    console.warn(`[pregen] khong nap duoc pte-open: ${e.message}`);
  }
}

// Tieng Phap (dot B, 12/09): 8 chu de (routes/fr.ts /fr/learn/say, dictee) +
// kho 500 tu (review.ts /review/say: "tu" va "tu. cau vi du"). Doc tu dist/config
// nen chuoi khop tuyet doi voi luc chay. Kho 500 tu co ca trong DB (sau khi
// seed) lan trong FR_DECK — Set o duoi loc trung.
if (ONLY === 'all' || ONLY === 'fr') {
  try {
    const { TOPICS_FR, FR_DECK } = await import('/app/dist/config.js');
    for (const t of TOPICS_FR) {
      for (const v of t.vocab) {
        JOBS_FR.push(v.word, v.example_en, `${v.word}. ${v.example_en}`);
      }
      for (const s of t.sentences) JOBS_FR.push(s.en);
      for (const s of t.translate) JOBS_FR.push(s.en_ref);
    }
    for (const w of FR_DECK.words) JOBS_FR.push(w.word, `${w.word}. ${w.example_fr}`);
    console.log(`[pregen] tieng Phap: ${TOPICS_FR.length} chu de, ${FR_DECK.words.length} tu trong kho.`);
  } catch (e) {
    console.warn(`[pregen] khong nap duoc noi dung tieng Phap: ${e.message}`);
  }
}

if (ONLY === 'all' || ONLY === 'pte') {
  const p = `${DIR}/pte-sentences.json`;
  try {
    for (const s of JSON.parse(readFileSync(p, 'utf8')).sentences || []) {
      if (s.text) jobs.push(s.text);
    }
  } catch {
    console.warn('[pregen] khong doc duoc pte-sentences.json, bo qua.');
  }
}

const uniq = [...new Set(jobs.map((s) => s.trim()).filter(Boolean))];
console.log(`Can dung ${uniq.length} clip (ONLY=${ONLY}).`);

let moi = 0, sanCo = 0, loi = 0;
const t0 = Date.now();
for (let i = 0; i < uniq.length; i += 1) {
  const t = Date.now();
  try {
    await synthesize(uniq[i]);
    // Duoi 100ms nghia la doc thang tu dia, khong goi speaches.
    if (Date.now() - t < 100) sanCo += 1; else moi += 1;
  } catch (e) {
    loi += 1;
    console.warn(`  [loi] ${uniq[i].slice(0, 50)} -> ${e.message}`);
  }
  if ((i + 1) % 25 === 0 || i === uniq.length - 1) {
    const giay = Math.round((Date.now() - t0) / 1000);
    console.log(`  ${i + 1}/${uniq.length}  (moi ${moi} · san co ${sanCo} · loi ${loi})  ${giay}s`);
  }
}
const giay = Math.round((Date.now() - t0) / 1000);
console.log(`\nXong sau ${giay}s — dung moi ${moi}, da co san ${sanCo}, loi ${loi}.`);

// Clip tieng Phap (12/09).
const uniqFr = [...new Set(JOBS_FR.map((s) => String(s ?? '').trim()).filter(Boolean))];
if (uniqFr.length) {
  let fMoi = 0, fSan = 0;
  const f0 = Date.now();
  console.log(`\n[pregen] clip tieng Phap: ${uniqFr.length}`);
  for (let i = 0; i < uniqFr.length; i += 1) {
    const t = Date.now();
    try {
      await synthesize(uniqFr[i], 'fr');
      if (Date.now() - t < 100) fSan += 1; else fMoi += 1;
    } catch (e) {
      loi += 1;
      console.warn(`  [loi] ${uniqFr[i].slice(0, 50)} -> ${e.message}`);
    }
    if ((i + 1) % 50 === 0 || i === uniqFr.length - 1) {
      console.log(`  fr ${i + 1}/${uniqFr.length}  (moi ${fMoi} · san co ${fSan})  ${Math.round((Date.now() - f0) / 1000)}s`);
    }
  }
}

// Clip co giong rieng (bai Noi/Viet co nghe, them 12/09).
if (JOBS_GIONG.length) {
  let gMoi = 0, gSan = 0;
  const g0 = Date.now();
  for (let i = 0; i < JOBS_GIONG.length; i += 1) {
    const { text, voice } = JOBS_GIONG[i];
    const t = Date.now();
    try {
      await synthesize(text, 'en', voice);
      if (Date.now() - t < 100) gSan += 1; else gMoi += 1;
    } catch (e) {
      loi += 1;
      console.warn(`  [loi] ${text.slice(0, 50)} -> ${e.message}`);
    }
    if ((i + 1) % 10 === 0 || i === JOBS_GIONG.length - 1) {
      console.log(`  ${i + 1}/${JOBS_GIONG.length}  (moi ${gMoi} · san co ${gSan})  ${Math.round((Date.now() - g0) / 1000)}s`);
    }
  }
}

// --- Shadowing: giong mau + moc tung chu ------------------------------------
//
// Goi DUNG ham refTiming() ma /shadow/prep va /shadow/answer goi, nen ten file
// cache khop tuyet doi. refTiming tu goi synthesize() — cau nao chua co clip
// (vd cau Doc doan tach tu doan Read Aloud) cung duoc dung clip luon.
if (ONLY === 'all' || ONLY === 'shadow') {
  const { SHADOW_ITEMS, refTiming } = await import('/app/dist/shadow.js');
  const texts = [...new Set(SHADOW_ITEMS.map((x) => x.text.trim()).filter(Boolean))];
  console.log(`\n[shadow] Can moc cho ${texts.length} cau.`);
  let sMoi = 0, sSan = 0, sLoi = 0;
  const s0 = Date.now();
  for (let i = 0; i < texts.length; i += 1) {
    const t = Date.now();
    try {
      await refTiming(texts[i]);
      if (Date.now() - t < 100) sSan += 1; else sMoi += 1;
    } catch (e) {
      sLoi += 1;
      console.warn(`  [loi] ${texts[i].slice(0, 50)} -> ${e.message}`);
    }
    if ((i + 1) % 25 === 0 || i === texts.length - 1) {
      const g = Math.round((Date.now() - s0) / 1000);
      console.log(`  ${i + 1}/${texts.length}  (moi ${sMoi} · san co ${sSan} · loi ${sLoi})  ${g}s`);
    }
  }
  loi += sLoi;
}

if (loi) process.exit(1);
MJS

docker cp "$TMP" "$CONTAINER:/tmp/pregen-tts.mjs" >/dev/null || die "khong chep duoc script vao container."
rm -f "$TMP"

# Boc trong `sh -c`: git-bash tren Windows doi doi so trong nhu /tmp/x.mjs thanh
# C:/Program Files/Git/tmp/x.mjs truoc khi docker nhin thay. Nam trong chuoi lenh
# thi khong bi dong toi. Da dinh that 06/09.
docker exec -e "ONLY=$ONLY" "$CONTAINER" sh -c "node /tmp/pregen-tts.mjs"
KQ=$?

docker exec -u root "$CONTAINER" sh -c "rm -f /tmp/pregen-tts.mjs" >/dev/null 2>&1 || true

SO="$(docker exec "$CONTAINER" sh -c "ls -1 /app/data/tts-cache 2>/dev/null | wc -l" | tr -d '\r')"
DUNG="$(docker exec "$CONTAINER" sh -c "du -sh /app/data/tts-cache 2>/dev/null | cut -f1" | tr -d '\r')"
echo "Kho clip: $SO file | $DUNG"
MOC="$(docker exec "$CONTAINER" sh -c "ls -1 /app/data/shadow-cache 2>/dev/null | wc -l" | tr -d '\r')"
echo "Kho moc shadowing: $MOC file"
exit $KQ
