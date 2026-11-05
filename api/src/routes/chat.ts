import type { FastifyInstance, FastifyReply } from 'fastify';
import { cfg, getScenario, getTopic, getTopicFr } from '../config.js';
import { transcribe, SttError } from '../stt.js';
import { synthesize, splitForStreaming, TtsError } from '../tts.js';
import { roleplay, LlmError, type Turn } from '../llm.js';
import { roleplaySystem, roleplaySystemFr } from '../prompts.js';
import {
  addVocab,
  appendTranscript,
  createSession,
  endSession,
  getSession,
  nowIso,
  readTranscript,
  lastDifficultyNote,
  userTurnCount,
  bumpDaily,
  completeDailyIfReady,
  getOrCreateToday,
  markStageDone,
  progressFor,
  unlockedStage,
} from '../store.js';

// Sau bao nhieu luot NOI cua nguoi hoc thi coi la du mot buoi roleplay (spec §5).
const TURNS_PER_SESSION = 8;

/** Ghi mot su kien SSE. Moi event la mot mieng doc lap, client xu ly ngay. */
function sse(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default async function chatRoutes(app: FastifyInstance) {
  /**
   * POST /chat   (multipart: audio, scenario, session_id?)
   *
   * Tra ve SSE chu khong phai mot cuc JSON. Ly do: tren CPU chuoi
   * STT -> Gemini -> TTS mat 6-9s. Neu doi het roi moi tra thi man hinh dung
   * hinh gan 10 giay. Voi SSE, nguoi hoc thay cau minh vua noi sau ~2s va
   * nghe tieng tra loi truoc khi phan sua loi tinh xong.
   *
   * Thu tu event:
   *   session    { session_id }
   *   transcript { text, duration_s }
   *   reply      { text }                      <- ngay khi Gemini viet xong reply_en
   *   audio      { index, mime, b64 }          <- tung cum cau, phat noi tiep
   *   feedback   { corrections, vocab, vocab_added, turn_count, should_end }
   *   done       {}
   *   error      { message, where }
   */
  app.post('/chat', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'audio.webm';
    let mimetype = 'audio/webm';
    let scenarioId = '';
    let sessionId: number | null = null;
    // Go text thay vi noi. Co nhung luc khong tien mo mieng — tren xe, trong
    // phong kham, gan nguoi khac — ma van muon giu chuoi ngay.
    let typed = '';

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'scenario') {
          scenarioId = String(part.value);
        } else if (part.fieldname === 'text') {
          typed = String(part.value).trim().slice(0, 1000);
        } else if (part.fieldname === 'session_id' && part.value) {
          const n = Number(part.value);
          if (Number.isInteger(n) && n > 0) sessionId = n;
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Doc file that bai: ${(e as Error).message}` });
    }

    if ((!audio || audio.length === 0) && !typed) {
      return reply.code(400).send({ error: 'Thiếu cả audio lẫn text.' });
    }

    // Session cu thi lay scenario cua no, khong tin field client gui len.
    if (sessionId) {
      const s = getSession(sessionId);
      if (!s) return reply.code(404).send({ error: `Khong co session ${sessionId}.` });
      scenarioId = s.scenario;
    }
    const sc = getScenario(scenarioId);
    if (!sc) {
      return reply.code(400).send({ error: `Scenario khong hop le: "${scenarioId}".` });
    }
    // Chang 4 tieng Phap (scenario 'topic:fr_*') di chung route nay. Ngon ngu lay
    // tu SCENARIO, khong tu client — nhu review.ts lay tu chinh the.
    const lang = sc.lang === 'fr' ? 'fr' : 'en';

    // Tu day tro di la SSE — moi loi phai di ra bang event `error`, khong
    // con doi status code duoc nua.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const fail = (where: string, message: string) => {
      sse(reply, 'error', { where, message });
      reply.raw.end();
    };

    // Moc thoi gian tung chang. Khi mot luot noi bong cham, dong log nay noi
    // ro cham o dau — STT, Gemini hay TTS — thay vi phai doan.
    // Xem: docker compose logs evc-api | grep chat-timing
    const t0 = Date.now();
    const lap: Record<string, number> = {};

    try {
      if (!sessionId) sessionId = createSession(sc.id, cfg.level);
      sse(reply, 'session', { session_id: sessionId });

      // --- 1. STT (bo qua neu nguoi hoc go text) -----------------------
      let said: { text: string; duration_s: number };
      if (typed) {
        said = { text: typed, duration_s: 0 };
      } else if (!audio) {
        return fail('stt', 'Thiếu audio.');
      } else {
      try {
        said = await transcribe(
          audio,
          filename,
          mimetype,
          lang === 'fr'
            ? { prompt: `Conversation simple en français. ${sc.target_phrases.join(', ')}.`, lang: 'fr' }
            : {
                // Moi Whisper ve phia tu vung cua tinh huong nay.
                prompt: `English conversation about ${sc.domain}. ${sc.target_phrases.join(', ')}.`,
              },
        );
      } catch (e) {
        return fail('stt', e instanceof SttError ? e.message : (e as Error).message);
      }

        if (!said.text) {
          sse(reply, 'transcript', { text: '', duration_s: said.duration_s });
          return fail('stt', 'Không nghe ra chữ nào. Thử nói to hơn hoặc gần mic hơn.');
        }
      }
      lap.stt = Date.now() - t0;
      sse(reply, 'transcript', {
        text: said.text,
        duration_s: said.duration_s,
        typed: Boolean(typed),
      });

      // --- 2. Gemini (stream) ----------------------------------------
      const past = readTranscript(sessionId);
      const history: Turn[] = past.map((t) => ({ role: t.role, text: t.text }));
      const system =
        lang === 'fr'
          ? roleplaySystemFr(sc, lastDifficultyNote(sessionId))
          : roleplaySystem(sc, cfg.level, lastDifficultyNote(sessionId));

      // TTS chay song song voi phan con lai cua Gemini. Bat dau ngay khi
      // reply_en xong, khong doi corrections/vocab.
      let ttsChain: Promise<void> = Promise.resolve();
      let audioIndex = 0;
      let ttsFailed: string | null = null;

      const speak = (text: string) => {
        const chunks = splitForStreaming(text);
        for (const chunk of chunks) {
          ttsChain = ttsChain.then(async () => {
            if (ttsFailed) return;
            try {
              const buf = await synthesize(chunk, lang);
              if (buf.length === 0) return;
              if (audioIndex === 0) lap.first_audio = Date.now() - t0;
              sse(reply, 'audio', {
                index: audioIndex++,
                mime: 'audio/mpeg',
                text: chunk,
                b64: buf.toString('base64'),
              });
            } catch (e) {
              // TTS chet KHONG duoc lam chet ca luot noi — van con transcript
              // va phan sua loi de doc.
              ttsFailed = e instanceof TtsError ? e.message : (e as Error).message;
            }
          });
        }
      };

      let result;
      try {
        result = await roleplay(system, history, said.text, (replyEn) => {
          sse(reply, 'reply', { text: replyEn });
          speak(replyEn);
        });
      } catch (e) {
        return fail('llm', e instanceof LlmError ? e.message : (e as Error).message);
      }

      lap.llm = Date.now() - t0 - lap.stt;
      await ttsChain;
      lap.tts_all = Date.now() - t0 - lap.stt - lap.llm;

      // --- 3. Ghi kho -------------------------------------------------
      // Tieng Phap KHONG dao tu tu hoi thoai: may nghe hay nghe nham giong nguoi
      // moi hoc, dao ra la nap tu rac vao kho. Tu tieng Phap chi vao tu giao trinh.
      const vocabAdded = lang === 'fr' ? 0 : addVocab(result.vocab, sessionId);
      appendTranscript(sessionId, [
        { role: 'user', text: said.text, at: nowIso(), corrections: result.corrections },
        { role: 'model', text: result.reply_en, at: nowIso(), note: result.difficulty_note },
      ]);

      const turns = userTurnCount(sessionId);
      sse(reply, 'feedback', {
        corrections: result.corrections,
        vocab: result.vocab,
        vocab_added: vocabAdded,
        turn_count: turns,
        target_turns: TURNS_PER_SESSION,
        should_end: turns >= TURNS_PER_SESSION,
      });
      if (ttsFailed) sse(reply, 'warn', { where: 'tts', message: ttsFailed });
      req.log.info(
        { ...lap, total: Date.now() - t0, audio_bytes: audioIndex, words: result.reply_en.split(/\s+/).length },
        'chat-timing',
      );
      sse(reply, 'done', {});
      reply.raw.end();
    } catch (e) {
      req.log.error(e);
      fail('server', (e as Error).message);
    }
  });

  /**
   * POST /session/end  { session_id }
   * Dong buoi roleplay, danh dau Buoc 2 xong, thu chot ngay.
   */
  app.post<{ Body: { session_id?: number } }>('/session/end', async (req, reply) => {
    const id = Number(req.body?.session_id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Thieu session_id.' });
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: `Khong co session ${id}.` });

    const alreadyEnded = s.ended_at !== null;
    endSession(id);
    // Tieng Phap khong cong vao nhiem vu ngay / chuoi ngay cua tieng Anh.
    const isFr = s.scenario.startsWith('topic:') && Boolean(getTopicFr(s.scenario.slice('topic:'.length)));
    // Chi cong Buoc 2 mot lan cho moi session.
    if (!alreadyEnded && !isFr) bumpDaily('scenario_done');
    // Buoi tieng Phap chi DOC ngay, khong duoc chot ngay tieng Anh (review 12/09:
    // nguoi hoc da "De sau" het the Anh + da tro chuyen Anh -> buoi Phap chot ngay
    // va cong streak tieng Anh du khong lam gi tieng Anh).
    const daily = isFr ? getOrCreateToday() : completeDailyIfReady();

    // Chang 4 cua mot chu de CHINH LA buoi roleplay nay. Truoc day khong cho
    // nao danh dau no xong: Lesson.tsx doi huong sang /session roi return truoc
    // khi kip goi POST /learn/stage-complete — ma do la cho DUY NHAT trong ca
    // web/ goi route ay. Hau qua: khong chu de nao hoan thanh duoc, lo trinh
    // ket cung o 75%, va /today moi ngay lai day nguoi hoc vao dung chang do.
    //
    // Danh dau o DAY chu khong o frontend, vi ba ly do:
    //  - /session/end la cho duy nhat moi buoi roleplay di qua, nen moi loi vao
    //    deu dung, ke ca man "Luyen them" sau nay;
    //  - sua o frontend phai luon topic_id qua Lesson -> SessionEntry ->
    //    VoiceChat, ba file;
    //  - neu de frontend goi /learn/stage-complete thi route do bumpDaily
    //    ('scenario_done') THEM mot lan nua trong khi o tren vua bump => dem doi.
    //
    // markStageDone dung ON CONFLICT DO UPDATE nen goi lai nhieu lan khong cong
    // don. unlockedStage() chi doc tang 1-3 nen ghi tang 4 khong dong vao no.
    let stageDone: { topic_id: string; stage: number } | null = null;
    if (!alreadyEnded && s.scenario.startsWith('topic:')) {
      const topicId = s.scenario.slice('topic:'.length);
      // Chi danh dau chang 4 khi no DA MO (13/09) — go tay /session?scenario=topic:X
      // khi chang 1-3 chua xong thi van tro chuyen duoc, nhung khong tinh la xong chu de.
      if ((getTopic(topicId) || getTopicFr(topicId)) && unlockedStage(progressFor(topicId)) >= 4) {
        markStageDone(topicId, 4);
        stageDone = { topic_id: topicId, stage: 4 };
      }
    }

    return {
      session_id: id,
      turns: userTurnCount(id),
      // THEM truong, khong doi hinh dang cu — frontend dang chay khong phai sua.
      stage_done: stageDone,
      daily: {
        vocab_reviewed: daily.vocab_reviewed,
        scenario_done: daily.scenario_done,
        completed: daily.completed,
        streak: daily.streak,
      },
    };
  });

  /** GET /scenarios — cho man "Luyen them". */
  app.get('/scenarios', async () => {
    const { SCENARIOS } = await import('../config.js');
    return SCENARIOS.map((s) => ({ id: s.id, name_vi: s.name_vi, domain: s.domain }));
  });

  /** GET /session/:id — doc lai transcript mot buoi da hoc. */
  app.get<{ Params: { id: string } }>('/session/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: 'Khong tim thay session.' });
    return { ...s, transcript: readTranscript(id) };
  });
}
