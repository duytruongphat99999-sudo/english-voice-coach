import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { TOPICS_FR, getTopicFr, frGroupVi, frInfoFor, FR_DECK, type Topic } from '../config.js';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { gradeTranslateFr, LlmError } from '../llm.js';
import { translateSystemFr } from '../prompts.js';
import { reviewRating } from '../srs.js';
import { Rating } from 'ts-fsrs';
import { scoreToGrade } from '../pronounce.js';
import { checkWord, diffSentence, accentSlips, wordsOf, spellNumbersFr, type WordVerdict } from '../fr-text.js';
import {
  addCourseVocab,
  allProgress,
  applyGrade,
  dueVocabFr,
  frDeckSummary,
  getVocab,
  markFrFirstSeen,
  markStageDone,
  progressFor,
  recordAttempt,
  unlockedStage,
  type StageRow,
} from '../store.js';

// ---------------------------------------------------------------------------
// TIENG PHAP (dot B, 12/09/2026) — toan bo API cua khong gian tieng Phap.
//
// Tach RIENG khoi routes/learn.ts va routes/review.ts (khong sua dong nao ben
// do): Duy chot tieng Anh va tieng Phap la hai khong gian khong dung nhau, va
// ba lua chon cua Duy 12/09 lam tieng Phap KHAC tieng Anh o cho chinh:
//   - bai hoc chang 1-2: noi theo mau, app chi hien "may nghe duoc gi",
//     KHONG diem (may nghe tieng Phap kem voi giong nguoi moi hoc);
//   - chang 3: GO cau tieng Phap, app so tung chu CO DAU + Gemini giai thich;
//   - On tu: GO lai tu, app cham chinh xac; lich on chi theo phan go.
// Tieng Phap KHONG cong vao `daily` (chuoi ngay, % lo trinh) cua tieng Anh.
// ---------------------------------------------------------------------------

const STAGES_FR = [
  { stage: 1, key: 'vocab', name_vi: 'Từ vựng', hint_vi: 'Nghe mẫu rồi nói theo — không chấm điểm' },
  { stage: 2, key: 'pronounce', name_vi: 'Phát âm', hint_vi: 'Nghe mẫu rồi đọc lại cả câu — không chấm điểm' },
  { stage: 3, key: 'translate', name_vi: 'Phản xạ dịch', hint_vi: 'Thấy câu tiếng Việt, gõ câu tiếng Pháp' },
  { stage: 4, key: 'talk', name_vi: 'Trò chuyện', hint_vi: 'Nói hoặc gõ với AI — không chấm điểm' },
] as const;

function itemCount(t: Topic, stage: number): number {
  if (stage === 1) return t.vocab.length;
  if (stage === 2) return t.sentences.length;
  if (stage === 3) return t.translate.length;
  return 1;
}

function stagesOf(t: Topic, rows: StageRow[]) {
  return STAGES_FR.map((s) => {
    const r = rows.find((x) => x.stage === s.stage);
    const total = itemCount(t, s.stage);
    return {
      stage: s.stage,
      key: s.key,
      name_vi: s.name_vi,
      hint_vi: s.hint_vi,
      done: r?.done === 1,
      items_done: Math.min(r?.items_done ?? 0, total),
      total,
    };
  });
}

/** Nhac lai giong + ghi chu cua tu, lay tu bo noi dung (DB khong co hai cot nay). */
function genderVi(g: string): string {
  return g === 'm' ? 'giống đực' : g === 'f' ? 'giống cái' : g === 'mpl' ? 'giống đực, số nhiều' : g === 'fpl' ? 'giống cái, số nhiều' : '';
}

// --- Nghe-viet chinh ta: kho cau tu 8 chu de, id mo (khong lo chu) ----------
type DicteeItem = { id: string; text: string; vi: string; topic_id: string; words: number };
const DICTEE: DicteeItem[] = (() => {
  const seen = new Set<string>();
  const out: DicteeItem[] = [];
  const add = (text: string, vi: string, topicId: string) => {
    const k = text.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ id: createHash('sha1').update(`dt|${k}`).digest('hex').slice(0, 12), text: k, vi, topic_id: topicId, words: wordsOf(k).length });
  };
  for (const t of TOPICS_FR) {
    for (const v of t.vocab) add(v.example_en, v.example_vi, t.id);
    for (const s of t.sentences) add(s.en, s.vi, t.id);
    for (const s of t.translate) add(s.en_ref, s.vi, t.id);
  }
  return out;
})();
const dicteeById = new Map(DICTEE.map((d) => [d.id, d]));

