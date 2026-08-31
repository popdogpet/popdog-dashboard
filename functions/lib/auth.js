/**
 * Ortak kimlik doğrulama yardımcıları.
 *
 * Çerez değeri:  <scope>.<exp>.<hmac-hex>
 * imza:          HMAC-SHA256(AUTH_SECRET, "<scope>.<exp>")
 *
 * PIN'ler ve AUTH_SECRET yalnızca sunucuda (Cloudflare secret) durur,
 * istemciye hiçbir zaman gönderilmez.
 */

export const APP_COOKIE = 'pd_auth';
export const EXPENSES_COOKIE = 'pd_exp';

/** Oturum ömrü (saniye). 12 saat. */
export const SESSION_TTL = 12 * 60 * 60;

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** Uzunluk sızdırmayan sabit zamanlı karşılaştırma. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret, scope, ttl = SESSION_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${scope}.${exp}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(secret, scope, value) {
  if (!secret || !value) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [gotScope, expStr, sig] = parts;
  if (gotScope !== scope) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, await hmac(secret, `${gotScope}.${expStr}`));
}

export function cookieHeader(name, value, maxAge) {
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  return attrs.join('; ');
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

/**
 * PIN denemelerini IP başına sınırlar. 4 haneli PIN kaba kuvvete açık
 * olduğu için bu şart; KV yoksa sessizce devre dışı kalır.
 */
export async function checkRateLimit(env, ip, scope) {
  if (!env.AI_KV) return { allowed: true, remaining: null };
  const key = `auth:fail:${scope}:${ip}`;
  const count = Number((await env.AI_KV.get(key)) || '0');
  return { allowed: count < 8, remaining: Math.max(0, 8 - count), key };
}

export async function recordFailure(env, ip, scope) {
  if (!env.AI_KV) return;
  const key = `auth:fail:${scope}:${ip}`;
  const count = Number((await env.AI_KV.get(key)) || '0') + 1;
  // 15 dakikalık pencere
  await env.AI_KV.put(key, String(count), { expirationTtl: 900 });
}

export async function clearFailures(env, ip, scope) {
  if (!env.AI_KV) return;
  await env.AI_KV.delete(`auth:fail:${scope}:${ip}`);
}

export function clientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}
