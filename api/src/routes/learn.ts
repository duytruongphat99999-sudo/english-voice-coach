import type { FastifyInstance } from 'fastify';
import { cfg, TOPICS, getTopic, TRACK_VI, type Topic } from '../config.js';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { score as scorePronunciation, type PronounceScore } from '../pronounce.js';
import { explainPronunciation, gradeTranslate, LlmError } from '../llm.js';
import { pronounceFeedbackSystem, translateSystem } from '../prompts.js';
import {
  addCourseVocab,
  allProgress,
  bumpDaily,
  completeDailyIfReady,
  markStageDone,
  progressFor,
  recordAttempt,
  stageStats,
  unlockedStage,
  type StageRow,
} from '../store.js';

export const STAGES = [
  { stage: 1, key: 'vocab', name_vi: 'Từ vựng', hint_vi: 'Đọc câu chứa từ, không phải đặt câu' },
  { stage: 2, key: 'pronounce', name_vi: 'Phát âm', hint_vi: 'Nghe mẫu rồi đọc lại cả câu' },
  { stage: 3, key: 'translate', name_vi: 'Phản xạ dịch', hint_vi: 'Thấy câu tiếng Việt, nói tiếng Anh' },
  { stage: 4, key: 'talk', name_vi: 'Trò chuyện', hint_vi: 'Nói hoặc gõ, tình huống thật' },
] as const;

/** Diem toi thieu de mot muc duoc tinh la qua. */
const PASS = 60;

function itemCount(t: Topic, stage: number): number {
  if (stage === 1) return t.vocab.length;
  if (stage === 2) return t.sentences.length;
  if (stage === 3) return t.translate.length;
  return 1; // tang 4 chi co mot buoi hoi thoai
}

/**
 * Cau NGUOI HOC phai doc/noi cho tung muc.
 *
 * Tang 1 lay CAU VI DU chu khong lay rieng tu. Hai ly do: Whisper doan rat
 * ba dao voi doan am mot chu (~1 giay), va tu nam trong cau thi moi hoc duoc
 * cach dung. Van la "khong phai tu dat cau" — cau co san, chi doc theo.
 */
function targetFor(t: Topic, stage: number, i: number): { target: string; extra?: unknown } | undefined {
  if (stage === 1) {
    const v = t.vocab[i];
    return v && { target: v.example_en, extra: { word: v.word, ipa: v.ipa, meaning_vi: v.meaning_vi } };
  }
  if (stage === 2) {
    const s = t.sentences[i];
    return s && { target: s.en, extra: { vi: s.vi, focus_vi: s.focus_vi } };
  }
  if (stage === 3) {
    const s = t.translate[i];
    return s && { target: s.en_ref, extra: { vi: s.vi, hint_en: s.hint_en } };
  }
  return undefined;
}

function stagesOf(t: Topic, rows: StageRow[]) {
  return STAGES.map((s) => {
    const r = rows.find((x) => x.stage === s.stage);
    const total = itemCount(t, s.stage);
    return {
      stage: s.stage,
      key: s.key,
      name_vi: s.name_vi,
      hint_vi: s.hint_vi,
      done: r?.done === 1,
      score: r?.score ?? null,
      items_done: Math.min(r?.items_done ?? 0, total),
      total,
    };
  });
}

