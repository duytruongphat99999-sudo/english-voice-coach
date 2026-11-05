// Client goi API. nginx proxy /api -> evc-api nen luon cung origin.
const BASE = '/api';

export class ApiError extends Error {}

/**
 * Het phien -> ve trang dang nhap, nho lai cho dang dung do.
 *
 * nginx CO Y de /api/ tra 401 tho thay vi 302: neu no redirect thi fetch()
 * se lang le nhan ve HTML trang dang nhap va bao "khong phai JSON", chi sai
 * cho. Bat 401 o day moi la dung tang.
 */
function toLogin(): never {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login.html?next=${next}`);
  // location.replace khong dung ngay lap tuc; nem de nguoi goi khong chay tiep.
  throw new ApiError('Phiên đã hết, đang chuyển sang trang đăng nhập…');
}

async function jsonOf<T>(res: Response): Promise<T> {
  if (res.status === 401) toLogin();
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Server tra ve khong phai JSON (${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `Loi ${res.status}`;
    throw new ApiError(msg);
  }
  return body as T;
}

export async function get<T>(path: string): Promise<T> {
  return jsonOf<T>(await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } }));
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return jsonOf<T>(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

/** PUT JSON. Them 11/09 cho PUT /pte/plan (dat ngay thi / diem muc tieu). */
export async function put<T>(path: string, body?: unknown): Promise<T> {
  return jsonOf<T>(
    await fetch(`${BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  return jsonOf<T>(await fetch(`${BASE}${path}`, { method: 'POST', body: form }));
}

// ---------------------------------------------------------------------------
// SSE tren POST. EventSource khong POST duoc va khong gui duoc file, nen phai
// tu doc stream cua fetch va tach event bang tay.
// ---------------------------------------------------------------------------
export type SseHandler = (event: string, data: any) => void;

export async function postSse(path: string, form: FormData, onEvent: SseHandler, signal?: AbortSignal) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, signal });

  if (res.status === 401) toLogin();

  if (!res.ok || !res.body) {
    // Loi truoc luc stream bat dau van la JSON thuong.
    let msg = `Loi ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* giu msg mac dinh */
    }
    throw new ApiError(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let sep: number;
    // Moi event ket thuc bang mot dong trong.
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let name = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try {
        onEvent(name, JSON.parse(dataLines.join('\n')));
      } catch {
        // Mieng hong — bo qua, khong lam chet ca luot.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Kieu du lieu
// ---------------------------------------------------------------------------
export type Today = {
  date: string;
  next_lesson: {
    topic_id: string;
    name_vi: string;
    emoji: string;
    track_vi: string;
    stage: number;
    stage_vi: string;
  } | null;
  roadmap_percent: number;
  due_count: number;
  suggested_scenario: string;
  suggested_scenario_vi: string;
  streak: number;
  steps_done: { vocab: boolean; scenario: boolean; presentation: boolean };
  vocab_reviewed: number;
  completed: boolean;
};

export type ScenarioBrief = { id: string; name_vi: string; domain: string };

export type Correction = { you_said: string; better: string; why_vi: string };
export type VocabItem = { word: string; meaning_vi: string; example_en: string; domain: string };

export type DueCard = {
  id: number;
  word: string;
  ipa: string;
  meaning_vi: string;
  example_en: string;
  domain: string;
  topic_id: string | null;
  reps: number;
  interval: number;
  due_date: string;
};

export type ReviewAnswer = {
  /**
   * The da tra loi, do CLIENT gan vao sau khi nhan ket qua (server khong tra).
   * Giu kem de khoi ket qua luon hien tu / nghia / nut nghe cua CUNG mot the,
   * ke ca khi danh sach the bi thay giua chung.
   */
  card?: DueCard;
  word_id: number;
  word: string;
  ipa: string;
  example_en: string;
  transcript: string;
  ok: boolean;
  grade: number;
  /** 0-100 tu doi chieu am; grade la ban quy doi sang thang SM-2. */
  score: number;
  matched: string | null;
  /** Mili giay tu luc the hien ra toi luc cham mic. null = khong do duoc. */
  think_ms: number | null;
  feedback_vi: string;
  next_due: string;
  interval: number;
  reps: number;
};

// ---------------------------------------------------------------------------
// PTE — Repeat Sentence + Write from Dictation
// ---------------------------------------------------------------------------

/** De KHONG kem cau goc: ca hai task deu la nghe roi tai tao lai. */
export type PteItem = { id: string; word_count: number };
export type PteItems = { total_bank: number; items: PteItem[] };

export type PteWordStatus = 'ok' | 'weak' | 'ending' | 'wrong' | 'missing';
export type PteWord = {
  target: string;
  said: string | null;
  status: PteWordStatus;
  probability: number | null;
};

export type PteResult = {
  id: string;
  mode: 'rs' | 'wfd';
  /** Cau goc, chi ve sau khi da tra loi. */
  target: string;
  transcript: string;
  /** Diem kieu PTE: tu khop chinh xac / tong tu. */
  pte_score: number;
  correct: number;
  total: number;
  dropped_endings: number;
  /** Diem mem cua bo cham phat am — de doi chieu, KHONG phai diem PTE. */
  raw_score: number;
  words: PteWord[];
  extra: string[];
};

/** Mot dong trong lich su Record & Roast (GET /presentation). */
export type PresentationListItem = {
  id: number;
  created_at: string;
  wpm: number;
  filler_count: number;
};

export type PresentationReport = {
  id: number;
  /** Chi co khi xem lai ban cu (GET /presentation/:id). */
  created_at?: string;
  transcript: string;
  wpm: number;
  words: number;
  duration_s: number;
  filler_count: number;
  filler_breakdown: Record<string, number>;
  report: {
    structure_score: number;
    structure_vi: string;
    pace_vi: string;
    fixes: Correction[];
    next_focus_vi: string;
  };
};

export type Progress = {
  streak: number;
  words_total: number;
  words_learned: number;
  words_due: number;
  sessions: number;
  sessions_finished: number;
  wpm_trend: { id: number; created_at: string; wpm: number; filler_count: number }[];
  last_30_days: { date: string; completed: boolean; vocab_reviewed: number }[];
  by_domain: { domain: string; n: number }[];
};

// ---------------------------------------------------------------------------
// Lo trinh + cac chang hoc
// ---------------------------------------------------------------------------
export type StageInfo = {
  stage: number;
  key: 'vocab' | 'pronounce' | 'translate' | 'talk';
  name_vi: string;
  hint_vi: string;
  done: boolean;
  score: number | null;
  items_done: number;
  total: number;
};

export type RoadmapTopic = {
  id: string;
  name_vi: string;
  emoji: string;
  track: string;
  track_vi: string;
  order: number;
  stages: StageInfo[];
  unlocked: number;
  done_stages: number;
  percent: number;
};

export type Roadmap = {
  topics: RoadmapTopic[];
  overall_percent: number;
  done_stages: number;
  total_stages: number;
  next: { topic_id: string; name_vi: string; emoji: string; stage: number } | null;
  tracks: { key: string; name_vi: string }[];
};

export type LessonPayload = {
  id: string;
  name_vi: string;
  emoji: string;
  track_vi: string;
  stage: StageInfo;
  items: unknown[];
  scenario?: { id: string; role: string; context: string; opener_en: string; opener_vi: string };
};

export type WordResult = {
  target: string;
  said: string | null;
  status: 'ok' | 'weak' | 'ending' | 'wrong' | 'missing';
  probability: number | null;
};

export type AnswerResult = {
  topic_id: string;
  stage: number;
  index: number;
  target: string;
  transcript: string;
  score: number;
  pass: boolean;
  progress: { items_done: number; total: number; score: number | null };
  words?: WordResult[];
  extra?: string[];
  summary?: Record<string, number>;
  feedback_vi?: string;
  focus_word?: string;
  better_en?: string;
  reference_en?: string;
  grade?: number;
  ok?: boolean;
};

export type VocabTopicCount = {
  topic_id: string;
  n: number;
  due: number;
  /** Nhan TIENG VIET de hien tren chip. Server luon tra, khong bao gio rong. */
  label?: string;
  emoji?: string | null;
  /** true = chu de giao trinh; false = nhom do Gemini dat khi dao tu. */
  is_course?: boolean;
};

// --- Read Aloud (PTE Noi) ---------------------------------------------------
// Chi THEM, khong sua kieu nao co san.

export type PteLevelProgress = {
  level: number;
  /** So bai da lam o cap hien tai. */
  done: number;
  /** Diem trung binh cac bai gan nhat o cap hien tai. */
  avg: number;
  /** Con thieu bao nhieu bai nua moi du dieu kien xet len cap. */
  need: number;
  unlocked_max: number;
};

export type RaItem = {
  id: string;
  level: number;
  topic: string;
  /**
   * Van ban goc. Read Aloud CO tra ve — day la ngoai le co chu y cua luat
   * "/pte/items khong tra cau goc", vi day la bai DOC, giau chu di thi
   * khong con bai. Xem chu thich trong api/src/routes/pte-speaking.ts.
   */
  text: string;
  word_count: number;
  source: string | null;
};

export type RaItems = {
  level: number;
  progress: PteLevelProgress;
  max_level: number;
  total_bank: number;
  items: RaItem[];
};

export type RaAttempt = {
  id: number;
  item_id: string;
  level: number;
  score: number;
  correct: number;
  total: number;
  created_at: string;
};

export type RaProgress = {
  progress: PteLevelProgress;
  max_level: number;
  bank: { level: number; n: number }[];
  recent: RaAttempt[];
};

export type RaResult = {
  id: string;
  level: number;
  mode: 'ra';
  target: string;
  transcript: string;
  pte_score: number;
  correct: number;
  total: number;
  dropped_endings: number;
  raw_score: number;
  words: PteWord[];
  extra: string[];
  /** Chi bao THO ve nhip noi — KHONG phai Oral Fluency cua PTE. */
  wpm: number;
  duration_s: number;
  filler_count: number;
  filler_breakdown: Record<string, number>;
  pauses: number;
  longest_pause_s: number;
  /** So tu chem them. Bay rieng vi pte_score bo qua no hoan toan. */
  extra_count: number;
  progress: PteLevelProgress;
};

// --- Shadowing (PTE) --------------------------------------------------------
// Chi THEM, khong sua kieu nao co san.

export type ShadowMode = 'rs' | 'ra' | 'vocab' | 'lesson';

export type ShadowItem = {
  id: string;
  mode: ShadowMode;
  level: number | null;
  word_count: number;
  /** Doi 12/09: server tra chu cho MOI che do; man Shadowing tu an chu Nhai cau khi nguoi hoc tat. */
  text: string | null;
  /** Ten chu de (vocab/lesson). */
  group?: string | null;
  /** Nghia tieng Viet. */
  vi?: string | null;
  /** Diem phat am can chu y (chi cau bai hoc). */
  focus_vi?: string | null;
};

export type ShadowItems = { mode: ShadowMode; total_bank: number; items: ShadowItem[] };

export type ShadowWordTiming = {
  word: string;
  /** Lech so voi nhip mau (ms), da bu toc do chung. null = khong ghep duoc. */
  offset_ms: number | null;
  extra_pause_ms: number | null;
};

export type ShadowTiming = {
  /** Nguoi / mau. 1,00 = khop; >1 cham hon; <1 nhanh hon. */
  tempo_ratio: number | null;
  mean_offset_ms: number | null;
  matched: number;
  total: number;
  extra_pauses: number;
  words: ShadowWordTiming[];
};

export type ShadowResult = {
  id: string;
  mode: ShadowMode;
  target: string;
  transcript: string;
  pte_score: number;
  correct: number;
  total: number;
  dropped_endings: number;
  raw_score: number;
  words: PteWord[];
  extra: string[];
  timing: ShadowTiming;
  /** Them 11/09: moc tung chu de chu chay theo giong mau. */
  karaoke?: KaraWord[] | null;
};

/** Mot chu TREN MAN (giu dau cau) kem moc giay trong audio mau. Them 11/09. */
export type KaraWord = { w: string; s: number; e: number };

/** GET /shadow/prep/:id. `karaoke` LUON null voi 'rs' (khong lo chu truoc khi nop). */
export type ShadowPrep = { id: string; words: number; duration_s: number; karaoke: KaraWord[] | null };

/** Che do "Nghe roi noi lai ca doan" — GET /shadow/passages. Them 11/09. */
export type ShadowPassage = {
  id: string;
  src: 'ra' | 'lesson';
  title: string;
  sub: string;
  emoji: string | null;
  level: number | null;
  items: { id: string; text: string; vi: string | null; focus_vi: string | null; word_count: number }[];
};

// --- Lo trinh PTE -----------------------------------------------------------
// Chi THEM, khong sua kieu nao co san.

export type PtePlanBlock = {
  id: string;
  name_vi: string;
  minutes: number;
  in_app: boolean;
  href: string | null;
  why_vi: string;
};

export type PtePhase = {
  phase: 'chan_doan' | 'nen_tang' | 'tang_toc' | 'chot' | 'da_thi';
  ten: string;
  mo_ta: string;
  days_left: number;
  weeks_left: number;
  next_mock: { set_no: number; khi_vi: string } | null;
};

export type PteMockRow = {
  id: number;
  taken_on: string;
  set_no: number | null;
  overall: number;
  listening: number;
  reading: number;
  speaking: number;
  writing: number;
  note: string;
};

export type PtePlanView = {
  plan: { exam_date: string; target: number };
  today: {
    phase: PtePhase;
    weakest_skill?: 'L' | 'R' | 'S' | 'W' | null;
    minutes_total: number;
    blocks: PtePlanBlock[];
  };
  practice: { id: string; name_vi: string; href: string | null; avg_14d: number | null; attempts_14d: number }[];
  /** Them 11/09: cung so lieu, xep theo 4 ky nang. */
  skills?: PteSkillView[];
  mocks: PteMockRow[];
  facts: {
    checked_at: string;
    format_changed_on: string;
    task_count: number;
    in_app: number;
    template_rule: { vi: string; quote?: string } | null;
    concordance: { pte: number; ielts: number }[];
    sources: Record<string, string>;
  } | null;
};

// --- PTE Doc (them 11/09) --------------------------------------------------
// Chi THEM. Dap an KHONG co trong ReadingView — chi ve o ReadingResult sau khi nop.

export type ReadingType = 'rwfib' | 'rfib' | 'rop' | 'mcsa_r' | 'mcma_r';

export type ReadingView = {
  id: string;
  type: ReadingType;
  level: number;
  topic: string;
  source: string;
  license: string;
  /** rop: doan da xao, kem nhan mo. */
  paragraphs?: { key: string; text: string }[];
  /** FIB: van ban cat tai o trong — n o thi n+1 doan. */
  segments?: string[];
  /** rfib: kho chu da xao. */
  bank?: string[];
  /** rwfib: lua chon cho tung o. */
  options?: string[][];
  /** Trac nghiem (them 12/09): bai doc, cau hoi, phuong an da xao kem nhan mo. */
  text?: string;
  question?: string;
  choices?: { key: string; text: string }[];
  /** true = chon nhieu, co tru diem. */
  multi?: boolean;
};

export type ReadingItems = {
  type: ReadingType;
  level: number;
  progress: PteLevelProgress;
  total_bank: number;
  items: ReadingView[];
};

export type ReadingProgress = {
  max_level: number;
  types: {
    type: ReadingType;
    name_vi: string;
    progress: PteLevelProgress;
    bank: { level: number; n: number }[];
    recent: { id: number; item_id: string; level: number; score: number; correct: number; total: number; created_at: string }[];
  }[];
};

export type ReadingResult = {
  id: string;
  type: ReadingType;
  level: number;
  pte_score: number;
  correct: number;
  total: number;
  blanks?: { chosen: string | null; answer: string; ok: boolean }[];
  full_text?: string;
  correct_order?: string[];
  your_order?: { text: string; pair_ok: boolean | null }[];
  /** Trac nghiem: moi phuong an theo thu tu goc. */
  choices?: { text: string; correct: boolean; chosen: boolean }[];
  /** Trac nghiem: giai thich tieng Viet. */
  why_vi?: string;
  source: string;
  license: string;
  progress: PteLevelProgress;
};

// --- PTE Nghe (them 12/09) -------------------------------------------------
// Chi THEM. Van ban nghe KHONG co trong ListeningView (tru fibl da duc o, hiw ban
// tren man) — chi ve o ListeningResult.transcript sau khi nop.

export type ListeningType = 'fibl' | 'hiw' | 'smw' | 'mcsa_l' | 'mcma_l' | 'hcs' | 'asq';

export type ListeningView = {
  id: string;
  type: ListeningType;
  level: number;
  topic: string;
  source: string;
  license: string;
  segments?: string[];
  words?: string[];
  question?: string;
  choices?: { key: string; text: string }[];
  multi?: boolean;
};

export type ListeningItems = {
  type: ListeningType;
  level: number;
  progress: PteLevelProgress;
  total_bank: number;
  items: ListeningView[];
};

export type ListeningProgress = {
  max_level: number;
  types: {
    type: ListeningType;
    name_vi: string;
    progress: PteLevelProgress;
    bank: { level: number; n: number }[];
    recent: { id: number; item_id: string; level: number; score: number; correct: number; total: number; created_at: string }[];
  }[];
};

export type ListeningResult = {
  id: string;
  type: ListeningType;
  level: number;
  pte_score: number;
  correct: number;
  total: number;
  transcript: string;
  blanks?: { typed: string | null; answer: string; ok: boolean }[];
  words?: { shown: string; spoken: string; swapped: boolean; tapped: boolean }[];
  question?: string;
  choices?: { text: string; correct: boolean; chosen: boolean }[];
  heard?: string;
  accepted?: string[];
  why_vi?: string;
  source: string;
  license: string;
  progress: PteLevelProgress;
};

// --- PTE Noi / Viet co nguoi cham (them 12/09) ----------------------------
// Diem la UOC LUONG cua AI theo thang Pearson — KHONG phai diem PTE.

export type OpenType = 'swt' | 'we' | 'sst' | 'di' | 'rl' | 'rts' | 'sgd';

export type OpenChart = {
  kind: 'bar' | 'line' | 'pie' | 'table';
  title: string;
  unit: string;
  labels: string[];
  series: { name: string; values: number[] }[];
};

export type OpenView = {
  id: string;
  type: OpenType;
  level: number;
  topic: string;
  source: string;
  license: string;
  timing: { prep_s?: number; answer_s?: number; minutes?: number };
  text?: string;
  prompt?: string;
  situation?: string;
  chart?: OpenChart;
  audio: boolean;
  turns?: { speaker: 'A' | 'B' | 'C'; name: string }[];
};

export type OpenItems = {
  type: OpenType;
  level: number;
  progress: PteLevelProgress;
  total_bank: number;
  rubric_source: string | null;
  items: OpenView[];
};

export type OpenProgress = {
  max_level: number;
  types: {
    type: OpenType;
    name_vi: string;
    writing: boolean;
    progress: PteLevelProgress;
    bank: { level: number; n: number }[];
    recent: { id: number; item_id: string; level: number; score: number; correct: number; total: number; created_at: string }[];
  }[];
};

export type OpenResult = {
  id: string;
  type: OpenType;
  level: number;
  pte_score: number;
  correct: number;
  total: number;
  cut_off: boolean;
  form: { band: number; max: number; words: number; ly_do_vi: string } | null;
  traits: { name: string; max: number; band: number; who: 'ai'; why_vi: string }[];
  not_scored: string[];
  key_points: { point: string; covered: boolean }[];
  template_like: boolean;
  template_vi: string;
  fixes: { you_said: string; better: string; why_vi: string }[];
  better_en: string;
  summary_vi: string;
  response: string;
  stats: { duration_s: number; words: number; wpm: number; long_pauses: number; fillers: number } | null;
  material: string | null;
  source: string;
  license: string;
  progress: PteLevelProgress;
};

/** Mot o ky nang tren tab PTE. Them 11/09. */
export type PteSkillView = {
  skill: 'L' | 'R' | 'S' | 'W';
  name_vi: string;
  /** So dang trong de gop vao ky nang nay. */
  task_count: number;
  /** Cac dang app luyen duoc. */
  in_app: { id: string; name_vi: string; href: string | null }[];
  attempts_14d: number;
  /** Trung binh cac luot luyen — KHONG phai diem ky nang PTE. */
  avg_14d: number | null;
  /** Chi o Noi: so luot shadowing, dem rieng. */
  shadow_14d: number | null;
  /** Diem thi thu chinh thuc gan nhat cua ky nang nay. */
  mock: { score: number; taken_on: string } | null;
  target: number;
};

export type PteTaskFact = {
  id: string;
  name: string;
  name_vi: string;
  section: 'speaking_writing' | 'reading' | 'listening';
  items: [number, number];
  scoring: 'partial' | 'correct_incorrect' | 'negative';
  skills: ('L' | 'R' | 'S' | 'W')[];
  app: string | null;
  human_content: boolean;
  new_2025?: boolean;
  strategies_vi: string[];
};

// ---------------------------------------------------------------------------
// TIENG PHAP (dot B, 12/09/2026) — routes/fr.ts. Khong gian rieng, API rieng.
// ---------------------------------------------------------------------------
export type FrStage = {
  stage: number;
  key: string;
  name_vi: string;
  hint_vi: string;
  done: boolean;
  items_done: number;
  total: number;
};

export type FrTopic = {
  id: string;
  name_vi: string;
  emoji: string;
  order: number;
  stages: FrStage[];
  unlocked: number;
  done_stages: number;
  percent: number;
};

export type FrRoadmap = {
  topics: FrTopic[];
  overall_percent: number;
  done_stages: number;
  total_stages: number;
  next: { topic_id: string; name_vi: string; emoji: string; stage: number } | null;
};

export type FrVocabItem = {
  word: string;
  ipa: string;
  meaning_vi: string;
  example_fr: string;
  example_vi: string;
  gender_vi: string;
  note_vi: string;
};
export type FrSentenceItem = { fr: string; vi: string; focus_vi: string };
export type FrTranslateItem = { vi: string; hint_fr: string };

export type FrLessonPayload = {
  id: string;
  name_vi: string;
  emoji: string;
  stage: FrStage;
  items?: (FrVocabItem | FrSentenceItem | FrTranslateItem)[];
};

/** Chang 1-2: KHONG diem — chi may nghe duoc gi va tu nao chua nghe ra. */
export type FrSpeakResult = {
  target: string;
  transcript: string;
  words: { w: string; heard: boolean }[];
  progress: { items_done: number; total: number };
};

export type FrTranslateResult = {
  typed: string;
  grade: number;
  ok: boolean;
  score: number;
  feedback_vi: string;
  better_fr: string;
  reference_fr: string;
  accent_slips: { typed: string; correct: string }[];
  progress: { items_done: number; total: number };
};

export type FrDeckSummary = {
  total: number;
  learned: number;
  due: number;
  due_new: number;
  waiting: number;
  per_day: number;
  deck_size: number;
};

export type FrDueCard = {
  id: number;
  word: string;
  ipa: string;
  meaning_vi: string;
  gender_vi: string;
  note_vi: string;
  example_fr: string;
  example_vi: string;
  group_vi: string;
  emoji: string;
  is_new: boolean;
};

export type FrVerdict = 'ok' | 'accent' | 'article' | 'no_article' | 'typo' | 'wrong' | 'empty';

export type FrReviewResult = {
  word_id: number;
  typed: string;
  verdict: FrVerdict;
  score: number;
  word: string;
  ipa: string;
  gender_vi: string;
  note_vi: string;
  example_fr: string;
  example_vi: string;
  feedback_vi: string;
  next_due: string;
  interval: number;
};

export type FrDicteeList = {
  pool: number;
  items: { id: string; topic_id: string; topic_vi: string; emoji: string; words: number }[];
  topics: { id: string; name_vi: string; emoji: string }[];
};

export type FrDiffToken = { w: string; status: 'ok' | 'accent' | 'missing' | 'extra'; typed?: string };

export type FrDicteeResult = {
  id: string;
  typed: string;
  reference: string;
  vi: string;
  tokens: FrDiffToken[];
  score: number;
  ok: number;
  accent: number;
  missing: number;
  extra: number;
};
