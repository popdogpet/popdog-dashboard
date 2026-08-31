/**
 * Tüm site için kimlik doğrulama kapısı.
 *
 * Bu middleware /* altındaki her isteği karşılar (bkz. _routes.json).
 * Geçerli oturum çerezi olmayan istekler index.html'i hiç görmez —
 * PIN artık istemciye inmiyor.
 *
 * Muaf yollar: yalnızca /api/login ve /api/logout.
 * (Eskiden /api/ingest de muaftı; çağıranı olmadığı için kaldırıldı —
 *  artık oturum kapısını atlayan hiçbir yazma ucu yok.)
 */
import { APP_COOKIE, parseCookies, verifySession, json } from './lib/auth.js';
import { loginPage } from './login-page.js';

const OPEN_PATHS = new Set(['/api/login', '/api/logout']);

/**
 * Güvenlik başlıkları. CSP mevcut sayfanın ihtiyaçlarına göre daraltıldı:
 *  - inline script/style: index.html tek dosya, hepsi gömülü
 *  - unpkg: PapaParse
 *  - blob: Papa.parse({worker:true}) kendi web worker'ını blob'dan yaratıyor
 *  - api.frankfurter.app / open.er-api.com / api.exchangerate.host: kur servisleri
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.frankfurter.app https://open.er-api.com https://api.exchangerate.host",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function harden(response) {
  const out = new Response(response.body, response);
  out.headers.set('Content-Security-Policy', CSP);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (OPEN_PATHS.has(path)) return harden(await next());

  // Yapılandırma eksikse açık bırakmak yerine kapalı kal.
  if (!env.AUTH_SECRET || !env.APP_PIN) {
    return new Response(
      'Sunucu yapılandırması eksik: AUTH_SECRET ve APP_PIN secret olarak tanımlanmalı.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }

  const cookies = parseCookies(request);
  if (await verifySession(env.AUTH_SECRET, 'app', cookies[APP_COOKIE])) {
    return harden(await next());
  }

  if (path.startsWith('/api/')) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  return harden(new Response(loginPage({ scope: 'app' }), {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }));
}
