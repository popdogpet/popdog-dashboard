/**
 * Kredi / varlık durumu — kalıcı depolama.
 *
 * Eskiden yalnızca tarayıcının localStorage'ında duruyordu: sürüm sıfırlaması
 * ya da cache temizliği veriyi siliyor, telefon ile bilgisayar farklı değer
 * gösteriyordu. Artık KV'de; localStorage sadece çevrimdışı yedek.
 *
 * Middleware'in arkasında olduğu için oturum zaten doğrulanmış olur.
 */
import { json } from '../lib/auth.js';

const KV_KEY = 'app:loans';
const MAX_BYTES = 256 * 1024;   // makul üst sınır; kaza eseri dev kayıt yazılmasın

export async function onRequestGet({ env }) {
  if (!env.AI_KV) return json({ ok: false, error: 'KV binding tanımlı değil', state: null });

  const val = await env.AI_KV.get(KV_KEY);
  if (!val) return json({ ok: true, state: null });   // henüz kayıt yok → istemci varsayılanı kullanır

  try {
    return json({ ok: true, state: JSON.parse(val) });
  } catch {
    console.log('[loans] bozuk JSON');
    return json({ ok: false, error: 'KV kaydı geçerli JSON değil', state: null });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.AI_KV) return json({ ok: false, error: 'KV binding tanımlı değil' }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ ok: false, error: 'Kayıt çok büyük' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'Geçersiz JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'Gövde bir nesne olmalı' }, 400);
  }

  await env.AI_KV.put(KV_KEY, JSON.stringify(body));
  return json({ ok: true, saved_at: new Date().toISOString() });
}
