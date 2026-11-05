import type { FastifyInstance } from 'fastify';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { cfg } from '../config.js';
import { db, nowIso } from '../db.js';
import { transcribe, SttError } from '../stt.js';
import { analyzePresentation, LlmError } from '../llm.js';
import { presentationSystem } from '../prompts.js';
import { bumpDaily } from '../store.js';

// Dem tren transcript da lowercase. Cum nhieu tu dat truoc de khong bi
// tinh trung ("you know" khong duoc dem lai thanh "know").
const FILLERS = [
  'you know',
  'sort of',
  'kind of',
  'i mean',
  'or something',
  'and so on',
  'basically',
  'actually',
  'literally',
  'obviously',
  'honestly',
  'um',
  'uh',
  'erm',
  'ah',
  'like',
  'right',
  'okay',
  'so',
  'well',
];

export function countFillers(transcript: string): { total: number; breakdown: Record<string, number> } {
  const text = ` ${transcript.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const breakdown: Record<string, number> = {};
  let total = 0;
  let scratch = text;
  for (const f of FILLERS) {
    const re = new RegExp(`(?<=\\s)${f.replace(/ /g, '\\s+')}(?=\\s)`, 'g');
    const hits = scratch.match(re);
    if (hits?.length) {
      breakdown[f] = hits.length;
      total += hits.length;
      // Xoa cho da dem de cum dai khong bi dem lai boi tu ngan hon.
      scratch = scratch.replace(re, ' ');
    }
  }
  return { total, breakdown };
}

export function countWords(transcript: string): number {
  const m = transcript.trim().match(/[A-Za-z0-9'’-]+/g);
  return m ? m.length : 0;
}

export default async function presentationRoutes(app: FastifyInstance) {
  /**
   * POST /presentation  (multipart: audio)
   * Thu 2-3 phut monologue -> wpm + filler + report.
   */
  app.post('/presentation', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'talk.webm';
    let mimetype = 'audio/webm';
    let clientDuration = 0;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'duration_s') {
          clientDuration = Number(part.value) || 0;
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Doc file that bai: ${(e as Error).message}` });
    }
    if (!audio || audio.length === 0) return reply.code(400).send({ error: 'Thieu file audio.' });

    let said;
    try {
      said = await transcribe(audio, filename, mimetype);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }
    if (!said.text.trim()) {
      return reply.code(422).send({ error: 'Khong nghe ra chu nao trong ban ghi.' });
    }

    // Uu tien duration do tu chinh file audio (speaches tra ve trong
    // verbose_json). Dong ho cua trinh duyet lech khi tab bi throttle.
    const duration = said.duration_s > 0 ? said.duration_s : clientDuration;
    if (duration <= 0) {
      return reply.code(422).send({ error: 'Khong xac dinh duoc do dai ban ghi.' });
    }

    const words = countWords(said.text);
    const wpm = Math.round(words / (duration / 60));
    const fillers = countFillers(said.text);

    let report;
    try {
      report = await analyzePresentation(
        presentationSystem(cfg.level),
        said.text,
        wpm,
        fillers.total,
        duration,
      );
    } catch (e) {
      return reply.code(502).send({ error: e instanceof LlmError ? e.message : (e as Error).message, where: 'llm' });
    }

    // Giu lai file goc de nghe lai. Thu muc nam trong ./data nen backup
    // ca du an chi can copy mot cho.
    let audioPath: string | null = null;
    try {
      const dir = join(cfg.dataDir, 'recordings');
      await mkdir(dir, { recursive: true });
      const ext = extname(filename) || '.webm';
      const name = `${Date.now()}${ext}`;
      await writeFile(join(dir, name), audio);
      audioPath = `recordings/${name}`;
    } catch (e) {
      req.log.warn(`Khong luu duoc file ghi am: ${(e as Error).message}`);
    }

    const full = { ...report, filler_breakdown: fillers.breakdown, words, duration_s: Math.round(duration) };
    const res = db
      .prepare(
        `INSERT INTO presentations (created_at, audio_path, transcript, wpm, filler_count, report_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(nowIso(), audioPath, said.text, wpm, fillers.total, JSON.stringify(full));

    bumpDaily('presentation_done');

    return {
      id: Number(res.lastInsertRowid),
      transcript: said.text,
      wpm,
      words,
      duration_s: Math.round(duration),
      filler_count: fillers.total,
      filler_breakdown: fillers.breakdown,
      report,
    };
  });

  /** GET /presentation — lich su, moi nhat truoc. */
  app.get('/presentation', async () => {
    const rows = db
      .prepare('SELECT id, created_at, wpm, filler_count FROM presentations ORDER BY id DESC LIMIT 50')
      .all() as unknown as { id: number; created_at: string; wpm: number; filler_count: number }[];
    return rows;
  });

  /**
   * GET /presentation/:id — xem lai bao cao day du.
   *
   * Tra ve DUNG hinh dang cua POST /presentation de man Record & Roast dung
   * lai duoc mot component bao cao duy nhat.
   *
   * `words`, `duration_s`, `filler_breakdown` khong co cot rieng trong DB —
   * chung nam long trong `report_json` (xem cho tao bien `full` o tren). Truoc
   * day route nay tra ca cuc do nguyen trong khoa `report`, nen ba truong tren
   * nam sai mot tang; ai dung `<Report>` de ve lai se ra `NaN` o o "filler %"
   * va "duration". Boc chung ra day cho khop.
   */
  app.get<{ Params: { id: string } }>('/presentation/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'id không hợp lệ.' });

    const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(id) as
      | { id: number; created_at: string; transcript: string; wpm: number; filler_count: number; report_json: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Khong tim thay ban ghi.' });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.report_json) as Record<string, unknown>;
    } catch {
      // Ban ghi hong thi van cho xem transcript, dung 500 ca man hinh.
      req.log.warn({ id }, 'report_json khong parse duoc');
    }
    const { words, duration_s, filler_breakdown, ...report } = parsed as {
      words?: number;
      duration_s?: number;
      filler_breakdown?: Record<string, number>;
    };

    return {
      id: row.id,
      created_at: row.created_at,
      transcript: row.transcript,
      wpm: row.wpm,
      words: words ?? 0,
      duration_s: duration_s ?? 0,
      filler_count: row.filler_count,
      filler_breakdown: filler_breakdown ?? {},
      report,
    };
  });
}
