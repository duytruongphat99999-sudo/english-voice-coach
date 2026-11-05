import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { cfg } from '../config.js';

const COOKIE = 'evc_session';
const MAX_AGE_S = 365 * 24 * 60 * 60; // 1 nam

/**
 * Dang nhap bang form + cookie, KHONG dung HTTP Basic Auth.
 *
 * Vi sao doi: Basic Auth tren may Duy bi Chrome tu nhoi mot username da luu
 * tu trang khac ("75477011"), gui sai -> 401 -> gui lai -> cham nguong ->
 * ERR_TOO_MANY_RETRIES, va khong co cach nao sua tu phia server. Duong vong
 * bang credential nhung trong URL cung chet: Chrome cam fetch() khi URL cua
 * trang co credential ("Request cannot be constructed from a URL that includes
 * credentials"), nen app tai duoc vo ma moi loi goi API deu hong.
 *
 * Form dang nhap thi autofill sai VAN HIEN RA cho nguoi dung sua, va khong co
 * vong lap thu lai nao o tang mang.
 *
 * Cookie khong luu state phia server: <het_han>.<uuid>.<hmac>. Doi APP_SECRET
 * la moi phien cu chet ngay.
 */

function sign(payload: string): string {
  return createHmac('sha256', cfg.app.secret).update(payload).digest('base64url');
}

function makeToken(): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  // uuid de hai lan dang nhap khong ra cung mot chuoi.
  const payload = `${exp}.${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const at = token.lastIndexOf('.');
  if (at <= 0) return false;

  const payload = token.slice(0, at);
  const got = Buffer.from(token.slice(at + 1));
  const want = Buffer.from(sign(payload));
  // So sanh do dai truoc: timingSafeEqual nem loi neu hai ben lech do dai.
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;

  const exp = Number(payload.split('.')[0]);
  return Number.isFinite(exp) && exp * 1000 > Date.now();
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function setCookie(reply: FastifyReply, value: string, maxAge: number) {
  // Secure luon bat: tu Chrome 89 / Firefox 75 thi cookie Secure van duoc
  // chap nhan tren http://localhost, nen dev khong hong. Duong LAN qua http
  // se khong giu duoc cookie — chap nhan, duong do von da dong.
  const bits = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  reply.header('Set-Cookie', bits.join('; '));
}

/** So sanh mat khau khong lo thoi gian. Bam truoc de hai ben luon bang do dai. */
function samePassword(given: string): boolean {
  const a = createHmac('sha256', cfg.app.secret).update(given).digest();
  const b = createHmac('sha256', cfg.app.secret).update(cfg.app.password).digest();
  return timingSafeEqual(a, b);
}

export default async function authRoutes(app: FastifyInstance) {
  /**
   * GET /auth/check — nginx goi qua `auth_request` cho MOI request.
   * Phai that nhe: chi doc cookie va kiem chu ky, khong cham DB.
   */
  app.get('/auth/check', async (req, reply) => {
    if (verifyToken(readCookie(req, COOKIE))) return reply.code(200).send();
    return reply.code(401).send();
  });

  /** POST /auth/login { password } */
  app.post<{ Body: { password?: string } }>('/auth/login', async (req, reply) => {
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!given) return reply.code(400).send({ error: 'Chua nhap mat khau.' });

    if (!samePassword(given)) {
      // Lam cham lai de do brute-force. Mot nguoi dung thi 400ms khong ai thay.
      await new Promise((r) => setTimeout(r, 400));
      req.log.warn({ ip: req.ip }, 'dang nhap that bai');
      return reply.code(401).send({ error: 'Sai mật khẩu.' });
    }

    setCookie(reply, makeToken(), MAX_AGE_S);
    return { ok: true };
  });

  /** POST /auth/logout */
  app.post('/auth/logout', async (_req, reply) => {
    setCookie(reply, '', 0);
    return { ok: true };
  });
}
