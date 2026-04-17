const EMPTY = { title: '', why: '', impact: '', next_steps: [], updated_at: null };

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  console.log('[focus] route hit');
  try {
    if (!env.AI_KV) {
      console.log('[focus] kv missing');
      return ok(EMPTY);
    }
    const val = await env.AI_KV.get('ai:focus');
    if (!val) {
      console.log('[focus] fallback used: no kv value');
      return ok(EMPTY);
    }
    console.log('[focus] kv read ok');
    let data;
    try { data = JSON.parse(val); } catch {
      console.log('[focus] parse failed');
      return ok(EMPTY);
    }
    return ok(data);
  } catch (err) {
    console.log('[focus] unexpected error:', err && err.message);
    return ok(EMPTY);
  }
}
