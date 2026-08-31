/**
 * Google Apps Script Web App proxy.
 *
 * /exec adresi artık HTML'de gömülü değil; GAS_EXEC_URL env değişkeninde.
 * İstemci `/api/gas?action=stocksummary` gibi çağırır, sorgu parametreleri
 * ve POST gövdesi olduğu gibi iletilir.
 */
import { json } from '../lib/auth.js';

async function proxy(request, env) {
  const base = env.GAS_EXEC_URL;
  if (!base) return json({ ok: false, error: 'GAS_EXEC_URL tanımlı değil' }, 503);

  const incoming = new URL(request.url);
  const target = new URL(base);
  for (const [k, v] of incoming.searchParams) target.searchParams.set(k, v);

  const init = {
    method: request.method,
    redirect: 'follow',
    headers: {},
  };
  if (request.method === 'POST') {
    init.body = await request.text();
    // Apps Script'te CORS preflight'ı tetiklememek için text/plain kullanılıyor.
    init.headers['Content-Type'] =
      request.headers.get('Content-Type') || 'text/plain;charset=utf-8';
  }

  try {
    const upstream = await fetch(target.toString(), init);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.log('[gas] proxy error:', err && err.message);
    return json({ ok: false, error: 'Apps Script’e ulaşılamadı' }, 502);
  }
}

export const onRequestGet  = ({ request, env }) => proxy(request, env);
export const onRequestPost = ({ request, env }) => proxy(request, env);
