/**
 * Google Sheets CSV proxy.
 *
 * Yayınlanmış CSV adresleri artık istemciye hiç gitmiyor; sunucu tarafında
 * env değişkenlerinde duruyor. İstemci sadece /api/sheet?key=revenue çağırır.
 * Bu uç middleware'in arkasında olduğu için oturum zaten doğrulanmış olur.
 */
import { EXPENSES_COOKIE, parseCookies, verifySession, json } from '../lib/auth.js';

const SOURCES = {
  revenue:   'SHEET_CSV_REVENUE',
  inventory: 'SHEET_CSV_INVENTORY',
  orders:    'SHEET_CSV_ORDERS',
  expenses:  'SHEET_CSV_EXPENSES',
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';

  const envName = SOURCES[key];
  if (!envName) {
    return json({ ok: false, error: 'Geçersiz key. Beklenen: ' + Object.keys(SOURCES).join(' | ') }, 400);
  }

  // Giderler ikinci PIN'in arkasında. EXPENSES_PIN tanımlı değilse ek kapı yok.
  if (key === 'expenses' && env.EXPENSES_PIN) {
    const cookies = parseCookies(request);
    if (!(await verifySession(env.AUTH_SECRET, 'expenses', cookies[EXPENSES_COOKIE]))) {
      return json({ ok: false, error: 'Giderler için ek PIN gerekli' }, 403);
    }
  }

  const target = env[envName];
  if (!target) return json({ ok: false, error: `${envName} tanımlı değil` }, 503);

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!upstream.ok) {
      return json({ ok: false, error: `Kaynak HTTP ${upstream.status}` }, 502);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Tarayıcıda kısa süre tut; asıl tazelik cache-bust parametresiyle sağlanıyor.
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    console.log('[sheet] fetch error:', err && err.message);
    return json({ ok: false, error: 'Kaynağa ulaşılamadı' }, 502);
  }
}
