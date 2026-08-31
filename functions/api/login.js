/** PIN doğrulama. PIN sunucuda kalır; başarıda imzalı HttpOnly çerez döner. */
import {
  APP_COOKIE, EXPENSES_COOKIE, SESSION_TTL,
  signSession, cookieHeader, json,
  checkRateLimit, recordFailure, clearFailures, clientIP,
} from '../lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.AUTH_SECRET) return json({ ok: false, error: 'Sunucu yapılandırması eksik' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Geçersiz istek' }, 400); }

  const scope = body && body.scope === 'expenses' ? 'expenses' : 'app';
  const pin = String((body && body.pin) || '');
  const expected = scope === 'expenses' ? env.EXPENSES_PIN : env.APP_PIN;
  if (!expected) return json({ ok: false, error: 'Sunucu yapılandırması eksik' }, 503);

  const ip = clientIP(request);
  const limit = await checkRateLimit(env, ip, scope);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' }, 429);
  }

  if (pin !== expected) {
    await recordFailure(env, ip, scope);
    return json({ ok: false, error: 'Yanlış PIN kodu' }, 401);
  }

  await clearFailures(env, ip, scope);
  const cookie = scope === 'expenses' ? EXPENSES_COOKIE : APP_COOKIE;
  const value = await signSession(env.AUTH_SECRET, scope);
  return json({ ok: true, scope }, 200, { 'Set-Cookie': cookieHeader(cookie, value, SESSION_TTL) });
}

export async function onRequestGet() {
  return json({ ok: false, error: 'Method Not Allowed' }, 405);
}
