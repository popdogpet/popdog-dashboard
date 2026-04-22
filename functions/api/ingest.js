const VALID_TYPES = new Set(['focus', 'action', 'alerts', 'daily_summary', 'caddebostan', 'caddebostan_live', 'caddebostan_close', 'instagram_live_summary', 'instagram_recommendations', 'instagram_calendar_suggestions', 'instagram_decision', 'instagram_recent_momentum']);
const KV_KEY = {
  focus:                          'ai:focus',
  action:                         'ai:action',
  alerts:                         'ai:alerts',
  daily_summary:                  'ai:daily_summary',
  caddebostan:                    'ai:caddebostan',
  caddebostan_live:               'ai:caddebostan_live',
  caddebostan_close:              'ai:caddebostan_close',
  instagram_live_summary:         'ai:instagram_live_summary',
  instagram_recommendations:      'ai:instagram_recommendations',
  instagram_calendar_suggestions: 'ai:instagram_calendar_suggestions',
  instagram_decision:             'ai:instagram_decision',
  instagram_recent_momentum:      'ai:instagram_recent_momentum',
};

function jsonResp(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  console.log('[ingest] reached ingest');
  try {
    // KV binding guard — catch missing binding before anything else
    if (!env.AI_KV) {
      console.log('[ingest] kv missing');
      return jsonResp({ ok: false, error: 'KV binding not configured' }, 500);
    }

    // Auth
    const token = env.AI_INGEST_TOKEN;
    if (!token) {
      console.log('[ingest] AI_INGEST_TOKEN env var missing');
      return jsonResp({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const auth = request.headers.get('Authorization') || '';
    if (!auth) {
      console.log('[ingest] auth failed: no Authorization header');
      return jsonResp({ ok: false, error: 'Missing Authorization header' }, 401);
    }
    if (auth !== `Bearer ${token}`) {
      console.log('[ingest] auth failed: bad token');
      return jsonResp({ ok: false, error: 'Invalid token' }, 403);
    }

    // Body
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResp({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const { type, payload } = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};

    if (!type || !VALID_TYPES.has(type)) {
      return jsonResp({ ok: false, error: 'Invalid type. Must be one of: ' + [...VALID_TYPES].join(' | ') }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResp({ ok: false, error: 'payload must be a non-array JSON object' }, 400);
    }

    // Write
    await env.AI_KV.put(KV_KEY[type], JSON.stringify(payload));
    console.log('[ingest] write success:', type);
    return jsonResp({ ok: true, type, stored_at: new Date().toISOString() }, 200);

  } catch (err) {
    console.log('[ingest] unexpected error:', err && err.message);
    return jsonResp({ ok: false, error: 'Internal server error' }, 500);
  }
}

export async function onRequestGet() {
  return jsonResp({ ok: false, error: 'Method Not Allowed' }, 405);
}