export default async function learnRoutes(app: FastifyInstance) {
  /**
   * GET /learn/topics — toan bo lo trinh.
   *
   * Chu de MO HET, chi tang la khoa tuan tu. Thang do kho nam ben trong mot
   * chu de (nhan mat tu -> doc duoc -> tu bat ra -> dung that), nen khoa chu
   * de chi to gay buc khi hom nay dang can dung cai chu de do.
   */
  app.get('/learn/topics', async () => {
    const all = allProgress();
    const topics = TOPICS.map((t) => {
      const rows = all.filter((r) => r.topic_id === t.id);
      const stages = stagesOf(t, rows);
      const doneCount = stages.filter((s) => s.done).length;
      return {
        id: t.id,
        name_vi: t.name_vi,
        emoji: t.emoji,
        track: t.track,
        track_vi: TRACK_VI[t.track],
        order: t.order,
        stages,
        unlocked: unlockedStage(rows),
        done_stages: doneCount,
        percent: Math.round((doneCount / STAGES.length) * 100),
      };
    });

    const totalStages = topics.length * STAGES.length;
    const doneStages = topics.reduce((n, t) => n + t.done_stages, 0);

    // Goi y tiep theo: chu de dang do dang truoc, chua dung toi thi lay cai
    // dau tien chua xong.
    const started = topics.find((t) => t.done_stages > 0 && t.done_stages < STAGES.length);
    const fresh = topics.find((t) => t.done_stages === 0);
    const next = started ?? fresh ?? topics.find((t) => t.done_stages < STAGES.length);

    return {
      topics,
      overall_percent: totalStages ? Math.round((doneStages / totalStages) * 100) : 0,
      done_stages: doneStages,
      total_stages: totalStages,
      next: next ? { topic_id: next.id, name_vi: next.name_vi, emoji: next.emoji, stage: next.unlocked } : null,
      tracks: Object.entries(TRACK_VI).map(([k, v]) => ({ key: k, name_vi: v })),
    };
  });

  /** GET /learn/topic/:id/:stage — cac muc de lam, kem tien do. */
  app.get<{ Params: { id: string; stage: string } }>('/learn/topic/:id/:stage', async (req, reply) => {
    const t = getTopic(req.params.id);
    if (!t) return reply.code(404).send({ error: `Khong co chu de "${req.params.id}".` });

    const stage = Number(req.params.stage);
    if (![1, 2, 3, 4].includes(stage)) return reply.code(400).send({ error: 'stage phải là 1-4.' });

    const rows = progressFor(t.id);
    const unlocked = unlockedStage(rows);
    if (stage > unlocked) {
      return reply.code(423).send({
        error: `Tầng ${stage} chưa mở. Xong tầng ${unlocked} trước đã.`,
        unlocked,
      });
    }

    const meta = { id: t.id, name_vi: t.name_vi, emoji: t.emoji, track_vi: TRACK_VI[t.track] };
    const stageInfo = stagesOf(t, rows).find((s) => s.stage === stage)!;

    if (stage === 1) {
      return { ...meta, stage: stageInfo, items: t.vocab };
    }
    if (stage === 2) {
      return { ...meta, stage: stageInfo, items: t.sentences };
    }
    if (stage === 3) {
      // KHONG gui en_ref xuong truoc khi tra loi — gui la nguoi hoc doc luon,
      // ma muc dich cua tang nay la BAT RA duoc chu khong phai doc theo.
      return {
        ...meta,
        stage: stageInfo,
        items: t.translate.map((x) => ({ vi: x.vi, hint_en: x.hint_en })),
      };
    }
    return { ...meta, stage: stageInfo, scenario: { ...t.scenario, id: `topic:${t.id}` } };
  });

  /**
   * GET /learn/say/:id/:stage/:index — doc mau bang TTS.
   * ?part=word cho tang 1 (doc rieng tu), mac dinh doc ca cau.
   */
  app.get<{ Params: { id: string; stage: string; index: string }; Querystring: { part?: string } }>(
    '/learn/say/:id/:stage/:index',
    async (req, reply) => {
      const t = getTopic(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Không có chủ đề này.' });
      const stage = Number(req.params.stage);
      const i = Number(req.params.index);

      let text = '';
      if (stage === 1 && t.vocab[i]) {
        // say_as: chu viet tat phai danh van tung chu, khong doc lien mot tieng.
        // Chi doi duong AM THANH; cham diem van so voi `word`.
        text =
          req.query.part === 'word'
            ? t.vocab[i]!.say_as ?? t.vocab[i]!.word
            : t.vocab[i]!.example_en;
      } else if (stage === 2 && t.sentences[i]) {
        text = t.sentences[i]!.en;
      } else if (stage === 3 && t.translate[i]) {
        text = t.translate[i]!.en_ref;
      }
      if (!text) return reply.code(404).send({ error: 'Không có mục này.' });

      try {
        const buf = await synthesize(text);
        return reply
          .header('Content-Type', 'audio/mpeg')
          .header('Cache-Control', 'private, max-age=86400')
          .send(buf);
      } catch (e) {
        return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
      }
    },
  );

  /**
   * POST /learn/answer  (multipart: topic_id, stage, index, audio)
   *
   * Tang 1 va 2 cham TAI CHO bang doi chieu tung tu — khong goi Gemini, nen
   * tra ve ngay sau STT (~2s). Chi khi diem duoi nguong moi hoi Gemini mot
   * cau giai thich; cham dung roi thi khong co gi de noi ma van cho 3 giay.
   *
   * Tang 3 thi bat buoc phai qua Gemini: dung/sai o day la chuyen Y NGHIA,
   * doi chieu tu khong tra loi duoc.
   */
  app.post('/learn/answer', async (req, reply) => {
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

    const t = getTopic(topicId);
    if (!t) return reply.code(400).send({ error: `Chủ đề không hợp lệ: "${topicId}".` });
    if (![1, 2, 3].includes(stage)) return reply.code(400).send({ error: 'stage phải là 1, 2 hoặc 3.' });
    if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: 'Thiếu index.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    const item = targetFor(t, stage, index);
    if (!item) return reply.code(404).send({ error: 'Không có mục này.' });

    // Tang 1 va 2 can timestamp tung tu de cham; tang 3 khong.
    let said;
    try {
      said = await transcribe(audio, filename, mimetype, { words: stage !== 3 });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }

    const finish = (score: number, payload: Record<string, unknown>) => {
      const stats = recordAttempt({
        topicId: t.id,
        stage,
        itemIndex: index,
        target: item.target,
        said: said.text,
        score,
        detail: payload.detail ?? {},
      });
      bumpDaily('vocab_reviewed', 0); // dam bao co dong `daily` cho hom nay
      return {
        topic_id: t.id,
        stage,
        index,
        target: item.target,
        transcript: said.text,
        score,
        pass: score >= PASS,
        progress: { items_done: stats.items, total: itemCount(t, stage), score: stats.score },
        ...payload,
      };
    };

    // --- Tang 3: cham y nghia ---------------------------------------------
    if (stage === 3) {
      const tr = t.translate[index]!;
      if (!said.text.trim()) {
        return finish(0, {
          ok: false,
          feedback_vi: 'Không nghe ra chữ nào. Thử nói to hơn, gần mic hơn.',
          better_en: '',
          reference_en: tr.en_ref,
        });
      }
      let g;
      try {
        g = await gradeTranslate(translateSystem(cfg.level), tr.vi, tr.en_ref, said.text);
      } catch (e) {
        return reply.code(502).send({ error: e instanceof LlmError ? e.message : (e as Error).message, where: 'llm' });
      }
      return finish(g.grade * 20, {
        ok: g.ok,
        grade: g.grade,
        feedback_vi: g.feedback_vi,
        better_en: g.better_en,
        reference_en: tr.en_ref,
      });
    }

    // --- Tang 1 & 2: doi chieu tung tu -------------------------------------
    if (!said.text.trim()) {
      return finish(0, {
        words: [],
        feedback_vi: 'Không nghe ra chữ nào. Thử nói to hơn, gần mic hơn.',
        focus_word: '',
        item: item.extra,
      });
    }

    const result: PronounceScore = scorePronunciation(
      item.target,
      said.words.length ? said.words : said.text.split(/\s+/).map((w) => ({ word: w })),
    );

    // Chi hoi Gemini khi that su co gi de noi.
    let feedback_vi = '';
    let focus_word = '';
    const flagged = result.words.filter((w) => w.status !== 'ok');
    if (result.score < 88 && flagged.length) {
      try {
        const fb = await explainPronunciation(pronounceFeedbackSystem(), item.target, flagged);
        feedback_vi = fb.tip_vi;
        focus_word = fb.focus_word;
      } catch {
        // Gemini chet KHONG duoc lam chet ca luot: diem va bang tung tu van
        // day du, do moi la phan chinh.
        feedback_vi = '';
      }
    } else if (result.score >= 88) {
      feedback_vi = result.score === 100 ? 'Chuẩn. Không có gì phải sửa.' : 'Tốt — nghe ra rõ gần hết câu.';
    }

    return finish(result.score, {
      words: result.words,
      extra: result.extra,
      summary: result.summary,
      feedback_vi,
      focus_word,
      item: item.extra,
      detail: { summary: result.summary, words: result.words },
    });
  });

  /**
   * POST /learn/stage-complete { topic_id, stage }
   *
   * Xong Tang 1 thi 12 tu cua chu de do roi vao kho on tap SM-2 — day chinh
   * la nua "thu" cua kho tu: hoc o day, mai no quay lai doi on.
   */
  app.post<{ Body: { topic_id?: string; stage?: number } }>('/learn/stage-complete', async (req, reply) => {
    const t = getTopic(String(req.body?.topic_id ?? ''));
    const stage = Number(req.body?.stage);
    if (!t) return reply.code(400).send({ error: 'Thiếu topic_id hợp lệ.' });
    if (![1, 2, 3, 4].includes(stage)) return reply.code(400).send({ error: 'stage phải là 1-4.' });

    // Khong cho danh dau xong chang CHUA MO (13/09): man hinh chi dan toi chang da
    // mo, nhung goi thang API thi truoc day nhay coc duoc — chang 3 "xong" khi 1-2
    // chua lam, va 12 tu khong bao gio vao kho.
    const unlockedNow = unlockedStage(progressFor(t.id));
    if (stage > unlockedNow) {
      return reply.code(423).send({ error: `Chặng ${stage} chưa mở. Xong chặng ${unlockedNow} trước đã.`, unlocked: unlockedNow });
    }

    const before = progressFor(t.id).find((r) => r.stage === stage)?.done === 1;
    const row = markStageDone(t.id, stage);

    let vocabAdded = 0;
    if (stage === 1) vocabAdded = addCourseVocab(t.id, t.vocab);
    if (stage === 4 && !before) bumpDaily('scenario_done');
    if (stage <= 3 && !before) bumpDaily('vocab_reviewed');

    const daily = completeDailyIfReady();
    const rows = progressFor(t.id);

    return {
      topic_id: t.id,
      stage,
      just_completed: !before,
      score: row.score,
      vocab_added: vocabAdded,
      unlocked: unlockedStage(rows),
      stages: stagesOf(t, rows),
      daily: {
        vocab_reviewed: daily.vocab_reviewed,
        scenario_done: daily.scenario_done,
        completed: daily.completed === 1,
        streak: daily.streak,
      },
    };
  });

  /** GET /learn/stats/:id — dung cho man tong ket cuoi mot tang. */
  app.get<{ Params: { id: string } }>('/learn/stats/:id', async (req, reply) => {
    const t = getTopic(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Không có chủ đề này.' });
    const rows = progressFor(t.id);
    return {
      id: t.id,
      name_vi: t.name_vi,
      emoji: t.emoji,
      stages: stagesOf(t, rows),
      unlocked: unlockedStage(rows),
      per_stage: [1, 2, 3].map((s) => ({ stage: s, ...stageStats(t.id, s) })),
    };
  });
}
