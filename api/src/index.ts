import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { cfg, TOPICS } from './config.js';
import './db.js'; // chay migration ngay luc khoi dong
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import learnRoutes from './routes/learn.js';
import todayRoutes from './routes/today.js';
import reviewRoutes from './routes/review.js';
import presentationRoutes from './routes/presentation.js';
import dailyRoutes from './routes/daily.js';
import progressRoutes from './routes/progress.js';
import pteRoutes from './routes/pte.js';
import pteSpeakingRoutes from './routes/pte-speaking.js';
import shadowRoutes from './routes/shadow.js';
import ptePlanRoutes from './routes/pte-plan.js';
import pteReadingRoutes from './routes/pte-reading.js';
import pteListeningRoutes from './routes/pte-listening.js';
import pteOpenRoutes from './routes/pte-open.js';
import frRoutes from './routes/fr.js';

const app = Fastify({
  // Khong dung pino-pretty: them mot dependency chi de log dep khong dang.
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Ban ghi presentation 3 phut webm/opus ~3MB; de rong tay.
  bodyLimit: 30 * 1024 * 1024,
  // Chuoi STT -> Gemini -> TTS co the cham. Mac dinh Fastify khong timeout
  // request, nhung ghi ro de khoi phai doan.
  requestTimeout: 0,
});

await app.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
    fields: 8,
  },
});

app.get('/health', async () => ({
  ok: true,
  topics: TOPICS.length,
  model: cfg.gemini.model,
  stt_model: cfg.stt.model,
  tts_model: cfg.tts.model,
  tts_voice: cfg.tts.voice,
  level: cfg.level,
  today_token_set: cfg.todayToken.length > 0,
}));

/**
 * GET /health/deps — kiem ca chuoi phu thuoc, dung de chan doan khi
 * "bam mic khong ra gi". Khong nam trong healthcheck cua compose vi no
 * goi ra Internet.
 */
app.get('/health/deps', async () => {
  const out: Record<string, unknown> = {};

  try {
    const r = await fetch(`${cfg.stt.baseUrl.replace(/\/v1$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    out.speaches = r.ok ? 'ok' : `http ${r.status}`;
  } catch (e) {
    out.speaches = `khong ket noi duoc: ${(e as Error).message}`;
  }

  try {
    const r = await fetch(`${cfg.stt.baseUrl}/models`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { data?: { id: string }[] };
    const ids = (j.data ?? []).map((m) => m.id);
    out.models_installed = ids;
    out.stt_model_ready = ids.includes(cfg.stt.model);
    out.tts_model_ready = ids.includes(cfg.tts.model);
    if (!ids.includes(cfg.stt.model) || !ids.includes(cfg.tts.model)) {
      out.hint = 'Thieu model. Chay: bash scripts/preload-models.sh';
    }
  } catch (e) {
    out.models_installed = `khong doc duoc: ${(e as Error).message}`;
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.gemini.model}?key=${cfg.gemini.apiKey}`,
      { signal: AbortSignal.timeout(8000) },
    );
    out.gemini = r.ok ? 'ok' : `http ${r.status}`;
  } catch (e) {
    out.gemini = `khong ket noi duoc: ${(e as Error).message}`;
  }

  return out;
});

await app.register(authRoutes);
await app.register(chatRoutes);
await app.register(learnRoutes);
await app.register(todayRoutes);
await app.register(reviewRoutes);
await app.register(presentationRoutes);
await app.register(dailyRoutes);
await app.register(progressRoutes);
await app.register(pteRoutes);
await app.register(pteSpeakingRoutes);
await app.register(shadowRoutes);
await app.register(ptePlanRoutes);
await app.register(pteReadingRoutes);
await app.register(pteListeningRoutes);
await app.register(pteOpenRoutes);
await app.register(frRoutes);

app.setErrorHandler((err: unknown, req, reply) => {
  req.log.error(err);
  const e = err as { statusCode?: number; message?: string };
  const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
  reply.code(status).send({ error: e.message ?? 'Loi khong xac dinh.' });
});

const shutdown = async (sig: string) => {
  app.log.info(`${sig} -> dong server`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
