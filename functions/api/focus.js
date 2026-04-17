const EMPTY = { title: '', why: '', impact: '', next_steps: [], updated_at: null };

export async function onRequestGet({ env }) {
  try {
    const val = await env.AI_KV.get('ai:focus');
    const data = val ? JSON.parse(val) : EMPTY;
    return Response.json(data);
  } catch {
    return Response.json(EMPTY);
  }
}
