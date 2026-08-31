/** Oturumu kapatır (her iki kapsam için de). */
import { APP_COOKIE, EXPENSES_COOKIE, clearCookieHeader } from '../lib/auth.js';

function bye() {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', clearCookieHeader(APP_COOKIE));
  h.append('Set-Cookie', clearCookieHeader(EXPENSES_COOKIE));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}

export const onRequestPost = bye;
export const onRequestGet = bye;
