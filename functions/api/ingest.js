const VALID_TYPES = new Set(['focus', 'action', 'alerts', 'daily_summary']);
const KV_KEY = {
  focus:         'ai:focus',
  action:        'ai:action',
  alerts:        'ai:alerts',
  daily_summary: 'ai:daily_summary',
};

export async function onRequestPost({ request, env }) {
  // Bearer token auth
  const token = env.AI_INGEST_TOKEN;
  if (!token) return new Response('Server misconfigured', { status: 500 });

  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${token}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { type, payload } = body ?? {};
  if (!type || !VALID_TYPES.has(type)) {
    return new Response('Invalid type. Must be: focus | action | alerts | daily_summary', { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new Response('payload must be a JSON object', { status: 400 });
  }

  await env.AI_KV.put(KV_KEY[type], JSON.stringify(payload));
  return Response.json({ ok: true, type, stored_at: new Date().toISOString() });
}

// Block GET/other methods explicitly
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
