const EMPTY = {};

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  try {
    if (!env.AI_KV) return ok(EMPTY);
    const val = await env.AI_KV.get('ai:instagram_recent_momentum');
    if (!val) return ok(EMPTY);
    let data;
    try { data = JSON.parse(val); } catch { return ok(EMPTY); }
    return ok(data);
  } catch {
    return ok(EMPTY);
  }
}
