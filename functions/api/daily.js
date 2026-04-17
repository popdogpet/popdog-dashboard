const EMPTY = { title: 'Günlük Özet', highlights: [], risks: [], opportunities: [], updated_at: null };

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  console.log('[daily] route hit');
  try {
    if (!env.AI_KV) {
      console.log('[daily] kv missing');
      return ok(EMPTY);
    }
    const val = await env.AI_KV.get('ai:daily_summary');
    if (!val) {
      console.log('[daily] fallback used: no kv value');
      return ok(EMPTY);
    }
    console.log('[daily] kv read ok');
    let data;
    try { data = JSON.parse(val); } catch {
      console.log('[daily] parse failed');
      return ok(EMPTY);
    }
    return ok(data);
  } catch (err) {
    console.log('[daily] unexpected error:', err && err.message);
    return ok(EMPTY);
  }
}
