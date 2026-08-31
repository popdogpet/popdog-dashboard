/**
 * AI kartlarının KV okuma katmanı.
 *
 * Uçlar her durumda 200 + geçerli şekil döner ki arayüz kırılmasın; ama
 * "veri yok" ile "sistem bozuk" ayırt edilebilsin diye yanıta bir `_meta`
 * alanı eklenir:
 *
 *   _meta.source = 'kv'           → gerçek veri
 *                | 'empty'        → KV'de henüz kayıt yok
 *                | 'config_error' → KV binding tanımlı değil
 *                | 'parse_error'  → KV'deki kayıt bozuk JSON
 */

function respond(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function withMeta(payload, source, error) {
  return {
    ...payload,
    _meta: {
      ok: source === 'kv',
      source,
      error: error || null,
      served_at: new Date().toISOString(),
    },
  };
}

export async function readKV(env, kvKey, empty, tag) {
  try {
    if (!env.AI_KV) {
      console.log(`[${tag}] kv binding yok`);
      return respond(withMeta(empty, 'config_error', 'AI_KV binding tanımlı değil'));
    }

    const val = await env.AI_KV.get(kvKey);
    if (!val) {
      console.log(`[${tag}] kayıt yok: ${kvKey}`);
      return respond(withMeta(empty, 'empty'));
    }

    let data;
    try {
      data = JSON.parse(val);
    } catch {
      console.log(`[${tag}] bozuk JSON: ${kvKey}`);
      return respond(withMeta(empty, 'parse_error', 'KV kaydı geçerli JSON değil'));
    }

    return respond(withMeta(data, 'kv'));
  } catch (err) {
    console.log(`[${tag}] beklenmeyen hata:`, err && err.message);
    return respond(withMeta(empty, 'config_error', 'Beklenmeyen sunucu hatası'));
  }
}