function lenOf(n: number): 'ngan' | 'vua' | 'dai' {
  return n <= 6 ? 'ngan' : n <= 10 ? 'vua' : 'dai';
}

const REVIEW_FEEDBACK: Record<WordVerdict, string> = {
  ok: 'Đúng từng chữ, đủ dấu.',
  accent: 'Nhớ đúng từ nhưng sai dấu — sai dấu là sai chính tả, lịch ôn sẽ hỏi lại sớm.',
  article: 'Nhớ đúng từ nhưng sai mạo từ, tức là sai giống — với danh từ Pháp, giống là một nửa của từ.',
  no_article: 'Nhớ đúng từ nhưng thiếu mạo từ — danh từ Pháp phải học kèm le / la / l\' / les.',
  typo: 'Lệch một chữ cái — chính tả phải đúng từng chữ, lịch ôn sẽ hỏi lại sớm.',
  wrong: 'Chưa nhớ ra từ này.',
  empty: 'Chưa nhớ — không sao, xem lại rồi lần sau sẽ hỏi sớm.',
};

export default async function frRoutes(app: FastifyInstance) {
  // =========================================================================
  // BAI HOC — 8 chu de A1, 4 chang
  // =========================================================================

  app.get('/fr/learn/topics', async () => {
    const all = allProgress();
    const topics = TOPICS_FR.map((t) => {
      const rows = all.filter((r) => r.topic_id === t.id);
      const stages = stagesOf(t, rows);
      const done = stages.filter((s) => s.done).length;
      return {
        id: t.id,
        name_vi: t.name_vi,
        emoji: t.emoji,
        order: t.order,
        stages,
        unlocked: unlockedStage(rows),
        done_stages: done,
        percent: Math.round((done / STAGES_FR.length) * 100),
      };
    });
    const total = topics.length * STAGES_FR.length;
    const doneStages = topics.reduce((n, t) => n + t.done_stages, 0);
    const started = topics.find((t) => t.done_stages > 0 && t.done_stages < STAGES_FR.length);
    const next = started ?? topics.find((t) => t.done_stages < STAGES_FR.length);
    return {
      topics,
      overall_percent: total ? Math.round((doneStages / total) * 100) : 0,
      done_stages: doneStages,
      total_stages: total,
      next: next ? { topic_id: next.id, name_vi: next.name_vi, emoji: next.emoji, stage: next.unlocked } : null,
    };
  });

  app.get<{ Params: { id: string; stage: string } }>('/fr/learn/topic/:id/:stage', async (req, reply) => {
    const t = getTopicFr(req.params.id);
    if (!t) return reply.code(404).send({ error: `Không có chủ đề "${req.params.id}".` });
    const stage = Number(req.params.stage);
    if (![1, 2, 3, 4].includes(stage)) return reply.code(400).send({ error: 'stage phải là 1-4.' });
    const rows = progressFor(t.id);
    const unlocked = unlockedStage(rows);
    if (stage > unlocked) {
      return reply.code(423).send({ error: `Chặng ${stage} chưa mở. Xong chặng ${unlocked} trước đã.`, unlocked });
    }
    const meta = { id: t.id, name_vi: t.name_vi, emoji: t.emoji };
    const stageInfo = stagesOf(t, rows).find((s) => s.stage === stage)!;
    if (stage === 1) {
      return {
        ...meta,
        stage: stageInfo,
        items: t.vocab.map((v) => ({
          word: v.word,
          ipa: v.ipa,
          meaning_vi: v.meaning_vi,
          example_fr: v.example_en,
          example_vi: v.example_vi,
          gender_vi: genderVi(v.gender ?? ''),
          note_vi: v.note_vi ?? '',
        })),
      };
    }
    if (stage === 2) return { ...meta, stage: stageInfo, items: t.sentences.map((s) => ({ fr: s.en, vi: s.vi, focus_vi: s.focus_vi })) };
    // Chang 3: KHONG gui cau mau xuong truoc khi go — muc dich la tu bat ra.
    if (stage === 3) return { ...meta, stage: stageInfo, items: t.translate.map((s) => ({ vi: s.vi, hint_fr: s.hint_en })) };
    return {
      ...meta,
      stage: stageInfo,
      scenario: { id: `topic:${t.id}`, role: t.scenario.role, context: t.scenario.context, opener_fr: t.scenario.opener_en, opener_vi: t.scenario.opener_vi },
    };
  });

  app.get<{ Params: { id: string; stage: string; index: string }; Querystring: { part?: string } }>(
    '/fr/learn/say/:id/:stage/:index',
    async (req, reply) => {
      const t = getTopicFr(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Không có chủ đề này.' });
      const stage = Number(req.params.stage);
      const i = Number(req.params.index);
      let text = '';
      if (stage === 1 && t.vocab[i]) text = req.query.part === 'word' ? t.vocab[i]!.word : t.vocab[i]!.example_en;
      else if (stage === 2 && t.sentences[i]) text = t.sentences[i]!.en;
      else if (stage === 3 && t.translate[i]) text = t.translate[i]!.en_ref;
      if (!text) return reply.code(404).send({ error: 'Không có mục này.' });
      try {
        const buf = await synthesize(text, 'fr');
        return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=86400').send(buf);
      } catch (e) {
        return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
      }
    },
  );

  /**
   * POST /fr/learn/answer (multipart: topic_id, stage 1|2, index, audio)
   *
   * KHONG CHAM DIEM (Duy chot 12/09). Tra ve may nghe duoc gi va tu nao cua cau
   * mau may KHONG nghe ra — de nguoi hoc tu so. Diem khop van ghi vao
   * drill_attempts (de sau nay do may nghe tieng Phap), nhung khong gui xuong.
   */
  app.post('/fr/learn/answer', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'answer.webm';
    let mimetype = 'audio/webm';
    let topicId = '';
    let stage = 0;
    let index = -1;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'topic_id') topicId = String(part.value);
        else if (part.fieldname === 'stage') stage = Number(part.value);
        else if (part.fieldname === 'index') index = Number(part.value);
      }
    } catch (e) {
      return reply.code(413).send({ error: `Đọc file thất bại: ${(e as Error).message}` });
    }
    const t = getTopicFr(topicId);
    if (!t) return reply.code(400).send({ error: `Chủ đề không hợp lệ: "${topicId}".` });
    if (stage !== 1 && stage !== 2) return reply.code(400).send({ error: 'stage phải là 1 hoặc 2.' });
    const target = stage === 1 ? t.vocab[index]?.example_en : t.sentences[index]?.en;
    if (!Number.isInteger(index) || !target) return reply.code(404).send({ error: 'Không có mục này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    try {
      // KHONG moi `prompt` chua cau mau: lam vay Whisper nghe ra cau mau du
      // nguoi hoc khong noi — va nguoi hoc tuong minh noi dung.
      said = await transcribe(audio, filename, mimetype, { lang: 'fr' });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }
    // Whisper viet so bang chu so ("9h") — doi sang chu truoc khi so voi cau mau.
    const d = diffSentence(spellNumbersFr(said.text), target);
    const words = d.tokens.filter((x) => x.status !== 'extra').map((x) => ({ w: x.w, heard: x.status !== 'missing' }));
    const st = recordAttempt({
      topicId: t.id,
      stage,
      itemIndex: index,
      target,
      said: said.text,
      score: d.score,
      detail: { ungraded: true, words },
    });
    return {
      topic_id: t.id,
      stage,
      index,
      target,
      transcript: said.text,
      words,
      progress: { items_done: st.items, total: itemCount(t, stage) },
    };
  });

  /** POST /fr/learn/answer-text { topic_id, index, text } — chang 3, GO cau tieng Phap. */
  app.post<{ Body: { topic_id?: string; index?: number; text?: string } }>('/fr/learn/answer-text', async (req, reply) => {
    const t = getTopicFr(String(req.body?.topic_id ?? ''));
    if (!t) return reply.code(400).send({ error: 'Thiếu topic_id hợp lệ.' });
    const index = Number(req.body?.index);
    const tr = Number.isInteger(index) ? t.translate[index] : undefined;
    if (!tr) return reply.code(404).send({ error: 'Không có mục này.' });
    const typed = String(req.body?.text ?? '').trim().slice(0, 400);
    if (!typed) return reply.code(400).send({ error: 'Chưa gõ gì.' });

    const slips = accentSlips(typed, tr.en_ref);
    let g;
    try {
      g = await gradeTranslateFr(translateSystemFr(), tr.vi, tr.en_ref, typed, slips);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof LlmError ? `${e.message} Bấm nộp lại.` : (e as Error).message, where: 'llm' });
    }
    const score = g.grade * 20;
    const st = recordAttempt({ topicId: t.id, stage: 3, itemIndex: index, target: tr.en_ref, said: typed, score, detail: { typed: true, slips } });
    return {
      topic_id: t.id,
      stage: 3,
      index,
      typed,
      grade: g.grade,
      ok: g.ok,
      score,
      feedback_vi: g.feedback_vi,
      better_fr: g.better_en,
      reference_fr: tr.en_ref,
      accent_slips: slips,
      progress: { items_done: st.items, total: itemCount(t, 3) },
    };
  });

  app.post<{ Body: { topic_id?: string; stage?: number } }>('/fr/learn/stage-complete', async (req, reply) => {
    const t = getTopicFr(String(req.body?.topic_id ?? ''));
    const stage = Number(req.body?.stage);
    if (!t) return reply.code(400).send({ error: 'Thiếu topic_id hợp lệ.' });
    if (![1, 2, 3].includes(stage)) return reply.code(400).send({ error: 'stage phải là 1-3 (chặng 4 xong khi kết thúc buổi trò chuyện).' });
    const unlockedNow = unlockedStage(progressFor(t.id));
    if (stage > unlockedNow) {
      return reply.code(423).send({ error: `Chặng ${stage} chưa mở. Xong chặng ${unlockedNow} trước đã.`, unlocked: unlockedNow });
    }
    markStageDone(t.id, stage);
    // 12 tu cua chu de vao kho on tieng Phap, mai quay lai doi on — nhu tieng Anh.
    const vocabAdded = stage === 1 ? addCourseVocab(t.id, t.vocab, 'fr') : 0;
    const rows = progressFor(t.id);
    return { topic_id: t.id, stage, vocab_added: vocabAdded, unlocked: unlockedStage(rows), stages: stagesOf(t, rows) };
  });

  // =========================================================================
  // ON TU — GO lai tu (Duy chot 12/09), 15 tu moi/ngay tu kho 500 tu
  // =========================================================================

  app.get('/fr/deck/summary', async () => ({ ...frDeckSummary(), deck_size: FR_DECK.words.length }));

  app.get<{ Querystring: { limit?: string } }>('/fr/review/due', async (req) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    return dueVocabFr(limit).map((c) => {
      const info = frInfoFor(c.word);
      const group = frGroupVi(c.topic_id ?? c.domain);
      return {
        id: c.id,
        word: c.word,
        ipa: c.ipa ?? '',
        meaning_vi: c.meaning_vi,
        gender_vi: genderVi(info?.gender ?? ''),
        note_vi: info?.note_vi ?? '',
        example_fr: c.example_en,
        example_vi: info?.example_vi ?? '',
        group_vi: group?.name_vi ?? '',
        emoji: group?.emoji ?? '',
        // The kho 500 tu chua tung gap: CHUA thay mat chu bao gio, nen man hinh cho
        // xem tu truoc roi moi bat go. Tu cua bai hoc thi da hoc o chang 1.
        is_new: c.reps === 0 && c.kind === 'deck',
      };
    });
  });

  /**
   * POST /fr/review/answer-text { word_id, text, think_ms }
   *
   * think_ms = tu luc the hien ra toi PHIM DAU TIEN — tuong duong luc cham mic
   * ben tieng Anh, khong tinh thoi gian go (go "la carte d'assurance maladie"
   * lau hon noi, khong phai vi nho cham).
   */
  app.post<{ Body: { word_id?: number; text?: string; think_ms?: number } }>('/fr/review/answer-text', async (req, reply) => {
    const id = Number(req.body?.word_id);
    const card = Number.isInteger(id) && id > 0 ? getVocab(id) : undefined;
    if (!card || card.lang !== 'fr') return reply.code(404).send({ error: 'Không tìm thấy thẻ tiếng Pháp này.' });
    const typed = String(req.body?.text ?? '').slice(0, 120);
    const n = Number(req.body?.think_ms);
    const thinkMs = Number.isFinite(n) ? n : null;

    const c = checkWord(typed, card.word);
    // Phai goi TRUOC applyGrade (ham nay chi doi the con reps = 0).
    markFrFirstSeen(card.id);
    let rating = reviewRating(c.score, thinkMs);
    // The moi tu kho 500 tu: man hinh VUA cho xem tu roi moi hoi — go dung ngay
    // luc do chua phai la nho that. Khong cho "Easy" (FSRS day xa ~8 ngay); toi da
    // Good (~2-3 ngay), lan on sau moi la phep thu that.
    if (card.reps === 0 && card.kind === 'deck' && rating === Rating.Easy) rating = Rating.Good;
    const grade = scoreToGrade(c.score);
    const next = applyGrade(card, grade, c.score, rating);
    const info = frInfoFor(card.word);
    const slow = c.verdict === 'ok' && thinkMs !== null && thinkMs > 12_000;
    return {
      word_id: card.id,
      typed,
      verdict: c.verdict,
      score: c.score,
      word: card.word,
      ipa: card.ipa ?? '',
      gender_vi: genderVi(info?.gender ?? ''),
      note_vi: info?.note_vi ?? '',
      example_fr: card.example_en,
      example_vi: info?.example_vi ?? '',
      feedback_vi: slow ? 'Đúng đủ dấu, nhưng nghĩ hơi lâu mới ra — lịch ôn chỉ giãn vừa phải.' : REVIEW_FEEDBACK[c.verdict],
      next_due: next.due_date,
      interval: next.interval,
    };
  });

  // =========================================================================
  // NGHE - VIET CHINH TA — may doc, nguoi hoc go, cham tung chu co dau
  // =========================================================================

  app.get<{ Querystring: { n?: string; len?: string; topic?: string } }>('/fr/dictee/items', async (req) => {
    const n = Math.min(20, Math.max(1, Number(req.query.n) || 10));
    const len = req.query.len;
    const topic = req.query.topic;
    const pool = DICTEE.filter((d) => (!topic || d.topic_id === topic) && (!len || len === 'all' || lenOf(d.words) === len));
    // Lay ngau nhien khong lap. Khong gui chu — chi id.
    const pick = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    return {
      pool: pool.length,
      items: pick.map((d) => {
        const g = frGroupVi(d.topic_id);
        return { id: d.id, topic_id: d.topic_id, topic_vi: g?.name_vi ?? '', emoji: g?.emoji ?? '', words: d.words };
      }),
      topics: TOPICS_FR.map((t) => ({ id: t.id, name_vi: t.name_vi, emoji: t.emoji })),
    };
  });

  app.get<{ Params: { id: string } }>('/fr/dictee/say/:id', async (req, reply) => {
    const d = dicteeById.get(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Không có câu này.' });
    try {
      const buf = await synthesize(d.text, 'fr');
      return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=86400').send(buf);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
    }
  });

  app.post<{ Body: { id?: string; text?: string } }>('/fr/dictee/answer', async (req, reply) => {
    const d = dicteeById.get(String(req.body?.id ?? ''));
    if (!d) return reply.code(404).send({ error: 'Không có câu này.' });
    const typed = String(req.body?.text ?? '').slice(0, 400);
    const r = diffSentence(typed, d.text);
    return { id: d.id, typed, reference: d.text, vi: d.vi, ...r };
  });
}
