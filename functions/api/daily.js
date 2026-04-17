const EMPTY = { title: 'Günlük Özet', highlights: [], risks: [], opportunities: [], updated_at: null };

export async function onRequestGet({ env }) {
  try {
    const val = await env.AI_KV.get('ai:daily_summary');
    const data = val ? JSON.parse(val) : EMPTY;
    return Response.json(data);
  } catch {
    return Response.json(EMPTY);
  }
}
