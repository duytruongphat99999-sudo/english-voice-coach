// SQLite qua `node:sqlite` (builtin tu Node 22, on dinh o Node 24).
// Khong dung better-sqlite3: ban v13 khong con prebuilt binary => phai compile
// bang node-gyp => phai apt install build tools => vi pham rang buoc du an.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './config.js';

mkdirSync(dirname(cfg.dbPath), { recursive: true });

export const db = new DatabaseSync(cfg.dbPath);

// WAL: cho phep doc trong khi dang ghi. App mot nguoi dung nhung /chat ghi
// vocab trong luc UI dang poll /today.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario         TEXT    NOT NULL,
  level            TEXT    NOT NULL,
  started_at       TEXT    NOT NULL,
  ended_at         TEXT,
  transcript_json  TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS vocab (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  word              TEXT    NOT NULL,
  meaning_vi        TEXT    NOT NULL DEFAULT '',
  example_en        TEXT    NOT NULL DEFAULT '',
  domain            TEXT    NOT NULL DEFAULT '',
  source_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL,
  -- SM-2
  ease              REAL    NOT NULL DEFAULT 2.5,
  interval          INTEGER NOT NULL DEFAULT 0,
  reps              INTEGER NOT NULL DEFAULT 0,
  due_date          TEXT    NOT NULL,
  last_grade        INTEGER
);

-- Mot tu chi vao kho mot lan. Gemini rat hay tra lai cung mot tu o cac luot
-- khac nhau; khong co rang buoc nay thi deck ngap ban trung.
--
-- ⚠️ Chi muc nay bi THAY THE ngay sau khoi nay bang idx_vocab_word_lang (co
-- them cot lang). Van phai giu dong nay: cot lang duoc them bang
-- addColumnIfMissing() o duoi, luc chay khoi CREATE TABLE thi no chua ton tai.
-- (Khong dung dau huyen trong khoi nay: ca khoi la mot template literal.)
--
-- ⚠️ 12/09: BO CHU UNIQUE. Khoi nay chay o MOI lan khoi dong, TRUOC lenh DROP
-- ben duoi — nen chi muc cu duoc dung lai moi lan. Khi kho co cung mot chu o CA
-- hai ngon ngu (vd "pour": tu giao trinh tieng Anh + kho tieng Phap), dung lai
-- UNIQUE tren lower(word) la loi rang buoc -> API chet, khong khoi dong duoc
-- (review 12/09 tai hien tren ban sao DB). Rang buoc that la idx_vocab_word_lang,
-- tao ngay sau addColumnIfMissing trong cung luot khoi dong, truoc moi INSERT.
CREATE INDEX IF NOT EXISTS idx_vocab_word ON vocab(lower(word));
CREATE INDEX IF NOT EXISTS idx_vocab_due  ON vocab(due_date);

CREATE TABLE IF NOT EXISTS presentations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL,
  audio_path   TEXT,
  transcript   TEXT    NOT NULL DEFAULT '',
  wpm          INTEGER NOT NULL DEFAULT 0,
  filler_count INTEGER NOT NULL DEFAULT 0,
  report_json  TEXT    NOT NULL DEFAULT '{}'
);

-- Tien do theo LO TRINH: moi chu de 4 tang, tang sau mo khi tang truoc xong.
CREATE TABLE IF NOT EXISTS topic_progress (
  topic_id   TEXT    NOT NULL,
  stage      INTEGER NOT NULL,          -- 1 tu vung · 2 phat am · 3 phan xa dich · 4 hoi thoai
  done       INTEGER NOT NULL DEFAULT 0,
  score      INTEGER,                   -- 0-100, trung binh cac lan tra loi
  items_done INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (topic_id, stage)
);

-- Tung lan tra loi. Giu lai de sau nay nhin duoc am nao hay sai.
CREATE TABLE IF NOT EXISTS drill_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    TEXT    NOT NULL,
  stage       INTEGER NOT NULL,
  item_index  INTEGER NOT NULL,
  target      TEXT    NOT NULL,
  said        TEXT    NOT NULL DEFAULT '',
  score       INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempt_topic ON drill_attempts(topic_id, stage);

