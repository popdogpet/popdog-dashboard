const EMPTY = { title: '', why: '', impact: '', urgency: '', updated_at: null };

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  console.log('[action] route hit');
  try {
    if (!env.AI_KV) {
      console.log('[action] kv missing');
      return ok(EMPTY);
    }
    const val = await env.AI_KV.get('ai:action');
    if (!val) {
      console.log('[action] fallback used: no kv value');
      return ok(EMPTY);
    }
    console.log('[action] kv read ok');
    let data;
    try { data = JSON.parse(val); } catch {
      console.log('[action] parse failed');
      return ok(EMPTY);
    }
    return ok(data);
  } catch (err) {
    console.log('[action] unexpected error:', err && err.message);
    return ok(EMPTY);
  }
}
