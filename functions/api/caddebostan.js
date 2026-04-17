const EMPTY = { date: null, grand_total: null, updated_at: null };

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  try {
    if (!env.AI_KV) return ok(EMPTY);
    const val = await env.AI_KV.get('ai:caddebostan');
    if (!val) return ok(EMPTY);
    let data;
    try { data = JSON.parse(val); } catch { return ok(EMPTY); }
    return ok(data);
  } catch (err) {
    console.log('[caddebostan] error:', err && err.message);
    return ok(EMPTY);
  }
}