CREATE TABLE IF NOT EXISTS daily (
  date              TEXT PRIMARY KEY,
  vocab_reviewed    INTEGER NOT NULL DEFAULT 0,
  scenario_done     INTEGER NOT NULL DEFAULT 0,
  presentation_done INTEGER NOT NULL DEFAULT 0,
  completed         INTEGER NOT NULL DEFAULT 0,
  streak            INTEGER NOT NULL DEFAULT 0
);

-- Lich su lam bai PTE.
--
-- BANG RIENG, co y KHONG dung lai drill_attempts. Ly do ky thuat cu the:
-- store.recordAttempt() ghi drill_attempts kem topic_progress, ma
-- routes/today.ts dem thang topic_progress de tinh roadmap_percent — nhet PTE
-- vao do la lam sai phan tram lo trinh o trang chu.
--
-- Bang nay LAT mot nguyen tac da ghi trong CONTEXT_SYNC khoi 04/09 ("module
-- PTE khong ghi gi vao DB. Co y"). Lat vi hai ly do: de Reading CO TRI NHO
-- (lam lai de MCQ da lam la vo ich), va vi cap do chi mo khoa duoc khi biet
-- diem cua nhung lan truoc.
--
-- Cot task la dang bai ('ra' = Read Aloud, 'rs', 'wfd', ...). Cot item_id la id
-- trong file de, de dang TEXT vi de PTE danh so kieu 'p01' / 'ra07'.
-- (Khong dung dau huyen o day: ca khoi nay nam trong mot template literal.)
CREATE TABLE IF NOT EXISTS pte_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT    NOT NULL,
  item_id     TEXT    NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  score       INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  transcript  TEXT    NOT NULL DEFAULT '',
  detail_json TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pte_task  ON pte_attempts(task, created_at);
CREATE INDEX IF NOT EXISTS idx_pte_level ON pte_attempts(task, level);

-- Lo trinh PTE (11/09/2026). Mot dong duy nhat (id = 1): ngay thi va diem muc tieu.
-- Duy thi thang 03/2027, muc tieu 65. Ngay thi doi thi moi moc giai doan tu doi theo.
CREATE TABLE IF NOT EXISTS pte_plan (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  exam_date   TEXT    NOT NULL,
  target      INTEGER NOT NULL DEFAULT 65,
  updated_at  TEXT    NOT NULL
);

-- Diem thi thu CHINH THUC cua Pearson (Scored Practice Test), Duy TU NHAP.
-- App KHONG du doan duoc diem PTE — day la can cu that duy nhat cua lo trinh.
-- set_no: bo de 1/2/3 cua Pearson (NULL neu thi thu o cho khac).
CREATE TABLE IF NOT EXISTS pte_mock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_on    TEXT    NOT NULL,
  set_no      INTEGER,
  overall     INTEGER NOT NULL,
  listening   INTEGER NOT NULL,
  reading     INTEGER NOT NULL,
  speaking    INTEGER NOT NULL,
  writing     INTEGER NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
`);

// ---------------------------------------------------------------------------
// SQLite khong co `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, va chay lai lenh
// ADD COLUMN se nem loi lam chet ca app luc khoi dong. Hoi pragma truoc.
// ---------------------------------------------------------------------------
function addColumnIfMissing(table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// Kho tu cu (do Gemini dao ra luc hoi thoai) khong co hai truong nay.
// Them chu KHONG xoa cot nao — du lieu da hoc van dung duoc.
addColumnIfMissing('vocab', 'topic_id', 'TEXT');
addColumnIfMissing('vocab', 'ipa', "TEXT NOT NULL DEFAULT ''");
// 'mined'  = Gemini dao ra tu hoi thoai (kho cu)
// 'course' = nap tu noi dung khoa hoc trong api/content/
addColumnIfMissing('vocab', 'kind', "TEXT NOT NULL DEFAULT 'mined'");

// FSRS-6 (02/09/2026). Theo dung luat o tren: THEM cot, khong xoa cot nao.
// ease/interval/reps van con de lui ve sm2() duoc bat cu luc nao.
//   stability  = nho duoc bao lau (ngay)
//   difficulty = the nay kho toi dau, 1-10
//   fsrs_state = 0 New · 1 Learning · 2 Review · 3 Relearning
//   lapses     = so lan quen han
// stability = 0 nghia la the chua tung duoc FSRS cham => coi nhu the moi.
addColumnIfMissing('vocab', 'stability', 'REAL NOT NULL DEFAULT 0');
addColumnIfMissing('vocab', 'difficulty', 'REAL NOT NULL DEFAULT 0');
addColumnIfMissing('vocab', 'fsrs_state', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('vocab', 'lapses', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('vocab', 'last_review', 'TEXT');
// Ngay nguoi hoc bam "De sau" cho the nay (YYYY-MM-DD).
//
// Nut de sau chi day rieng due_date sang mai, KHONG dong vao FSRS — ly do bam
// thuong la on / hong mic / met, khong phai quen tu. Nhung neu chi doi due_date
// thi dueCountExcludingToday() se coi nhu deck da rong va cho chot ngay + tang
// streak du chua on tu nao. Cot nay de phan biet "the mai moi toi han" voi
// "the hom nay bi day sang mai".
addColumnIfMissing('vocab', 'buried_on', 'TEXT');

// ---------------------------------------------------------------------------
// NGON NGU cua the: 'en' | 'fr'. Mac dinh 'en' — moi the dang co deu la tieng Anh.
//
// Duy chot 07/09/2026: tieng Anh va tieng Phap la HAI KHONG GIAN RIENG, khong
// dung nhau. Chon ngon ngu ngay khi vao app.
// ---------------------------------------------------------------------------
addColumnIfMissing('vocab', 'lang', "TEXT NOT NULL DEFAULT 'en'");

// Ngay the tieng Phap trong kho 500 tu duoc MO ra cho hoc (YYYY-MM-DD); lan dau
// tra loi thi doi thanh ngay HOC LAN DAU (store.markFrFirstSeen, 16/09). NULL =
// con nam trong hang doi (kind='deck', due_date = HANG_DOI_FR xa tit).
//
// Duy chot 12/09: mo 15 tu moi/ngay. Khong dung cach rai due_date truoc, vi bo
// hoc vai ngay la tu moi DON LAI thanh dong; o day ngay nao mo app moi mo them,
// va dem theo cot nay nen moi ngay khong qua 15. The tieng Anh khong dung cot nay.
addColumnIfMissing('vocab', 'introduced_on', 'TEXT');

// ⚠️ DOI CHI MUC DUY NHAT: (lower(word)) -> (lower(word), lang).
//
// Chi muc cu chan xuyen NGON NGU: tu tieng Phap trung chu tieng Anh se bi
// `ON CONFLICT DO NOTHING` nuot IM LANG, khong bao gi. Danh sach va cham that:
// important · table · police · sale · chance · chair · pain · coin · main ·
// ton · son · car · pour · plus · fin · but · train · film · long · sort.
//
// Doi chi muc phai lam theo thu tu nay: tao chi muc moi TRUOC roi mai xoa cai
// cu. Lam nguoc lai thi giua hai lenh co mot khoang khong co rang buoc nao.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_word_lang ON vocab(lower(word), lang)`);
db.exec('DROP INDEX IF EXISTS idx_vocab_word');

// ---------------------------------------------------------------------------
// Ngay theo gio Viet Nam, khong theo UTC. Neu dung UTC thi hoc luc 22h toi
// se bi tinh sang ngay hom sau va streak dut oan.
// ---------------------------------------------------------------------------
export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: cfg.tz }); // YYYY-MM-DD
}

export function daysAgoLocal(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: cfg.tz });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type DailyRow = {
  date: string;
  vocab_reviewed: number;
  scenario_done: number;
  presentation_done: number;
  completed: number;
  streak: number;
};

export function getOrCreateToday(): DailyRow {
  const date = todayLocal();
  const found = db.prepare('SELECT * FROM daily WHERE date = ?').get(date) as DailyRow | undefined;
  if (found) return found;
  db.prepare('INSERT INTO daily (date) VALUES (?)').run(date);
  return db.prepare('SELECT * FROM daily WHERE date = ?').get(date) as DailyRow;
}
