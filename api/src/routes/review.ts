import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { matchPhrase, scoreToGrade } from '../pronounce.js';
import { sayAsFor, getTopic, DOMAIN_VI } from '../config.js';
import { reviewRating } from '../srs.js';
import { Rating } from 'ts-fsrs';
import {
  applyGrade,
  bumpDaily,
  completeDailyIfReady,
  dueVocab,
  dueVocabIn,
  getVocab,
  vocabTopics,
  buryVocab,
  asLang,
} from '../store.js';

export default async function reviewRoutes(app: FastifyInstance) {
  /**
   * GET /review/due — cac the den han theo SM-2.
   *
   * `?topic=` de loc. Can vi hai nguoi dung chung mot kho: khong loc thi tu
   * da lieu cua vo roi vao phan on cua Duy va nguoc lai.
   */
  app.get<{ Querystring: { limit?: string; topic?: string; lang?: string } }>('/review/due', async (req) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const topic = (req.query.topic ?? '').trim();
    // Tieng Anh va tieng Phap la HAI KHO RIENG. Thieu bo loc nay la the tieng
    // Phap lot vao buoi on tieng Anh.
    const lang = asLang(req.query.lang);
    const cards = topic ? dueVocabIn(topic, limit, lang) : dueVocab(limit, lang);
    return cards.map((c) => ({
      id: c.id,
      word: c.word,
      ipa: c.ipa ?? '',
      meaning_vi: c.meaning_vi,
      example_en: c.example_en,
      domain: c.domain,
      topic_id: c.topic_id,
      lang: c.lang ?? 'en',
      reps: c.reps,
      interval: c.interval,
      due_date: c.due_date,
    }));
  });

  /**
   * GET /review/topics — cac nhom co trong kho, de dung lam bo loc.
   *
   * Tra kem `label` TIENG VIET. Truoc day chip in nguyen slug tieng Anh
   * ("negotiation") — cung chuoi do con bi in len mat truoc the on va tro
   * thanh chu tieng Anh duy nhat tren man, khien nguoi hoc doc luon no thay
   * vi tu can hoc (truy duoc trong log 07/09).
   *
   * Nhan lay theo hai duong: chu de giao trinh thi lay name_vi that tu
   * api/content; domain do Gemini dat thi tra bang DOMAIN_VI. Gemini tra
   * `domain` la chuoi TU DO (llm.ts khai bao S.str, khong enum) nen bang tra
   * chac chan se thieu — thieu thi rot ve chinh slug do, khong duoc de trong.
   */
  app.get<{ Querystring: { lang?: string } }>('/review/topics', async (req) =>
    vocabTopics(asLang(req.query.lang)).map((t) => {
      const topic = getTopic(t.topic_id);
      return {
        ...t,
        label: topic?.name_vi ?? DOMAIN_VI[t.topic_id] ?? t.topic_id.replace(/_/g, ' '),
        emoji: topic?.emoji ?? null,
        /** true = chu de giao trinh; false = nhom do Gemini dat khi dao tu. */
        is_course: Boolean(topic),
      };
    }),
  );

  /**
   * POST /review/skip  { word_id } — "De sau".
   *
   * Chi day rieng due_date sang mai. KHONG applyGrade, KHONG reviewRating,
   * KHONG bumpDaily, KHONG completeDailyIfReady — mot lan bam nut go bi khong
   * duoc phep ghi gi vao mo hinh tri nho cua the. Xem chu thich buryVocab.
   */
  app.post<{ Body: { word_id?: number } }>('/review/skip', async (req, reply) => {
    const id = Number(req.body?.word_id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Thiếu word_id.' });
    const card = getVocab(id);
    if (!card) return reply.code(404).send({ error: 'Không tìm thấy từ.' });
    return { word_id: id, next_due: buryVocab(id) };
  });

  /**
   * POST /review/answer  (multipart: word_id, audio)
   *
   * DE BAI la nghia tieng Viet; nguoi hoc phai BAT RA tu tieng Anh.
   *
   * Truoc day man nay bat "dat 1 cau dung tu X" roi nho Gemini cham. Bo vi
   * hai ly do Duy neu ra va deu dung: bi bat sang tac cau voi mot tu chuyen
   * nganh thi mong lung, va moi the phai cho Gemini them 4-6 giay.
   *
   * Gio cham tai cho bang doi chieu am — khoang 2 giay, va do dung thu can do:
   * co nho ra tu do khong, va noi co ra tieng khong. Khong goi Gemini.
   */
  app.post('/review/answer', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'answer.webm';
    let mimetype = 'audio/webm';
    let wordId = 0;
    // Mili giay tu luc the hien ra toi luc nguoi hoc cham mic. null = client
    // khong gui (ban web cu) => reviewRating se khong bao gio cham Easy.
    let thinkMs: number | null = null;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'word_id') {
          wordId = Number(part.value);
        } else if (part.fieldname === 'think_ms') {
          const n = Number(part.value);
          thinkMs = Number.isFinite(n) ? n : null;
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Đọc file thất bại: ${(e as Error).message}` });
    }

    if (!Number.isInteger(wordId) || wordId <= 0) return reply.code(400).send({ error: 'Thiếu word_id.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    const card = getVocab(wordId);
    if (!card) return reply.code(404).send({ error: `Không có từ id=${wordId}.` });

    let said;
    try {
      // KHONG truyen `prompt` chua chinh tu can kiem: lam vay la moi Whisper
      // nghe ra tu do du nguoi hoc khong he noi, va diem se luon dep.
      // Ngon ngu lay tu CHINH THE, khong tu query: the biet no thuoc kho nao.
      // De Whisper doan thi cau tieng Phap ngan bi nhan nham thanh tieng Anh
      // roi phien am bay.
      said = await transcribe(audio, filename, mimetype, {
        words: true,
        lang: card.lang === 'fr' ? 'fr' : 'en',
      });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }

    const heard = said.words.length ? said.words : said.text.split(/\s+/).map((w) => ({ word: w }));
    const m = said.text.trim() ? matchPhrase(card.word, heard) : { score: 0, found: false, matched: null, probability: null };
    // grade 0-5 chi con dung de HIEN THI ("Diem nho x/5") va ghi vao last_grade.
    // Lich on do FSRS quyet, an theo m.score nguyen ban — xem store.applyGrade.
    const grade = scoreToGrade(m.score);
    // Lich on an theo CA hai: doc co dung khong, va bat ra co nhanh khong.
    // Xem chu thich dai trong srs.reviewRating ve vi sao khong dung mot minh diem.
    const rating = reviewRating(m.score, thinkMs);
    const next = applyGrade(card, grade, m.score, rating);
    bumpDaily('vocab_reviewed');
    const daily = completeDailyIfReady();

    // Nhac lai cho nguoi hoc thay vi sao lich lai giay ra bay nhieu — gio no
    // phu thuoc ca toc do bat ra, khong chi do ro chu.
    const slow = thinkMs !== null && thinkMs > 8_000;
    const feedback = !said.text.trim()
      ? 'Không nghe ra chữ nào. Thử nói to hơn, gần mic hơn.'
      : rating === Rating.Easy
        ? 'Bật ra ngay và nói rõ. Giãn lịch ôn ra thật xa.'
        : m.score >= 90
          ? slow
            ? 'Nói rõ, nhưng nghĩ hơi lâu mới bật ra được — lịch ôn chỉ giãn vừa phải.'
            : 'Nhớ và nói rõ. Lịch ôn giãn ra.'
          : m.found
            ? `Nhớ được từ, nhưng nghe chưa rõ (máy nghe thành "${m.matched}"). Đọc lại theo mẫu.`
            : `Chưa bật ra được từ này — máy nghe thành "${said.text.trim() || '…'}".`;

    return {
      word_id: card.id,
      word: card.word,
      ipa: card.ipa ?? '',
      example_en: card.example_en,
      transcript: said.text,
      ok: grade >= 3,
      grade,
      score: m.score,
      matched: m.matched,
      think_ms: thinkMs,
      feedback_vi: feedback,
      next_due: next.due_date,
      interval: next.interval,
      reps: next.reps,
      daily: {
        vocab_reviewed: daily.vocab_reviewed,
        scenario_done: daily.scenario_done,
        completed: daily.completed === 1,
        streak: daily.streak,
      },
    };
  });

  /**
   * GET /review/say/:id — doc to tu + cau vi du.
   * ?part=word chi doc rieng tu.
   */
  app.get<{ Params: { id: string }; Querystring: { part?: string } }>(
    '/review/say/:id',
    async (req, reply) => {
      const card = getVocab(Number(req.params.id));
      if (!card) return reply.code(404).send({ error: 'Không tìm thấy từ.' });
      // say_as: chu viet tat phai danh van tung chu, khong doc lien mot tieng
      // ("MOQ" -> "Mach"). The doc tu DB nen phai tra nguoc qua bo noi dung;
      // the mined khong co trong do thi tra undefined va dung `word` nhu cu.
      // Chi doi duong AM THANH; cham diem van so voi card.word.
      const sayWord = sayAsFor(card.word) ?? card.word;
      const text =
        req.query.part === 'word' || !card.example_en
          ? sayWord
          : `${sayWord}. ${card.example_en}`;
      try {
        // Giong doc theo ngon ngu cua the: 'fr' -> ff_siwis.
        const buf = await synthesize(text, card.lang === 'fr' ? 'fr' : 'en');
        return reply
          .header('Content-Type', 'audio/mpeg')
          .header('Cache-Control', 'private, max-age=86400')
          .send(buf);
      } catch (e) {
        return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
      }
    },
  );
}
