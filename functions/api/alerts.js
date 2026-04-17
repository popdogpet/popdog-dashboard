const EMPTY = { items: [], updated_at: null };

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  console.log('[alerts] route hit');
  try {
    if (!env.AI_KV) {
      console.log('[alerts] kv missing');
      return ok(EMPTY);
    }
    const val = await env.AI_KV.get('ai:alerts');
    if (!val) {
      console.log('[alerts] fallback used: no kv value');
      return ok(EMPTY);
    }
    console.log('[alerts] kv read ok');
    let data;
    try { data = JSON.parse(val); } catch {
      console.log('[alerts] parse failed');
      return ok(EMPTY);
    }
    return ok(data);
  } catch (err) {
    console.log('[alerts] unexpected error:', err && err.message);
    return ok(EMPTY);
  }
}
