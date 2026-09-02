/* ================== CHANNEL DISPLAY NAMES ================== */
const CHANNEL_DISPLAY = { 'CKM':'Shop', 'CKM Nakit':'Shop (Nakit)', 'Toptan':'B2B', 'Kuaför':'Grooming' };
function chLabel(k){ return CHANNEL_DISPLAY[k] || k; }

/* ================== CONFIG ================== */
/* Apps Script Web App URL’in (write-to-sheet için) */
/* Apps Script artık sunucudaki /api/gas proxy'si üzerinden çağrılıyor.
   Gerçek /exec adresi GAS_EXEC_URL secret'ında, istemciye hiç inmiyor. */
const GAS_PROXY_URL = '/api/gas';
const SHEET_WEBAPP_URL = (()=>{
  try{
    const u = localStorage.getItem('popdog_sheet_webapp_url');
    if (u && isValidWebAppURL(u)) return u;
  }catch(_){}
  return GAS_PROXY_URL;
})();

/* Hem proxy yolunu hem de elle girilmiş doğrudan /exec adresini kabul eder. */
function isValidWebAppURL(u){
  return u === GAS_PROXY_URL
      || isValidWebAppURL(String(u||''));
}

// Always read the latest URL from localStorage at call time
function getSheetWebAppURL(){
  try{
    const u = localStorage.getItem('popdog_sheet_webapp_url');
    if (u && isValidWebAppURL(u)) return u;
  }catch(_){ }
  return SHEET_WEBAPP_URL; // boot-time fallback
}

async function fetchFundQuote(code){
  const base = getSheetWebAppURL();
  if (!base || typeof base !== 'string' || !isValidWebAppURL(base)){
    throw new Error('INVALID_WEBAPP_URL');
  }

  const upper = String(code||'').toUpperCase();
  const shortcut = { FI5:'fi5Quote', SAS:'sasQuote', TI3:'isyQuote' }[upper] || '';

  // Small helper: fetch and try to parse JSON safely (don’t throw on 200/HTML bodies)
  async function request(url, opts){
    const ctrl = new AbortController();
    const id = setTimeout(()=> ctrl.abort(), 12000); // a bit more lenient
    try{
      const res = await fetch(url, { cache:'no-store', ...opts, signal: ctrl.signal });
      const text = await res.text().catch(()=> '');
      let json = null;
      // Try JSON only if it looks like JSON
      try{ json = JSON.parse(text); }catch(_){ json = null; }
      return { status: res.status, ok: res.ok, json, raw: text };
    }catch(err){
      return { status: 0, ok:false, json:null, raw: (err && err.name==='AbortError') ? 'TIMEOUT' : 'LOAD_FAILED' };
    }finally{ clearTimeout(id); }
  }

  // Normalize a potential quote-shaped object
  function normalizeQuote(j){
    if (!j || typeof j !== 'object') return null;
    const unit = (j.unitTRY!=null) ? Number(j.unitTRY) : NaN;
    if (j.ok && unit>0) return { ok:true, code: (j.code||upper), unitTRY: unit, source: j.source||'' };
    return null;
  }

  // Try a sequence of GET endpoints first (some deploys only allow GET)
  const getURLs = [
    `${base}?action=fundQuote&code=${encodeURIComponent(upper)}&t=${Date.now()}`,
    `${base}?code=${encodeURIComponent(upper)}&action=fundQuote&t=${Date.now()}`,
  ];
  if (shortcut){
    getURLs.push(`${base}?action=${encodeURIComponent(shortcut)}&t=${Date.now()}`);
  }

  for (const u of getURLs){
    const r = await request(u, { method:'GET' });
    const q = normalizeQuote(r.json);
    if (q) return q;             // success
    // If server answered 200 but not a quote (e.g., ping JSON), just continue without throwing
    if (r.raw === 'TIMEOUT' || r.raw === 'LOAD_FAILED'){
      // soft fail; continue trying other strategies — don’t surface as an error yet
      continue;
    }
  }

  // Try POST (JSON)
  {
    const r = await request(base, {
      method:'POST',
      headers: { 'Content-Type':'application/json;charset=utf-8' },
      body: JSON.stringify({ action:'fundQuote', code: upper })
    });
    const q = normalizeQuote(r.json);
    if (q) return q;
  }

  // Try POST (form-urlencoded)
  {
    const form = new URLSearchParams();
    form.set('action','fundQuote');
    form.set('code', upper);
    const r = await request(base, {
      method:'POST',
      headers: { 'Content-Type':'application/x-www-form-urlencoded;charset=utf-8' },
      body: form.toString()
    });
    const q = normalizeQuote(r.json);
    if (q) return q;
  }

  // Nothing worked → signal upper layer to use cache without logging scary errors
  throw new Error('NO_QUOTE');
}

function cacheless(url){
  const u = new URL(url, location.href);
  // Add a cache-busting param to avoid any intermediary caches
  u.searchParams.set('_', Date.now());
  // IMPORTANT: Do NOT set any custom headers here — Apps Script Web Apps
  // will preflight on non-simple headers and return 405 to the CORS OPTIONS request.
  // Keep this a simple GET so the request does not trigger a preflight.
  return fetch(u.toString(), {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow'
  });
}

// === TEFAS fon fiyatlarını Apps Script'ten çek (FI5, SAS, TI3) ===
async function refreshFundQuotes(){
  try{
    const funds = [
      { code:'FI5', input:'fi5UnitInput', lsUnit:'popdog_fi5_unit_try', lsAt:'popdog_fi5_updated_at' },
      { code:'SAS', input:'sasUnitInput', lsUnit:'popdog_sas_unit_try', lsAt:'popdog_sas_updated_at' },
      { code:'TI3', input:'isyUnitInput', lsUnit:'popdog_isy_unit_try', lsAt:'popdog_isy_updated_at' }, // İŞY = TI3
    ];
    const base = getSheetWebAppURL();
    for (const f of funds){
      try{
        // Build GET URL (prefer action=fundQuote&code=...)
        const r = await cacheless(`${base}?action=fundQuote&code=${encodeURIComponent(f.code)}`);
        let j = null;
        try {
          const txt = await r.text();
          j = JSON.parse(txt);
        } catch(_){}
        // Normalize: expect shape { ok:true, unitTRY: number }
        const unitRaw = (j && typeof j.unitTRY !== 'undefined') ? j.unitTRY : null;
        const unit = Number(unitRaw);
        if (!j || !j.ok || !(unit > 0)) {
          throw new Error('Invalid payload');
        }
        // SANE PRICE GUARD
        const codeUp = String(f.code || '').toUpperCase();
        const cap = (codeUp === 'FI5') ? 2000 : 10000;
        if (!(unit > 0 && unit < cap)) {
          throw new Error('Insane price rejected');
        }

        // Başarılı → kaydet + UI
        localStorage.setItem(f.lsUnit, String(unit));
        localStorage.setItem(f.lsAt, String(Date.now()));
        const inp = document.getElementById(f.input);
        if (inp) inp.value = String(unit);

        // Kaynak yaz
        const noteEl = document.getElementById((f.input||'').replace('UnitInput','Note'));
        if (noteEl) noteEl.textContent = (j.source ? `Kaynak: ${j.source}` : '');
      }catch(e){
        // Bağlantı/timeout/yanıt bozuksa → önbellek fallback
        const cached = Number(localStorage.getItem(f.lsUnit)||'0');
        const inp = document.getElementById(f.input);
        if (cached>0 && inp){
          inp.value = String(cached);
          const noteEl = document.getElementById((f.input||'').replace('UnitInput','Note'));
          const at = Number(localStorage.getItem(f.lsAt)||'0');
          const ageMin = at? Math.round((Date.now()-at)/60000) : null;
          if (noteEl) noteEl.textContent = `Önbellekten kullanıldı${ageMin!=null ? ` • ${ageMin} dk önce` : ''}`;
        }
        // Sessiz hata - API sorunları kullanıcıyı ilgilendirmez, cache kullanılır
        // console.debug('fundQuote fetch failed:', String(f.code).toLowerCase(), e && e.message ? e.message : e);
      }
    }
    // Kartlardaki toplamları/hesap notlarını tazele
    try{ renderLoansBlock(); }catch(_){}
  }catch(e){
    console.warn('refreshFundQuotes() top-level error', e);
  }
}

// === Altın gram fiyatını Apps Script üzerinden çek (CORS'suz) ===
async function refreshGoldFromScript(){
  try{
    const base = getSheetWebAppURL();
    if (!isValidWebAppURL(base)){
      throw new Error('INVALID_WEBAPP_URL');
    }

    const url = `${base}?action=goldQuote&t=${Date.now()}`;
    const res = await fetch(url, { method:'GET', cache:'no-store' });
    const txt = await res.text().catch(()=> '');
    let j = null;
    try{ j = JSON.parse(txt); }catch(_){ j = null; }

    if (!j || !j.ok || typeof j.gramTRY === 'undefined'){
      throw new Error('Invalid payload');
    }

    const gram = Number(j.gramTRY);
    if (!(gram > 0)){
      throw new Error('Invalid price');
    }

    // Cache to localStorage
    try{
      localStorage.setItem('popdog_gold_gram_try', String(gram));
      localStorage.setItem('popdog_gold_updated_at', String(Date.now()));
    }catch(_){}

    const input = document.getElementById('goldGramInput');
    const note  = document.getElementById('goldNote');

    if (input){
      // Türkçe formatla veya düz sayı bırak; mevcut logic input'u parse ediyor
      input.value = String(gram);
      // Mevcut hesaplama mantığını tetiklemek için input event'i gönder
      try{
        const evt = new Event('input', { bubbles:true });
        input.dispatchEvent(evt);
      }catch(_){}
    }

    if (note){
      note.textContent = j.source
        ? `Kaynak: ${j.source}`
        : 'Altın gram fiyatı Apps Script üzerinden güncellendi.';
    }
  }catch(e){
    // Hata durumunda, varsa önbelleği kullan
    const input = document.getElementById('goldGramInput');
    const note  = document.getElementById('goldNote');
    try{
      const cached = Number(localStorage.getItem('popdog_gold_gram_try') || '0');
      const at     = Number(localStorage.getItem('popdog_gold_updated_at') || '0');
      if (cached > 0 && input){
        input.value = String(cached);
        try{
          const evt = new Event('input', { bubbles:true });
          input.dispatchEvent(evt);
        }catch(_){}
        if (note){
          const ageMin = at ? Math.round((Date.now() - at)/60000) : null;
          note.textContent = ageMin != null
            ? `Gram fiyatı önbellekten kullanıldı • ${ageMin} dk önce`
            : 'Gram fiyatı önbellekten kullanıldı.';
        }
        return;
      }
    }catch(_){}
    if (note){
      note.textContent = 'Altın fiyatı otomatik alınamadı, lütfen gram fiyatını elle girin.';
    }
    // Sessiz hata - API sorunları kullanıcıyı ilgilendirmez
    // console.debug('refreshGoldFromScript() error:', e && e.message ? e.message : e);
  }
}

// Simple interactive setter for the Web App URL
async function setupSheetWebAppURL(infoEl){
  try{
    const cur = getSheetWebAppURL() || '';
    const hint = '(Boş bırakırsanız sunucudaki /api/gas proxy’si kullanılır)';
    const pasted = prompt('Apps Script Web App URL’nizi yapıştırın\n' + hint, cur);
    if(!pasted){ if(infoEl) infoEl.textContent = 'İptal edildi.'; return; }
    const ok = isValidWebAppURL(pasted.trim());
    if(!ok){ if(infoEl) infoEl.textContent = '⚠️ Geçerli bir /exec URL girin.'; return; }
    localStorage.setItem('popdog_sheet_webapp_url', pasted.trim());
    if(infoEl) infoEl.textContent = '✓ URL kaydedildi. Sayfa tazelenecek…';
    setTimeout(()=> location.reload(), 400);
  }catch(e){
    if(infoEl) infoEl.textContent = '⚠️ URL kaydedilemedi: ' + (e?.message || e);
  }
}
/* === Apps Script WebApp Compatibility (action/rows keys) === */
const WEBAPP_COMPAT_KEY = 'popdog_webapp_compat';

function getWebAppCompat(){
  try{
    const j = JSON.parse(localStorage.getItem(WEBAPP_COMPAT_KEY) || '{}');
    return (j && typeof j === 'object') ? j : {};
  }catch(_){ return {}; }
}

/* Quick interactive compat setup:
   - rowsKey (default: 'rows')
   - actionKey (default: 'action')
   - dailyAction (default: 'appendDaily')
   - expenseAction (default: 'appendExpense')
*/
async function setupWebAppCompat(infoEl){
  try{
    const cur = getWebAppCompat();
    const rowsKey = prompt('Web App: satır listesinin parametre adı nedir?\n(örn. rows, data, values, payload)', cur.rowsKey || 'rows') || '';
    const actionKey = prompt('Web App: aksiyon parametresi adı?\n(örn. action, mode, type — boş bırakabilirsiniz)', cur.actionKey || 'action') || '';
    const dailyAction = prompt('Günlük rapor yazma aksiyon değeri?', cur.dailyAction || 'appendDaily') || '';
    const expenseAction = prompt('Gider ekleme aksiyon değeri?', cur.expenseAction || 'appendExpense') || '';
    const cfg = { rowsKey: rowsKey.trim(), actionKey: actionKey.trim(), dailyAction: dailyAction.trim(), expenseAction: expenseAction.trim() };
    localStorage.setItem(WEBAPP_COMPAT_KEY, JSON.stringify(cfg));
    if(infoEl) infoEl.textContent = '✓ Uyumluluk kaydedildi. Tekrar deneyebilirsiniz.';
    return cfg;
  }catch(e){
    if(infoEl) infoEl.textContent = '⚠️ Uyumluluk ayarı kaydedilemedi: ' + (e?.message || e);
    return null;
  }
}
// === Hardcoded default CSV URLs (fallbacks if nothing set) ===
const DEFAULT_SHEET_CSV = '/api/sheet?key=revenue';
const DEFAULT_INV_CSV = '/api/sheet?key=inventory';
const DEFAULT_ORDERS_CSV = '/api/sheet?key=orders';

const DEFAULT_EXPENSES_CSV = '/api/sheet?key=expenses';

/* ================== TABLE RENDERERS (NO CHARTS) ================== */

function safeText(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function loadCsv(url, timeoutMs = 30000){
  return new Promise((resolve, reject)=>{
    if (!window.Papa){ reject(new Error('PAPA_MISSING')); return; }

    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(new Error('CSV_LOAD_TIMEOUT'));
      }
    }, timeoutMs);

    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res)=> {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          resolve(res.data || []);
        }
      },
      error: (err)=> {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  });
}

function monthKeyFromDateStr(ds){
  try{
    const d = new Date(String(ds||'').slice(0,10));
    if (isNaN(+d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }catch(_){ return ''; }
}

function fmtPct(n){
  if (!isFinite(n)) return '–';
  const s = (n>0?'+':'') + n.toFixed(1) + '%';
  return s;
}

async function renderRevenueTables(){
  const wrapTotal = document.getElementById('lineTotalTblWrap');
  const wrapCh    = document.getElementById('barStackTblWrap');
  const yearSel   = document.getElementById('revYearSel');
  const YEAR_KEY  = 'popdog_revenue_year';
  const selectedYear = (()=>{
    try{
      const v = yearSel ? String(yearSel.value || '') : '';
      if (v) return v;
      return String(localStorage.getItem(YEAR_KEY) || 'all');
    }catch(_){
      return 'all';
    }
  })();
  if (!wrapTotal && !wrapCh) return;

  // Default placeholder
  if (wrapTotal) wrapTotal.innerHTML = '<div class="hint text-sm">Yükleniyor…</div>';
  if (wrapCh)    wrapCh.innerHTML    = '<div class="hint text-sm">Yükleniyor…</div>';
  const wrapGroom0 = document.getElementById('groomMonthlyTblWrap');
  if (wrapGroom0) wrapGroom0.innerHTML = '<div class="hint text-sm">Yükleniyor…</div>';

  let rows = [];
  try{
    rows = await loadCsv(DEFAULT_SHEET_CSV);
  }catch(e){
    if (wrapTotal) wrapTotal.innerHTML = '<div class="hint text-sm">Ciro tablosu yüklenemedi.</div>';
    if (wrapCh)    wrapCh.innerHTML    = '<div class="hint text-sm">Kanal tablosu yüklenemedi.</div>';
    const wrapGroomE = document.getElementById('groomMonthlyTblWrap');
    if (wrapGroomE) wrapGroomE.innerHTML = '<div class="hint text-sm">Kuaför tablosu yüklenemedi.</div>';
    console.warn('renderRevenueTables load error', e);
    return;
  }

  // Column mapping (case-insensitive)
  const getDate = (r)=> getFieldCI(r, ['Date','Tarih','date','TARİH']);
  const getTotal = (r)=> parseTL(getFieldCI(r, ['Total','Toplam','TOTAL','Sum'])) || 0;

  const CHANNELS = [
    { key:'toptan', label:'B2B', cols:['Toptan','Wholesale','Pop Dog Toptan'] },
    { key:'online', label:'Online', cols:['Online','Pop Dog Online','E-Commerce','Ecom'] },
    { key:'ckm', label:'Shop', cols:['CKM','Caddebostan','Mağaza','Store'] },
    { key:'kuafor', label:'Grooming', cols:['Kuaför','Kuafor','Grooming'] },
    { key:'trendyol', label:'Trendyol', cols:['Trendyol'] },
    { key:'hepsiburada', label:'Hepsiburada', cols:['Hepsiburada','HB'] },
  ];

  // Aggregate by YEAR -> MONTH
  const byYear = new Map(); // y -> Map(monthKey -> { total, channels, kuaforQty })

  function ensureYearMonth(y, mk){
    if (!byYear.has(y)) byYear.set(y, new Map());
    const mMap = byYear.get(y);
    if (!mMap.has(mk)){
      const ch = {};
      CHANNELS.forEach(c=> ch[c.key]=0);
      mMap.set(mk, { total:0, channels: ch, kuaforQty: 0 });
    }
    return mMap.get(mk);
  }

  for (const r of (rows||[])){
    const ds = getDate(r);
    const mk = monthKeyFromDateStr(ds);
    if (!mk) continue;
    const y = Number(String(mk).slice(0,4)) || 0;
    if (!y) continue;
    const o = ensureYearMonth(y, mk);

    const t = getTotal(r);
    o.total += t;

    CHANNELS.forEach(c=>{
      const v = parseTL(getFieldCI(r, c.cols)) || 0;
      o.channels[c.key] += v;
    });

    // Kuaför seans adedi (Ciro sheet'te "Kuaför Adet" sütunu varsa oku)
    const kuaforAdetVal = Number(getFieldCI(r, ['Kuaför Adet','Kuafor Adet','Grooming Adet','Grooming Qty','Kuaför Qty','KuaforAdet','GroomingAdet'])) || 0;
    if (kuaforAdetVal > 0) o.kuaforQty += kuaforAdetVal;
  }

  const years = Array.from(byYear.keys()).sort((a,b)=> a-b);
  if (!years.length){
    if (wrapTotal) wrapTotal.innerHTML = '<div class="hint text-sm">Ciro verisi bulunamadı.</div>';
    if (wrapCh)    wrapCh.innerHTML    = '<div class="hint text-sm">Kanal verisi bulunamadı.</div>';
    const wrapGroomN = document.getElementById('groomMonthlyTblWrap');
    if (wrapGroomN) wrapGroomN.innerHTML = '<div class="hint text-sm">Kuaför verisi bulunamadı.</div>';
    return;
  }

  // Populate year selector (once) + persist selection
  if (yearSel){
    const curVal = String(localStorage.getItem(YEAR_KEY) || 'all');
    // Build options
    const opts = ['all', ...years.map(y=>String(y))];
    // If options differ, rebuild
    const existing = Array.from(yearSel.options).map(o=>o.value);
    const same = existing.length === opts.length && existing.every((v,i)=>v===opts[i]);
    if (!same){
      yearSel.innerHTML = opts.map(v=>{
        const lbl = (v==='all') ? 'Tümü' : v;
        return `<option value="${v}">${lbl}</option>`;
      }).join('');
    }
    // Set selected
    yearSel.value = (opts.includes(curVal) ? curVal : 'all');
    // Bind change (only once)
    if (!yearSel.__bound){
      yearSel.__bound = true;
      yearSel.addEventListener('change', ()=>{
        try{ localStorage.setItem(YEAR_KEY, String(yearSel.value||'all')); }catch(_){ }
        // Re-render tables
        renderRevenueTables();
      });
    }
  }

  // Apply year filter
  const yearsToRender = (()=>{
    const v = (yearSel ? String(yearSel.value||'') : selectedYear) || 'all';
    if (v === 'all') return years;
    const yNum = Number(v);
    return (years.includes(yNum)) ? [yNum] : years;
  })();

  // === Monthly total table (grouped by year) ===
  if (wrapTotal){
    let html = '<div class="overflow-auto"><table class="min-w-full text-sm">'
      + '<thead class="text-slate-600 dark:text-slate-300"><tr>'
      + '<th class="text-left py-2 pr-4">Ay</th>'
      + '<th class="text-right py-2 pr-4">Toplam Ciro</th>'
      + '<th class="text-right py-2 pr-4">MoM</th>'
      + '<th class="text-right py-2 pr-4">Hedef</th>'
      + '<th class="text-right py-2 pr-0">Gerçekleşme</th>'
      + '</tr></thead><tbody class="text-slate-800 dark:text-slate-100">';

    yearsToRender.forEach((y, yi)=>{
      const mMap = byYear.get(y);
      const months = Array.from(mMap.keys()).sort();

      // Year separator row
      html += `<tr class="border-t border-white/30 dark:border-slate-700/40">`
        + `<td class="py-2 pr-4 font-semibold" colspan="5">${safeText(String(y))}</td>`
        + `</tr>`;

      let prev = 0;
      let yearSum = 0;
      /* Hedef kuralı, eski "Aylık Hedefler" bölümüyle aynı:
         ilk ay kendi cirosu, sonraki aylar o yıl içinde kendinden önceki
         ayların ortalaması. O bölüm kaldırıldı, buraya sütun olarak taşındı. */
      const oncekiAylar = [];

      months.forEach(mk=>{
        const tot = Number(mMap.get(mk).total||0);
        yearSum += tot;

        const hedef = oncekiAylar.length
          ? oncekiAylar.reduce((a,b)=>a+b,0) / oncekiAylar.length
          : tot;
        const gercPct = hedef > 0 ? Math.min(100, Math.round(tot / hedef * 100)) : 0;
        oncekiAylar.push(tot);

        let mom = '–';
        let cls = '';
        if (prev > 0){
          const pct = ((tot - prev) / prev) * 100;
          mom = fmtPct(pct);
          cls = pct >= 0 ? 'kpi-up' : 'kpi-down';
        }

        html += `<tr>`
          + `<td class="py-1 pr-4">${safeText(mk)}</td>`
          + `<td class="py-1 pr-4 text-right">${numberTL(tot)}</td>`
          + `<td class="py-1 pr-4 text-right ${cls}">${safeText(mom)}</td>`
          + `<td class="py-1 pr-4 text-right hint">${numberTL(hedef)}</td>`
          + `<td class="py-1 pr-0 text-right ${gercPct >= 100 ? 'kpi-up' : ''}">${gercPct}%</td>`
          + `</tr>`;
        prev = tot;
      });

      // Year total row
      html += `<tr class="border-t border-white/40 dark:border-slate-700/40">`
        + `<td class="py-2 pr-4 font-medium">${safeText(String(y))} Toplam</td>`
        + `<td class="py-2 pr-4 text-right font-semibold">${numberTL(yearSum)}</td>`
        + `<td class="py-2 pr-4"></td><td class="py-2 pr-4"></td><td class="py-2 pr-0"></td>`
        + `</tr>`;
    });

    html += '</tbody></table></div>';
    wrapTotal.innerHTML = html;
  }

  // === Channel-by-month table (grouped by year, with yearly totals) ===
  if (wrapCh){
    let html = '<div class="overflow-auto"><table class="min-w-full text-sm">'
      + '<thead class="text-slate-600 dark:text-slate-300"><tr>'
      + '<th class="text-left py-2 pr-4">Ay</th>';
    CHANNELS.forEach(c=>{ html += `<th class="text-right py-2 pr-4">${safeText(c.label)}</th>`; });
    html += '<th class="text-right py-2 pr-0">Toplam</th>';
    html += '</tr></thead><tbody class="text-slate-800 dark:text-slate-100">';

    yearsToRender.forEach(y=>{
      const mMap = byYear.get(y);
      const months = Array.from(mMap.keys()).sort();

      // Year separator row
      html += `<tr class="border-t border-white/30 dark:border-slate-700/40">`
        + `<td class="py-2 pr-4 font-semibold" colspan="${CHANNELS.length + 2}">${safeText(String(y))}</td>`
        + `</tr>`;

      const colTotals = {}; CHANNELS.forEach(c=> colTotals[c.key]=0);
      let yearGrand = 0;

      months.forEach(mk=>{
        const o = mMap.get(mk);
        html += `<tr><td class="py-1 pr-4">${safeText(mk)}</td>`;
        let rowSum = 0;
        CHANNELS.forEach(c=>{
          const v = Number((o.channels && o.channels[c.key]) || 0);
          rowSum += v;
          colTotals[c.key] += v;
          html += `<td class="py-1 pr-4 text-right">${numberTL(v)}</td>`;
        });
        // Prefer sheet total if provided; otherwise sum channels
        const tot = Number(o.total||0) || rowSum;
        yearGrand += tot;
        html += `<td class="py-1 pr-0 text-right font-medium">${numberTL(tot)}</td></tr>`;
      });

      // Year totals row
      html += `<tr class="border-t border-white/40 dark:border-slate-700/40">`;
      html += `<td class="py-2 pr-4 font-medium">${safeText(String(y))} Toplam</td>`;
      CHANNELS.forEach(c=>{ html += `<td class="py-2 pr-4 text-right font-semibold">${numberTL(colTotals[c.key])}</td>`; });
      html += `<td class="py-2 pr-0 text-right font-semibold">${numberTL(yearGrand)}</td>`;
      html += `</tr>`;
    });

    html += '</tbody></table></div>';
    wrapCh.innerHTML = html;
  }

  // === Grooming (Kuaför) monthly totals + MoM ===
  const wrapGroom = document.getElementById('groomMonthlyTblWrap');
  if (wrapGroom){
    // Önce Ciro sheet'teki "Kuaför Adet" sütunundan kontrol et (byYear içinde kuaforQty olarak toplandı)
    // Yoksa Shopify siparişlerinden aylık Kuaför adetini dene (channel='Kuaför' ile etiketli siparişler)
    const groomQtyByYM = {};
    try {
      (getOrdersCache()||[]).forEach(function(o){
        if (!o.date || o.channel !== 'Kuaför') return;
        const mk = o.date.getFullYear() + '-' + String(o.date.getMonth()+1).padStart(2,'0');
        groomQtyByYM[mk] = (groomQtyByYM[mk]||0) + (o.qty||0);
      });
    } catch(_) {}

    let html = '<div class="overflow-auto"><table class="min-w-full text-sm">'
      + '<thead class="text-slate-600 dark:text-slate-300"><tr>'
      + '<th class="text-left py-2 pr-4">Ay</th>'
      + '<th class="text-right py-2 pr-4">Kuaför</th>'
      + '<th class="text-right py-2 pr-4">Adet</th>'
      + '<th class="text-right py-2 pr-0">MoM</th>'
      + '</tr></thead><tbody class="text-slate-800 dark:text-slate-100">';

    yearsToRender.forEach((y)=>{
      const mMap = byYear.get(y);
      const months = Array.from(mMap.keys()).sort();

      html += `<tr class="border-t border-white/30 dark:border-slate-700/40">`
        + `<td class="py-2 pr-4 font-semibold" colspan="4">${safeText(String(y))}</td>`
        + `</tr>`;

      let prev = 0;
      let yearSum = 0;
      let yearQty = 0;

      months.forEach(mk=>{
        const o = mMap.get(mk);
        const v = Number((o && o.channels && o.channels.kuafor) || 0);
        yearSum += v;

        // Adet: önce Ciro sheet'teki "Kuaför Adet" sütununa bak, yoksa Shopify cache'ine dön
        const ciroQty = (o && o.kuaforQty) || 0;
        const ymKey = mk.length === 7 ? mk : mk.slice(0,7);
        const shopifyQty = groomQtyByYM[ymKey] || 0;
        const qty = ciroQty > 0 ? ciroQty : shopifyQty;
        yearQty += qty;

        let mom = '–';
        let cls = '';
        if (prev > 0){
          const pct = ((v - prev) / prev) * 100;
          mom = fmtPct(pct);
          cls = pct >= 0 ? 'kpi-up' : 'kpi-down';
        }

        html += `<tr>`
          + `<td class="py-1 pr-4">${safeText(mk)}</td>`
          + `<td class="py-1 pr-4 text-right">${numberTL(v)}</td>`
          + `<td class="py-1 pr-4 text-right">${qty > 0 ? qty.toLocaleString('tr-TR') : '<span class="hint">–</span>'}</td>`
          + `<td class="py-1 pr-0 text-right ${cls}">${safeText(mom)}</td>`
          + `</tr>`;

        prev = v;
      });

      html += `<tr class="border-t border-white/40 dark:border-slate-700/40">`
        + `<td class="py-2 pr-4 font-medium">${safeText(String(y))} Kuaför Toplam</td>`
        + `<td class="py-2 pr-4 text-right font-semibold">${numberTL(yearSum)}</td>`
        + `<td class="py-2 pr-4 text-right font-semibold">${yearQty > 0 ? yearQty.toLocaleString('tr-TR') : '<span class="hint">–</span>'}</td>`
        + `<td class="py-2 pr-0"></td>`
        + `</tr>`;
    });

    html += '</tbody></table></div>';
    wrapGroom.innerHTML = html;
  }

  // === Grooming seans adedi (Shopify siparişlerinden) ===
  const wrapUnits = document.getElementById('groomUnitsWrap');
  if (wrapUnits) {
    try {
      const ytdData   = buildChannelSalesFromOrders({ period: 'ytd' });
      const monthData = buildChannelSalesFromOrders({ period: 'month' });
      const weekData  = buildChannelSalesFromOrders({ period: 'week' });

      // Bugün filtresi (Date nesnesi karşılaştırması)
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
      let todayQty = 0;
      (getOrdersCache()||[]).forEach(function(o){
        if (!o.date || o.channel !== 'Kuaför') return;
        if (o.date >= todayStart && o.date <= todayEnd) todayQty += (o.qty || 0);
      });

      const ytdQty   = (ytdData.channels['Kuaför']   ? ytdData.channels['Kuaför'].qty   : 0) || 0;
      const monthQty = (monthData.channels['Kuaför']  ? monthData.channels['Kuaför'].qty  : 0) || 0;
      const weekQty  = (weekData.channels['Kuaför']   ? weekData.channels['Kuaför'].qty   : 0) || 0;

      if (ytdQty > 0 || monthQty > 0 || weekQty > 0 || todayQty > 0) {
        const periods = [
          { label: 'Bugün',    val: todayQty },
          { label: 'Bu Hafta', val: weekQty  },
          { label: 'Bu Ay',    val: monthQty },
          { label: 'YTD',      val: ytdQty   },
        ];
        var h = '<div class="hint" style="font-size:.595rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;margin-bottom:9px">💇 Seans Adedi (Shopify)</div>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:10px 28px">';
        periods.forEach(function(p){
          h += '<div style="display:flex;flex-direction:column;gap:1px">'
            + '<span class="hint" style="font-size:.62rem;text-transform:uppercase;letter-spacing:.07em">' + p.label + '</span>'
            + '<span class="text-slate-800 dark:text-slate-100" style="font-size:.95rem;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em">'
            + p.val.toLocaleString('tr-TR')
            + '<span class="hint" style="font-size:.68rem;font-weight:400;margin-left:3px">seans</span>'
            + '</span></div>';
        });
        h += '</div>';
        wrapUnits.innerHTML = h;
      } else {
        wrapUnits.innerHTML = '<div class="hint" style="font-size:.75rem">Shopify\'te Kuaför kanalı siparişi bulunamadı.</div>';
      }
    } catch(e) {
      wrapUnits.innerHTML = '';
    }
  }
}

async function renderExpensesMonthlyTable(){
  const wrap = document.getElementById('expensesMonthlyTblWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="hint text-sm">Yükleniyor…</div>';

  let rows = [];
  try{
    rows = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);
  }catch(e){
    wrap.innerHTML = '<div class="hint text-sm">Gider tablosu yüklenemedi.</div>';
    console.warn('renderExpensesMonthlyTable load error', e);
    return;
  }

  const byMonth = new Map();
  for (const r of (rows||[])){
    const mk = monthKeyFromDateStr(getFieldCI(r, ['Date','Tarih','date']));
    if (!mk) continue;
    const amt = readExpenseAmountTRY(r);
    if (!(amt>0)) continue;
    byMonth.set(mk, (byMonth.get(mk)||0) + amt);
  }

  const months = Array.from(byMonth.keys()).sort();
  if (!months.length){
    wrap.innerHTML = '<div class="hint text-sm">Gider verisi bulunamadı.</div>';
    return;
  }

  let html = '<div class="overflow-auto"><table class="min-w-full text-sm">'
    + '<thead class="text-slate-600 dark:text-slate-300"><tr>'
    + '<th class="text-left py-2 pr-4">Ay</th>'
    + '<th class="text-right py-2 pr-4">Toplam Gider</th>'
    + '<th class="text-right py-2 pr-0">MoM</th>'
    + '</tr></thead><tbody class="text-slate-800 dark:text-slate-100">';

  let prev = 0;
  months.forEach(mk=>{
    const tot = byMonth.get(mk)||0;
    let mom = '–';
    let cls = '';
    if (prev > 0){
      const pct = ((tot - prev)/prev)*100;
      mom = fmtPct(pct);
      cls = pct >= 0 ? 'kpi-up' : 'kpi-down';
    }
    html += `<tr>`
      + `<td class="py-1 pr-4">${safeText(mk)}</td>`
      + `<td class="py-1 pr-4 text-right">${numberTL(tot)}</td>`
      + `<td class="py-1 pr-0 text-right ${cls}">${safeText(mom)}</td>`
      + `</tr>`;
    prev = tot;
  });

  const grand = months.reduce((a,m)=> a + (byMonth.get(m)||0), 0);
  html += `<tr class="border-t border-white/40 dark:border-slate-700/40">`
    + `<td class="py-2 pr-4 font-medium">Toplam</td>`
    + `<td class="py-2 pr-4 text-right font-semibold">${numberTL(grand)}</td>`
    + `<td class="py-2 pr-0"></td>`
    + `</tr>`;

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function hookNoChartRenderers(){
  // Run on load
  window.addEventListener('load', ()=>{
    try{ renderRevenueTables(); }catch(_){ }
    try{ renderExpensesMonthlyTable(); }catch(_){ }
  });

  // If refreshAll exists, chain it
  const tryHook = (name)=>{
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__noChartHooked) return;
    const wrapped = async function(){
      const r = fn.apply(this, arguments);
      try{ await Promise.resolve(r); }catch(_){ }
      try{ renderRevenueTables(); }catch(_){ }
      try{ renderExpensesMonthlyTable(); }catch(_){ }
      return r;
    };
    wrapped.__noChartHooked = true;
    window[name] = wrapped;
  };
  ['refreshAll','refreshAllData','loadAll','loadAllData'].forEach(tryHook);
}
hookNoChartRenderers();

/* ================== /TABLE RENDERERS (NO CHARTS) ================== */

/* ================== THEME ================== */
const root = document.documentElement;
function setTheme(mode){
  if(mode === 'dark'){
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  localStorage.setItem('popdog_theme', mode);
}
document.getElementById('themeBtn').onclick = ()=> setTheme(root.classList.contains('dark') ? 'light' : 'dark');
(function(){
  const initial = localStorage.getItem('popdog_theme') || 'light';
  setTheme(initial);
})();

// Yenile: varsa veri yenileme fonksiyonunu çağır, yoksa sayfayı tazele
(function(){
  const rb = document.getElementById('refreshBtn');
  if (!rb) return;
  rb.onclick = async () => {
    try{
      if (typeof refreshAll === 'function') await refreshAll();
      else if (typeof refreshAllData === 'function') await refreshAllData();
      else if (typeof loadAll === 'function') await loadAll();
      else if (typeof loadAllData === 'function') await loadAllData();
      else {
        location.reload();
        return;
      }
    }catch(_){
      location.reload();
      return;
    }
    try{ await renderRevenueTables(); }catch(_){ }
  };
})();

/* ================== HELPERS ================== */
const nfTL  = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const nfUSD = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const numberTL  = n => {
  const val = Number(n);
  return nfTL.format(isNaN(val) ? 0 : Math.round(val));
};
const numberUSD = n => nfUSD.format(Math.round(n||0));


/* ================== DAILY REPORT PARSER (CKM + Kuaför split) ================== */
// Parse WhatsApp/daily report text, extract Kuaför (Grooming) and avoid double counting in CKM.
function parseDailyReportText_v2(text) {
  // Normalize newlines and remove invisible chars (WhatsApp copy/paste)
  text = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\u00A0/g,' ')                 // NBSP
    .replace(/[\u200B-\u200D\uFEFF]/g,'') // zero-width
    .trim();

  // Diacritics-stripped text for stable matching (Kuaför/Kuafor)
  const textNoDia = text.normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  // Helper: extract amount from a line using a regex with one capture group for the number.
  // Returns null if no match, 0 if the label exists but number is empty.
  function extractAmount_(line, re){
    const m = String(line||'').trim().match(re);
    if (!m) return null;
    if (!m[1]) return 0;
    return parseTL(m[1]);
  }

  // Build normalized lines (both original + no-diacritics) keeping position
  const rawLines = text.split('\n').map(s => String(s||'').trim()).filter(Boolean);
  const lines    = textNoDia.split('\n').map(s => String(s||'').trim()).filter(Boolean);

  // Date: use original text (to preserve separators)
  let date = '';
  const dateMatch = text.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/);
  if (dateMatch) date = parseTRDateString(dateMatch[1]);

  // Extract amounts line-by-line (no false matches like "Kasa Nakit" vs "Nakit")
  let groomingTRY = 0;
  let cashSalesTRY = 0;     // Nakit satış
  let kasaNakitTRY = 0;     // EoD cash
  let trendyolTRY = 0;
  let hbTRY = 0;
  let onlineTRY = 0;
  let toptanTRY = 0;
  let storeTotalTRY = 0;
  let kkTRY = 0;
  let cashSalesHasNumber = false; // true only if the Nakit line contains a number

  for (let i=0; i<lines.length; i++){
    const L = lines[i];

    // Kuaför (prefer explicit Kuaför/Kuafor line; do not overwrite once captured)
    {
      if (!(groomingTRY > 0)) {
        const rawL = (rawLines && rawLines[i]) ? String(rawLines[i]) : '';

        // Try on raw line (keeps Turkish chars) then on diacritics-stripped line.
        // Do NOT require end-of-line; WhatsApp often has trailing notes/hidden chars.
        let v = extractAmount_(rawL, /\bKuaf[öo]r\b[^0-9]{0,60}[:：=]\s*([0-9][0-9\.,\s]*)/i);
        if (v == null) {
          v = extractAmount_(L, /\bKuafor\b[^0-9]{0,60}[:：=]\s*([0-9][0-9\.,\s]*)/i);
        }

        // Ultra-fallback for weird spacing: "Kuaför 2550" (no colon)
        if (v == null) {
          v = extractAmount_(rawL, /\bKuaf[öo]r\b[^0-9]{0,60}([0-9][0-9\.,\s]*)/i);
        }
        if (v == null) {
          v = extractAmount_(L, /\bKuafor\b[^0-9]{0,60}([0-9][0-9\.,\s]*)/i);
        }

        if (v != null && v > 0) groomingTRY = v;
      }
    }

    // Nakit (cash sales) — DO NOT match "Kasa Nakit".
    // IMPORTANT: Only treat as cash sales if the Nakit line actually contains digits.
    {
      const m = String(L||'').trim().match(/^\s*(?!Kasa\s+Nakit\b)Nakit\s*[:：=]\s*([0-9][0-9\.,\s]*)\s*(?:TL|₺)?\s*$/i);
      if (m && m[1]){
        cashSalesTRY = parseTL(m[1]) || 0;
        cashSalesHasNumber = true;
      }
    }

    // Kasa Nakit (EoD), strict label+colon
    {
      const v = extractAmount_(L, /^\s*Kasa\s+Nakit\s*[:：=]\s*([0-9][0-9\.,\s]*)\s*(?:TL|₺)?\s*$/i);
      if (v != null) kasaNakitTRY = v;
    }

    // Trendyol, strict label+colon
    {
      const v = extractAmount_(L, /^\s*Trendyol\s*[:：=]\s*([0-9][0-9\.,\s]*)\s*(?:TL|₺)?\s*$/i);
      if (v != null) trendyolTRY = v;
    }

    // Hepsiburada, strict label+colon, number optional
    {
      const v = extractAmount_(L, /^\s*Hepsiburada\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v != null) hbTRY = v;
    }

    // Pop Dog Online / Online, strict label+colon, number optional
    {
      const v1 = extractAmount_(L, /^\s*Pop\s*Dog\s*Online\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v1 != null) onlineTRY = v1;
      const v2 = extractAmount_(L, /^\s*Online\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v2 != null) onlineTRY = v2;
    }

    // Pop Dog Toptan / Toptan, strict label+colon, number optional
    {
      const v1 = extractAmount_(L, /^\s*Pop\s*Dog\s*Toptan\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v1 != null) toptanTRY = v1;
      const v2 = extractAmount_(L, /^\s*Toptan\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v2 != null) toptanTRY = v2;
    }

    // Toplam ciro, strict label+colon, number optional
    {
      const v = extractAmount_(L, /^\s*Toplam\s*ciro\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v != null) storeTotalTRY = v;
    }

    // Kredi Kartı, strict label+colon, number optional
    {
      const v = extractAmount_(L, /^\s*Kredi\s*Kart[ıi]\s*[:：=]\s*([0-9][0-9\.,\s]*)?\s*(?:TL|₺)?\s*$/i);
      if (v != null) kkTRY = v;
    }
  }

  // Fallback: if Kuaför wasn't found line-by-line, do robust global scans.
  // Prefer explicit "Kuaför/Kuafor" label near a number; tolerate trailing text.
  if (!(groomingTRY > 0)){
    let m = text.match(/\bKuaf[öo]r\b[^0-9]{0,80}[:：=]?\s*([0-9][0-9\.,\s]*)/i);
    if (m && m[1]) groomingTRY = parseTL(m[1]) || 0;
  }
  if (!(groomingTRY > 0)){
    let m = textNoDia.match(/\bKuafor\b[^0-9]{0,80}[:：=]?\s*([0-9][0-9\.,\s]*)/i);
    if (m && m[1]) groomingTRY = parseTL(m[1]) || 0;
  }

  // Safety: if grooming accidentally equals cash sales and we did not see an explicit Kuaför label, force grooming=0.
  // (Prevents rare mis-parses where another line's number is picked up.)
  try{
    if ((groomingTRY > 0) && (cashSalesTRY > 0) && groomingTRY === cashSalesTRY){
      const hasExplicitKuafor = /\bKuaf[öo]r\b\s*[:：=]/i.test(text) || /\bKuafor\b\s*[:：=]/i.test(textNoDia);
      if (!hasExplicitKuafor) groomingTRY = 0;
    }
  }catch(_){ }

  // If total not provided, compute from credit card + cash sales
  if (!(storeTotalTRY > 0)){
    storeTotalTRY = (kkTRY || 0) + (cashSalesTRY || 0);
  }

  // CKM (retail) = storeTotal - grooming (avoid double count)
  const ckmRetailTRY = Math.max(0, (storeTotalTRY || 0) - (groomingTRY || 0));

  // CKM Nakit: prefer explicit "CKM Nakit" if present; otherwise use Nakit ONLY if it had a number.
  let ckmNakitTRY = cashSalesHasNumber ? cashSalesTRY : 0;
  for (let i=0; i<lines.length; i++){
    const m = String(lines[i]||'').trim().match(/^\s*CKM\s+Nakit\s*[:：=]\s*([0-9][0-9\.,\s]*)\s*(?:TL|₺)?\s*$/i);
    if (m && m[1]){ ckmNakitTRY = parseTL(m[1]) || 0; break; }
  }

  // Total (channels sum) — CKM retail + Kuaför counted once
  const totalTRY = (toptanTRY || 0) + (onlineTRY || 0) + (ckmRetailTRY || 0) + (groomingTRY || 0) + (trendyolTRY || 0) + (hbTRY || 0);


  return {
    'Date': date,
    'Toptan': toptanTRY,
    'Online': onlineTRY,
    'CKM': ckmRetailTRY,
    'Kuaför': (groomingTRY || 0),
    'CKM Nakit': ckmNakitTRY,
    'Kasa Nakit (EoD)': kasaNakitTRY,
    'Trendyol': trendyolTRY,
    'Hepsiburada': hbTRY,
    'Total': totalTRY
  };
}

// Force global reference to the new parser (prevents legacy overrides)
try{ window.parseDailyReportText = parseDailyReportText_v2; }catch(_){ }

function renderStagedRows(stagedRows) {
  const tbody = document.getElementById('stagedTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const row of stagedRows) {
    const html =
      `<tr>
        <td class="py-2 pr-4">${safeText(row.Date || '')}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.Toptan || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.Online || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.CKM || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row['Kuaför'] || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row['CKM Nakit'] || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row['Kasa Nakit (EoD)'] || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.Trendyol || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.Hepsiburada || 0)}</td>
        <td class="text-right py-2 pr-4">${numberTL(row.Total || 0)}</td>
      </tr>`;
    tbody.insertAdjacentHTML('beforeend', html);
  }
}

(function(){
  const btn = document.getElementById('parseAddBtn');
  if (!btn) return;

  // ✅ TEK KAYNAK: günlük satırlar tek bir global array’de tutulur
  if (!Array.isArray(window.stagedRows)) window.stagedRows = [];


  btn.onclick = function() {
    const ta = document.getElementById('dailyText');
    const info = document.getElementById('parseInfo');
    if (!ta) return;

    const text = ta.value || '';
    let row;
    try {
      row = parseDailyReportText_v2(text);
      // Guarantee Kuaför key exists
      if (row && typeof row['Kuaför'] === 'undefined') row['Kuaför'] = 0;
      if (info && row) {
        info.textContent = `Önizleme: CKM=${numberTL(row.CKM||0)} • Kuaför=${numberTL(row['Kuaför']||0)} • Trendyol=${numberTL(row.Trendyol||0)} • HB=${numberTL(row.Hepsiburada||0)} • Total=${numberTL(row.Total||0)}`;
      }
    } catch (e) {
      if (info) info.textContent = 'Satır ayrıştırılamadı: ' + (e && e.message ? e.message : e);
      return;
    }

    if (!row || !row.Date) {
      if (info) info.textContent = 'Tarih bulunamadı veya format hatalı.';
      return;
    }

    window.stagedRows.push(row);
    renderStagedRows(window.stagedRows);
    if (info) {
      info.textContent = `Satır eklendi. (${window.stagedRows.length}) • Önizleme: CKM=${numberTL(row.CKM||0)} • Kuaför=${numberTL(row['Kuaför']||0)} • Trendyol=${numberTL(row.Trendyol||0)} • HB=${numberTL(row.Hepsiburada||0)} • Total=${numberTL(row.Total||0)}`;
    }
    ta.value = '';
  };

window.getStagedDailyRows = () => (Array.isArray(window.stagedRows) ? window.stagedRows.slice() : []);
})();
/* ================== /DAILY REPORT PARSER ================== */

/* ================== GEÇMİŞ KUAFÖR DÜZELTMESİ ================== */
(function(){
  const btn = document.getElementById('fixKuaforBtn');
  if (!btn) return;

  btn.onclick = async function(){
    const info = document.getElementById('parseInfo');
    const base = getSheetWebAppURL();
    if (!base){ if(info) info.textContent = 'Sheet URL ayarlı değil.'; return; }

    async function gasPost(action){
      const payload = JSON.stringify({ action });
      try{
        const res = await fetch(base, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: payload });
        const text = await res.text().catch(()=>'');
        try{ return JSON.parse(text); }catch(_){ return null; }
      }catch(e){ return null; }
    }

    // Step 1: Preview
    btn.disabled = true;
    btn.textContent = '⏳ Kontrol ediliyor…';
    if (info) info.textContent = '';

    const preview = await gasPost('previewkuafor');

    if (!preview || !preview.ok){
      if(info) info.textContent = '❌ Önizleme hatası: ' + ((preview && preview.error) || 'Sunucu yanıt vermedi');
      btn.textContent = '🔧 Geçmişi Düzelt';
      btn.disabled = false;
      return;
    }

    const fixCount = preview.toFix ? preview.toFix.length : 0;
    const skipCount = preview.skipManual ? preview.skipManual.length : 0;

    if (fixCount === 0){
      if(info) info.textContent = `✅ Zaten temiz — düzeltilecek satır yok (${preview.totalRows} satır kontrol edildi)`;
      btn.textContent = '🔧 Geçmişi Düzelt';
      btn.disabled = false;
      return;
    }

    // Build preview detail
    const dateList = (preview.toFix || []).slice(0,10).map(x =>
      `${x.date}: CKM ${x.ckmOld}→${x.ckmNew} (kuaför ${x.kuafor})`
    ).join('\n') + (fixCount > 10 ? `\n… ve ${fixCount-10} satır daha` : '');

    const msg = `${fixCount} satırda CKM kuaförü içeriyor.\n\n${dateList}\n\n` +
      (skipCount > 0 ? `⚠️ ${skipCount} satır atlanacak (CKM < Kuaför).\n\n` : '') +
      'Google Sheets\'te bu satırların CKM sütunu düzeltilsin mi?\n(Toplam rakamlar değişmez, sadece CKM ↓ ve Kuaför ayrı sayılır.)';

    if (!window.confirm(msg)){
      if(info) info.textContent = 'İptal edildi.';
      btn.textContent = '🔧 Geçmişi Düzelt';
      btn.disabled = false;
      return;
    }

    // Step 2: Apply fix
    btn.textContent = '⏳ Düzeltiliyor…';
    const result = await gasPost('fixkuafor');

    if (result && result.ok){
      if(info) info.textContent = `✅ ${result.fixed} satır düzeltildi` +
        (result.skipped > 0 ? ` • ⚠️ ${result.skipped} satır atlandı (manuel kontrol)` : '');
      btn.textContent = '✅ Düzeltildi';
      if (typeof refreshAll === 'function') try{ refreshAll(); }catch(_){}
    } else {
      const err = (result && result.error) || 'Bilinmeyen hata';
      if(info) info.textContent = '❌ Hata: ' + err;
      btn.textContent = '🔧 Geçmişi Düzelt';
      btn.disabled = false;
    }
  };
})();
/* ================== /GEÇMİŞ KUAFÖR DÜZELTMESİ ================== */


/* ================== LOANS STATE HELPERS ================== */
// Zee.Dog varsayılan bekleyen ödemeler (USD)
const DEFAULT_ZEE_AWAIT = [
  { id:'YK#033',   usd:4626.02, paidUsd:0, remainingUsd:4626.02, status:'waiting' },
  { id:'YK#034',   usd:39425.33, paidUsd:0, remainingUsd:39425.33, status:'waiting' },
  { id:'YK#034.1', usd:11827.00, paidUsd:0, remainingUsd:11827.00, status:'waiting' },
  { id:'YK#034.2', usd:27597.00, paidUsd:0, remainingUsd:27597.00, status:'waiting' },
  { id:'YK#035',   usd:37589.19, paidUsd:0, remainingUsd:37589.19, status:'waiting' },
  { id:'YK#035.1', usd:11276.76, paidUsd:0, remainingUsd:11276.76, status:'waiting' },
  { id:'YK#035.2', usd:26312.43, paidUsd:0, remainingUsd:26312.43, status:'waiting' },
  { id:'YK#037',   usd:31021.80, paidUsd:0, remainingUsd:31021.80, status:'waiting' },
  { id:'YK#037.1', usd: 9306.54, paidUsd:0, remainingUsd: 9306.54, status:'waiting' },  // %30
  { id:'YK#037.2', usd:21715.26, paidUsd:0, remainingUsd:21715.26, status:'waiting' },  // %70
];
(function(){
  if (typeof window.defaultLoansState === 'undefined') {
    window.defaultLoansState = {
            loans: {
        biz:  { total: 24, paid: 0, instTRY: 0,        remainTRY: 0,         principalTRY: 0,         monthlyRate: 0 },
        car:  { total: 24, paid: 0, instTRY: 0,        remainTRY: 0,         principalTRY: 0,         monthlyRate: 0 },
        biz2: { total: 24, paid: 0, instTRY: 71452.86, remainTRY: 1714868.61, principalTRY: 1714868.61, monthlyRate: 0 }
      },
    zeeAwaitUSD: DEFAULT_ZEE_AWAIT.slice(),  // Fixed: changed from zeeAwait to zeeAwaitUSD for consistency
    demoBank: {
      goldGram: 169,
      gramTRY: 0,
      fi5Units: 565,
      fi5UnitTRY: 0,
      sasUnits: 114236,
      sasUnitTRY: 0,
      isyUnits: 2530000,
      isyUnitTRY: 0
    }
    };
  }
  if (typeof window.getLoansState !== 'function'){
    window.getLoansState = function(){
      try{
        const raw = localStorage.getItem('popdog_loans_state');
        if (!raw) return JSON.parse(JSON.stringify(window.defaultLoansState));
        const obj = JSON.parse(raw);
        const d = JSON.parse(JSON.stringify(window.defaultLoansState));
        const out = Object.assign({}, d, obj || {});
        out.loans = Object.assign({}, d.loans, out.loans || {});
        out.zeeAwaitUSD = Array.isArray(out.zeeAwaitUSD) && out.zeeAwaitUSD.length ? out.zeeAwaitUSD : DEFAULT_ZEE_AWAIT.slice();
        // Migrate old data structure to new: add paidUsd and remainingUsd if missing
        out.zeeAwaitUSD = out.zeeAwaitUSD.map(z => {
          const total = Number(z.usd || 0);
          const paid = Number(z.paidUsd ?? 0);
          const remaining = Number(z.remainingUsd ?? total);
          return {
            ...z,
            paidUsd: paid,
            remainingUsd: remaining
          };
        });
        out.loans.biz  = Object.assign({}, d.loans.biz,  out.loans.biz  || {});
        out.loans.car  = Object.assign({}, d.loans.car,  out.loans.car  || {});
        out.loans.biz2 = Object.assign({}, d.loans.biz2, out.loans.biz2 || {});
        return out;
      }catch(_){ return JSON.parse(JSON.stringify(window.defaultLoansState)); }
    };
  }
  if (typeof window.setLoansState !== 'function'){
    window.setLoansState = function(st){
      try{ localStorage.setItem('popdog_loans_state', JSON.stringify(st || {})); }catch(_){}
    };
  }
  if (typeof window.bumpLoansPaidIfMatches !== 'function'){
    window.bumpLoansPaidIfMatches = function(subcat, amountTRY){
      try{
        const s = String(subcat || '').toLowerCase();
        if (!s) return;
        const amt = Number(amountTRY || 0);
        const st = getLoansState();

        // Check for "Kredi 2" first (most specific)
        const isBiz2 = /kredi\s*2|kredi\s*ii|ticari\s*2|ticari\s*ii|işletme\s*2/.test(s);
        // Then check for regular "ticari" (but not if it's Kredi 2)
        const isBiz = !isBiz2 && /ticari|işletme|taksitli.*ticari|kredi(?!\s*2)/.test(s);
        const isCar = /araç|oto|otomobil|taşıt/.test(s);

        if (isBiz2){
          // Handle Taksitli Ticari Kredi 2
          if (!st.loans.biz2) st.loans.biz2 = { total: 24, paid: 0, instTRY: 71452.86, remainTRY: 1714868.61, principalTRY: 1714868.61, monthlyRate: 0 };
          st.loans.biz2.paid = Math.max(0, Number(st.loans.biz2.paid || 0)) + 1;
          if (amt > 0) st.loans.biz2.remainTRY = Math.max(0, Number(st.loans.biz2.remainTRY || 0) - amt);
          setLoansState(st);
        } else if (isBiz){
          st.loans.biz.paid = Math.max(0, Number(st.loans.biz.paid || 0)) + 1;
          if (amt > 0) st.loans.biz.remainTRY = Math.max(0, Number(st.loans.biz.remainTRY || 0) - amt);
          setLoansState(st);
        } else if (isCar){
          st.loans.car.paid = Math.max(0, Number(st.loans.car.paid || 0)) + 1;
          if (amt > 0) st.loans.car.remainTRY = Math.max(0, Number(st.loans.car.remainTRY || 0) - amt);
          setLoansState(st);
        }
      }catch(_){}
    };
  }
})();

function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function yyyymmddUTC(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

/* TRY sayıları için sağlam parser */
function parseTL(v){
  if(v==null || v==='') return 0;
  if(typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s|₺|TRY|TL/gi,'').replace(/\u00A0/g,'');
  if(s === '-' || s === '–' || s === '—') return 0;
  if(/^-?\d+$/.test(s)) return Number(s);
  if(s.includes('.') && s.includes(',')){
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if(lastComma > lastDot){ s = s.replace(/\./g,'').replace(',', '.'); } else { s = s.replace(/,/g,''); }
    const n = Number(s); return isNaN(n)?0:n;
  }
  if(s.includes(',') && !s.includes('.')){
    s = s.replace(/\./g,''); s = s.replace(',', '.');
    const n = Number(s); return isNaN(n)?0:n;
  }
  const n = Number(s.replace(/,/g,'')); return isNaN(n)?0:n;
}

function parseTRDateString(s){
  const m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if(!m) return '';
  let dd=+m[1], mm=+m[2], yy=+m[3]; if(yy<100) yy += 2000;
  return yyyymmddUTC(yy, mm, dd);
}
function parseUSD(v){
  if(v==null || v==='') return 0;
  if(typeof v === 'number') return v;
  let s = String(v).trim();
  s = s.replace(/USD/gi,'').replace(/\$/g,'').replace(/\s/g,'').replace(/\u00A0/g,'');
  if(s === '-' || s === '–' || s === '—') return 0;
  if(/^-?\d+$/.test(s)) return Number(s);
  if(s.includes('.') && s.includes(',')){
    s = s.replace(/,/g,'');
    const n = Number(s);
    return isNaN(n)?0:n;
  }
  const n = Number(s.replace(/,/g,''));
  return isNaN(n)?0:n;
}
 
function getTryPerUsd(){
  try{
    const s = localStorage.getItem('popdog_fx_try_per_usd');
    const n = s ? Number(s) : 0;
    if (n && !isNaN(n)) return n;

    // if a session-level USD/TRY exists, invert it
    if (typeof fxRateUSDPerTRY === 'number' && fxRateUSDPerTRY > 0){
      return 1 / fxRateUSDPerTRY;
    }
    return 0;
  }catch(e){ return 0; }
}

// === Case-insensitive field getter (first non-empty) ===
function getFieldCI(row, candidates){
  if(!row) return '';
  const keys = Object.keys(row);
  // quick map of lower->actual
  const map = {};
  keys.forEach(k => { map[String(k).toLowerCase()] = k; });
  for (const want of candidates){
    const real = map[String(want).toLowerCase()];
    if (real && row[real] != null && String(row[real]).trim() !== ''){
      return row[real];
    }
  }
  return '';
}

// === REMOVED: Duplicate function definition (kept the most comprehensive version at line ~4634) ===

// === Satırdan subcategory metnini okuma (case-insensitive) ===
function readExpenseSubcat(row){
  const keys = (typeof SUBCAT_KEYS !== 'undefined' && Array.isArray(SUBCAT_KEYS) && SUBCAT_KEYS.length)
    ? SUBCAT_KEYS
    : ['Subcategory','Sub-Category','Subcat','Alt Kategori','AltKategori','Detail','Kalem'];
  const v = getFieldCI(row, keys);
  return v !== '' ? String(v).trim() : '';
}

/* === Aylık Giderler: Kategori + Alt Kategori listesi (Ay Seçimli) === */
let selectedExpenseMonth = null; // Seçili ay {year, month} (0-indexed month)
let expenseRowsCache = null; // CSV verisi cache

function getExpenseMonthLabel(year, month) {
  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${monthNames[month]} ${year}`;
}

async function renderThisMonthExpenses(){
  try{
    const tbody = document.getElementById('tblExpThisMonth');
    const labelEl = document.getElementById('expMonthLabel');
    if (!tbody) return;

    // CSV'yi yükle (cache varsa kullan)
    if (!expenseRowsCache) {
      expenseRowsCache = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);
    }
    const rows = expenseRowsCache;

    // Varsayılan: bu ay
    if (!selectedExpenseMonth) {
      const now = new Date();
      selectedExpenseMonth = { year: now.getFullYear(), month: now.getMonth() };
    }

    const y = selectedExpenseMonth.year;
    const m = selectedExpenseMonth.month;

    // Ay label'ı güncelle
    if (labelEl) labelEl.textContent = getExpenseMonthLabel(y, m);

    // Seçili aya ait satırları filtrele
    const inMonth = (rows||[]).filter(r=>{
      const ds = String(r.Date || r.date || '').slice(0,10);
      const d  = new Date(ds);
      return !isNaN(+d) && d.getFullYear() === y && d.getMonth() === m;
    });

    // === Totals & MoM ===
    const curTotal = inMonth.reduce((acc, r) => acc + readExpenseAmountTRY(r), 0);

    // Previous month (handles year wrap automatically)
    const prevStart = new Date(y, m - 1, 1);
    const prevY = prevStart.getFullYear();
    const prevM = prevStart.getMonth();
    const prevMonthRows = (rows || []).filter(r => {
      const ds = String(r.Date || r.date || '').slice(0,10);
      const d  = new Date(ds);
      return !isNaN(+d) && d.getFullYear() === prevY && d.getMonth() === prevM;
    });
    const prevTotal = prevMonthRows.reduce((acc, r) => acc + readExpenseAmountTRY(r), 0);

    // Write header totals
    const totalEl = document.getElementById('expThisMonthTotal');
    if (totalEl) totalEl.textContent = numberTL(curTotal);

    const momEl = document.getElementById('expThisMonthMoM');
    if (momEl){
      let text = 'MoM: –';
      momEl.classList.remove('kpi-up','kpi-down');
      if (prevTotal > 0){
        const pct = ((curTotal - prevTotal) / prevTotal) * 100;
        const sign = pct > 0 ? '+' : '';
        text = `MoM: ${sign}${pct.toFixed(1)}%`;
        momEl.classList.add(pct >= 0 ? 'kpi-up' : 'kpi-down');
      } else if (curTotal > 0){
        text = 'MoM: +∞% (ilk ay)';
        momEl.classList.add('kpi-up');
      }
      momEl.textContent = text;
    }

    if (!inMonth.length){
      tbody.innerHTML = '<tr><td class="hint py-2" colspan="4">Bu ay için gider bulunamadı.</td></tr>';
      return;
    }

    // Satırları tarihe göre azalan sırada göster (en yeni en üstte)
    inMonth.sort((a,b)=>{
      const ad = new Date(String(a.Date||a.date||'').slice(0,10));
      const bd = new Date(String(b.Date||b.date||'').slice(0,10));
      return bd - ad;
    });

    // Yardımcılar
    const fmtTL = (n)=> nfTL.format(Math.round(n||0));
    const getCat = (r)=> getFieldCI(r, ['Category','Kategori','Main Category','Ana Kategori','Cat']) || '';
    // Nihai alt kategori (varsa FinalSubcategory öncelikli)
    const getFinalSub = (r)=> getFieldCI(r, ['FinalSubcategory','Final Subcategory','Final','Nihai Alt Kategori']) ||
                              getFieldCI(r, ['Subcategory','Sub-Category','Alt Kategori','AltKategori','Detail','Kalem']) || '';

    // Render (kompakt - 4 sütun)
    const html = inMonth.map(r=>{
      const date = String(r.Date || r.date || '').slice(5,10); // MM-DD formatı (kompakt)
      const cat  = getCat(r);
      const fsub = getFinalSub(r);
      const amt  = readExpenseAmountTRY(r); // TRY tutarı güvenli okuma
      return `<tr>
        <td class="py-0.5 pr-2">${date}</td>
        <td class="py-0.5 pr-2">${cat}</td>
        <td class="py-0.5 pr-2">${fsub}</td>
        <td class="py-0.5 pr-0 text-right">${fmtTL(amt)}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = html;
  }catch(e){
    console.warn('renderThisMonthExpenses() error:', e);
    const tbody = document.getElementById('tblExpThisMonth');
    if (tbody) tbody.innerHTML = '<tr><td class="hint py-2" colspan="4">Liste yüklenemedi.</td></tr>';
  }
}

// Gider ayı gezinme butonları
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('expMonthPrev')?.addEventListener('click', () => {
    if (!selectedExpenseMonth) {
      const now = new Date();
      selectedExpenseMonth = { year: now.getFullYear(), month: now.getMonth() };
    }
    // Önceki aya git
    selectedExpenseMonth.month--;
    if (selectedExpenseMonth.month < 0) {
      selectedExpenseMonth.month = 11;
      selectedExpenseMonth.year--;
    }
    renderThisMonthExpenses();
    renderThisMonthExpensesByCategory();
  });

  document.getElementById('expMonthNext')?.addEventListener('click', () => {
    if (!selectedExpenseMonth) {
      const now = new Date();
      selectedExpenseMonth = { year: now.getFullYear(), month: now.getMonth() };
    }
    // Sonraki aya git (bugünden ileriye gitme)
    const now = new Date();
    const nextMonth = selectedExpenseMonth.month + 1;
    const nextYear = nextMonth > 11 ? selectedExpenseMonth.year + 1 : selectedExpenseMonth.year;
    const normalizedMonth = nextMonth > 11 ? 0 : nextMonth;

    if (nextYear < now.getFullYear() || (nextYear === now.getFullYear() && normalizedMonth <= now.getMonth())) {
      selectedExpenseMonth.month = normalizedMonth;
      selectedExpenseMonth.year = nextYear;
      renderThisMonthExpenses();
      renderThisMonthExpensesByCategory();
    }
  });
});

/* === Bu Ayın Giderleri: Kategori altında (FinalSubcategory – Subcategory) kırılımı === */
async function renderThisMonthExpensesByCategory(){
  try{
    const wrap = document.getElementById('expThisMonthByCat');
    if (!wrap) return;

    // CSV'yi yükle (cache varsa kullan)
    if (!expenseRowsCache) {
      expenseRowsCache = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);
    }
    const rows = expenseRowsCache;

    // Seçili ay (veya bu ay)
    if (!selectedExpenseMonth) {
      const now = new Date();
      selectedExpenseMonth = { year: now.getFullYear(), month: now.getMonth() };
    }
    const y = selectedExpenseMonth.year;
    const m = selectedExpenseMonth.month;

    // Seçili aya ait satırları filtrele
    const inMonth = (rows||[]).filter(r=>{
      const ds = String(r.Date || r.date || '').slice(0,10);
      const d  = new Date(ds);
      return !isNaN(+d) && d.getFullYear() === y && d.getMonth() === m;
    });

    // Hiç veri yoksa
    if (!inMonth.length){
      wrap.innerHTML = '<div class="hint">Bu ay için gider bulunamadı.</div>';
      const totEl = document.getElementById('expByCatTotal');
      if (totEl) totEl.textContent = '–';
      return;
    }

    // Kategori -> { sum, items: Map(label -> sum) }
    const totals = new Map();
    let grand = 0;

    inMonth.forEach(r=>{
      const cat = getFieldCI(r, ['Category','Kategori','Main Category','Ana Kategori','Cat']) || 'Diğer';
      const fsubRaw = getFieldCI(r, ['FinalSubcategory','Final Subcategory','Final','Nihai Alt Kategori']) || '';
      const subRaw  = getFieldCI(r, ['Subcategory','Sub-Category','Alt Kategori','AltKategori','Detail','Kalem']) || '';
      const label = (function(){
        if (fsubRaw && subRaw && String(fsubRaw) !== String(subRaw)) return `${fsubRaw} – ${subRaw}`;
        if (fsubRaw) return String(fsubRaw);
        if (subRaw)  return String(subRaw);
        return 'Diğer';
      })();
      const amt = readExpenseAmountTRY(r);
      if (!(amt > 0)) return;
      grand += amt;

      if (!totals.has(cat)) totals.set(cat, { sum:0, items:new Map() });
      const entry = totals.get(cat);
      entry.sum += amt;
      entry.items.set(label, (entry.items.get(label)||0) + amt);
    });

    // Render: Kategorileri toplam tutara göre büyükten küçüğe sırala
    const cats = Array.from(totals.entries()).sort((a,b)=> b[1].sum - a[1].sum);

    let html = '';
    cats.forEach(([cat, obj])=>{
      const items = Array.from(obj.items.entries()).sort((a,b)=> b[1] - a[1]);
      const listHTML = items.map(([label, val])=> `<li>${label} — <strong>${numberTL(val)}</strong></li>`).join('');
      html += `
        <div class="mt-2">
          <div class="font-medium">${cat} — Toplam Tutar: ${numberTL(obj.sum)}</div>
          <ul class="ml-4 list-disc">
            ${listHTML}
          </ul>
        </div>
      `;
    });

    const totEl = document.getElementById('expByCatTotal');
    if (totEl) totEl.textContent = numberTL(grand);
    wrap.innerHTML = html || '<div class="hint">Bu ay için gider bulunamadı.</div>';
  }catch(e){
    console.warn('renderThisMonthExpensesByCategory() error:', e);
    const wrap = document.getElementById('expThisMonthByCat');
    if (wrap) wrap.innerHTML = '<div class="hint">Liste yüklenemedi.</div>';
    const totEl = document.getElementById('expByCatTotal');
    if (totEl) totEl.textContent = '–';
  }
}

/* === Expenses CSV'den kredi taksitlerini say ve Loans UI'ı güncelle === */
async function refreshLoansFromExpenses(){
  try{
    // CSV'yi oku (mevcut loader'ını kullanıyoruz)
    const rows = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);

    // Mevcut loans config/state'i al
    const st = (typeof getLoansState === 'function') ? getLoansState() : (window.defaultLoansState || {
      loans:{
        biz:{ total:24, paid:0, instTRY:0, remainTRY:0, principalTRY:0, monthlyRate:0 },
        car:{ total:24, paid:0, instTRY:0, remainTRY:0, principalTRY:0, monthlyRate:0 },
        biz2: { total:24, paid:0, instTRY:71452.86, remainTRY:1714868.61, principalTRY:1714868.61, monthlyRate:0 }
      },
      zeeAwaitUSD:[]
    });

    // === Filtre koşulları (daha sıkı ve AY bazında tekil sayım) ===
    // "Taksitli Ticari Kredi" sayımı:
    //  - Subcategory = "Kredi" (case-insensitive, tam eşleşme)
    //  - Tutar ≈ 143.155 TL (instTRY varsa ona ±500 TL tolerans; yoksa hedefe ±500 TL)
    //  - Aynı ay içinde birden fazla satır varsa 1 taksit say (month-dedup)
    //
    // "Araç Kredisi":
    //  - Subcategory "Kredi" ve satırda araç/taşıt ipucu (subcategory veya final sub)
    //  - Tutar mantıklı bandda; AY bazında tekil.
    const NORM = s => String(s||'').toLowerCase().trim();

    const BIZ_TARGET = Number(st?.loans?.biz?.instTRY) > 0 ? Number(st.loans.biz.instTRY) : 143_155;
    const BIZ_EPS    = 500; // ±500 TL tolerans

    // Kredi 2 (Taksitli Ticari Kredi 2)
    const BIZ2_TARGET = Number(st?.loans?.biz2?.instTRY) > 0 ? Number(st.loans.biz2.instTRY) : 71_453;
    const BIZ2_EPS    = 500; // ±500 TL tolerans

    // Garanti Ticari Kredi — gider Sheet'inde alt kategori "Garanti Kredi" olarak geçiyor.
    const GARANTI_RE = /garanti\s*kredi/i;

    // Araç ipuçları
    const CAR_HINT_RE = /(araç|taşıt|oto|otomobil)/i;
    const CAR_TARGET  = Number(st?.loans?.car?.instTRY) > 0 ? Number(st.loans.car.instTRY) : 30_000;
    const CAR_EPS     = 1_500; // ±1.5K TL varsayılan tolerans

    // Distinct month sets (YYYY-MM)
    const bizMonths = new Set();
    const biz2Months = new Set();
    const carMonths = new Set();
    const garantiMonths = new Set();

    // Yardımcı: YYYY-MM anahtarı
    const monthKeyFromRow = (r) => {
      try{
        const dstr = String(r.Date || r.date || '').slice(0,10);
        if(!dstr) return '';
        const dt = new Date(dstr);
        if (isNaN(+dt)) return '';
        return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0');
      }catch(_){ return ''; }
    };

    (rows||[]).forEach(r=>{
      const subRaw = readExpenseSubcat(r);
      const sub = NORM(subRaw);
      if (!sub) return;

      const amt = readExpenseAmountTRY(r);
      if (!(amt > 0)) return;

      const monthK = monthKeyFromRow(r);
      if (!monthK) return;

      // FinalSubcategory’yi de ipucu olarak okuyalım
      const finSub = NORM(r.FinalSubcategory || r['Final Subcategory'] || r.Final || '');

      // --- Araç kredisi ayıklama ---
      const isCarHint = CAR_HINT_RE.test(sub) || CAR_HINT_RE.test(finSub);

      // --- Kredi 2 ayıklama ---
      const isKredi2Hint = /kredi\s*2|kredi\s*ii|ticari\s*2/.test(sub) || /kredi\s*2|kredi\s*ii|ticari\s*2/.test(finSub);

      // Yalnızca "Kredi" alt kategorisini say (tam eşleşme)
      const isSubKredi = sub === 'kredi' || finSub === 'kredi';

      // === Kredi 2 (check first, most specific) ===
      if (isKredi2Hint){
        const near = Math.abs(amt - BIZ2_TARGET) <= BIZ2_EPS;
        if (near) biz2Months.add(monthK);
      }
      // === Garanti kredisi: alt kategori "Garanti Kredi" ===
      else if (GARANTI_RE.test(sub) || GARANTI_RE.test(finSub)){
        garantiMonths.add(monthK);
      }
      // === İşletme/Ticari kredi (regular) ===
      else if (isSubKredi && !isCarHint){
        const near = Math.abs(amt - BIZ_TARGET) <= BIZ_EPS;
        if (near) bizMonths.add(monthK);
      }
      // === Araç kredisi ===
      else if (isSubKredi && isCarHint){
        const nearCar = Math.abs(amt - CAR_TARGET) <= CAR_EPS;
        if (nearCar) carMonths.add(monthK);
      }
    });

    // AY bazında tekil sayım
    const bizPaid = bizMonths.size;
    const biz2Paid = biz2Months.size;
    const carPaid = carMonths.size;
    const garantiPaid = garantiMonths.size;

    // State'i güncelle
    st.loans = st.loans || {};
    st.loans.biz = Object.assign({ total:24, instTRY:143000, remainTRY:0 }, st.loans.biz||{});
    st.loans.car = Object.assign({ total:24, instTRY:30000,  remainTRY:0 }, st.loans.car||{});
    st.loans.biz2 = Object.assign(
      { total:24, instTRY:71452.86, remainTRY:1714868.61, principalTRY:1714868.61, monthlyRate:0, paid:0 },
      st.loans.biz2 || {}
    );
    st.loans.garanti = Object.assign(
      { total:12, instTRY:106175.29, remainTRY:1274103.37, principalTRY:1000000,
        monthlyRate:3.69, paid:0, dueDay:26, firstPaymentDate:'2026-09-26' },
      st.loans.garanti || {}
    );
    st.loans.biz.paid = bizPaid;
    st.loans.biz2.paid = biz2Paid;
    st.loans.car.paid = carPaid;
    st.loans.garanti.paid = garantiPaid;

    // Kalan toplamı kabaca taksit* (kalan adet) olarak güncelle (opsiyonel)
    const bizRemainCnt = Math.max(0, (st.loans.biz.total||0) - bizPaid);
    const biz2RemainCnt = Math.max(0, (st.loans.biz2.total||0) - biz2Paid);
    const carRemainCnt = Math.max(0, (st.loans.car.total||0) - carPaid);
    if (st.loans.biz.instTRY>0) st.loans.biz.remainTRY = bizRemainCnt * Number(st.loans.biz.instTRY||0);
    if (st.loans.biz2.instTRY>0) st.loans.biz2.remainTRY = biz2RemainCnt * Number(st.loans.biz2.instTRY||0);
    if (st.loans.car.instTRY>0) st.loans.car.remainTRY = carRemainCnt * Number(st.loans.car.instTRY||0);
    const garantiRemainCnt = Math.max(0, (st.loans.garanti.total||0) - garantiPaid);
    if (st.loans.garanti.instTRY>0) st.loans.garanti.remainTRY = garantiRemainCnt * Number(st.loans.garanti.instTRY||0);

    // Kaydet + UI
    if (typeof setLoansState === 'function') setLoansState(st);
    try{
      localStorage.removeItem('popdog_expenses_cache');
    }catch(_){}
    if (typeof renderLoansBlock === 'function') renderLoansBlock();

  }catch(e){
    console.warn('refreshLoansFromExpenses() error:', e);
  }
}

// === Zee.Dog: Expenses'tan paid olanları işaretle + TRY hesapla ===
async function refreshZeeAwaitFromExpenses(){
  try{
    // Always bust the cached expenses before scanning (ensures we see latest Notes)
    try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}
    // 1) Expenses'ı yükle
    const rows = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);

    // 2) Note/Not/Açıklama içinden YK#... yakala (case-insensitive header names)
    const NOTE_KEYS = ['Note','Notes','Not','Açıklama','Açıklama 2','Description','DetailNote','Source','Kaynak','Detay'];
    const getNote = (r) => {
      const v = getFieldCI(r, NOTE_KEYS);
      return v !== '' ? String(v).trim() : '';
    };
    const idFromNote = (s) => {
      const m = String(s||'').match(/YK#\d+(?:\.\d+)?/i);
      return m ? m[0].toUpperCase() : '';
    };
    // Fallback: scan all string fields on the row for an ID like YK#033 or YK#033.1
    const idFromAnyField = (row) => {
      try{
        for (const k in row){
          const v = row[k];
          if (v == null) continue;
          const m = String(v).match(/YK#\d+(?:\.\d+)?/i);
          if (m) return m[0].toUpperCase();
        }
      }catch(_){}
      return '';
    };
    // Zee.Dog satırı olup olmadığını Subcategory/FinalSubcategory üzerinden, case-insensitive bak
    const isZeeRow = (r) => {
      const sub = String(getFieldCI(r, ['Subcategory','FinalSubcategory','Final Subcategory']) || '').toLowerCase();
      return /zee\.?dog/.test(sub);
    };

    // Ödeme tutarlarını ID bazında topla
    const paymentsByID = new Map(); // Map<ID, totalUSD>
    const AMT_KEYS = ['AmountTRY','Amount','Tutar','Tutar (TRY)','TRY'];
    const CURR_KEYS = ['Currency','Para Birimi'];

    for (const r of rows) {
      if (!isZeeRow(r)) continue;
      let id = idFromNote(getNote(r));
      if (!id) id = idFromAnyField(r);
      if (!id) continue;

      // Tutar ve para birimini al
      const amtTRY = Number(getFieldCI(r, AMT_KEYS) || 0);
      if (amtTRY <= 0) continue;

      // Zee.Dog ödemeleri için varsayılan para birimi USD (Currency sütunu yoksa veya boşsa)
      const currencyField = getFieldCI(r, CURR_KEYS);
      const currency = currencyField ? String(currencyField).toUpperCase() : 'USD';

      // USD'ye çevir
      let amtUSD = 0;
      if (currency === 'USD') {
        amtUSD = amtTRY; // AmountTRY aslında USD ise (sütun adı AmountTRY ama değer USD)
      } else {
        // TRY ise USD'ye çevir (getTryPerUsd = kaç TRY = 1 USD, mesela 43.3)
        // TRY → USD dönüşümü: TRY tutarı / (TRY/USD oranı)
        const fx = (typeof getTryPerUsd === 'function') ? getTryPerUsd() : 0;
        amtUSD = fx > 0 ? (amtTRY / fx) : 0;
      }

      // Sanity check: USD tutarı çok büyükse (>$500k), muhtemelen TRY yanlışlıkla USD olarak algılanmış
      if (amtUSD > 500000) {
        console.warn(`[Zee.Dog] Şüpheli yüksek ödeme tutarı: ${id} için $${amtUSD.toFixed(2)} (kaynak: ₺${amtTRY}, currency: ${currency}). Bu ödeme atlandı.`);
        continue;
      }

      // Bu ID için toplama ekle
      const current = paymentsByID.get(id) || 0;
      paymentsByID.set(id, current + amtUSD);
    }

    // 3) State'i al + yoksa default listeyi kullan
    const st = (typeof getLoansState === 'function') ? getLoansState() : (window.defaultLoansState || { zeeAwaitUSD: [] });
    if (!Array.isArray(st.zeeAwaitUSD) || st.zeeAwaitUSD.length===0) {
      st.zeeAwaitUSD = DEFAULT_ZEE_AWAIT.slice();
    }

    // 4) Kur (USD→TRY)
    const fx = (typeof getTryPerUsd === 'function') ? getTryPerUsd() : 0;

    // 5) Her bir Zee.Dog ödeme kaydını güncelle
    st.zeeAwaitUSD = st.zeeAwaitUSD.map(it => {
      const id = String(it.id || '').toUpperCase();
      const totalUsd = Number(it.usd || 0);
      const paidUsd = paymentsByID.get(id) || 0;
      const remainingUsd = Math.max(0, totalUsd - paidUsd);

      // Durum belirle
      let status = 'waiting';
      if (remainingUsd <= 0.01) { // Tam ödendi (1 cent tolerans)
        status = 'paid';
      } else if (paidUsd > 0) { // Kısmi ödendi
        status = 'partially_paid';
      }

      const prevTRY = (typeof it.try === 'number') ? it.try : null;
      const nextTRY = (fx > 0 && totalUsd > 0) ? (totalUsd * fx) : prevTRY;

      return {
        ...it,
        paidUsd: paidUsd,
        remainingUsd: remainingUsd,
        status: status,
        try: nextTRY
      };
    });

    // 5.5) Ana ID'leri alt ID'lerden hesapla (YK#034 = YK#034.1 + YK#034.2 gibi)
    // Ana ID'leri bul (nokta içermeyen, örn: YK#034, YK#035)
    const parentIds = st.zeeAwaitUSD.filter(z => !String(z.id).includes('.')).map(z => z.id.toUpperCase());

    parentIds.forEach(parentId => {
      // Bu ana ID'nin alt ID'lerini bul (YK#034.1, YK#034.2 gibi)
      const children = st.zeeAwaitUSD.filter(z => {
        const id = String(z.id).toUpperCase();
        return id.startsWith(parentId + '.'); // YK#034. ile başlayanlar
      });

      if (children.length === 0) return; // Alt ID yoksa atla

      // Alt ID'lerin toplam ödenen ve kalanını hesapla
      const childrenPaidTotal = children.reduce((sum, c) => sum + Number(c.paidUsd || 0), 0);
      const childrenRemainingTotal = children.reduce((sum, c) => sum + Number(c.remainingUsd || 0), 0);

      // Ana ID'yi güncelle
      const parent = st.zeeAwaitUSD.find(z => z.id.toUpperCase() === parentId);
      if (parent) {
        parent.paidUsd = childrenPaidTotal;
        parent.remainingUsd = childrenRemainingTotal;

        // Durum güncelle
        if (childrenRemainingTotal <= 0.01) {
          parent.status = 'paid';
        } else if (childrenPaidTotal > 0) {
          parent.status = 'partially_paid';
        } else {
          parent.status = 'waiting';
        }
      }
    });

    // 6) Kaydet + UI
    if (typeof setLoansState === 'function') setLoansState(st);
    if (typeof renderLoansBlock === 'function') renderLoansBlock();
  }catch(e){
    console.warn('refreshZeeAwaitFromExpenses() error:', e);
  }
}

document.addEventListener('DOMContentLoaded', async function(){
  // Krediler önce sunucudan; diğer hesaplar bunun üzerine çalışsın.
  try{ await loadLoansFromKV(); }catch(_){}
  try{ if (typeof renderLoansBlock === 'function') renderLoansBlock(); }catch(_){}

  // Ensure fresh expenses before both passes
  try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}

  // Run sequential operations that depend on cache clear
  try{ await refreshLoansFromExpenses(); }catch(e){ console.warn('refreshLoansFromExpenses error:', e); }
  try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}
  try{ await refreshZeeAwaitFromExpenses(); }catch(e){ console.warn('refreshZeeAwaitFromExpenses error:', e); }

  // Run independent operations in parallel
  await Promise.allSettled([
    (async () => { try{ await renderThisMonthExpenses(); }catch(e){ console.warn('renderThisMonthExpenses error:', e); } })(),
    (async () => { try{ await renderThisMonthExpensesByCategory(); }catch(e){ console.warn('renderThisMonthExpensesByCategory error:', e); } })(),
    (async () => { try{ await refreshGoldFromScript(); }catch(e){ console.warn('refreshGoldFromScript error:', e); } })()
  ]);
}, { once:true });

/* Re-run Zee + Loans refresh after "Gider Ekle" form submits (best-effort) */
document.addEventListener('DOMContentLoaded', function(){
  const btn = document.getElementById('expAddBtn');
  if (!btn) return;
  // We don't intercept the existing click handler; we just schedule a refresh shortly after.
  btn.addEventListener('click', function(){
    // Give the existing submit/write flow a moment to complete before refreshing.
    setTimeout(async function(){
      try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}
      try{ await refreshLoansFromExpenses(); }catch(_){}
      try{ await refreshZeeAwaitFromExpenses(); }catch(_){}
      try{ await renderThisMonthExpenses(); }catch(_){}
      try{ await renderThisMonthExpensesByCategory(); }catch(_){}
    }, 1800);
  });
}, { once:true });
function toMonday(d){
  const dt = new Date(d); const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); dt.setHours(0,0,0,0); return dt;
}
function addDays(d, n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
function weekRangeLabel(monday){
  const sun = addDays(monday, 6);
  const f = (x)=> `${x.getDate().toString().padStart(2,'0')}.${(x.getMonth()+1).toString().padStart(2,'0')}`;
  return `${f(monday)} – ${f(sun)}`;
}

/* Cache-bust — 5-dakikalık bucket, tarayıcı/CDN cache'i korur */
function withCacheBust(url){
  if(!url) return '';
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${bucket}`;
}

// === Missing helpers (used by CSV loaders) ===
// assetURL: currently just applies cache-bust; can be extended later for local assets
function assetURL(url){
  try{
    return withCacheBust(url);
  }catch(e){
    return url || '';
  }
}

// isFreshMode: controls fetch cache mode; can be toggled via ?fresh=1 or localStorage flag
function isFreshMode(){
  try{
    const p = getParam('fresh');
    if (p === '1') return true;
    if (p === '0') return false;
    const s = localStorage.getItem('popdog_fresh_mode');
    if (s === '1') return true;
    if (s === '0') return false;
  } catch(e){}
  return true; // default: fresh mode on (force reload)
}

/* ================== QUERY PARAM HELPERS ================== */
function getParam(name){
  try { return new URLSearchParams(location.search).get(name) || ''; } catch(e){ return ''; }
}

/* Clean-on-load flag: URL ?clean=1/0 overrides; falls back to localStorage; default = true */
function isCleanOnLoad(){
  try{
    const p = getParam('clean');
    if (p === '1') return true;
    if (p === '0') return false;
    const s = localStorage.getItem('popdog_clean_on_load');
    if (s === '1') return true;
    if (s === '0') return false;
  }catch(e){}
  return true; // default: clean enabled
}

/* ================== STATE ================== */
/* === Ensure daily rows are deduped by Date (keep richer row) === */
let loadedRows = [];     // revenue rows (sheet csv)
// IMPORTANT: use a single shared stagedRows array everywhere.
// Some code paths used a local `stagedRows` while others used `window.stagedRows`.
// If those diverge, the "Sheet’e Yaz" button thinks there are 0 rows.
if (!Array.isArray(window.stagedRows)) window.stagedRows = [];
let stagedRows = window.stagedRows; // legacy compat: keep name but point to the shared array
let fxRateUSDPerTRY = null;
let fxDate = null;
let mergedRowsCache = [];

// === REMOVED: Duplicate function definition (kept the version at line ~5231) ===

/* ================== CSV LOADERS ================== */
async function loadFromSheet(url){
  const resp = await fetch(assetURL(url), { cache: 'no-store' });
  if(!resp.ok) throw new Error(`CSV fetch failed: ${resp.status}`);
  const csvText = await resp.text();
  return new Promise((resolve,reject)=>{
    Papa.parse(csvText, {
      header:true, skipEmptyLines:true,
      worker:true, fastMode:true,
      complete: (res)=>{
        try{
          const data = (res.data||[]).map(r=>{
            const iso = r.Date ? String(r.Date).trim().slice(0,10) : '';
            // Kuaför sütunu: Kuaför, Kuafor veya Grooming olabilir
            const kuaforVal = parseTL(r['Kuaför'] ?? r['Kuafor'] ?? r['Grooming'] ?? 0);
            const row = {
              Date: iso,
              Toptan: parseTL(r.Toptan),
              Online: parseTL(r.Online),
              CKM: parseTL(r.CKM),
              "CKM Nakit": parseTL(r["CKM Nakit"]),
              Kuaför: kuaforVal,
              Trendyol: parseTL(r.Trendyol),
              Hepsiburada: parseTL(r.Hepsiburada),
            };
            // Prefer the sheet's own Total column — it's always correct for both old-format rows
            // (where CKM already includes Kuaför) and new-format rows (where CKM excludes Kuaför).
            // Recalculating here would double-count Kuaför for old-format rows.
            const rawSheetTotal = parseTL(r.Total);
            row.Total = rawSheetTotal > 0 ? rawSheetTotal : (row.Toptan + row.Online + row.CKM + row.Kuaför + row.Trendyol + row.Hepsiburada);
            return row;
          }).filter(r=>r.Date);
          // Optional cleaning while loading from Sheet:
          // - dedupe same-day rows (keeps the row with higher Total or more non-zero fields)
          // - sort by Date ascending
          const cleaned = isCleanOnLoad() ? dedupeDailyRows(data) : data;
          resolve(cleaned);
        }catch(e){ reject(e); }
      },
      error: reject
    });
  });
}

async function loadCSV(url){
  if(!url) return [];
  const busted = withCacheBust(url);
  const resp = await fetch(busted, { cache: 'no-store' });
  if(!resp.ok) throw new Error(`CSV fetch failed: ${resp.status}`);
  const text = await resp.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header:true, skipEmptyLines:true,
      complete: (res)=> resolve(res.data||[]),
      error: reject
    });
  });
}

// Robust normalizer so Papa.parse output always has Date normalized.
function parseExpenseRow(r){
  try{
    const iso = getExpenseISODate(r) || '';
    // IMPORTANT:
    // Do NOT modify or overwrite r.Amount here.
    // Keep raw CSV fields intact so readExpenseAmountTRY(r) can apply FX exactly once later.
    return { ...r, Date: (iso || r.Date || r.date || '') };
  }catch(e){
    return r || {};
  }
}

// Correct CSV loader for Expenses (fetch text, then Papa.parse on string)
async function loadExpensesCsv(url){
  if (!url) return [];
  try{
    const resp = await fetch(withCacheBust(url), { cache: 'no-store' });
    if (!resp.ok) return [];
    const text = await resp.text();

    return await new Promise((resolve) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
const rows = (res.data || [])
  .map(parseExpenseRow)
  .filter(r => r.Date);          resolve(rows);
        },
        error: () => resolve([])
      });
    });
  }catch(e){
    return [];
  }
}

/* ========= Gider Ekle (UI + Sheet yazma) ========= */
// Ek kolon alias'ları
const CATEGORY_KEYS = ['Category','Kategori','Main Category','Ana Kategori','Cat'];
const FINALSUB_KEYS = ['FinalSubcategory','Final Subcategory','FinalSubcat','Final Sub-Category','Nihai Alt Kategori','Final','FinalSub'];
// Subcategory → { category, final } eşlemesi (CSV'den türetilir)
let EXP_SUBMAP = {};  // ör: { "Kargo": { category:"Lojistik", final:"Kargo" } }
// Alt kategori kolon isimleri için olası başlıklar
const SUBCAT_KEYS = ['Subcategory', 'Sub-Category', 'Subcat', 'Alt Kategori', 'AltKategori', 'Detail', 'Kalem'];

// Mevcut expenses CSV’den benzersiz alt kategorileri topla + kategori/final eşlemesi
async function loadExpenseSubcategories(){
  try{
    // 1) Önce localStorage cache varsa kullan
    let rows = [];
    try{ rows = JSON.parse(localStorage.getItem('popdog_expenses_cache') || '[]'); }catch(_){}
    // 2) Yoksa CSV’den yükle
    if(!Array.isArray(rows) || rows.length===0){
      rows = await loadExpensesCsv(DEFAULT_EXPENSES_CSV);
      try{ localStorage.setItem('popdog_expenses_cache', JSON.stringify(rows||[])); }catch(_){}
    }

    // 3) Set + eşleme (subcategory → {category, final})
    const set = new Set();
    const map = {};

    (rows||[]).forEach(r=>{
      if(!r) return;

      // Subcategory value
      let sub = '';
      for(const k of SUBCAT_KEYS){
        if(r[k]!=null && String(r[k]).trim()!==''){ sub = String(r[k]).trim(); break; }
      }
      if(!sub) return;

      // Category value
      let cat = '';
      for(const k of CATEGORY_KEYS){
        if(r[k]!=null && String(r[k]).trim()!==''){ cat = String(r[k]).trim(); break; }
      }

      // FinalSubcategory value
      let fin = '';
      for(const k of FINALSUB_KEYS){
        if(r[k]!=null && String(r[k]).trim()!==''){ fin = String(r[k]).trim(); break; }
      }

      set.add(sub);
      // İlk geleni koru, boşsa doldur
      if(!map[sub]) map[sub] = { category: cat || '', final: fin || sub };
    });

    // Boşsa en azından bir kaç öneri bırak
    if(set.size===0){
      ['Kira','Elektrik','Personel','Kargo','Reklam','Sarf','Diğer'].forEach(x=>{
        set.add(x);
        if(!map[x]) map[x] = { category:'', final:x };
      });
    }

    // Global ve localStorage'a yaz
    EXP_SUBMAP = map;
    try{ localStorage.setItem('popdog_expenses_submap', JSON.stringify(map)); }catch(_){}

    return Array.from(set).sort((a,b)=> a.localeCompare(b,'tr'));
  }catch(e){
    // Map fallback
    EXP_SUBMAP = {};
    return ['Diğer'];
  }
}

// Tarih: <input type="date"> → YYYY-MM-DD
function dateToISO(d){
  if(!d) return '';
  const s = String(d).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s; // already ISO-like from <input type="date">
}

// Sheet’e gider satırı yaz (daha sağlam hata yakalama + JSON kontrol)
  async function appendExpenseRow({ dateISO, subcat, amountTRY, note }){
  // Subcategory eşleşmesinden kategori/final çek
  let cat = '', fin = '';
  try{
    const m = EXP_SUBMAP && EXP_SUBMAP[subcat] ? EXP_SUBMAP[subcat] : JSON.parse(localStorage.getItem('popdog_expenses_submap')||'{}')[subcat];
    if(m){ cat = m.category || ''; fin = m.final || subcat; } else { fin = subcat; }
  }catch(_){ fin = subcat; }

  // Zee.Dog kontrolü - USD mi TRY mi?
  const isZeeDog = /zee[\s\.-]*dog|zeedog/i.test(subcat) || /zee[\s\.-]*dog|zeedog/i.test(fin);
  const currency = isZeeDog ? 'USD' : 'TRY';

  const payload = {
    action: 'appendExpense',
    row: {
      Date: dateISO,                       // YYYY-MM-DD (01)
      Subcategory: subcat,                 // alt kategori
      Category: cat,                       // ana kategori (varsa)
      FinalSubcategory: fin,               // nihai alt kategori (varsa)
      Amount: amountTRY,                   // Sheet'teki sütun adı "Amount"
      Currency: currency,                  // Zee.Dog için USD, diğerleri TRY
      Note: note || ''
    }
  };
  const WEBAPP_URL = getSheetWebAppURL();
  async function postOnceFlexible(body){
    const url = WEBAPP_URL;

    // Strategy A: JSON POST
    try{
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(body)
      });
      if (r.ok){
        const raw = await r.text().catch(()=> '');
        let json = null; try{ json = JSON.parse(raw); }catch(_){ /* ignore */ }
        return { json, raw };
      }
      // If 400/unknown action text is present, bubble for fallback
      const raw = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status}${raw? ' • '+raw : ''}`);
    }catch(e){ /* fall through to Strategy B */ }

    // Strategy B: x-www-form-urlencoded POST (Apps Script classic doPost(e.parameter))
    try{
      const form = new URLSearchParams();
      Object.keys(body||{}).forEach(k=>{
        const v = body[k];
        form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form.toString()
      });
      if (r.ok){
        const raw = await r.text().catch(()=> '');
        let json = null; try{ json = JSON.parse(raw); }catch(_){ /* ignore */ }
        return { json, raw };
      }
      const raw = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status}${raw? ' • '+raw : ''}`);
    }catch(e){ /* fall through to Strategy C */ }

    // Strategy C: GET with query params (very legacy handlers; beware URL length)
    const params = new URLSearchParams();
    Object.keys(body||{}).forEach(k=>{
      const v = body[k];
      params.append(k, typeof v === 'object' ? encodeURIComponent(JSON.stringify(v)) : String(v));
    });
    const r = await fetch(`${url}?${params.toString()}`, { method: 'GET' });
    const raw = await r.text().catch(()=> '');
    let json = null; try{ json = JSON.parse(raw); }catch(_){ /* ignore */ }
    if (!r.ok) throw new Error(`HTTP ${r.status}${raw? ' • '+raw : ''}`);
    return { json, raw };
  }

  const attempts = [];
  {
    const compat = getWebAppCompat();
    if (compat && (compat.rowsKey || compat.actionKey || compat.expenseAction)){
      const ak = compat.actionKey || 'action';
      const av = compat.expenseAction || 'appendExpense';
      // prefer 'row' for single; fallback to compat.rowsKey if provided
      const rk = compat.rowsKey || 'row';
      const b1 = {}; b1[rk] = payload.row; if (ak) b1[ak] = av; attempts.push(b1);
      const b2 = {}; b2[rk] = JSON.stringify(payload.row); if (ak) b2[ak] = av; attempts.push(b2);
    }
  }
  attempts.push(
    { action: 'appendExpense', row: payload.row },
    { action: 'append_expense', row: payload.row },
    { action: 'expenseAppend',  row: payload.row },
    { action: 'appendRow',      row: payload.row },
    { action: 'append',         row: payload.row },
    // legacy: rowJson / data
    { action: 'appendExpense', rowJson: JSON.stringify(payload.row) },
    { action: 'appendExpense', data: payload.row },
    { data: JSON.stringify(payload.row) },
    // very old handlers: flat payload
    payload.row
  );

  for (const body of attempts){
    try{
      const { json, raw } = await postOnceFlexible(body);
      if (json && json.ok === false && /UNKNOWN_ACTION|unknown\s*action|no\s*such\s*action/i.test(String(json.error||json.message||''))){
        continue; // try next
      }
      if (json && json.ok === false){
        throw new Error(`Server • ${json.error || json.message || 'unknown error'}`);
      }
      if (json && (json.error || json.message)){
        try{
          localStorage.removeItem('popdog_expenses_cache');
          if (subcat) bumpLoansPaidIfMatches(subcat, amountTRY);
          if (typeof renderLoansBlock === 'function') renderLoansBlock();
        }catch(_){}
        return String(json.message || json.error);
      }
      // Success case - update cache and return
      try{
        localStorage.removeItem('popdog_expenses_cache');
        if (subcat) bumpLoansPaidIfMatches(subcat, amountTRY);
        if (typeof renderLoansBlock === 'function') renderLoansBlock();
      } catch(_){}
      return 'Sheet güncellendi';
    }catch(e){
      const s = String(e && e.message || '');
      if (/UNKNOWN_ACTION|unknown\s*action|no\s*such\s*action/i.test(s)) continue;
      // network or other errors → bubble up
      throw e;
    }
  }
  throw new Error('UNKNOWN_ACTION: Sunucu appendExpense işlemini tanımıyor. (appendExpense/appendRow/append)');
}

// Web App bağlantı testi (opsiyonel)
async function pingSheetWebApp(){
  try{
    // Try POST __ping__ (preferred)
    const r = await fetch(getSheetWebAppURL(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: '__ping__' })
    });
    if (r && r.ok) return true;
  }catch(_){}
  try{
    // Fallback: simple GET
    const g = await fetch(getSheetWebAppURL(), { method: 'GET' });
    return !!(g && g.ok);
  }catch(_){
    return false;
  }
}

// UI init
async function initExpenseEntryUI(){
  const sel = document.getElementById('expSubSel');
  const info = document.getElementById('expAddInfo');
  const btn = document.getElementById('expAddBtn');

  // Bağlantı uyarısı (erken)
  try{
    if(info) info.textContent = 'Bağlantı kontrol ediliyor…';
    const ok = await pingSheetWebApp();
    if(!ok && info){
      info.textContent = '⚠️ Sheet bağlantısı yok. Apps Script adresi sunucuda GAS_EXEC_URL secret’ında tanımlı olmalı (wrangler pages secret put GAS_EXEC_URL).';
    }
  }catch(_){ /* sessiz */ }

  // Alt kategorileri doldur
  try{
    const subs = await loadExpenseSubcategories();
    if(sel){
      sel.innerHTML = `<option value="">Seçiniz…</option>` + subs.map(s=>`<option>${s}</option>`).join('');
    }
    if(info) info.textContent = `Alt kategori sayısı: ${subs.length}`;
  }catch(e){
    if(sel) sel.innerHTML = `<option value="">(yüklenemedi)</option>`;
    if(info) info.textContent = `⚠️ Alt kategoriler yüklenemedi: ${e.message||e}`;
  }

  // Varsayılan: bugün seçili gelsin
  try{
    const dateInput = document.getElementById('expDate');
    if(dateInput && !dateInput.value){
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth()+1).padStart(2,'0');
      const d = String(today.getDate()).padStart(2,'0');
      dateInput.value = `${y}-${m}-${d}`;
    }
  }catch(_){/* sessiz */}

  // Ekle butonu
  if(btn){
    btn.onclick = async ()=>{
      const dateVal = document.getElementById('expDate')?.value || '';
      const subVal  = document.getElementById('expSubSel')?.value || '';
      const amtVal  = document.getElementById('expAmount')?.value || '';
      const noteVal = document.getElementById('expNote')?.value || '';

      const infoEl = document.getElementById('expAddInfo');
      function setInfo(t){ if(infoEl) infoEl.textContent = t; }

      // Validasyon
      const dateISO = dateToISO(dateVal);
      if(!dateISO){ setInfo('Lütfen bir tarih seçin (YYYY-AA-GG).'); return; }
      if(!subVal){ setInfo('Alt kategori seçin.'); return; }
      const amountTRY = parseTL(amtVal);
      if(!amountTRY || amountTRY<=0){ setInfo('Tutar (₺) girin.'); return; }

      try{
        setInfo('Gönderiliyor…');
        // Optional UX: kategori eşleşmesi yoksa bilgi ver
        if(!EXP_SUBMAP[subVal]){
          setInfo('Gönderiliyor… (kategori eşleşmesi bulunamadı, FinalSubcategory=subcat yazılacak)');
        }
        const msg = await appendExpenseRow({ dateISO, subcat: subVal, amountTRY, note: noteVal });
        setInfo(`✓ Eklendi • ${msg||'Sheet güncellendi'}`);
        applyExpenseToLoans({ amountTRY, subcat: subVal, note: noteVal });
        // Gerekirse cache’i kirletme & ekrana tazeleme
        try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}
        try{ if(typeof refreshAll === 'function') refreshAll(); }catch(_){}
      }catch(err){
        setInfo(`⚠️ Hata: ${err && err.message ? err.message : err}\n— Olası nedenler: Web App URL hatalı, yayın yapılmadı/yeni versiyon seçilmedi veya erişim izni (Anyone) kapalı.`);
      }
    };
  }
}

// Sayfa yüklenince hazırla (router çalıştıktan sonra da çağrılırsa sorun yok)
document.addEventListener('DOMContentLoaded', ()=> {
  try{ initExpenseEntryUI(); }catch(_){}
});

document.addEventListener('DOMContentLoaded', ()=>{
  // 300ms sonra bir kere çek (UI render’dan sonra gelsin)
  setTimeout(refreshFundQuotes, 300);

  // Ekstra: Çift tıkla anlık güncelle
  ['fi5UnitInput','sasUnitInput','isyUnitInput'].forEach(id=>{
    const el = document.getElementById(id);
    if (el){
      el.title = 'Çift tıkla: sunucudan en son birim fiyatı çek';
      el.addEventListener('dblclick', refreshFundQuotes);
    }
  });
});

/* ================== LOANS & PENDING (STATE + UI) ================== */
/* Kalıcı durum (localStorage) şeması */
const LOANS_KEY = 'popdog_loans_state';
const defaultLoansState = {
  loans: {
    biz: {                    // Taksitli Ticari
      remainTRY: 2719938.78,
      paid: 5, total: 24,
      instTRY: 143154.67,
      principalTRY: 2000000,
      monthlyRate: 4.640833,
      dueDay: 4,                       // Sheet ve banka ekstresinde her ayın 4'ü
      firstPaymentDate: '2025-05-04'   // bu tutarla ilk taksit
    },
    car: {                    // Taksitli Araç
      remainTRY: 1453127.86,
      paid: 9, total: 24,
      instTRY: 96875.20,
      principalTRY: 1500000,
      monthlyRate: 3.666666,
      dueDay: 18,
      firstPaymentDate: '2025-01-18'
    },
    biz2: {                   // Taksitli Ticari 2
      remainTRY: 1714868.61,
      paid: 0, total: 24,
      instTRY: 71452.86,
      principalTRY: 1714868.61,
      monthlyRate: 3.72,
      dueDay: 21,
      firstPaymentDate: '2025-11-21'
    },
    garanti: {                // Garanti Ticari Kredi
      remainTRY: 1274103.37,  // bankanın toplam geri ödeme tutarı
      paid: 0, total: 12,
      instTRY: 106175.29,
      principalTRY: 1000000,
      monthlyRate: 3.69,
      dueDay: 26,                        // her ayın 26'sı
      firstPaymentDate: '2026-09-26'     // ilk taksit
    }
  },
  zeeAwaitUSD: [
    { id:'YK#033',   usd: 4626.02,  paid:true },
    { id:'YK#034',   usd: 39425.33, paid:false },
    { id:'YK#034.1', usd: 11827.00, paid:false },
    { id:'YK#034.2', usd: 27597.00, paid:false },
    { id:'YK#035',   usd: 37589.19, paid:false },
    { id:'YK#035.1', usd: 11276.76, paid:false },
    { id:'YK#035.2', usd: 26312.43, paid:false },
    { id:'YK#037',   usd: 31021.80, paid:false },
    { id:'YK#037.1', usd:  9306.54, paid:false },   // toplamın %30'u
    { id:'YK#037.2', usd: 21715.26, paid:false },   // toplamın %70'i
  ],
  /* Yıllık ciro hedefi. 2024: 16,3 M · 2025: 17,3 M · 2026 ilk 8 ay: 17,06 M.
     Düz koşu hızı 25,6 M; 2025'in Eyl–Ara mevsimselliği (yılın %38'i)
     uygulanınca 27,5 M çıkıyor. Hedef ikisinin arasında, ulaşılabilir ama
     kendiliğinden gelmeyecek bir yerde. */
  yillikHedef: 27000000,
  demoBank: {
  goldGram: 169,
  gramTRY: Number(localStorage.getItem('popdog_gold_gram_try')||0) || 0, // kullanıcı girecek
  fi5Units: 565,
  fi5UnitTRY: Number(localStorage.getItem('popdog_fi5_unit_try')||0) || 0,  // kullanıcı girecek (birim fiyat)
  sasUnits: 114236,
  sasUnitTRY: Number(localStorage.getItem('popdog_sas_unit_try')||0) || 0,
  isyUnits: 2530000,
  isyUnitTRY: Number(localStorage.getItem('popdog_isy_unit_try')||0) || 0
}
};

/* Kayıtlı durumu varsayılanlarla birleştirir.
 *
 * Eskiden kayıt neyse olduğu gibi döndürülüyordu. Eksik veya eski şemalı bir
 * kayıt (ör. sadece {loans:{biz:{paid,total}}}) geldiğinde loans.car,
 * loans.biz2, zeeAwaitUSD ve demoBank tanımsız kalıyor; buna bağlı render'lar
 * patlayıp "Yükleniyor..." ve "–%" ekranda kalıyordu. Artık eksik alanlar
 * varsayılandan tamamlanıyor — kullanıcının girdiği değerler korunuyor. */
/* Kaynak sırası: bellek (KV'den gelen) → localStorage (çevrimdışı yedek)
   → varsayılan. KV'ye yazma setLoansState içinde arka planda yapılır. */
let __loansCache = null;
let __loansLastSent = '';

async function loadLoansFromKV(){
  try{
    const r = await fetch('/api/loans', { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    if (j && j.ok && j.state && typeof j.state === 'object'){
      __loansCache = j.state;
      __loansLastSent = JSON.stringify(j.state);
      try{ localStorage.setItem(LOANS_KEY, __loansLastSent); }catch(_){}
      return true;
    }
  }catch(e){ console.warn('loadLoansFromKV:', e && e.message); }
  return false;
}
window.loadLoansFromKV = loadLoansFromKV;

function getLoansState(){
  const d = structuredClone(defaultLoansState);
  let s = __loansCache;
  if (!s){
    try{
      s = JSON.parse(localStorage.getItem(LOANS_KEY) || 'null');
    }catch(_){}
  }
  if (!s || typeof s !== 'object') return d;

  const out = Object.assign({}, d, s);
  out.loans = Object.assign({}, d.loans, s.loans || {});
  ['biz', 'car', 'biz2', 'garanti'].forEach(function(k){
    out.loans[k] = Object.assign({}, d.loans[k], (s.loans && s.loans[k]) || {});
  });
  /* Kayıtlı liste ile varsayılan liste id bazında birleşir.
     Kayıtlı kalem kazanır (ödendi bilgisi korunur); varsayılanda olup
     kayıtta olmayan yeni kalemler listeye eklenir. Aksi halde koda yeni
     bir YK# eklendiğinde KV'deki eski liste onu gölgeliyordu. */
  {
    const kayitli = Array.isArray(s.zeeAwaitUSD) ? s.zeeAwaitUSD : [];
    const gorulen = new Set(kayitli.map(function(z){ return String(z && z.id || '').toUpperCase(); }));
    const eklenecek = structuredClone(d.zeeAwaitUSD).filter(function(z){
      return !gorulen.has(String(z.id || '').toUpperCase());
    });
    out.zeeAwaitUSD = kayitli.length ? kayitli.concat(eklenecek) : structuredClone(d.zeeAwaitUSD);
  }
  out.demoBank = Object.assign({}, d.demoBank, s.demoBank || {});
  return out;
}
function setLoansState(st){
  __loansCache = st;
  const payload = JSON.stringify(st);
  try{ localStorage.setItem(LOANS_KEY, payload); }catch(_){}

  // Değişmediyse KV'ye yazma — her sayfa açılışında boşuna PUT olmasın.
  if (payload === __loansLastSent) return;
  __loansLastSent = payload;
  try{
    fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(function(e){ console.warn('setLoansState KV yazma:', e && e.message); });
  }catch(_){}
}

/* Dosyanın üstündeki yardımcı blok window.defaultLoansState'i sıfır değerlerle
   kurmuştu (const olduğu için gerçek tanımı göremiyordu). Doğrusuyla eşitliyoruz. */
window.defaultLoansState = defaultLoansState;
window.getLoansState = getLoansState;
window.setLoansState = setLoansState;

/* ================== AYLIK ÖDEME PLANI ==================
 * expenses_master'daki geçmişten bu ayın beklenen ödemelerini çıkarır.
 * Bir kalem "düzenli" sayılır: son 8 ayın en az 5'inde görülmüşse.
 * Tutar  = aylık toplamların medyanı (tek seferlik sapmalar etkilemesin)
 * Gün    = ödeme günlerinin medyanı
 * Durum  = bu ay aynı alt kategoride kayıt varsa "ödendi"
 */
function aylikOdemePlani(){
  const rows = Array.isArray(expensesRowsCache) ? expensesRowsCache : [];
  if (!rows.length) return { kalemler: [], buAy: null };

  const buAy = (function(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();
  const gecmisAylar = [];
  {
    const d = new Date(); d.setDate(1);
    for (let i=0; i<8; i++){ d.setMonth(d.getMonth()-1);
      gecmisAylar.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
  }
  const gecmisSet = new Set(gecmisAylar);

  const aylik = {}, gunler = {}, meta = {}, buAyOdenen = {};
  rows.forEach(function(r){
    const iso = String(r.Date || '').slice(0,10);
    if (iso.length < 10) return;
    const ay = iso.slice(0,7), gun = Number(iso.slice(8,10));
    const alt = String(r.Subcategory || '').trim();
    if (!alt) return;
    const tl = (typeof readExpenseAmountTRY === 'function') ? readExpenseAmountTRY(r) : Number(r.Amount||0);
    if (!(tl > 0)) return;
    if (ay === buAy){ buAyOdenen[alt] = (buAyOdenen[alt]||0) + tl; return; }
    if (!gecmisSet.has(ay)) return;
    (aylik[alt] = aylik[alt] || {})[ay] = (aylik[alt][ay]||0) + tl;
    (gunler[alt] = gunler[alt] || []).push(gun);
    meta[alt] = { kategori: String(r.Category||'').trim() };
  });

  const medyan = function(a){ const b=a.slice().sort(function(x,y){return x-y;});
    const m=Math.floor(b.length/2); return b.length%2 ? b[m] : (b[m-1]+b[m])/2; };

  const kalemler = [];
  Object.keys(aylik).forEach(function(alt){
    const aylar = Object.keys(aylik[alt]).sort();
    if (aylar.length < 5) return;
    const degerler = aylar.map(function(a){ return aylik[alt][a]; });
    const ort = degerler.reduce(function(x,y){return x+y;},0) / degerler.length;
    const sapma = Math.sqrt(degerler.reduce(function(t,v){ return t + (v-ort)*(v-ort); },0) / degerler.length);
    const cv = ort ? sapma/ort : 0;
    kalemler.push({
      alt: alt,
      kategori: (meta[alt]||{}).kategori || '',
      gun: Math.round(medyan(gunler[alt])),
      /* Öneri tutarı = SON AY. Medyan zamlanan kalemlerde geride kalıyordu
         (kira 70.000 gösteriyordu, oysa 95.000 olmuştu). */
      tutar: degerler[degerler.length-1],
      medyan: medyan(degerler),
      sabit: cv < 0.10,          // %10'un altında oynayan = sabit, doğrudan girilebilir
      oynaklik: cv,
      gorulenAy: aylar.length,
      odendi: !!buAyOdenen[alt],
      odenenTutar: buAyOdenen[alt] || 0,
    });
  });
  kalemler.sort(function(a,b){ return a.gun - b.gun || b.tutar - a.tutar; });
  return { kalemler: kalemler, buAy: buAy };
}
window.aylikOdemePlani = aylikOdemePlani;

/* Zee.Dog listesinde ana kalem (ör. YK#037) ile alt kalemleri (YK#037.1 = %30,
   YK#037.2 = %70) birlikte listeleniyor. Alt kalemler ana kalemi böldüğü için
   ikisini birden toplamak borcu iki kat gösteriyor. Toplamlarda ana kalem
   atlanır; tabloda başlık satırı gibi durmaya devam eder. */
function zeeAnaKalemMi(id, liste){
  const onek = String(id || '').toUpperCase() + '.';
  return (liste || []).some(function(z){
    return String(z && z.id || '').toUpperCase().startsWith(onek);
  });
}
function zeeToplananlar(liste){
  const arr = Array.isArray(liste) ? liste : [];
  return arr.filter(function(z){ return !zeeAnaKalemMi(z && z.id, arr); });
}
window.zeeAnaKalemMi = zeeAnaKalemMi;
window.zeeToplananlar = zeeToplananlar;

/* Ödenmemişler üstte; her grup kendi içinde özgün sırasını korur. */
function zeeSirala(liste){
  const arr = (Array.isArray(liste) ? liste : []).map(function(z, i){ return { z: z, i: i }; });
  const odenmis = function(z){
    return z && (z.paid === true || String(z.status || '').toLowerCase() === 'paid');
  };
  arr.sort(function(a, b){
    const fa = odenmis(a.z) ? 1 : 0, fb = odenmis(b.z) ? 1 : 0;
    return fa !== fb ? fa - fb : a.i - b.i;
  });
  return arr.map(function(x){ return x.z; });
}

/* Yardımcı: yaklaşık eşleşme (taksit sayısı tahmini) */
function approxInstallments(paidAmount, instAmount){
  if (!instAmount) return 1;
  const k = Math.round(paidAmount / instAmount);
  return Math.max(1, k);
}

/* Zee ID yakalama: not metninde YK#... varsa */
function extractZeeIdFromNote(note){
  if(!note) return '';
  const m = String(note).match(/YK#\d+(?:\.\d+)?/i);
  return m ? m[0].toUpperCase() : '';
}

/* USD tutarı nottan yakalama: $ 12,345.67 gibi */
function extractUSDFromNote(note){
  if(!note) return 0;
  const m = String(note).match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return 0;
  const s = m[1].replace(/,/g,'');
  const v = Number(s);
  return isNaN(v) ? 0 : v;
}

/* TRY↔USD yardımcıları (mevcut koddaki oranları kullanır) */
function tryPerUsd(){
  // varsa localStorage tpu, yoksa KPI’dan türetilen
  const tpu = Number(localStorage.getItem('popdog_fx_try_per_usd') || '0');
  if (tpu>0) return tpu;
  const derived = deriveTryPerUsdFromKPI();
  return derived || 0;
}
function renderLoansBlock(){
  try{
    const st = (typeof getLoansState === 'function') ? getLoansState() : (window.defaultLoansState || {});
    const loans = st.loans || {};

    function applyLoan(prefix, loan){
      if (!loan) return;
      const total = Number(loan.total || 0);
      const paid  = Number(loan.paid  || 0);
      const inst  = Number(loan.instTRY || 0);
      const remain= Number(loan.remainTRY || 0);
      const princ = Number(loan.principalTRY || 0);
      const rate  = loan.monthlyRate;

      const id = (s)=> document.getElementById(prefix + s);

      const badge = id('PaidBadge');
      if (badge) badge.textContent = `${paid}/${total}`;

      const remainEl = id('Remain');
      if (remainEl) {
        const calcRemain = remain > 0 ? remain : Math.max(0, (total - paid) * inst);
        remainEl.textContent = numberTL(calcRemain);
      }

      const instEl = id('Inst');
      if (instEl) instEl.textContent = numberTL(inst);

      const princEl = id('Principal');
      if (princEl) {
        const calcPrinc = princ > 0 ? princ : inst * total;
        princEl.textContent = numberTL(calcPrinc);
      }

      const rateEl = id('Rate');
      if (rateEl) {
        if (rate != null && rate !== '' && !isNaN(Number(rate)) && Number(rate) > 0) {
          rateEl.textContent = `${Number(rate).toFixed(3)}%`;
        } else {
          rateEl.textContent = '–';
        }
      }

      /* Sonraki ödeme tarihi: ilk taksit + ödenen taksit sayısı kadar ay.
         firstPaymentDate tanımlı olmayan kredilerde alan gizli kalır. */
      const nextEl = id('Next');
      if (nextEl){
        const ilk = loan && loan.firstPaymentDate ? new Date(loan.firstPaymentDate) : null;
        if (ilk && !isNaN(+ilk) && paid < total){
          const d = new Date(ilk.getFullYear(), ilk.getMonth() + paid, ilk.getDate());
          nextEl.textContent = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
          if (nextEl.parentElement) nextEl.parentElement.style.display = '';
        } else if (nextEl.parentElement) {
          nextEl.parentElement.style.display = 'none';
        }
      }

      const bar = id('Bar');
      if (bar){
        const pct = total > 0 ? Math.max(0, Math.min(100, (paid / total) * 100)) : 0;
        bar.style.width = `${pct.toFixed(1)}%`;
      }
    }

    // Krediler
    applyLoan('loanBiz',     loans.biz);
    applyLoan('loanCar',     loans.car);
    applyLoan('loanBiz2',    loans.biz2);
    applyLoan('loanGaranti', loans.garanti);

    // Zee.Dog Bekleyen Ödemeler tablosu
    const tbody = document.getElementById('tblZeeAwait');
    if (tbody){
      const fx = (typeof getTryPerUsd === 'function') ? getTryPerUsd() : 0;
      const list = Array.isArray(st.zeeAwaitUSD) && st.zeeAwaitUSD.length ? st.zeeAwaitUSD : (DEFAULT_ZEE_AWAIT || []);

      if (!list.length){
        tbody.innerHTML = '<tr><td class="hint py-2" colspan="5">Kayıt bulunamadı.</td></tr>';
      } else {
        const sirali = zeeSirala(list);
        const rows = sirali.map(it => {
          const anaKalem = zeeAnaKalemMi(it.id, list);
          const totalUsd = Number(it.usd || 0);
          const paidUsd = Number(it.paidUsd || 0);
          const remainingUsd = Number(it.remainingUsd ?? totalUsd);
          const status = (it.status || '').toLowerCase();

          // Badge stil ve metni
          let badgeCls = 'badge-wait';
          let badgeText = 'Bekliyor';
          if (status === 'paid') {
            badgeCls = 'badge-paid';
            badgeText = 'Ödendi';
          } else if (status === 'partially_paid') {
            badgeCls = 'badge-partial';
            badgeText = 'Kısmi Ödendi';
          }
          if (anaKalem && status !== 'paid') {
            // Alt kalemlere bölündü; toplama girmiyor.
            badgeCls = 'badge-wait';
            badgeText = 'Alt kalemlere bölündü';
          }

          return `
            <tr${anaKalem ? ' style="opacity:.62"' : ''}>
              <td class="py-1 pr-3">${it.id || ''}</td>
              <td class="py-1 pr-3 text-right">${totalUsd > 0 ? numberUSD(totalUsd) : '–'}</td>
              <td class="py-1 pr-3 text-right">${paidUsd > 0 ? numberUSD(paidUsd) : '–'}</td>
              <td class="py-1 pr-3 text-right">${remainingUsd > 0 ? numberUSD(remainingUsd) : '–'}</td>
              <td class="py-1 pr-0">
                <span class="${badgeCls}">${badgeText}</span>
              </td>
            </tr>`;
        }).join('');
        tbody.innerHTML = rows;
      }
    }
  }catch(e){
    console.warn('renderLoansBlock() error:', e);
  }
}

 

  window.renderLoansBlock = renderLoansBlock;

  // Zee listesi
  const tbody = document.getElementById('tblZeeAwait');
  const st = (typeof getLoansState === 'function') ? getLoansState() : defaultLoansState;

  const k = tryPerUsd();
  tbody.innerHTML = st.zeeAwaitUSD.map(z=>{
    const tryEq = k ? numberTL(z.usd * k) : '–';
    const badge = z.paid ? '<span class="badge-paid">paid</span>' : '<span class="badge-wait">waiting</span>';
    return `
      <tr>
        <td class="py-1 pr-3">${z.id}</td>
        <td class="py-1 pr-3 text-right">$ ${z.usd.toLocaleString('en-US',{maximumFractionDigits:2})}</td>
        <td class="py-1 pr-3 text-right">${tryEq}</td>
        <td class="py-1 pr-0">${badge}</td>
      </tr>
    `;
  }).join('');

  // Altın
  const gInput = document.getElementById('goldGramInput');
  if (gInput){
    if (!gInput.value && st.demoBank.gramTRY){ gInput.value = String(st.demoBank.gramTRY); }

    const applyGoldInput = ()=>{
      const v = parseTL(gInput.value);
      const s = getLoansState();
      s.demoBank.gramTRY = v;
      setLoansState(s);
      try{
        localStorage.setItem('popdog_gold_gram_try', String(v));
        localStorage.setItem('popdog_gold_updated_at', String(Date.now()));
      }catch(_){}
      renderLoansBlock();
    };

    // Değer değişip input'tan çıkıldığında çalışsın
    gInput.addEventListener('change', applyGoldInput);

    // Enter'a basınca da aynı işlemi yap
    gInput.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Enter'){
        ev.preventDefault();
        applyGoldInput();
        try{ gInput.blur(); }catch(_){}
      }
    });
  }
  const gramPrice = st.demoBank.gramTRY || Number(localStorage.getItem('popdog_gold_gram_try')||0) || 0;
  const goldTotal = gramPrice ? gramPrice * st.demoBank.goldGram : 0;
  document.getElementById('goldTotal').textContent = goldTotal ? numberTL(goldTotal) : '–';
  {
    const GOLD_UPDATED_AT_KEY = 'popdog_gold_updated_at';
    const ts = Number(localStorage.getItem(GOLD_UPDATED_AT_KEY) || 0);
    const when = ts ? new Date(ts).toLocaleString('tr-TR') : '';
    const suffix = when ? ` • Güncellendi: ${when}` : '';
    document.getElementById('goldNote').textContent = gramPrice
      ? `Hesap: ${st.demoBank.goldGram} gr × ${numberTL(gramPrice)}${suffix}`
      : 'Gram fiyatı girin';
  }
// FI5 (QNB Portföy Para Piyasası) — birim fiyat × adet
const fInput = document.getElementById('fi5UnitInput');
if (fInput){
  if (!fInput.value && st.demoBank.fi5UnitTRY){ fInput.value = String(st.demoBank.fi5UnitTRY); }

  const applyFi5Input = ()=>{
    const v = parseTL(fInput.value);
    const s = getLoansState();
    s.demoBank.fi5UnitTRY = v;
    setLoansState(s);
    localStorage.setItem('popdog_fi5_unit_try', String(v));
    localStorage.setItem('popdog_fi5_updated_at', String(Date.now()));
    renderLoansBlock();
  };

  fInput.addEventListener('change', applyFi5Input);
  fInput.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){
      ev.preventDefault();
      applyFi5Input();
      try{ fInput.blur(); }catch(_){}
    }
  });
}

// === FI5 total (robust parse + sanity cap) ===
const fi5Inp = document.getElementById('fi5UnitInput');
let fi5Unit = fi5Inp ? parseTL(fi5Inp.value) : 0;
if (!(fi5Unit > 0 && fi5Unit < 2000)) {
  fi5Unit = 0; // kirli/zehirli değeri yok say
}
// adet güvenli: state’ten al, yoksa 565
const fi5Qty = (st && st.demoBank && Number(st.demoBank.fi5Units)) || 565;

const fi5TotalVal = fi5Unit * fi5Qty;
const fi5TotalEl = document.getElementById('fi5Total');
if (fi5TotalEl) fi5TotalEl.textContent = fi5TotalVal ? numberTL(fi5TotalVal) : '–';

{
  const ts = Number(localStorage.getItem('popdog_fi5_updated_at') || 0);
  const when = ts ? new Date(ts).toLocaleString('tr-TR') : '';
  const suffix = when ? ` • Güncellendi: ${when}` : '';
  const noteEl = document.getElementById('fi5Note');
  if (noteEl) noteEl.textContent = fi5Unit
    ? `Hesap: ${fi5Qty} adet × ${numberTL(fi5Unit)}${suffix}`
    : 'Birim fiyat girin';
}
// Remove old FI5 total block if present
// (no action needed if not present)
  // SAS Fonu
const sasInput = document.getElementById('sasUnitInput');
if (sasInput){
  if (!sasInput.value && st.demoBank.sasUnitTRY){ sasInput.value = String(st.demoBank.sasUnitTRY); }
  sasInput.onchange = ()=>{
    const v = parseTL(sasInput.value);
    const s = getLoansState();
    s.demoBank.sasUnitTRY = v;
    setLoansState(s);
    localStorage.setItem('popdog_sas_unit_try', String(v));
    localStorage.setItem('popdog_sas_updated_at', String(Date.now()));
    renderLoansBlock();
  };
}
const sasUnit = st.demoBank.sasUnitTRY || Number(localStorage.getItem('popdog_sas_unit_try')||0) || 0;
const sasQty  = st.demoBank.sasUnits || 114236;
const sasSum  = sasUnit ? (sasUnit * sasQty) : 0;
const sasTotalEl = document.getElementById('sasTotal');
if (sasTotalEl) sasTotalEl.textContent = sasSum ? numberTL(sasSum) : '–';
{
  const ts = Number(localStorage.getItem('popdog_sas_updated_at') || 0);
  const when = ts ? new Date(ts).toLocaleString('tr-TR') : '';
  const suffix = when ? ` • Güncellendi: ${when}` : '';
  const noteEl = document.getElementById('sasNote');
  if (noteEl) noteEl.textContent = sasUnit
    ? `Hesap: ${sasQty} adet × ${numberTL(sasUnit)}${suffix}`
    : 'Birim fiyat girin';
}

// İŞY Fonu
const isyInput = document.getElementById('isyUnitInput');
if (isyInput){
  if (!isyInput.value && st.demoBank.isyUnitTRY){ isyInput.value = String(st.demoBank.isyUnitTRY); }
  isyInput.onchange = ()=>{
    const v = parseTL(isyInput.value);
    const s = getLoansState();
    s.demoBank.isyUnitTRY = v;
    setLoansState(s);
    localStorage.setItem('popdog_isy_unit_try', String(v));
    localStorage.setItem('popdog_isy_updated_at', String(Date.now()));
    renderLoansBlock();
  };
}
const isyUnit = st.demoBank.isyUnitTRY || Number(localStorage.getItem('popdog_isy_unit_try')||0) || 0;
const isyQty  = st.demoBank.isyUnits || 2530000;
const isySum  = isyUnit ? (isyUnit * isyQty) : 0;
const isyTotalEl = document.getElementById('isyTotal');
if (isyTotalEl) isyTotalEl.textContent = isySum ? numberTL(isySum) : '–';
{
  const ts = Number(localStorage.getItem('popdog_isy_updated_at') || 0);
  const when = ts ? new Date(ts).toLocaleString('tr-TR') : '';
  const suffix = when ? ` • Güncellendi: ${when}` : '';
  const noteEl = document.getElementById('isyNote');
  if (noteEl) noteEl.textContent = isyUnit
    ? `Hesap: ${isyQty} adet × ${numberTL(isyUnit)}${suffix}`
    : 'Birim fiyat girin';
}


/* === Otomatik güncelleme: gider eklendiğinde çağırılacak ===
   - subcat "Taksitli Ticari Kredi" → loans.biz
   - subcat "Taksitli Araç Kredisi" → loans.car
   - Zee.Dog ödemesi (not veya kategori) → eşleşen YK# id “paid”
*/
function applyExpenseToLoans({ amountTRY, subcat, note }){
  const st = getLoansState();
  const s = (subcat||'').toLowerCase();

  // 1) Kredi taksitleri
  if (s.includes('araç kredi') || s.includes('arac kredi')) {
    // Araç Kredisi
    const inst = st.loans.car.instTRY || 0;
    const n = approxInstallments(amountTRY, inst);
    st.loans.car.remainTRY = Math.max(0, (st.loans.car.remainTRY || 0) - amountTRY);
    st.loans.car.paid = Math.min(st.loans.car.total, (st.loans.car.paid || 0) + n);

  } else if (s.includes('kredi 2') || s.includes('ticari kredi 2')) {
    // 2. Ticari Kredi (loanBiz2)
    const inst = st.loans.biz2.instTRY || 0;
    const n = approxInstallments(amountTRY, inst);
    st.loans.biz2.remainTRY = Math.max(0, (st.loans.biz2.remainTRY || 0) - amountTRY);
    st.loans.biz2.paid = Math.min(st.loans.biz2.total, (st.loans.biz2.paid || 0) + n);

  } else if (s.includes('kredi')) {
    // 1. Ticari Kredi (loanBiz)
    const inst = st.loans.biz.instTRY || 0;
    const n = approxInstallments(amountTRY, inst);
    st.loans.biz.remainTRY = Math.max(0, (st.loans.biz.remainTRY || 0) - amountTRY);
    st.loans.biz.paid = Math.min(st.loans.biz.total, (st.loans.biz.paid || 0) + n);
  }

  // 2) Zee.Dog ödemesi: not içinde YK#xxx varsa kısmi/tam ödeme olarak işaretle
  let marked = false;
  const idFromNote = extractZeeIdFromNote(note);

  if (idFromNote){
    // ID bulundu - bu ödemeyi ekle
    st.zeeAwaitUSD.forEach(z => {
      if (z.id.toUpperCase() === idFromNote) {
        // Zee.Dog ödemeleri (YK# ID'li) varsayılan olarak USD cinsindendir
        // amountTRY parametresi yanıltıcı isimde ama Zee.Dog için USD değeridir
        const paymentUsd = amountTRY;

        // Ödenen miktarı güncelle
        z.paidUsd = Number(z.paidUsd || 0) + paymentUsd;
        z.remainingUsd = Math.max(0, Number(z.usd || 0) - z.paidUsd);

        // Durum güncelle
        if (z.remainingUsd <= 0.01) { // Tam ödendi (1 cent tolerans)
          z.status = 'paid';
          z.remainingUsd = 0;
        } else if (z.paidUsd > 0) { // Kısmi ödendi
          z.status = 'partially_paid';
        } else {
          z.status = 'waiting';
        }
        marked = true;
      }
    });
  } else {
    // ID yok - tutar eşleşmesi dene (tam ödeme varsayımı)
    // Not: Zee.Dog fonksiyonuna girildiğine göre, amountTRY aslında USD'dir
    const usdNote = extractUSDFromNote(note);
    const usdAmount = amountTRY; // Zee.Dog için varsayılan USD
    const candidates = st.zeeAwaitUSD.filter(z => z.status !== 'paid');
    const matchBy = (val)=> candidates.find(z => Math.abs(z.usd - val) <= Math.max(5, z.usd*0.02)); // ±2% veya min $5
    let hit = null;
    if (usdNote) hit = matchBy(usdNote);
    if (!hit && usdAmount) hit = matchBy(usdAmount);
    if (hit){
      hit.paidUsd = Number(hit.usd || 0);
      hit.remainingUsd = 0;
      hit.status = 'paid';
      marked = true;
    }
  }

  setLoansState(st);
  renderLoansBlock();
  return true;
}

/* === Başlat === */
(function initLoans(){
  // İlk render
  try{ if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', renderLoansBlock, { once:true }); } else { renderLoansBlock(); } }catch(_){}
})();

/* === GOLD AUTO PRICE (daily refresh) =============================== */
(function(){
  const GOLD_FETCH_URL_KEY   = 'popdog_gold_fetch_url';       // optional override URL set by you
  const GOLD_UPDATED_AT_KEY  = 'popdog_gold_updated_at';
  const GOLD_GRAM_STORAGEKEY = 'popdog_gold_gram_try';        // already used elsewhere

  // Consider price stale after 22 hours
  function isStale(ts){
    if(!ts) return true;
    const ageMs = Date.now() - Number(ts);
    return !(ageMs > 0) || ageMs > 22*60*60*1000;
  }


  // Source #0: Optional custom endpoint you can define in localStorage
  async function fetchFromCustom(){
    const u = localStorage.getItem(GOLD_FETCH_URL_KEY) || '';
    if(!u) throw new Error('no custom');
    const r = await fetch(u, { cache:'no-store' });
    if(!r.ok) throw new Error('custom http '+r.status);
    const j = await r.json();
    // Accept a few shapes: {priceTRY}, {gramTRY}, {sell}, {Satış}
    const s = (j.priceTRY ?? j.gramTRY ?? j.sell ?? j.selling ?? j['Satış'] ?? j.price ?? '').toString().replace('.', '').replace(',', '.');
    const v = Number(s);
    if(!v || isNaN(v)) throw new Error('custom parse');
    return v;
  }

  async function tryFetch(){
    try{
      // If a custom endpoint is defined in localStorage, use it as the only automated source.
      const v = await fetchFromCustom();
      if (v && !isNaN(v)) return v;
      throw new Error('custom source invalid');
    }catch(e){
      // No automatic external fallbacks anymore: user can always type the gram price manually.
      throw new Error('Gold auto source failed (custom endpoint only).');
    }
  }

  async function updateGold(force=false){
    try{
      // If user just typed a price, do not override immediately unless force=true.
      const ts = Number(localStorage.getItem(GOLD_UPDATED_AT_KEY) || 0);
      if(!force && !isStale(ts)) return; // still fresh

      const price = await tryFetch();
      if(!price || isNaN(price)) return;

      // Persist
      localStorage.setItem(GOLD_GRAM_STORAGEKEY, String(price));
      localStorage.setItem(GOLD_UPDATED_AT_KEY, String(Date.now()));

      // Also sync Loans state if it exists
      try{
        const s = getLoansState();
        if(s && s.demoBank){ s.demoBank.gramTRY = price; setLoansState(s); }
      }catch(_){ /* ignore */ }

      // Reflect in input instantly
      const gInput = document.getElementById('goldGramInput');
      if(gInput){ gInput.value = String(price); }
      // Re-render card
      try{ renderLoansBlock(); }catch(_){}
    }catch(err){
      // Silent failure is okay; user can still type manually.
      // console.debug('Gold auto price update skipped:', err && err.message ? err.message : err);
    }
  }

  // Kick on load and then every 6 hours
  try{
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', ()=>{ updateGold(false); setInterval(updateGold, 6*60*60*1000); }, { once:true });
    } else {
      updateGold(false);
      setInterval(updateGold, 6*60*60*1000);
    }
  }catch(_){ /* ignore */ }

  // Expose a small manual refresh for debugging
  window.refreshGoldNow = ()=> updateGold(true);
})();

/* ================== INVENTORY & ORDERS HELPERS ================== */
const SALES_WINDOW_OPTIONS = [30,90,120,180];
let salesWindowDays = Number(localStorage.getItem('popdog_sales_window_days') || '90');
if (!SALES_WINDOW_OPTIONS.includes(salesWindowDays)) salesWindowDays = 90;
function initSalesWindowSelector(){
  const sel = document.getElementById('salesWindowSelect');
  if(!sel) return;
  // Set current value
  sel.value = String(salesWindowDays);
  sel.onchange = () => {
    const v = Number(sel.value);
    if(!SALES_WINDOW_OPTIONS.includes(v)) return;
    salesWindowDays = v;
    localStorage.setItem('popdog_sales_window_days', String(v));
    renderStockBlock();
  };
}
/* SKU -> marka haritası (bot günlük olarak KV'ye yazıyor).
   Stok sayfasındaki kategori kartı bunu kullanıyor. Bir kez çekilir,
   geldiğinde stok bloğu zaten çizilmişse yeniden çizilir; gelmezse kart
   eski başlık tahminiyle çalışmaya devam eder. */
window.__skuVendors = null;
let _vendorYukleniyor = false;
function loadSkuVendors(){
  if (window.__skuVendors || _vendorYukleniyor) return;
  _vendorYukleniyor = true;
  fetch('/api/sku_vendors?_=' + Date.now(), { cache:'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.vendors || !Object.keys(d.vendors).length) {
        console.warn('[stok] marka haritası boş — kategori kartı başlık tahminine düşüyor');
        return;
      }
      window.__skuVendors = d;
      const blok = document.getElementById('stockBlock');
      if (blok && blok.textContent.trim().length > 200) {
        try { renderStockBlock(); } catch(e){ console.warn('[stok] yeniden çizim hatası', e); }
      }
    })
    .catch(e => console.warn('[stok] marka haritası alınamadı', e && e.message))
    .finally(() => { _vendorYukleniyor = false; });
}

/* ============================================================
   ZEE.DOG ODAĞI

   Stok sayfası yalnızca Zee.Dog ürünlerini gösterir. Diğer markalar
   (POPDOG 147 satır, Paw Max 9, Unleash 2, Cansei De Ser Gato 1)
   toplam 29 adet ve ₺21 bin — ama dead stock / en az satan gibi
   listeleri doldurup gerçek Zee.Dog sinyalini bastırıyorlardı.

   Marka kararı:
     1) SKU marka haritasında varsa (bot günlük yazıyor) harita karar verir.
     2) Haritada yoksa (Shopify'dan silinmiş eski ürün) başlığa bakılır.
   Sadece başlığa bakmak yetmiyor: 86 gerçek Zee.Dog satırının başlığında
   "zee" geçmiyor ("Bali | Papyon", "Area 51 | Kedi Tasması"...).
   Harita henüz gelmediyse başlık tahminine düşer, harita gelince
   loadSkuVendors bloğu yeniden çizer.
   ============================================================ */

function zeeFiltresiKur(hamInvRows){
  const harita = (window.__skuVendors && window.__skuVendors.vendors) || null;
  const basliklar = new Map();
  (hamInvRows || []).forEach(r => {
    const sku = String(r['SKU'] || '').trim();
    if (sku && !basliklar.has(sku)) basliklar.set(sku, r['Title'] || '');
  });

  const zeeMi = (sku, title) => {
    const s = String(sku || '').trim();
    const marka = (harita && s) ? harita[s] : null;
    if (marka) return String(marka).toLowerCase().includes('zee');
    return String(title || '').toLowerCase().includes('zee');
  };

  return {
    haritaVar: !!harita,
    satirZee: (r) => zeeMi(r && r['SKU'], r && r['Title']),
    // Siparişte başlık yok; stok kaydından bakılır. Hiç eşleşmeyen SKU
    // (ör. boş SKU'lu kargo/kuaför satırları) Zee.Dog sayılmaz.
    skuZee:   (sku) => { const s = String(sku || '').trim(); return s ? zeeMi(s, basliklar.get(s) || '') : false; },
  };
}

/* Zee.Dog ürün tipi — başlıktan çıkarılır. İlk eşleşen kural kazanır,
   sıra önemli ("Kedi Tasması" tasma değil kedi ürünü sayılsın diye
   kedi kuralı tasma kurallarından sonra değil, önce gelmemeli). */
const ZEE_URUN_TIPLERI = [
  ['Göğüs Tasması',    ['göğüs tasma','gogus tasma','flyharness','harness','h tipi','softer walk']],
  ['Gezdirme Tasması', ['gezdirme','ruff','leash','uzatmal','zee.run','zee run']],
  ['Boyun Tasması',    ['boyun tasma','klasik köpek tasma','ayarlanabilir köpek tasma','şok emici köpek tasma','eller serbest']],
  ['Kedi Ürünleri',    ['kedi','zee.cat','zee cat','cansei','cdsg','gato']],
  ['Oyuncak',          ['oyunca','super veggiez','super fruitz','super ','çiğneme','diş kaşıma','ödül','frisbee']],
  ['Yatak & Mat',      ['yatak','bed','air.mat','air mat','battaniye','havlu']],
  ['Hijyen',           ['dışkı','torba','kum ','çiş','pad']],
  ['Kıyafet',          ['mont','kıyafet','tişört','sweat','yağmurluk','coat','şapka']],
  ['Mama & Su Kabı',   ['mama','su kab','su kase','kase','matara','bowl']],
  ['Papyon & Bandana', ['papyon','bandana']],
  ['Aksesuar',         ['pinz','anahtarlık','çanta','taşıma','sırt','bag','kılıf','cüzdan','rozet']],
];

function zeeUrunTipi(title){
  const t = String(title || '').toLowerCase();
  for (const [ad, kelimeler] of ZEE_URUN_TIPLERI){
    for (const k of kelimeler){ if (t.includes(k)) return ad; }
  }
  return 'Diğer';
}

/* Sayfanın "sadece Zee.Dog" olduğunu ve kaç satırın dışarıda kaldığını
   görünür kılar. Sessiz filtre kötü filtredir: rakam neden değişti
   sorusunun cevabı ekranda dursun. */
function yazZeeRozet(hamRows, zeeRows, zeeF){
  const el = document.getElementById('stockZeeRozet');
  if (!el) return;
  const disarida = (hamRows || []).length - (zeeRows || []).length;
  let metin = 'Sadece Zee.Dog';
  if (disarida > 0) metin += ' · ' + disarida + ' diğer marka satırı hariç';
  if (!zeeF.haritaVar) metin += ' · marka haritası bekleniyor';
  el.textContent = metin;
  el.title = zeeF.haritaVar
    ? "Marka bilgisi Shopify'den geliyor (bot her gün 04:00'te günceller).\n"
      + 'Bu sayfadaki tüm KPI, tablo, grafik ve CSV export yalnızca Zee.Dog ürünlerini kapsar.'
    : 'Marka haritası henüz yüklenmedi; geçici olarak ürün başlığına göre ayıklanıyor. '
      + 'Harita gelince sayfa kendini yeniler.';
}

/* inventory_value toplam özet */
function summarizeInventoryValue(rows){
  // başlık varyasyonlarını tolere et
  let valCost = 0, valPrice = 0;
  for(const r of rows || []){
    const costRaw  = r['Value@Cost']  ?? r['Value @Cost']  ?? r['CostValue']   ?? r['Value_Cost']  ?? 0;
    const priceRaw = r['Value@Price'] ?? r['Value @Price'] ?? r['SalesValue']  ?? r['Value_Price'] ?? 0;
    valCost  += parseTL(costRaw);
    valPrice += parseTL(priceRaw);
  }
  return { valCost, valPrice };
}

// Shopify "Created at" tarihlerini sağlam parse et
function parseShopifyDate(s){
  if(!s) return null;
  let t = String(s).trim();

  // "2025-09-07 12:34:56 +0300" → "+03:00" biçimine çevir
  if(/\s\+\d{4}$/.test(t)){
    t = t.replace(/\s\+(\d{2})(\d{2})$/, (m,h,mn)=> `+${h}:${mn}`);
  }
  // "... UTC" → Z
  if(/\sUTC$/i.test(t)){ t = t.replace(/\sUTC$/i,'Z'); }

  // "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss"
  if(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(t)){
    t = t.replace(' ', 'T');
  }

  // dd/mm/yyyy veya dd.mm.yyyy gibi olursa
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if(m){
    let dd=+m[1], mm=+m[2], yy=+m[3]; if(yy<100) yy+=2000;
    t = `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T00:00:00Z`;
  }

  const d = new Date(t);
  return isNaN(+d) ? null : d;
}

// localStorage→orders okurken tarihleri Date'e yeniden çevir
function getOrdersCache(){
  const raw = JSON.parse(localStorage.getItem('popdog_orders_cache') || '[]');
  return raw.map(o => ({
    sku: (o.sku||'').trim(),
    qty: Number(o.qty)||0,
    price: parseTL(o.price||0),
    date: o.date ? new Date(o.date) : null,  // <- rehydrate
    channel: o.channel || 'Online'           // <- kanal bilgisi
  })).filter(o => (o.sku || o.channel === 'Kuaför') && o.qty>0 && o.date && !isNaN(+o.date));
}

/**
 * Kanal Bazlı Satış Hesaplama (Shopify Orders)
 * Orders CSV verisinden kanal bazlı satış toplamlarını hesaplar
 * Kanal tespiti: Tags (Hepsiburada/Trendyol) + Delivery Method (CKM/Online)
 * @param {Object} options - {period: 'all'|'month'|'week'|'ytd'}
 * @returns {Object} {channels: {CKM: {amountTRY, usd, qty}, ...}, total: {amountTRY, usd, qty}}
 */
function buildChannelSalesFromOrders(options = {}){
  const orders = getOrdersCache();
  const now = new Date();
  let startDate = null;

  // Dönem hesaplama
  if (options.period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (options.period === 'week') {
    const dayOfWeek = now.getDay() || 7;
    startDate = new Date(now);
    startDate.setDate(now.getDate() - dayOfWeek + 1);
    startDate.setHours(0,0,0,0);
  } else if (options.period === 'ytd') {
    startDate = new Date(now.getFullYear(), 0, 1);
  }
  // 'all' için startDate = null (tüm veriler)

  // Kanal bazlı toplam
  const channels = {};
  let totalTRY = 0;
  let totalQty = 0;

  orders.forEach(o => {
    if (!o.date) return;
    if (startDate && o.date < startDate) return;

    const ch = o.channel || 'Online';
    if (!channels[ch]) {
      channels[ch] = { amountTRY: 0, qty: 0 };
    }

    const revenue = (o.price || 0) * (o.qty || 0);
    channels[ch].amountTRY += revenue;
    channels[ch].qty += o.qty || 0;
    totalTRY += revenue;
    totalQty += o.qty || 0;
  });

  // USD çevirimi (kur varsa)
  const rate = fxRateUSDPerTRY || 0;
  Object.values(channels).forEach(ch => {
    ch.usd = rate ? ch.amountTRY * rate : 0;
  });

  return {
    channels,
    total: {
      amountTRY: totalTRY,
      usd: rate ? totalTRY * rate : 0,
      qty: totalQty
    },
    period: options.period || 'ytd'
  };
}

/* stok listesi içinden (₺ satış değeri bazlı) top N */
function topStockSKUs(rows, n=10){
  const arr = (rows||[]).map(r=>({
    sku: String(r['SKU']||'').trim(),
    title: r['Title'] || '',
    units: parseTL(r['TotalUnits'] || r['On hand total'] || 0),
    unitCost: parseTL(r['UnitCost'] || 0),
    unitPrice: parseTL(r['UnitPrice'] || 0),
    valueCost: parseTL(r['Value@Cost'] || r['Value @Cost'] || 0),
    valuePrice: parseTL(r['Value@Price']|| r['Value @Price']|| 0),
  }));
  return arr.filter(x=>x.sku && x.units>0)
            .sort((a,b)=> b.valuePrice - a.valuePrice)
            .slice(0,n);
}

/* Shopify orders + orders_clean (buildAll) uyumlu mapper */
function mapOrderRow(r){
  // SKU alias'ları: Shopify (Lineitem sku / SKU / Variant SKU) + orders_clean (sku)
  const sku = (r['Lineitem sku'] || r['SKU'] || r['Variant SKU'] || r['sku'] || '').toString().trim();

  // Qty alias'ları: Shopify (Lineitem quantity / Quantity / Qty) + orders_clean (qty)
  const qty = parseInt(r['Lineitem quantity'] || r['Quantity'] || r['Qty'] || r['qty'] || 0, 10) || 0;

  // Price (opsiyonel) – gerekirse; orders_clean'de 'price'
  const price = parseTL(r['Lineitem price'] || r['Price'] || r['price'] || 0);

  // Tarih: Shopify (Created at / …) + orders_clean (date)
  const rawDate = r['Created at'] || r['Created At'] || r['Created at (UTC)'] || r['Processed at'] || r['Paid at'] || r['Fulfilled at'] || r['date'] || '';
  const date = parseShopifyDate(rawDate);

  // Kanal tespiti: Tags, Source (POS vs Web), Delivery Method
  const tags = (r['Tags'] || r['tags'] || r['Tag'] || r['tag'] || '').toString().toLowerCase();
  const source = (r['Source'] || r['source'] || r['source_name'] || '').toString().toLowerCase();
  const deliveryMethod = (r['Delivery Method'] || r['delivery_method'] || r['Shipping Method'] || '').toString().toLowerCase();

  let channel = 'Online'; // varsayılan

  // 1) Tags'ten marketplace/B2B/Grooming tespiti
  if (tags.includes('hepsiburada')) {
    channel = 'Hepsiburada';
  } else if (tags.includes('trendyol')) {
    channel = 'Trendyol';
  } else if (tags.includes('b2b') || tags.includes('toptan')) {
    channel = 'Toptan';
  } else if (tags.includes('grooming') || tags.includes('kuaför') || tags.includes('kuafor') || tags.includes('groom') || tags.includes('groomin')) {
    channel = 'Kuaför';
  }
  // 2) Source'dan POS (mağaza) tespiti
  else if (source === 'pos' || source.includes('pos')) {
    channel = 'CKM';
  }
  // 3) Delivery Method'dan tespit
  else if (deliveryMethod.includes('in store') || deliveryMethod.includes('instore') || deliveryMethod.includes('pickup') || deliveryMethod.includes('gel al')) {
    channel = 'CKM';
  }
  // 4) Diğer = Online
  else {
    channel = 'Online';
  }

  // Eğer önceden channel kaydedilmişse (cache'den) onu kullan
  if (r.channel) {
    channel = r.channel;
  }

  return { sku, qty, price, date, channel };
}

/**
 * Gerçek COGS Hesaplama
 * Satılan ürünlerin SKU bazlı maliyetlerini envanter verisinden alır
 * @param {Array} orderRows - Sipariş verileri [{sku, qty, price, date, channel}]
 * @param {Array} inventoryRows - Envanter verileri [{SKU, Cost, ...}]
 * @param {Object} options - {startDate, endDate, channel} filtreleme
 * @returns {Object} {totalCOGS, totalRevenue, byChannel: {channel: {cogs, revenue, qty}}, bySKU: {...}}
 */
function calculateRealCOGS(orderRows, inventoryRows, options = {}) {
  const { startDate, endDate, channel: filterChannel } = options;

  // Envanter'den SKU → birim maliyet map'i oluştur
  const skuCostMap = {};
  const skuPriceMap = {};
  (inventoryRows || []).forEach(inv => {
    const sku = (inv['SKU'] || inv['sku'] || inv['Variant SKU'] || '').toString().trim();
    if (!sku) return;

    // Birim maliyet (Cost / Units veya doğrudan Unit Cost)
    const unitCost = parseTL(inv['Unit Cost'] || inv['unit_cost'] || inv['UnitCost'] || 0);
    const totalCost = parseTL(inv['Value@Cost'] || inv['Value @Cost'] || inv['CostValue'] || 0);
    const units = parseInt(inv['Units'] || inv['units'] || inv['Qty'] || inv['qty'] || 1, 10) || 1;

    // Birim maliyet hesapla
    if (unitCost > 0) {
      skuCostMap[sku] = unitCost;
    } else if (totalCost > 0 && units > 0) {
      skuCostMap[sku] = totalCost / units;
    }

    // Birim satış fiyatı
    const unitPrice = parseTL(inv['Unit Price'] || inv['unit_price'] || inv['Price'] || 0);
    const totalPrice = parseTL(inv['Value@Price'] || inv['Value @Price'] || inv['SalesValue'] || 0);
    if (unitPrice > 0) {
      skuPriceMap[sku] = unitPrice;
    } else if (totalPrice > 0 && units > 0) {
      skuPriceMap[sku] = totalPrice / units;
    }
  });

  // Sonuç objesi
  const result = {
    totalCOGS: 0,
    totalRevenue: 0,
    totalQty: 0,
    byChannel: {},
    bySKU: {},
    unmatchedSKUs: [], // Envanter'de bulunamayan SKU'lar
    matchRate: 0
  };

  let matchedOrders = 0;
  let totalOrders = 0;

  // Siparişleri işle
  (orderRows || []).forEach(order => {
    if (!order || !order.sku || !order.qty) return;

    // Tarih filtresi
    const orderDate = order.date instanceof Date ? order.date : new Date(order.date);
    if (startDate && orderDate < startDate) return;
    if (endDate && orderDate > endDate) return;

    // Kanal filtresi
    const orderChannel = order.channel || 'Online';
    if (filterChannel && orderChannel !== filterChannel) return;

    totalOrders++;

    const sku = order.sku;
    const qty = order.qty;
    const salePrice = order.price || 0;

    // SKU'nun maliyetini bul
    const unitCost = skuCostMap[sku] || 0;
    const lineCOGS = unitCost * qty;
    const lineRevenue = salePrice * qty;

    if (unitCost > 0) {
      matchedOrders++;
    } else {
      if (!result.unmatchedSKUs.includes(sku)) {
        result.unmatchedSKUs.push(sku);
      }
    }

    // Toplam
    result.totalCOGS += lineCOGS;
    result.totalRevenue += lineRevenue;
    result.totalQty += qty;

    // Kanal bazlı
    if (!result.byChannel[orderChannel]) {
      result.byChannel[orderChannel] = { cogs: 0, revenue: 0, qty: 0 };
    }
    result.byChannel[orderChannel].cogs += lineCOGS;
    result.byChannel[orderChannel].revenue += lineRevenue;
    result.byChannel[orderChannel].qty += qty;

    // SKU bazlı
    if (!result.bySKU[sku]) {
      result.bySKU[sku] = { cogs: 0, revenue: 0, qty: 0, unitCost };
    }
    result.bySKU[sku].cogs += lineCOGS;
    result.bySKU[sku].revenue += lineRevenue;
    result.bySKU[sku].qty += qty;
  });

  // Eşleşme oranı
  result.matchRate = totalOrders > 0 ? (matchedOrders / totalOrders) * 100 : 0;

  return result;
}

// Global erişim için
window.calculateRealCOGS = calculateRealCOGS;

/* stok yaşlandırma (son satışa göre gün farkı) */
function stockAging(inventoryRows, orderRows){
  const today = new Date();
  const lastSaleMap = {};
  (orderRows||[]).forEach(o=>{
    if(!o || !o.sku || !o.date) return;
    if(!lastSaleMap[o.sku] || o.date > lastSaleMap[o.sku]) lastSaleMap[o.sku] = o.date;
  });

  const buckets = { '0-30':0, '31-60':0, '61-90':0, '90+':0 };
  const bucketsVal = { '0-30':0, '31-60':0, '61-90':0, '90+':0 };
  const ages = [];

  (inventoryRows||[]).forEach(r=>{
    const sku = String(r['SKU']||'').trim();
    const units = parseTL(r['TotalUnits']||0);
    const valCost = parseTL(r['Value@Cost']||r['Value @Cost']||0);
    if(!sku || units<=0) return;
    const last = lastSaleMap[sku];
    const diff = last ? Math.floor((today-last)/(1000*60*60*24)) : 9999; // hiç satmamışsa 9999
    ages.push(diff);

    let bucket = '90+';
    if(diff<=30) bucket='0-30';
    else if(diff<=60) bucket='31-60';
    else if(diff<=90) bucket='61-90';
    buckets[bucket]+=units;
    bucketsVal[bucket]+=valCost;
  });

  const sorted = ages.sort((a,b)=>a-b);
  const medianAge = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
  return { buckets, bucketsVal, medianAge };
}

/* DIO: Days of Inventory = On-hand / (günlük satış ort.) */
function daysOfInventory(inventoryRows, orderRows, days=60){
  const today = new Date();
  const cutoff = new Date(today.getTime() - days*24*60*60*1000);
  let totalUnitsSold=0;
  (orderRows||[]).forEach(o=>{
    if(!o.date || isNaN(+o.date) || o.date<cutoff) return;
    totalUnitsSold += (o.qty||0);
  });
  const dailyAvg = totalUnitsSold / (days||1);
  const totalOnHand = (inventoryRows||[]).reduce((a,r)=> a + parseTL(r['TotalUnits']||0), 0);
  return dailyAvg>0 ? (totalOnHand/dailyAvg) : null;
}

/* Stok tablolarını ve KPI’ları render et */
function renderStockBlock(){
  loadSkuVendors();
  // cache’lerden oku
  const invHam    = JSON.parse(localStorage.getItem('popdog_inv_cache')   || '[]');
  const ordersHam = getOrdersCache();

  /* Bu sayfadaki her şey — KPI'lar, 9 tablo, yaşlandırma, devir hızı,
     ABC, dead stock, export — aşağıdaki iki filtrelenmiş diziden besleniyor.
     Filtre tek yerde: yeni bir liste eklendiğinde ayrıca marka kontrolü
     yazmak gerekmiyor. */
  const zeeF      = zeeFiltresiKur(invHam);
  const invRows   = invHam.filter(r => zeeF.satirZee(r));
  const ordersMap = ordersHam.filter(o => zeeF.skuZee(o.sku));
  yazZeeRozet(invHam, invRows, zeeF);

  // 1) Stok değeri KPI'ları
  const inv = summarizeInventoryValue(invRows);
  const costValTL = numberTL(inv.valCost);
  const priceValTL = numberTL(inv.valPrice);
  const costValUSD = fxRateUSDPerTRY ? `≈ ${numberUSD(inv.valCost * fxRateUSDPerTRY)} USD` : '≈ – USD';
  const priceValUSD = fxRateUSDPerTRY ? `≈ ${numberUSD(inv.valPrice * fxRateUSDPerTRY)} USD` : '≈ – USD';

  // Özet sayfasındaki kartlar
  const el1 = document.getElementById('kpiInvCost');
  const el2 = document.getElementById('kpiInvPrice');
  if(el1) el1.textContent = costValTL;
  if(el2) el2.textContent = priceValTL;

  // Stok sayfasındaki kartlar
  const el1b = document.getElementById('kpiInvCost2');
  const el2b = document.getElementById('kpiInvPrice2');
  if(el1b) el1b.textContent = costValTL;
  if(el2b) el2b.textContent = priceValTL;

  // USD equivalents (using latest fetched fxRateUSDPerTRY)
  try {
    const costUsdEl  = document.getElementById('kpiInvCost_USD');
    const priceUsdEl = document.getElementById('kpiInvPrice_USD');
    const costUsdEl2  = document.getElementById('kpiInvCost2_USD');
    const priceUsdEl2 = document.getElementById('kpiInvPrice2_USD');

    if (costUsdEl) costUsdEl.textContent = costValUSD;
    if (priceUsdEl) priceUsdEl.textContent = priceValUSD;
    if (costUsdEl2) costUsdEl2.textContent = costValUSD;
    if (priceUsdEl2) priceUsdEl2.textContent = priceValUSD;
  } catch (e) {
    // silent
  }

  // 1.c) Türetilmiş tutarlar: Maliyet +%65 (Vergi+Navlun) ve Satış KDV Hariç (−%20)
  try {
    const costPlus = inv.valCost * 1.65;           // +%65 eklendi
    const priceEx  = inv.valPrice / 1.20;          // %20 KDV çıkartıldı
    const costPlusTL = numberTL(costPlus);
    const priceExTL = numberTL(priceEx);
    const costPlusUSD = fxRateUSDPerTRY ? `≈ ${numberUSD(costPlus * fxRateUSDPerTRY)} USD` : '≈ – USD';
    const priceExUSD = fxRateUSDPerTRY ? `≈ ${numberUSD(priceEx * fxRateUSDPerTRY)} USD` : '≈ – USD';

    // Özet sayfası
    const c65El      = document.getElementById('kpiInvCost_65');
    const c65UsdEl   = document.getElementById('kpiInvCost_65_USD');
    const exVatEl    = document.getElementById('kpiInvPrice_exVAT');
    const exVatUsdEl = document.getElementById('kpiInvPrice_exVAT_USD');

    if (c65El)    c65El.textContent    = costPlusTL;
    if (exVatEl)  exVatEl.textContent  = priceExTL;
    if (c65UsdEl) c65UsdEl.textContent = costPlusUSD;
    if (exVatUsdEl) exVatUsdEl.textContent = priceExUSD;

    // Stok sayfası
    const c65El2      = document.getElementById('kpiInvCost2_65');
    const c65UsdEl2   = document.getElementById('kpiInvCost2_65_USD');
    const exVatEl2    = document.getElementById('kpiInvPrice2_exVAT');
    const exVatUsdEl2 = document.getElementById('kpiInvPrice2_exVAT_USD');

    if (c65El2)    c65El2.textContent    = costPlusTL;
    if (exVatEl2)  exVatEl2.textContent  = priceExTL;
    if (c65UsdEl2) c65UsdEl2.textContent = costPlusUSD;
    if (exVatUsdEl2) exVatUsdEl2.textContent = priceExUSD;
  } catch (e) { /* silent */ }

  // 1.b) Toplam Ürün Adedi + depo bazında dağılım (Thrones / Caddebostan)
  try {
    // toplam on-hand (SKU bazında TotalUnits)
    const totalUnitsAll = (invRows || []).reduce((acc, r) => acc + parseTL(r['TotalUnits'] || 0), 0);

    /* Konum sütunları Sheet'e Shopify location ID'si olarak geliyor
       (ör. "69595889734"), isim olarak değil. Eski kod sütun adının içinde
       "thrones"/"caddebostan" arıyordu; sayısal ID'de bu hiç eşleşmediği için
       dağılım her zaman "Thrones: 0 • Caddebostan: 0" görünüyordu.
       ID'ler Shopify locations.json'dan doğrulandı. Tanımadığı bir ID gelirse
       ham ID basılır — sessizce sıfır göstermez. */
    const KONUM_ADLARI = {
      '69595889734': 'Thrones Depo',
      '62772936774': 'Caddebostan Mağaza',
      '60925804614': 'Kanyon Mağaza',
      '43120661':    'Moda Mağaza',
      '34531737670': 'OPLOG Darıca',
      '31144575046': 'TomTom Toptan',
    };
    const konumAdi = (baslik) => {
      const ham = String(baslik || '').trim();
      if (KONUM_ADLARI[ham]) return KONUM_ADLARI[ham];
      const k = ham.toLowerCase();
      if (k.includes('thrones')) return 'Thrones Depo';
      if (k.includes('caddebostan') || k.includes('ckm') || k.includes('cadde')) return 'Caddebostan Mağaza';
      return ham;
    };

    const konumAdet = new Map();
    if (Array.isArray(invRows) && invRows.length) {
      const hdrs = Object.keys(invRows[0] || {});
      const iTitle = hdrs.indexOf('Title');
      const iTotal = hdrs.indexOf('TotalUnits');
      const locCols = (iTitle >= 0 && iTotal > iTitle) ? hdrs.slice(iTitle + 1, iTotal) : [];

      locCols.forEach(col => {
        const ad = konumAdi(col);
        const toplam = invRows.reduce((a, row) => a + parseTL(row[col] || 0), 0);
        konumAdet.set(ad, (konumAdet.get(ad) || 0) + toplam);
      });
    }

    const totalEl = document.getElementById('kpiTotalUnits');
    const noteEl  = document.getElementById('kpiTotalUnitsNote');
    if (totalEl) totalEl.textContent = `${totalUnitsAll} adet`;
    if (noteEl) {
      const parcalar = [...konumAdet.entries()]
        .filter(([, adet]) => adet > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([ad, adet]) => `${ad}: ${adet.toLocaleString('tr-TR')}`);
      noteEl.textContent = parcalar.length ? parcalar.join(' • ') : 'Konum dağılımı yok';
    }
  } catch (e) {
    console.warn('Total units KPI calc error', e);
  }

  // 2) Top 10 ₺ stok tablosu
  const top10 = topStockSKUs(invRows, 10);
  const topTbody = document.getElementById('tblTopStock');
  topTbody.innerHTML = '';
  top10.forEach(row=>{
    // son satış tarihi & yaş (gün)
    const lastDate = lastSaleDateForSKU(row.sku, ordersMap);
    const age = lastDate ? Math.floor((Date.now() - lastDate.getTime())/(1000*60*60*24)) : '—';
    const lastStr = lastDate ? lastDate.toISOString().slice(0,10) : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-2 pr-4">${row.sku}</td>
      <td class="py-2 pr-4">${row.title||''}</td>
      <td class="py-2 pr-4 text-right">${row.units}</td>
      <td class="py-2 pr-4 text-right">${numberTL(row.valueCost)}</td>
      <td class="py-2 pr-4 text-right">${lastStr}</td>
      <td class="py-2 pr-4 text-right">${age}</td>
    `;
    topTbody.appendChild(tr);
  });

  // 3) 90+ gün elde olanlar (₺ maliyet bazında en büyük 10)
  const agedList = (invRows||[]).filter(r => r != null).map(r=>{
    const sku = String(r['SKU']||'').trim();
    const units = parseTL(r['TotalUnits']||0);
    const valCost = parseTL(r['Value@Cost']||r['Value @Cost']||0);
    const last = lastSaleDateForSKU(sku, ordersMap);
    const age = last ? Math.floor((Date.now()-last.getTime())/(1000*60*60*24)) : 9999;
    return { sku, title:r['Title']||'', units, valCost, last, age };
  }).filter(x=>x.units>0 && x.age>=90)
    .sort((a,b)=> b.valCost - a.valCost)
    .slice(0,10);

  const agedTbody = document.getElementById('tblAged90');
  agedTbody.innerHTML='';
  agedList.forEach(x=>{
    const lastStr = x.last ? x.last.toISOString().slice(0,10) : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-2 pr-4">${x.sku}</td>
      <td class="py-2 pr-4">${x.title}</td>
      <td class="py-2 pr-4 text-right">${x.units}</td>
      <td class="py-2 pr-4 text-right">${numberTL(x.valCost)}</td>
      <td class="py-2 pr-4 text-right">${lastStr}</td>
      <td class="py-2 pr-4 text-right">${x.age}</td>
    `;
    agedTbody.appendChild(tr);
  });

  // 4) Yaşlandırma KPI’ları (toplam)
  const aging = stockAging(invRows, ordersMap);
  const agedQty = aging.buckets['90+'] || 0;
  const agedVal = aging.bucketsVal['90+'] || 0;
  document.getElementById('kpiAged90Qty').textContent   = `${agedQty} adet`;
  document.getElementById('kpiAged90Value').textContent = numberTL(agedVal);
  document.getElementById('kpiMedianAge').textContent   = `${aging.medianAge} gün`;

  // 5) DIO KPI (60 gün) + notlar
  const dio60 = daysOfInventory(invRows, ordersMap, 60);
  const dio30 = daysOfInventory(invRows, ordersMap, 30);
  const dio90 = daysOfInventory(invRows, ordersMap, 90);
  document.getElementById('kpiDIO60').textContent = dio60 ? `${dio60.toFixed(0)} gün` : '– gün';

  // Patch: update kpiDIOx with 30g and 90g values
  const dioxEl = document.getElementById('kpiDIOx');
  if (dioxEl) dioxEl.textContent = `30g: ${dio30?dio30.toFixed(0):'–'} • 90g: ${dio90?dio90.toFixed(0):'–'}`;

  // küçük açıklama (title attribute)
  document.getElementById('kpiDIO60').title =
    `DIO ~ On-hand / günlük satış ort.\n30g: ${dio30?dio30.toFixed(0):'–'} • 60g: ${dio60?dio60.toFixed(0):'–'} • 90g: ${dio90?dio90.toFixed(0):'–'}`;

  // 6) Satış & Devir listeleri (son SALES_WINDOW_DAYS gün)
  try {
    const cutoff = new Date(Date.now() - salesWindowDays*24*60*60*1000);
    const soldMap = new Map();   // sku -> sold qty (window)
    const lastMap = new Map();   // sku -> last sale date
    (ordersMap||[]).forEach(o=>{
      if(!o || !o.sku || !o.date) return;
      if(o.date >= cutoff){
        soldMap.set(o.sku, (soldMap.get(o.sku)||0) + (o.qty||0));
      }
      if(!lastMap.get(o.sku) || o.date > lastMap.get(o.sku)){
        lastMap.set(o.sku, o.date);
      }
    });

    // On-hand ve title map’leri
    const onHandMap = new Map();   // sku -> units
    const titleMap  = new Map();   // sku -> title
    (invRows||[]).forEach(r=>{
      const sku = String(r['SKU']||'').trim();
      if(!sku) return;
      const units = parseTL(r['TotalUnits']||r['On hand total']||r['On hand (current)']||0);
      onHandMap.set(sku, (onHandMap.get(sku)||0) + (units||0));
      const title = r['Title'] || '';
      if(title && !titleMap.has(sku)) titleMap.set(sku, title);
    });

    /* Not: eskiden burada başlıkta "zee" arayan bir isZee() vardı.
       Artık marka ayıklaması renderStockBlock'un başında, Shopify marka
       haritasıyla yapılıyor; buraya gelen invRows/ordersMap zaten
       yalnızca Zee.Dog. Başlık tahmini 86 gerçek Zee.Dog satırını
       kaçırıyordu (papyonlar, kedi tasmaları). */

    // 6.a En çok satan 5 (satış miktarına göre)
    const topSellers = Array.from(soldMap.entries())
      .map(([sku,qty])=>({sku, qty, title:titleMap.get(sku)||''}))
      .sort((a,b)=> b.qty - a.qty)
      .slice(0,5);

    const topSellersTbody = document.getElementById('tblTopSellers');
    if(topSellersTbody){
      topSellersTbody.innerHTML = topSellers.map(x=>`
        <tr><td class="py-1 pr-3">${x.sku}</td><td class="py-1 pr-3">${x.title}</td><td class="py-1 pr-3 text-right">${x.qty}</td></tr>
      `).join('') || '<tr><td class="hint py-1" colspan="3">Veri yok.</td></tr>';
    }

    // 6.b En az satan 5 (pencerede satış yapanlar arasından en az qty, stok>0)
    const leastSellers = Array.from(soldMap.entries())
      .map(([sku,qty])=>({sku, qty, title:titleMap.get(sku)||'', on:onHandMap.get(sku)||0}))
      .filter(x => x.on>0)
      .sort((a,b)=> a.qty - b.qty)
      .slice(0,5);

    const leastSellersTbody = document.getElementById('tblLeastSellers');
    if(leastSellersTbody){
      leastSellersTbody.innerHTML = leastSellers.map(x=>`
        <tr><td class="py-1 pr-3">${x.sku}</td><td class="py-1 pr-3">${x.title}</td><td class="py-1 pr-3 text-right">${x.qty}</td></tr>
      `).join('') || '<tr><td class="hint py-1" colspan="3">Veri yok.</td></tr>';
    }

    // 6.c Stoğu en hızlı giden 5 (satış hızı: adet/gün)
    const winDays = salesWindowDays || 1;
    const speedArr = Array.from(new Set([...Array.from(soldMap.keys()), ...Array.from(onHandMap.keys())]))
      .map(sku=>{
        const sold = soldMap.get(sku)||0;
        const on   = onHandMap.get(sku)||0;
        const spd  = sold / winDays; // adet/gün
        return { sku, title:titleMap.get(sku)||'', speed: spd, onHand:on };
      })
      .filter(x=> x.speed>0)
      .sort((a,b)=> b.speed - a.speed)
      .slice(0,5);

    const fastestTbody = document.getElementById('tblFastestMoving');
    if(fastestTbody){
      fastestTbody.innerHTML = speedArr.map(x=>`
        <tr><td class="py-1 pr-3">${x.sku}</td><td class="py-1 pr-3">${x.title}</td><td class="py-1 pr-3 text-right">${x.speed.toFixed(2)}</td><td class="py-1 pr-3 text-right">${x.onHand}</td></tr>
      `).join('') || '<tr><td class="hint py-1" colspan="4">Veri yok.</td></tr>';
    }

    // 6.d Stokta en uzun süredir kalan 5 (en yaşlı, on-hand > 0)
    const staleArr = Array.from(onHandMap.entries()).map(([sku,on])=>{
      const last = lastMap.get(sku);
      const age = last ? Math.floor((Date.now()-last.getTime())/(1000*60*60*24)) : 9999;
      return { sku, title:titleMap.get(sku)||'', age, onHand:on };
    }).filter(x=> x.onHand>0)
      .sort((a,b)=> b.age - a.age)
      .slice(0,5);

    const staleTbody = document.getElementById('tblMostStale');
    if(staleTbody){
      staleTbody.innerHTML = staleArr.map(x=>`
        <tr><td class="py-1 pr-3">${x.sku}</td><td class="py-1 pr-3">${x.title}</td><td class="py-1 pr-3 text-right">${x.age}</td><td class="py-1 pr-3 text-right">${x.onHand}</td></tr>
      `).join('') || '<tr><td class="hint py-1" colspan="4">Veri yok.</td></tr>';
    }

    const noteEl = document.getElementById('stockExtraNote');
    if(noteEl){
      const today = new Date(); const start = new Date(today.getTime() - salesWindowDays*24*60*60*1000);
      const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
      noteEl.textContent = `Pencere: ${fmt(start)} – ${fmt(today)} · Kaynak: orders_raw`;
    }
    // 6.e Stokout Riski (≤14 gün): pencere = salesWindowDays
    try {
      const riskDays = 14;
      const days = salesWindowDays || 90;
      // sold qty per SKU in the selected window
      const soldMapWin = new Map();
      const cutoffWin = new Date(Date.now() - days*24*60*60*1000);
      (ordersMap||[]).forEach(o=>{
        if(!o || !o.sku || !o.date) return;
        if(o.date >= cutoffWin){
          soldMapWin.set(o.sku, (soldMapWin.get(o.sku)||0) + (o.qty||0));
        }
      });
      // on-hand ve başlıklar yukarıda hesaplandı: onHandMap, titleMap
      const riskArr = [];
      onHandMap.forEach((on, sku)=>{
        const title = titleMap.get(sku) || '';
        if (on <= 0) return;
        const sold = soldMapWin.get(sku)||0;
        const daily = sold / (days||1);
        if (daily > 0){
          const remain = on / daily;
          if (remain <= riskDays){
            riskArr.push({
              sku,
              title: title,
              onHand: on,
              daily: daily,
              remain: remain
            });
          }
        }
      });
      // Sort and slice to max 25 entries
      riskArr.sort((a,b)=> a.remain - b.remain);
      const riskArrSliced = riskArr.slice(0, 25);
      const riskTbody = document.getElementById('tblStockoutRisk');
      if (riskTbody){
        riskTbody.innerHTML = riskArrSliced.length
          ? riskArrSliced.map(x => `
              <tr>
                <td class="py-2 pr-4">${x.sku}</td>
                <td class="py-2 pr-4">${x.title}</td>
                <td class="py-2 pr-4 text-right">${x.onHand}</td>
                <td class="py-2 pr-4 text-right">${x.daily.toFixed(2)}</td>
                <td class="py-2 pr-4 text-right">${x.remain.toFixed(1)}</td>
              </tr>
            `).join('')
          : '<tr><td class="hint py-2 pr-4" colspan="5">Riskli ürün bulunmadı.</td></tr>';
      }
      const riskLbl = document.getElementById('riskWindowLbl');
      if (riskLbl) riskLbl.textContent = `${days} gün`;
    } catch (e) {
      console.warn('Stockout risk render error', e);
    }

    // 6.f Stoğu En Fazla Olan (Top 25)
    try {
      const largest = (invRows || []).map(r => ({
        sku: String(r['SKU'] || '').trim(),
        title: r['Title'] || '',
        on: parseTL(r['TotalUnits'] || r['On hand total'] || r['On hand (current)'] || 0)
      }))
      .filter(x => x.sku && x.on > 0)
      .sort((a,b) => b.on - a.on)
      .slice(0, 25);

      const largestTbody = document.getElementById('tblLargestStock');
      if (largestTbody) {
        largestTbody.innerHTML = largest.length
          ? largest.map(x => `
              <tr>
                <td class="py-2 pr-4">${x.sku}</td>
                <td class="py-2 pr-4">${x.title}</td>
                <td class="py-2 pr-4 text-right">${x.on}</td>
              </tr>
            `).join('')
          : '<tr><td class="hint py-2 pr-4" colspan="3">Veri yok.</td></tr>';
      }
    } catch (e) {
      console.warn('Largest stock render error', e);
    }

    /* 6.g Zee.Dog ürün tipi kırılımı

       Burada eskiden marka kırılımı (Zee Dog / Pop Dog / Diğer) vardı.
       Sayfa artık zaten yalnızca Zee.Dog gösterdiği için o kart
       "%99,8 Zee.Dog, gerisi sıfır" demekten ibaretti. Yerine stoğun
       hangi ürün tipinde durduğunu gösteren kırılım geldi — gezdirme
       tasması mı, göğüs tasması mı, kedi ürünü mü. Tip, ürün başlığından
       zeeUrunTipi() ile çıkarılır (adetlerin ~%99,6'sı sınıflanıyor). */
    try {
      /* Kırılım sayfa toplamıyla BİREBİR tutmalı. Bu yüzden negatif ve sıfır
         stoklu satırlar da toplama giriyor (stokta -1 görünen ürünler var).
         Sadece "kaç SKU" sayarken stoğu olanlar sayılıyor. */
      const tipler = new Map();   // tip -> { adet, deger, satir }
      (invRows||[]).forEach(r=>{
        const adet  = parseTL(r['TotalUnits']||0);
        const deger = parseTL(r['Value@Price']||r['Value @Price']||0);
        const tip = zeeUrunTipi(r['Title']);
        const k = tipler.get(tip) || { adet:0, deger:0, satir:0 };
        k.adet += adet; k.deger += deger;
        if (adet > 0) k.satir += 1;
        tipler.set(tip, k);
      });

      const sirali = [...tipler.entries()].sort((a,b)=> b[1].adet - a[1].adet);
      const toplamAdet  = sirali.reduce((a,[,k])=> a + k.adet, 0);
      const toplamDeger = sirali.reduce((a,[,k])=> a + k.deger, 0);
      const enBuyuk     = sirali.reduce((a,[,k])=> Math.max(a, k.adet), 0);

      const ozetEl = document.getElementById('zeeTipToplam');
      if (ozetEl){
        ozetEl.textContent = toplamAdet
          ? `${toplamAdet.toLocaleString('tr-TR')} adet · ${numberTL(toplamDeger)} (satış fiyatıyla)`
          : '–';
      }

      const kutu = document.getElementById('zeeTipKirilim');
      if (kutu){
        kutu.innerHTML = sirali.length ? sirali.map(([tip,k])=>{
          const pay = toplamAdet ? (100 * k.adet / toplamAdet) : 0;
          const bar = (enBuyuk > 0 && k.adet > 0) ? Math.max(2, 100 * k.adet / enBuyuk) : 0;
          return `<div title="${k.satir} SKU · ${numberTL(k.deger)} satış değeri">
            <div class="tip-satir-ust">
              <span class="tip-ad">${tip}</span>
              <span class="tip-sayi">${k.adet.toLocaleString('tr-TR')} adet · %${pay.toFixed(1)}</span>
            </div>
            <div class="tip-bar"><i style="width:${bar.toFixed(1)}%"></i></div>
          </div>`;
        }).join('') : '<div class="hint text-xs">Kırılım için stok verisi yok.</div>';
      }
    } catch(e){ console.warn('Ürün tipi kırılımı hatası', e); }

    // 6.h Stok Devir Hızı (Turnover) = Yıllık satış / ortalama stok değeri
    try {
      /* Devir hızı iki tarafı da AYNI bazda ölçmeli. Eski kod yıllık satışı
         satış fiyatıyla, stoğu maliyetle alıp bölüyordu; sonuç kâr marjı
         katsayısı kadar (burada 6,88x) şişiyordu — 9,05x görünüyordu, oysa
         gerçek 1,32x. Ekrandaki DIO 310 gün derken devir 9x demek kendi
         içinde çelişkiydi. Artık iki taraf da satış fiyatı bazında. */
      const oneYearAgo = new Date(Date.now() - 365*24*60*60*1000);
      let yearSalesVal = 0;
      (ordersMap||[]).forEach(o=>{
        if(o.date && o.date >= oneYearAgo){
          yearSalesVal += (o.qty||0) * (o.price||0);
        }
      });
      const stokSatisBazi = inv.valPrice || 0;
      const turnover = stokSatisBazi > 0 ? (yearSalesVal / stokSatisBazi) : 0;
      const turnoverEl = document.getElementById('kpiTurnover');
      if(turnoverEl){
        if(turnover > 0){
          const gun = Math.round(365 / turnover);
          turnoverEl.textContent = turnover.toFixed(2) + 'x';
          turnoverEl.title = `Yıllık satış ₺${Math.round(yearSalesVal).toLocaleString('tr-TR')} `
            + `/ stok (satış fiyatıyla) ₺${Math.round(stokSatisBazi).toLocaleString('tr-TR')}\n`
            + `Stok yılda ${turnover.toFixed(2)} kez dönüyor ≈ ${gun} günde bir`;
        } else {
          turnoverEl.textContent = '–';
        }
      }
    } catch(e){}

    // 6.i Dead Stock (180+ gün)
    try {
      const deadList = (invRows||[]).map(r=>{
        const sku = String(r['SKU']||'').trim();
        const units = parseTL(r['TotalUnits']||0);
        const valCost = parseTL(r['Value@Cost']||r['Value @Cost']||0);
        const last = lastSaleDateForSKU(sku, ordersMap);
        const age = last ? Math.floor((Date.now()-last.getTime())/(1000*60*60*24)) : 9999;
        return { sku, title:r['Title']||'', units, valCost, last, age };
      }).filter(x=>x.units>0 && x.age>=180)
        .sort((a,b)=> b.valCost - a.valCost);

      const deadQty = deadList.reduce((a,x)=>a+x.units, 0);
      const deadVal = deadList.reduce((a,x)=>a+x.valCost, 0);

      const deadStockEl = document.getElementById('kpiDeadStock');
      const deadStockQtyEl = document.getElementById('kpiDeadStockQty');
      if(deadStockEl) deadStockEl.textContent = numberTL(deadVal);
      if(deadStockQtyEl) deadStockQtyEl.textContent = `${deadQty} adet`;

      const deadTbody = document.getElementById('tblDeadStock');
      if(deadTbody){
        deadTbody.innerHTML = deadList.slice(0,15).map(x=>{
          const lastStr = x.last ? x.last.toISOString().slice(0,10) : '—';
          return `<tr class="text-red-600 dark:text-red-400">
            <td class="py-2 pr-4">${x.sku}</td>
            <td class="py-2 pr-4">${x.title}</td>
            <td class="py-2 pr-4 text-right">${x.units}</td>
            <td class="py-2 pr-4 text-right">${numberTL(x.valCost)}</td>
            <td class="py-2 pr-4 text-right">${lastStr}</td>
            <td class="py-2 pr-4 text-right">${x.age}</td>
          </tr>`;
        }).join('') || '<tr><td class="hint py-2" colspan="6">Dead stock yok.</td></tr>';
      }
    } catch(e){}

    // 6.j Stok Yaşlandırma Bar Chart
    try {
      const buckets = aging.buckets;
      const total = Object.values(buckets).reduce((a,b)=>a+b, 0) || 1;
      const maxVal = Math.max(...Object.values(buckets)) || 1;

      const bar0_30 = document.getElementById('agingBar0_30');
      const bar31_60 = document.getElementById('agingBar31_60');
      const bar61_90 = document.getElementById('agingBar61_90');
      const bar90plus = document.getElementById('agingBar90plus');

      if(bar0_30) bar0_30.style.height = ((buckets['0-30']||0)/maxVal*100) + '%';
      if(bar31_60) bar31_60.style.height = ((buckets['31-60']||0)/maxVal*100) + '%';
      if(bar61_90) bar61_90.style.height = ((buckets['61-90']||0)/maxVal*100) + '%';
      if(bar90plus) bar90plus.style.height = ((buckets['90+']||0)/maxVal*100) + '%';

      const lbl0_30 = document.getElementById('agingLbl0_30');
      const lbl31_60 = document.getElementById('agingLbl31_60');
      const lbl61_90 = document.getElementById('agingLbl61_90');
      const lbl90plus = document.getElementById('agingLbl90plus');

      if(lbl0_30) lbl0_30.textContent = buckets['0-30']||0;
      if(lbl31_60) lbl31_60.textContent = buckets['31-60']||0;
      if(lbl61_90) lbl61_90.textContent = buckets['61-90']||0;
      if(lbl90plus) lbl90plus.textContent = buckets['90+']||0;

      const chartNote = document.getElementById('agingChartNote');
      if(chartNote) chartNote.textContent = `Toplam: ${total} adet`;
    } catch(e){}

    // 6.k ABC Analizi
    try {
      // SKU bazında satış değeri (pencere içinde)
      const skuSales = new Map();
      (ordersMap||[]).forEach(o=>{
        if(o.date && o.date >= cutoff){
          const val = (o.qty||0) * (o.price||0);
          skuSales.set(o.sku, (skuSales.get(o.sku)||0) + val);
        }
      });

      const sorted = Array.from(skuSales.entries())
        .map(([sku,val])=>({sku, val}))
        .sort((a,b)=>b.val-a.val);

      const totalSalesVal = sorted.reduce((a,x)=>a+x.val, 0) || 1;
      let cumulative = 0;
      let aCount=0, aVal=0, bCount=0, bVal=0, cCount=0, cVal=0;

      sorted.forEach(x=>{
        cumulative += x.val;
        const pct = cumulative / totalSalesVal;
        if(pct <= 0.80){
          aCount++; aVal += x.val;
        } else if(pct <= 0.95){
          bCount++; bVal += x.val;
        } else {
          cCount++; cVal += x.val;
        }
      });

      const abcAEl = document.getElementById('kpiAbcA');
      const abcAValEl = document.getElementById('kpiAbcAVal');
      const abcBEl = document.getElementById('kpiAbcB');
      const abcBValEl = document.getElementById('kpiAbcBVal');
      const abcCEl = document.getElementById('kpiAbcC');
      const abcCValEl = document.getElementById('kpiAbcCVal');

      if(abcAEl) abcAEl.textContent = `${aCount} SKU`;
      if(abcAValEl) abcAValEl.textContent = `${numberTL(aVal)} (${(aVal/totalSalesVal*100).toFixed(0)}%)`;
      if(abcBEl) abcBEl.textContent = `${bCount} SKU`;
      if(abcBValEl) abcBValEl.textContent = `${numberTL(bVal)} (${(bVal/totalSalesVal*100).toFixed(0)}%)`;
      if(abcCEl) abcCEl.textContent = `${cCount} SKU`;
      if(abcCValEl) abcCValEl.textContent = `${numberTL(cVal)} (${(cVal/totalSalesVal*100).toFixed(0)}%)`;
    } catch(e){}

    // 6.l Reorder Point - Kategori + Beden Bazlı
    try {
      const leadTime = 45;
    } catch(e){}

    // 6.m Son güncelleme tarihi
    try {
      const updateEl = document.getElementById('stockLastUpdate');
      if(updateEl){
        const now = new Date();
        updateEl.textContent = `Son güncelleme: ${now.toLocaleString('tr-TR')}`;
      }
    } catch(e){}

    // 6.n Renk kodlarını uygula
    setTimeout(applyStockRowColors, 100);

  } catch(err) {
    console.warn('Sales/Turnover lists error', err);
  }
}

// Stok arama fonksiyonu
function initStockSearch(){
  const input = document.getElementById('stockSearchInput');
  if(!input) return;

  input.addEventListener('input', function(){
    const query = this.value.toLowerCase().trim();
    const tables = ['tblTopStock','tblAged90','tblDeadStock','tblStockoutRisk','tblLargestStock'];

    tables.forEach(id=>{
      const tbody = document.getElementById(id);
      if(!tbody) return;
      const rows = tbody.querySelectorAll('tr');
      rows.forEach(row=>{
        const text = row.textContent.toLowerCase();
        row.style.display = (!query || text.includes(query)) ? '' : 'none';
      });
    });
  });
}

// CSV Export fonksiyonu
function initStockExport(){
  const btn = document.getElementById('stockExportBtn');
  if(!btn) return;

  btn.addEventListener('click', function(){
    // Export ekrandakiyle aynı kümeyi vermeli: sayfa Zee.Dog gösteriyorsa
    // CSV de Zee.Dog vermeli, yoksa dosya ile ekran tutmaz.
    const invHam  = JSON.parse(localStorage.getItem('popdog_inv_cache') || '[]');
    const zeeF    = zeeFiltresiKur(invHam);
    const invRows = invHam.filter(r => zeeF.satirZee(r));
    if(!invRows.length){
      alert('Export edilecek veri yok.');
      return;
    }

    // CSV oluştur
    const headers = ['SKU','Title','TotalUnits','Value@Cost','Value@Price'];
    const csv = [
      headers.join(','),
      ...invRows.map(r => headers.map(h => {
        let val = r[h] || '';
        if(typeof val === 'string' && val.includes(',')) val = `"${val}"`;
        return val;
      }).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zeedog_stok_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Tablolara renk kodları ekle (kritik satırlara)
function applyStockRowColors(){
  // Stokout risk tablosunda kalan gün < 7 ise kırmızı
  const riskTbody = document.getElementById('tblStockoutRisk');
  if(riskTbody){
    riskTbody.querySelectorAll('tr').forEach(row=>{
      const cells = row.querySelectorAll('td');
      if(cells.length >= 5){
        const remain = parseFloat(cells[4].textContent) || 999;
        if(remain <= 7){
          row.classList.add('bg-red-100','dark:bg-red-900/30');
        } else if(remain <= 10){
          row.classList.add('bg-orange-100','dark:bg-orange-900/30');
        }
      }
    });
  }

  // Aged tablosunda yaş > 120 ise koyu kırmızı
  const agedTbody = document.getElementById('tblAged90');
  if(agedTbody){
    agedTbody.querySelectorAll('tr').forEach(row=>{
      const cells = row.querySelectorAll('td');
      if(cells.length >= 6){
        const age = parseInt(cells[5].textContent) || 0;
        if(age >= 180){
          row.classList.add('text-red-700','dark:text-red-400');
        } else if(age >= 120){
          row.classList.add('text-orange-600','dark:text-orange-400');
        }
      }
    });
  }
}

function lastSaleDateForSKU(sku, ordersMap){
  if(!sku || !Array.isArray(ordersMap)) return null;
  let last = null;
  for(const o of ordersMap){
    if(o.sku!==sku || !o.date) continue;
    if(!last || o.date>last) last = o.date;
  }
  return last;
}
function deriveTryPerUsdFromKPI(){
  try{
    const tlEl  = document.getElementById('kpiYTD');
    const usdEl = document.getElementById('kpiYTD_USD');
    if(!tlEl || !usdEl) return 0;

    const tl  = parseTL(tlEl.textContent || '');
    // "≈ $12,345 USD" benzeri metinden USD’yi çek
    const usdText = (usdEl.textContent || '').replace(/≈/g,'').replace(/about/i,'');
    const usd = parseUSD(usdText);

    if(tl > 0 && usd > 0){
      const usdPerTry = usd / tl;      // 1 TRY kaç USD
      const tryPerUsd = 1 / usdPerTry; // 1 USD kaç TRY
      // cache’le
      try{
        localStorage.setItem('popdog_fx_try_per_usd', String(tryPerUsd));
        localStorage.setItem('popdog_fx_usd_per_try', String(usdPerTry));
      }catch(e){}
      return tryPerUsd;
    }
    return 0;
  }catch(e){ return 0; }
}
/* ================== REVENUE AGGREGATIONS & UI ================== */
function buildMonthly(rows){
  const map = new Map();
  rows.forEach(r=>{
    if(!r.Date) return;
    const d = new Date(r.Date + "T00:00:00Z");
    if(isNaN(+d)) return;
    const key = monthKey(d);
    const tpt=+r.Toptan||0, onl=+r.Online||0, ckm=+r.CKM||0, ckmN=+r["CKM Nakit"]||0, trn=+r.Trendyol||0, hb=+r.Hepsiburada||0, kua=+r.Kuaför||0;
    // Sheet'teki Total sütununu kullan (her zaman doğru hesaplanmış)
    // Yoksa veya 0 ise kanalları topla — eski satırlarda Kuaför CKM içinde olduğu için
    // bu fallback sadece Total=0 olan çok eski satırlar için devreye girer
    const sheetTotal = +r.Total || 0;
    const usedTotal = sheetTotal > 0 ? sheetTotal : (tpt + onl + ckm + trn + hb);
    const prev = map.get(key) || { month:key, year:d.getFullYear(), Toptan:0, Online:0, CKM:0, CKM_Nakit:0, Trendyol:0, Hepsiburada:0, Kuaför:0, Total:0 };
    prev.Toptan+=tpt; prev.Online+=onl; prev.CKM+=ckm; prev.CKM_Nakit+=ckmN; prev.Trendyol+=trn; prev.Hepsiburada+=hb; prev.Kuaför+=kua; prev.Total+=usedTotal;
    map.set(key, prev);
  });
  return Array.from(map.values()).filter(m=>m.Total>0).sort((a,b)=>a.month.localeCompare(b.month));
}

function buildWeekly(rows){
  const map = new Map();
  rows.forEach(r=>{
    if(!r.Date) return;
    const d = new Date(r.Date + "T00:00:00Z");
    if(isNaN(+d)) return;
    const mon = toMonday(d);
    const key = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
    const tpt=+r.Toptan||0, onl=+r.Online||0, ckm=+r.CKM||0, trn=+r.Trendyol||0, hb=+r.Hepsiburada||0, kua=+r.Kuaför||0;
    const sheetTotal = +r.Total || 0;
    const total = sheetTotal > 0 ? sheetTotal : (tpt + onl + ckm + trn + hb);
    const prev = map.get(key) || { monday:key, Toptan:0, Online:0, CKM:0, CKM_Nakit:0, Trendyol:0, Hepsiburada:0, Kuaför:0, Total:0 };
    prev.Toptan+=tpt; prev.Online+=onl; prev.CKM+=ckm; prev.Trendyol+=trn; prev.Hepsiburada+=hb; prev.Kuaför+=kua; prev.Total+=total;
    map.set(key, prev);
  });
  return Array.from(map.values()).sort((a,b)=>a.monday.localeCompare(b.monday));
}

/* ================== KPIs (Revenue) ================== */
function setKPIs(monthly){
  // === KPIs sadece bu yıl (YTD) üzerinden hesaplansın ===
  const now = new Date();
  const currentYearReal = now.getFullYear();

  // Bu yılki aylar
  const ytdRowsReal = (monthly || []).filter(m => m.year === currentYearReal);

  // Eğer bu yıl yoksa: eldeki son yıl
  const fallbackYear = ytdRowsReal.length
    ? currentYearReal
    : ((monthly || []).length ? monthly[(monthly.length - 1)].year : currentYearReal);

  const thisYear = ytdRowsReal.length ? currentYearReal : fallbackYear;
  const rowsThisYear = (monthly || []).filter(m => m.year === thisYear);

  // Toplam yardımcı sadece seçilen yıl için
  const sumTY = k => rowsThisYear.reduce((a, r) => a + (r[k] || 0), 0);

  // === YTD Toplam (sadece bu yıl) ===
  const ytdTotal = sumTY('Total');
  const elYTD = document.getElementById('kpiYTD');
  if (elYTD) elYTD.textContent = numberTL(ytdTotal);

  const elYTD_USD = document.getElementById('kpiYTD_USD');
  if (elYTD_USD) {
    if (fxRateUSDPerTRY) elYTD_USD.textContent = `≈ ${numberUSD(ytdTotal * fxRateUSDPerTRY)} USD`;
    else elYTD_USD.textContent = '≈ – USD';
  }

  // === YTD YoY: geçen yılın aynı ay sayısı ile hizalanmış toplam ===
  try {
    const prevYear = thisYear - 1;
    // Bu yıl var olan ayların MM listesini çıkar
    const monthsThisYear = rowsThisYear.map(r => r.month.slice(5, 7));
    const mmSet = new Set(monthsThisYear);

    // Geçen yıl aynı ayların toplamı
    const prevYtd = (monthly || []).reduce((acc, r) => {
      if (r.year !== prevYear) return acc;
      const mm = r.month.slice(5, 7);
      if (mmSet.has(mm)) acc += (r.Total || 0);
      return acc;
    }, 0);

    const yoy = prevYtd ? ((ytdTotal - prevYtd) / prevYtd) : 0;
    const elYoY = document.getElementById('kpiYTD_YoY');
    if (elYoY) elYoY.textContent = `YTD YoY: ${(yoy * 100).toFixed(1)}%`;
  } catch (e) {
    // sessiz geç
  }

  // === En büyük kanal + paylar (yalnızca bu yıl) ===
  const channels = [
    { k: 'Toptan',      v: sumTY('Toptan') },
    { k: 'Online',      v: sumTY('Online') },
    { k: 'CKM',         v: sumTY('CKM') },
    { k: 'Trendyol',    v: sumTY('Trendyol') },
    { k: 'Hepsiburada', v: sumTY('Hepsiburada') },
    { k: 'Kuaför',      v: sumTY('Kuaför') },
  ].sort((a, b) => b.v - a.v);

  const totalCh = channels.reduce((a, b) => a + b.v, 0) || 1;
  const top = channels[0] || { k: '—', v: 0 };

  const kpiTopEl = document.getElementById('kpiTop');
  if (kpiTopEl) {
    kpiTopEl.textContent =
      `${chLabel(top.k)}: ${numberTL(top.v)}  •  ${fxRateUSDPerTRY ? numberUSD(top.v * fxRateUSDPerTRY) : '– USD'}`;
  }

  const ul = document.getElementById('kpiOthers');
  if (ul) {
    ul.innerHTML = '';
    channels.slice(1).forEach(c => {
      const li = document.createElement('li');
      li.textContent = `${chLabel(c.k)}: ${numberTL(c.v)}  •  ${fxRateUSDPerTRY ? numberUSD(c.v * fxRateUSDPerTRY) : '– USD'}`;
      ul.appendChild(li);
    });
  }

  const shareTbl = document.getElementById('kpiShareTbl');
  if (shareTbl) {
    shareTbl.innerHTML = channels
      .map(c => {
        const pct = (c.v / totalCh) * 100;
        return `<tr><td>${chLabel(c.k)}</td><td class="text-right">${pct.toFixed(1)}%</td></tr>`;
      })
      .join('');
  }

  // === MoM (bu yıl içindeki son iki ay) ===
  const rowsSorted = rowsThisYear.slice().sort((a, b) => a.month.localeCompare(b.month));
  let last = null, prev = null;
  if (rowsSorted.length >= 2) {
    last = rowsSorted.at(-1).Total;
    prev = rowsSorted.at(-2).Total;
  } else if (rowsSorted.length === 1) {
    last = rowsSorted[0].Total;
    prev = 0;
  }

  const mom = prev ? (last - prev) / prev : 0;
  const elMoM = document.getElementById('kpiMoM');
  if (elMoM) {
    elMoM.textContent = `${(mom * 100).toFixed(1)}%`;
    elMoM.classList.remove('kpi-up', 'kpi-down');
    elMoM.classList.add(mom >= 0 ? 'kpi-up' : 'kpi-down');
  }

  const mLabels = rowsSorted.map(m => m.month);
  const momNote = document.getElementById('momNote');
  if (momNote) momNote.textContent = mLabels.length >= 2 ? `(${mLabels.at(-2)} → ${mLabels.at(-1)})` : '';
  // Ensure expenses table re-renders after KPIs (FX may now be derived)
  try { renderMainExpensesTable(); } catch (e) { /* silent */ }
}

/* ================== Alerts ================== */
function buildAlerts(monthly){
  const alerts = [];
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 1) MoM Ciro Düşüşü
  if(monthly.length>=2){
    const mLast = monthly.at(-1), mPrev = monthly.at(-2);
    const mom = mPrev.Total ? (mLast.Total - mPrev.Total) / mPrev.Total : 0;
    if(mom < -0.15){
      alerts.push({type:'risk', text:`MoM toplam ciro düşüşü ${(mom*100).toFixed(1)}%`, priority: 1});
    }
    // Kanal bazlı düşüşler
    ["Toptan","Online","CKM","Trendyol","Hepsiburada"].forEach(k=>{
      const r = mPrev[k] ? (mLast[k]-mPrev[k]) / mPrev[k] : 0;
      if(r < -0.20){
        alerts.push({type:'warn', text:`${k} aylık -${(Math.abs(r)*100).toFixed(0)}%`, priority: 2});
      }
    });
  }

  // 2) Kredi Ödeme Uyarıları
  try {
    const st = (typeof getLoansState === 'function') ? getLoansState() : {};
    const loans = st.loans || {};
    const dayOfMonth = now.getDate();

    /* Her kredi kendi ödeme gününden itibaren uyarır. dueDay tanımlı değilse
       eski davranış korunur (ayın 10'u). */
    [
      { key: 'biz',     ad: 'Ticari kredi' },
      { key: 'car',     ad: 'Araç kredisi' },
      { key: 'garanti', ad: 'Garanti kredisi' },
    ].forEach(function(k){
      const l = loans[k.key];
      if (!l || !(l.paid < l.total)) return;

      if (l.firstPaymentDate){
        /* Ödeme takvimi biliniyorsa yalnızca sıradaki taksidin ayında ve
           gününde uyar — aksi halde ilk taksitten aylar önce uyarı çıkıyor. */
        const ilk = new Date(l.firstPaymentDate);
        if (isNaN(+ilk)) return;
        const sonraki = new Date(ilk.getFullYear(), ilk.getMonth() + Number(l.paid || 0), ilk.getDate());
        const ayniAy = now.getFullYear() === sonraki.getFullYear() && now.getMonth() === sonraki.getMonth();
        if (!ayniAy || dayOfMonth < sonraki.getDate()) return;
      } else {
        // Takvimi bilinmeyen krediler için eski davranış: ayın 10'undan sonra.
        const gun = Number(l.dueDay) > 0 ? Number(l.dueDay) : 10;
        if (dayOfMonth < gun) return;
      }

      const inst = Number(l.instTRY || 0);
      if (inst > 0) {
        alerts.push({ type:'info', text:`${k.ad} taksiti yaklaşıyor: ${numberTL(inst)}`, priority: 3 });
      }
    });
  } catch(e){}

  // 3) Margin Uyarıları
  try {
    const ytdRevenue = parseFloat((document.getElementById('kpiYTD')?.textContent || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    const ytdExpenses = parseFloat((document.getElementById('kpiExpYTD')?.textContent || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

    if (ytdRevenue > 0 && ytdExpenses > 0) {
      const expenseRatio = (ytdExpenses / ytdRevenue) * 100;
      if (expenseRatio > 50) {
        alerts.push({type:'risk', text:`Gider/Ciro oranı yüksek: %${expenseRatio.toFixed(1)}`, priority: 1});
      } else if (expenseRatio > 40) {
        alerts.push({type:'warn', text:`Gider/Ciro oranı dikkat: %${expenseRatio.toFixed(1)}`, priority: 2});
      }
    }
  } catch(e){}

  // 4) Hedef Takibi Uyarısı
  try {
    const annualTarget = parseFloat(localStorage.getItem(ANNUAL_TARGET_KEY) || '0') || 0;
    if (annualTarget > 0) {
      const ytdRevenue = parseFloat((document.getElementById('kpiYTD')?.textContent || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      const expectedProgress = (currentMonth / 12) * annualTarget;
      const behindBy = expectedProgress - ytdRevenue;

      if (behindBy > 0 && (behindBy / expectedProgress) > 0.15) {
        alerts.push({type:'warn', text:`Yıllık hedefin %${((behindBy/expectedProgress)*100).toFixed(0)} gerisinde`, priority: 2});
      }
    }
  } catch(e){}

  // 5) Stok Uyarıları
  try {
    const deadStockEl = document.getElementById('kpiDeadStock');
    if (deadStockEl) {
      const deadStockText = deadStockEl.textContent || '';
      const deadStockVal = parseFloat(deadStockText.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      if (deadStockVal > 500000) {
        alerts.push({type:'warn', text:`Yüksek dead stock: ${numberTL(deadStockVal)}`, priority: 2});
      }
    }
  } catch(e){}

  // Sırala: önce risk, sonra warn, sonra info
  alerts.sort((a, b) => (a.priority || 99) - (b.priority || 99));

  // UI güncelle
  const ul = document.getElementById('alertsList');
  ul.innerHTML='';
  if(alerts.length===0){
    ul.innerHTML = `<li class="hint">✅ Uyarı yok - her şey yolunda!</li>`;
    return;
  }

  alerts.slice(0, 6).forEach(a=>{
    const li = document.createElement('li');
    const color = a.type==='risk'?'#ef4444':(a.type==='warn'?'#f59e0b':'#6366f1');
    const icon = a.type==='risk'?'🚨':(a.type==='warn'?'⚠️':'ℹ️');
    li.innerHTML = `<span class="dot" style="background:${color}"></span>${icon} ${a.text}`;
    ul.appendChild(li);
  });
}

/* ================== Targets ================== */
function computeAutoTargets(monthly){
  const byYear = {};
  monthly.forEach(m => { (byYear[m.year] = byYear[m.year] || []).push(m); });
  const targets = {};
  for(const y of Object.keys(byYear)){
    const arr = byYear[y].sort((a,b)=> a.month.localeCompare(b.month));
    let running = [];
    arr.forEach((m, idx) => {
      if(idx === 0){ targets[m.month] = m.Total; running.push(m.Total); }
      else { const avg = running.reduce((a,b)=>a+b,0) / running.length; targets[m.month] = avg; running.push(m.Total); }
    });
  }
  return targets;
}
function renderTargets(monthly){
  const autoTargets = computeAutoTargets(monthly);
  const wrap = document.getElementById('targetsWrap');
  if (!wrap) return;   // Hedefler artık aylık ciro tablosunun sütunu
  wrap.innerHTML='';
  monthly.forEach(m=>{
    const target = autoTargets[m.month] || 0;
    const p = target ? Math.min(100, Math.round(m.Total/target*100)) : 0;
    const box = document.createElement('div');
    box.className = 'glass target-card border border-white/70';
    box.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="ttl text-slate-700 dark:text-slate-200">${m.month}</div>
        <div class="val text-slate-800 dark:text-slate-100">${numberTL(m.Total)}</div>
      </div>
      <div class="progress-wrap mt-1.5"><div class="progress-bar" style="width:${p}%"></div></div>
      <div class="sub hint mt-1">Hedef: ${numberTL(target)} • ${p}%</div>
    `;
    wrap.appendChild(box);
  });
}

/* ================== Charts ================== */
// Charts removed (stability + simpler maintenance)
// Keep `monthlyCache` as the shared revenue monthly cache used by other blocks.
let monthlyCache = [];
function drawCharts(){
  if (!window.Chart) { return; }
 /* no-op */ }
/* ================== Expenses (CFO) ================== */

let expensesRowsCache = [];
let expensesMonthlyCache = [];
let expYoyEnabled = true;
try{ const s = document.getElementById('expYoyState'); if (s) s.textContent = expYoyEnabled ? 'Açık' : 'Kapalı'; }catch(e){}
let expensesRowsAdjustedCache = [];




// Return the main category for a row; when grouped=true, collapse certain mains
function mainCategoryForRow(r, grouped=false){
  try{
    const cats = typeof expenseCats === 'function' ? expenseCats(r) : { main: (r.Category||r.Main||'') };
    let m = (cats && cats.main) ? String(cats.main) : String(r.Category||r.Main||'');
    if (!m) return '';
    if (grouped){
      const key = m.toLowerCase();
      // Collapse Caddebostan entries under a single bucket
      if (key.includes('caddebostan')) m = 'Caddebostan (Toplam)';
      // Add more grouping rules here if needed (e.g., advertising buckets)
    }
    return m;
  }catch(e){ return String(r.Category||r.Main||'')||''; }
}


// Alt kırılım anahtarı: FinalSubcategory > Subcategory > "Diğer"
function subKeyForRow(r){
  const key =
    r.FinalSubcategory || r.FinalSubCategory || r['Final Subcategory'] ||
    r.Subcategory || r['Subcategory'] || r.SubCat || r['Sub Cat'] ||
    '';
  const s = String(key||'').trim();
  return s || 'Diğer';
}

// YTD Detay kırılımı: Ana Kategori + (FinalSubcategory/Subcategory)
function buildMainExpenseBreakdownYTD(expRows){
  const year = new Date().getFullYear();
  const map = new Map(); // "main||sub" -> TRY toplam
  let sumAll = 0;

  for (const r of (expRows || [])){
    const iso = getExpenseISODate(r);
    if (!iso || !iso.startsWith(String(year))) continue;

    const main = mainCategoryForRow(r, false);
    if (!main) continue;

    const sub  = subKeyForRow(r);
    const amt  = Math.abs(readExpenseAmountTRY(r)) || 0;
    if (!amt) continue;

    const k = `${main}||${sub}`;
    map.set(k, (map.get(k)||0) + amt);
    sumAll += amt;
  }

  // Diziye çevir, ana kategori + (tutar desc), sonra ana kategori alfabetik
  const arr = Array.from(map.entries()).map(([k, v])=>{
    const [main, sub] = k.split('||');
    return { main, sub, total: v };
  });

  // Önce ana kategori, içinde tutara göre
  arr.sort((a,b)=>{
    if (a.main !== b.main) return a.main.localeCompare(b.main, 'tr');
    return b.total - a.total;
  });

  // pay hesapları
  return { rows: arr, sumAll: sumAll || 1 };
}

// === YTD Ana Kategori Toplamı (TRY) — robust: category via expenseCats(), amount via readExpenseAmountTRY() ===
function buildMainExpenseTotalsYTD(expRows, grouped=false){
  const year = new Date().getFullYear();
  const map = new Map(); // main -> sum TRY
  for (const r of (expRows || [])) {
    const iso = getExpenseISODate(r);
    if (!iso || !iso.startsWith(String(year))) continue;
    const main = mainCategoryForRow(r, grouped);   // use grouped mapping when requested
    const amt = readExpenseAmountTRY(r);           // convert to TRY exactly once
    if (!main || !amt) continue;
    map.set(main, (map.get(main) || 0) + Math.abs(amt));
  }
  return Array.from(map.entries())
    .map(([k,v]) => ({ main:k, total:v }))
    .sort((a,b) => b.total - a.total);
}

// === "Ana Kategoriler (YTD)" tablosunu bu toplamlarla render et ===
function renderMainExpensesTable(){
  // Kaynak diziler
  const rowsDetail  = Array.isArray(expensesRowsCache) ? expensesRowsCache : [];
  const rowsGrouped = (Array.isArray(expensesRowsAdjustedCache) && expensesRowsAdjustedCache.length)
    ? expensesRowsAdjustedCache
    : rowsDetail;

  /* -------- Detay (FinalSubcategory/Subcategory kırılımı) -------- */
  const { rows: detailRows, sumAll: sumDetail } = buildMainExpenseBreakdownYTD(rowsDetail);

  // İsteğe bağlı: ana kategori başlığı eklemek için gruplayalım
  const byMain = new Map();
  for (const r of detailRows){
    if(!byMain.has(r.main)) byMain.set(r.main, []);
    byMain.get(r.main).push(r);
  }

  const tbodyD = document.getElementById('tblMainExpensesDetail');
  if (tbodyD){
    const parts = [];
    byMain.forEach((list, main)=>{
      // Ana kategoriye başlık satırı
      parts.push(`
        <tr>
          <td class="text-left py-1 pr-3 font-medium" colspan="3">${main}</td>
        </tr>
      `);
      // Alt kırılımlar (sub)
      list.forEach(item=>{
        parts.push(`
          <tr>
            <td class="text-left py-1 pr-3 pl-4">↳ ${item.sub}</td>
            <td class="text-right py-1 pr-3">${numberTL(item.total)}</td>
            <td class="text-right py-1 pr-0">${(item.total/sumDetail*100).toFixed(1)}%</td>
          </tr>
        `);
      });
      // Ara ayraç
      parts.push(`<tr><td colspan="3" class="py-1"></td></tr>`);
    });
    tbodyD.innerHTML = parts.join('') || '<tr><td class="hint py-1" colspan="3">Veri yok.</td></tr>';
  }

  /* -------- Gruplanmış (Ana Kategori toplamları) -------- */
  const totalsGrouped = buildMainExpenseTotalsYTD(rowsGrouped, true);
  const sumGrouped = totalsGrouped.reduce((a,b)=>a+b.total,0) || 1;

  const tbodyG = document.getElementById('tblMainExpensesGrouped');
  if (tbodyG) {
    tbodyG.innerHTML = totalsGrouped.map(t => `
      <tr>
        <td class="text-left py-1 pr-3">${t.main}</td>
         <td class="text-right py-1 pr-3">${numberTL(t.total)}</td>
        <td class="text-right py-1 pr-0">${(t.total/sumGrouped*100).toFixed(1)}%</td>
      </tr>
    `).join('') || '<tr><td class="hint py-1" colspan="3">Veri yok.</td></tr>';
  }
}

// === Yumuşak bağlama (expensesRowsCache dolunca 1 kez çiz) ===
(function setupMainExpensesAutoRender(){
  let tries = 0;
  const maxTries = 20; // ~16s
  const iv = setInterval(()=>{
    tries++;
    if (Array.isArray(expensesRowsCache) && expensesRowsCache.length){
      clearInterval(iv);
      renderMainExpensesTable();
    } else if (tries >= maxTries){
      clearInterval(iv);
    }
  }, 800);
  // Güvenlik için: sayfa görünür olduğunda tekrar dene
  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden && Array.isArray(expensesRowsCache) && expensesRowsCache.length){
      renderMainExpensesTable();
    }
  });
})();

// ===== MAIN DATA LOAD (Revenue + Inventory + Orders) =====
(function initMainLoad(){
  if (window.__popdog_main_inited) return; // avoid double init
  window.__popdog_main_inited = true;

  async function boot(){
    // 1) SHEET (revenue daily)
    try{
      const sheetUrl = localStorage.getItem('popdog_sheet_csv') || DEFAULT_SHEET_CSV;
      if (sheetUrl){
        const rows = await loadFromSheet(sheetUrl);
        loadedRows = Array.isArray(rows) ? rows : [];
        try { localStorage.setItem('popdog_sheet_cache', JSON.stringify(loadedRows)); } catch(e){}
        const monthly = buildMonthly(loadedRows);
        try { setKPIs(monthly); } catch(e) { console.warn('setKPIs error', e); }
        try { drawCharts(monthly); } catch(e) { console.warn('drawCharts error', e); }
        try { buildAlerts(monthly); } catch(e) { console.warn('buildAlerts error', e); }
        try { renderTargets(monthly); } catch(e) { console.warn('renderTargets error', e); }
        // FX türet: KPIs yazıldıktan sonra TRY/USD oranını çıkar (opsiyonel)
        try {
          const tryPerUsd = deriveTryPerUsdFromKPI();
          if (tryPerUsd) { fxRateUSDPerTRY = 1 / tryPerUsd; }
        } catch(e){}
      }
    }catch(err){ console.warn('Revenue boot error', err); }

    // 2) INVENTORY — Apps Script JSON endpoint (CSV fallback)
    try{
      const gasBase = (typeof getSheetWebAppURL === 'function' ? getSheetWebAppURL() : null)
                   || (typeof SHEET_WEBAPP_URL !== 'undefined' ? SHEET_WEBAPP_URL : '');
      let loaded = false;
      if (gasBase) {
        try {
          const r = await fetch(`${gasBase}?action=stocksummary&t=${Date.now()}`, { cache:'no-store', redirect:'follow' });
          if (r.ok) {
            const d = await r.json();
            if (d.ok && Array.isArray(d.rows) && d.rows.length) {
              localStorage.setItem('popdog_inv_cache', JSON.stringify(d.rows));
              loaded = true;
            }
          }
        } catch(e){ console.warn('stocksummary fetch error', e); }
      }
      if (!loaded) {
        const invUrl = localStorage.getItem('popdog_inv_csv') || DEFAULT_INV_CSV;
        if (invUrl) {
          const invRows = await loadCSV(invUrl);
          if (invRows && invRows.length) localStorage.setItem('popdog_inv_cache', JSON.stringify(invRows));
        }
      }
    }catch(err){ console.warn('Inventory load error', err); }

    // 3) ORDERS (raw → mapped)
    try{
      const ordersUrl = localStorage.getItem('popdog_orders_csv') || DEFAULT_ORDERS_CSV;
      if (ordersUrl){
        const ordersRaw = await loadCSV(ordersUrl);
        const mapped = (ordersRaw||[]).map(mapOrderRow).filter(o=>o && (o.sku || o.channel==='Kuaför') && o.qty>0 && o.date);
        try { localStorage.setItem('popdog_orders_cache', JSON.stringify(mapped)); } catch(e){}
      }
    }catch(err){ console.warn('Orders load error', err); }

    // 4) STOCK BLOCK render (after caches are ready)
    try { renderStockBlock(); } catch(e) { console.warn('renderStockBlock error', e); }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();

// ===== Ensure Expenses CSV loads on page load (idempotent) =====
// ===== Ensure Expenses CSV loads on page load (idempotent) =====
(function initExpensesLoader(){
  if (window.__popdog_expenses_inited) return; // prevent double init
  window.__popdog_expenses_inited = true;
  async function loadExp(){
    try{
      const expUrl = localStorage.getItem('popdog_expenses_csv') || DEFAULT_EXPENSES_CSV;
      if (!expUrl) return;
      const expRows = await loadExpensesCsv(expUrl);
      expensesRowsCache = Array.isArray(expRows) ? expRows : [];
      if (!Array.isArray(expensesRowsAdjustedCache) || !expensesRowsAdjustedCache.length){
        expensesRowsAdjustedCache = expensesRowsCache.slice();
      }
      renderMainExpensesTable();
      refreshExpensesUI();
    }catch(e){ console.warn('Expenses init error', e); }
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', loadExp, { once:true });
  } else {
    loadExp();
  }
})();


// === Helper: revenue YTD (same logic as setKPIs uses) ===
function revenueYTDForYear(year){
  try{
    if(!Array.isArray(monthlyCache)||!monthlyCache.length) return 0;
    return monthlyCache.filter(m=>m.year===year).reduce((a,b)=>a+(b.Total||0),0);
  }catch(e){ return 0; }
}

// Robustly parse expense amount in TRY, including USD->TRY conversion if needed
// === Expense helpers: robust date parse, category mapping (Zee.Dog override), TRY amount ===
function getExpenseISODate(r){
  try{
    const raw = (r && (r.Date || r.date)) ? String(r.Date || r.date).trim() : '';
    if (!raw) return '';
    const mIso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (mIso) return mIso[1];
    const mTr = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (mTr){
      let dd=+mTr[1], mm=+mTr[2], yy=+mTr[3]; if(yy<100) yy+=2000;
      return `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
    const d = new Date(raw);
    return isNaN(+d) ? '' : d.toISOString().slice(0,10);
  }catch(e){ return ''; }
}

// === REMOVED: Duplicate function definition (kept the most comprehensive version at line ~4759) ===

// === REMOVED: Duplicate function definition (kept the most comprehensive version below) ===
function readExpenseAmountTRY(r){
  try{
    if(!r) return 0;

    // 0) Zee.Dog kontrolü - Zee.Dog giderleri HER ZAMAN USD'dir
    const zeeRegex = /(zee[\s\.-]*dog|zeedog)/i;
    const zeeFields = String(r.Category || '') + ' ' + String(r.Subcategory || '') + ' ' +
                      String(r.FinalSubcategory || '') + ' ' + String(r.Description || '') + ' ' +
                      String(r.Merchant || '') + ' ' + String(r.Payee || '') + ' ' +
                      String(r.Source || '') + ' ' + String(r.Details || '') + ' ' +
                      String(r.Note || r.Notes || r.Memo || r.Aciklama || r['Açıklama'] || '');
    const isZeeDog = zeeRegex.test(zeeFields) ||
                     (typeof isZeeExpense === 'function' && isZeeExpense(r));

    // 1) Currency hint from row (accept various header variants)
    let currency = String(
      r.Currency || r['Para Birimi'] || r['Currency Code'] || r['Currency'] || ''
    ).trim().toUpperCase();

    // Zee.Dog için currency belirtilmemişse USD kabul et
    if (isZeeDog && !currency) {
      currency = 'USD';
    }

    // 2) Candidate amount fields (robust to header variants)
    let raw =
      r.Amount ??
      r.amount ??
      r['Amount (TRY)'] ??
      r['Amount (USD)'] ??
      r['Expense Amount'] ??
      r['Miktar'] ??
      r['Value'] ??
      r['Price'] ??
      r['Tutar'] ??
      r['Net Tutar'] ??
      r['Total'] ??
      r['Toplam'] ??
      0;

    const s = String(raw || '');

    // 3) Detect sign in accounting format "(1,234.00)"
    const isAccountingNegative = /^\s*\(.*\)\s*$/.test(s);

    // 4) Detect currency from field or inline symbols
    // Zee.Dog için özel: currency zaten USD olarak ayarlandı
    const looksUSD = currency === 'USD' || /\bUSD\b/i.test(s) || /^\s*\$/.test(s) || isZeeDog;
    const looksTRY = !isZeeDog && (currency === 'TRY' || /₺|TL|TRY/i.test(s));

    // 5) Helper to resolve TRY per USD (₺/USD)
    const resolveTryPerUsd = ()=>{
      // a) direct (stored) TRY per USD
      try{
        const tpu = Number(localStorage.getItem('popdog_fx_try_per_usd') || '0');
        if (tpu > 0) return tpu;
      }catch(e){}

      // b) we might only have USD per TRY in fxRateUSDPerTRY or storage → invert
      let usdPerTry = 0;
      if (typeof fxRateUSDPerTRY === 'number' && fxRateUSDPerTRY > 0) usdPerTry = fxRateUSDPerTRY;
      try{
        const upt = Number(localStorage.getItem('popdog_fx_usd_per_try') || '0');
        if (upt > 0) usdPerTry = usdPerTry || upt;
      }catch(e){}
      if (usdPerTry > 0) return 1 / usdPerTry;

      // c) derive from KPI widgets on screen (kpiYTD vs kpiYTD_USD)
      const derived = deriveTryPerUsdFromKPI();
      if (derived > 0) return derived;

      return 0;
    };

    // 6) Convert based on detection
    if (looksUSD){
      // Parse as USD first
      const usd = parseUSD(s);
      const tryPerUsd = resolveTryPerUsd();
      if (!tryPerUsd) return 0;
      const valTRY = usd * tryPerUsd;
      return isAccountingNegative ? -Math.abs(valTRY) : valTRY;
    }

    // 7) Default branch: treat as TRY (also honoring accounting negatives)
    if (isAccountingNegative){
      const inner = s.replace(/^\(|\)$/g,'');
      return -Math.abs(parseTL(inner));
    }
    if (looksTRY){
      return parseTL(s);
    }
    // If currency is unknown, prefer TRY interpretation
    return parseTL(s);
  }catch(e){
    return 0;
  }
}





// === Recompute expenses monthly + KPIs + chart when cache changes ===
function refreshExpensesUI(){
  try{
    expensesMonthlyCache = buildExpensesMonthly(expensesRowsCache||[]);
    // try to derive FX if not ready (from revenue YTD box)
    if(!fxRateUSDPerTRY){
      const tryPerUsd = deriveTryPerUsdFromKPI();
      if(tryPerUsd>0){ fxRateUSDPerTRY = 1 / tryPerUsd; }
    }
    setExpensesKPIs(expensesMonthlyCache);
    drawExpensesCharts(expensesMonthlyCache);
  }catch(e){ console.warn('Expenses UI refresh error', e); }
}

// Run once on load (after expensesRowsCache is filled by initExpensesLoader)
(function(){
  let tries = 0; const maxTries = 25; // ~20s
  const iv = setInterval(()=>{
    tries++;
    if(Array.isArray(expensesRowsCache) && expensesRowsCache.length){
      clearInterval(iv); refreshExpensesUI();
    } else if (tries>=maxTries){ clearInterval(iv); }
  }, 800);
})();

// === Helpers specific to Expenses (robust Zee.Dog handling) ===
function isZeeExpense(r){
  const re = /(zee[\s\.-]*dog|zeedog)/i;
  const fields = [
    r && r.FinalSubcategory, r && r.FinalCategory, r && r.MainCategory, r && r.Category, r && r.Subcategory,
    r && r.Source, r && r.Description, r && r.Details, r && r.Note, r && r.Notes, r && r.Memo,
    r && r.Merchant, r && r.Payee, r && r.Supplier, r && r.Vendor, r && r.Bank, r && r.Banka, r && r.Account,
    r && r.Aciklama, r && r['Açıklama']
  ];
  return fields.some(f => f && re.test(String(f)));
}

// Unified category extractor with HARD Zee.Dog override
function expenseCats(r){
  const finalSub = (r && r.FinalSubcategory ? String(r.FinalSubcategory).trim() : '');
  const finalCat = (r && r.FinalCategory    ? String(r.FinalCategory).trim()    : '');

  // Build a combined text for fallback normalization / Zee detection
  const parts = [
    r && r.FinalSubcategory, r && r.FinalCategory,
    r && r.Subcategory, r && r.Category, r && r.Kategori,
    r && r.Source, r && r.Aciklama, r && r['Açıklama'], r && r.Description, r && r.Details, r && r.Note, r && r.Notes, r && r.Memo,
    r && r.Merchant, r && r.Payee, r && r.Supplier, r && r.Vendor, r && r.Bank, r && r.Banka, r && r.Account
  ].filter(Boolean).map(x => String(x).trim());
  const combined = parts.join(' | ');

  // Fallback subcategory candidate via normalization
  const sub0 = finalSub || normalizeExpenseCategory(combined) || 'Diğer';

  // --- HARD override for Zee.Dog anywhere ---
  const zeeRegex = /(zee[\s\.-]*dog|zeedog)/i;
  const zeeAny   = zeeRegex.test(combined) || zeeRegex.test(sub0) || zeeRegex.test(finalCat);

  // Prefer explicitly provided "main" category fields from the source row.
  // This preserves granular categories like "Kredi", "Kira", "Google", etc.
  const explicitMainCandidates = [
    r && r.FinalCategory,
    r && r.MainCategory,
    r && r.Category,
    r && r.Kategori
  ].filter(Boolean).map(s => String(s).trim()).filter(s => s.length > 0);

  let main = '';
  if (zeeAny) {
    main = 'Zee.Dog';
  } else if (explicitMainCandidates.length) {
    // Use the first explicit main-like field
    main = explicitMainCandidates[0];
    // If it is literally "Diğer" but we have a better sub, promote sub to main
    if (/^diğer$/i.test(main) && sub0 && !/^diğer$/i.test(sub0)) {
      main = sub0;
    }
  } else {
    // No explicit main given → map based on normalized sub as a last resort
    main = mapMainExpenseCategory(sub0);
    // Avoid collapsing into "Diğer" if sub looks meaningful
    if (/^diğer$/i.test(main) && sub0 && !/^diğer$/i.test(sub0)) {
      main = sub0;
    }
  }

  const sub = zeeAny ? 'Zee.Dog' : (finalSub || sub0);
  return { sub, main };
}

function getExpenseISODate(r){
  const cands = [r && r.Date, r && r.date, r && r.DATE, r && r['Tarih'], r && r['Transaction Date'], r && r['Posting Date']];
  for(const c of cands){
    if(!c) continue;
    const s = String(c).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    if(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(s)){
      const iso = parseTRDateString(s);
      if(iso) return iso;
    }
  }
  return '';
}


function normalizeExpenseCategory(cat){
  const s0 = (cat || '').toString();
  if (!s0) return '';

  // 1) Başta "Diğer -" gibi süsleri temizle
  const s1 = s0.replace(/^diğer\s*[-:–—]\s*/i, '').replace(/^diger\s*[-:–—]\s*/i, '').trim();

  // 2) Küçük harfe indir, diakritikleri normalize et
  const toAscii = (str) => str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // mağaza -> magaza

  const s = toAscii(s1);

  // 3) Ayırıcılarla böl: " | " , "/" , " - "
  const tokens = s.split(/[|/]+/).flatMap(t => t.split(/\s+-\s+/)).map(t => t.trim()).filter(Boolean);

  // 4) "other/diğer/misc" sayılacak kelimeler
  const isOther = (t) => /^(other|others|misc|miscellaneous|cesitli|various|diverse|diger|digerleri)$/i.test(t);

  // 5) İlk "diğer" olmayan etiket
  const primary = tokens.find(t => !isOther(t)) || (tokens[0] || '');

  // 6) Sık görülen ad düzeltmeleri
  if (/^meta\s*ads?$/.test(primary) || /^facebook(\s*ads?)?$/.test(primary) || /^instagram(\s*ads?)?$/.test(primary)) return 'Facebook';
  if (/^google(\s*ads?|adwords)$/.test(primary)) return 'Google Ads';
  if (/^tik(tok| tok)(\s*ads?)?$/.test(primary)) return 'TikTok Ads';
  if (/(yurtici|aras|mng|surat|ptt|ups|dhl|fedex|trendyol\s*express|hepsijet)/.test(primary)) return 'Kargo';
  if (/(garanti|isbank|is\s*bankasi|qnb|enpara|akbank|ziraat|yapi\s*kredi|iyzico|iyzi|iyzi-co|payu|iyzico|iyzi\s*co|stripe|iyzico)/.test(primary)) return 'Banka/Ödeme';

  // 7) Özel ürün/marka örnekleri
  if (/(zee)[\s\.-]*(dog)|zeedog/.test(primary)) return 'Zee.Dog';

  // 8) Boşsa Diğer
  if (!primary || isOther(primary)) return 'Diğer';

  // 9) Standart boşluk temizliği
  return primary.replace(/\s+/g, ' ').trim();
}

function mapMainExpenseCategory(cat){
  // `cat` = normalizeExpenseCategory çıktısı veya özgün metin
  const s = (cat || '').toString().toLowerCase();

  // 1) Dijital Reklam
  if (/(facebook|google\s*ads?|adwords|instagram|tiktok|youtube|meta\s*ads?)/.test(s))
    return 'Dijital Reklam';

  // 2) Lojistik
  if (/(kargo|lojistik|shipping|nakliye|kurye|yurtici|aras|mng|surat|ptt|ups|dhl|fedex|trendyol\s*express|hepsijet)/.test(s))
    return 'Lojistik';

  // 3) Banka / Komisyon / Ödeme Kuruluşları
  if (/(banka|komisyon|pos\s*kesintisi|pos\s*ucreti|havale|eft|chargeback|kart\s*ucreti|iban\s*ucreti|iyzico|payu|stripe|paytr|papara|wise|paycell)/.test(s))
    return 'Banka / Komisyon';

  // 4) Vergiler
  if (/(vergi|kdv|stopaj|damga|gecikme|ceza|beyanname|muhasebe\s*damga)/.test(s))
    return 'Vergiler';

  // 5) Yazılım / Abonelik
  if (/(shopify|yazilim|abonelik|subscription|google\s*workspace|office\s*365|microsoft\s*365|slack|notion|figma|zoom|canva|trello|asana|jira|aws|gcp|azure|cloudflare)/.test(s))
    return 'Yazılım / Abonelik';

  // 6) Danışmanlık / Hizmet
  if (/(danisman|consult|freelance|ajans|agency|hukuk|legal|avukat|muhasebe\s*hizmet|ymm|denetim|tasarim|design|fotograf|video|prodüksiyon|prodüksiyon)/.test(s))
    return 'Danışmanlık Giderleri';

  // 7) Stok / Mal Alımı
  if (/(mal\s*al(imi|ımı)|stok|tedarik|sat(in|ın)\s*alma|purchase|supplier|tedarikci)/.test(s))
    return 'Stok / Mal Alımı';

  // 8) Mağaza Giderleri (yalnız mağaza/şube anahtarlarıyla eşle)
  if (/(magaza|mağaza|saha|sube|ckm|caddebostan|cadde|depo|thrones)/.test(s) &&
      /(kira|elektrik|su|dogalgaz|doğalgaz|aidat|guvenlik|güvenlik|temizlik|personel|maas|maaş|yemek|ssk|sgk|pos)/.test(s))
    return 'Mağaza Giderleri';

  // 9) Ev Giderleri (ev/konut anahtarı şart)
  if (/(ev|konut|daire|home|house)/.test(s) &&
      /(kira|elektrik|su|dogalgaz|doğalgaz|aidat|internet)/.test(s))
    return 'Ev Giderleri';

  // 9.b) Marka bazlı özel kasa: Zee.Dog ana kategori olarak ayrı listelensin
  if (/(zee)[\s\.-]*dog|zeedog/.test(s)) return 'Zee.Dog';
  // 10) Varsayılan
  return 'Diğer';
}



function buildExpensesMonthly(rows){
  const map = new Map();

  (rows || []).forEach(r => {
    const iso = (r && r.Date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.Date)))
      ? String(r.Date).slice(0,10)
      : getExpenseISODate(r);
    if (!iso) return;

    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(+d)) return;

    const key = monthKey(d);

   const amount = readExpenseAmountTRY(r);

    const cats = expenseCats(r);
    const subKey  = cats.sub || 'Diğer';
    const mainKey = cats.main || 'Diğer';

    const prev = map.get(key) || { month: key, year: d.getFullYear(), Total: 0, byCat: {}, byMain: {} };

    prev.Total += amount;
    prev.byCat[subKey]   = (prev.byCat[subKey]   || 0) + amount;
    prev.byMain[mainKey] = (prev.byMain[mainKey] || 0) + amount;

    map.set(key, prev);
  });

  return Array.from(map.values()).sort((a,b)=> a.month.localeCompare(b.month));
}

function setExpensesKPIs(expMonthly){
  const now = new Date();
  const curYear = now.getFullYear();
  // Yıl seçimi: Bu yıl veriniz yoksa, eldeki son yılı kullan
  const yearsExp = Array.from(new Set((expMonthly||[]).map(m=>m.year))).sort((a,b)=>a-b);
  const expYear = yearsExp.includes(curYear) ? curYear : (yearsExp.length ? yearsExp[yearsExp.length-1] : curYear);
  const rowsThisYear = (expMonthly||[]).filter(m=> m.year===expYear);
  const expYTD = rowsThisYear.reduce((a, r) => a + (r.Total || 0), 0);

  // YTD gider
  const elExp = document.getElementById('kpiExpYTD'); if (elExp) elExp.textContent = numberTL(expYTD);
  const elExpUSD = document.getElementById('kpiExpYTD_USD'); if (elExpUSD) elExpUSD.textContent = fxRateUSDPerTRY ? `≈ ${numberUSD(expYTD*fxRateUSDPerTRY)} USD` : '≈ – USD';

  // YoY (aynı ay sayısı hizalı)
  try{
    const monthsThis = rowsThisYear.map(r=> r.month.slice(5,7));
const prevSum = (expMonthly||[]).reduce((acc,r)=> (r.year===expYear-1 && monthsThis.includes(r.month.slice(5,7))) ? acc+(r.Total||0) : acc, 0);    const yoy = prevSum ? (expYTD - prevSum) / prevSum : 0;
    const elYoY = document.getElementById('kpiExpYoY'); if (elYoY) elYoY.textContent = `YTD YoY: ${(yoy*100).toFixed(1)}%`;
  }catch(e){}

  // MoM
  const sorted = rowsThisYear.slice().sort((a,b)=> a.month.localeCompare(b.month));
  const last = sorted.at(-1)?.Total || 0; const prev = sorted.at(-2)?.Total || 0;
  const mom = prev ? (last - prev) / prev : 0;
  const elMoM = document.getElementById('kpiExpMoM'); if (elMoM){ elMoM.textContent = `${(mom*100).toFixed(1)}%`; elMoM.classList.remove('kpi-up','kpi-down'); elMoM.classList.add(mom<=0?'kpi-up':'kpi-down'); }
  const elMoMNote = document.getElementById('kpiExpMoMNote'); if (elMoMNote){ const labs = sorted.map(m=>m.month); elMoMNote.textContent = labs.length>=2 ? `(${labs.at(-2)} → ${labs.at(-1)})` : ''; }

  // Net (Gelir YTD - Gider YTD)
  try{
    const revThisYear = (monthlyCache||[]).filter(m=> m.year===expYear).reduce((a,r)=> a+(r.Total||0), 0);
    const net = revThisYear - expYTD;
    const elNet = document.getElementById('kpiNetYTD'); if (elNet) elNet.textContent = numberTL(net);
    const elNetUSD = document.getElementById('kpiNetYTD_USD'); if (elNetUSD) elNetUSD.textContent = fxRateUSDPerTRY ? `≈ ${numberUSD(net*fxRateUSDPerTRY)} USD` : '≈ – USD';
    const elNetNote = document.getElementById('kpiNetNote'); if (elNetNote) elNetNote.textContent = `Gelir (YTD): ${numberTL(revThisYear)} • Gider (YTD): ${numberTL(expYTD)}`;
  }catch(e){}
}

/* renderMainExpenseTable() kaldırıldı: tblMainExpenses elemanı HTML'de yok,
   hiçbir yerden de çağrılmıyordu. Canlı olan renderMainExpensesTable()
   (çoğul) — Detay ve Gruplanmış tablolarını basan o. */
function drawExpensesCharts(){
  // Charts removed - placeholder function for compatibility
  if (!window.Chart) { return; }
  return;
}

/* ================== Expenses: Load & Refresh ================== */
function refreshExpenses(){
  try{
    // Amount alanları zaten readExpenseAmountTRY() ile TRY’ye normalize edilmiş durumda.
    expensesRowsAdjustedCache = Array.isArray(expensesRowsCache) ? expensesRowsCache.slice() : [];

    // Aylık agregasyonları doğrudan bu cache'ten oluştur
    expensesMonthlyCache = buildExpensesMonthly(expensesRowsAdjustedCache);

    // KPI + grafik + tablo
    setExpensesKPIs(expensesMonthlyCache);
    drawExpensesCharts(expensesMonthlyCache);
    renderMainExpensesTable();
  }catch(e){
    console.warn('refreshExpenses error', e);
  }
}

// URL / localStorage config for expenses CSV
const EXPENSES_CSV_URL =
  getParam('expenses') ||
  getParam('expenses_csv') ||
  localStorage.getItem('popdog_expenses_csv_url') ||
  DEFAULT_EXPENSES_CSV;

// YoY toggle for expenses chart
(function initExpYoyToggle(){
  const tgl = document.getElementById('expYoyToggle');
  const stateEl = document.getElementById('expYoyState');
  if (!tgl) return;
  tgl.addEventListener('click', ()=>{
    expYoyEnabled = !expYoyEnabled;
    if (stateEl) stateEl.textContent = expYoyEnabled ? 'Açık' : 'Kapalı';
    if (expensesMonthlyCache && expensesMonthlyCache.length) {
      drawExpensesCharts(expensesMonthlyCache);
    }
  });
})();

/* ================== Hook expenses into global refreshAll ================== */
(function patchRefreshAll(){
  const prev = window.refreshAll;
  window.refreshAll = function(...args){
    if (typeof prev === 'function') {
      try { prev.apply(this, args); } catch(e){ console.warn('refreshAll (prev) error', e); }
    }
    try { refreshExpenses(); } catch(e){ console.warn('refreshAll→refreshExpenses error', e); }
  };
})();



/* ================== Weekly UI ================== */
let weeklyAgg = [];
let selectedMondayISO = null;
function renderWeek(){
  if(!weeklyAgg.length){
    document.getElementById('weekCards').innerHTML = '<div class="hint text-sm">Haftalık veri yok.</div>';
    document.getElementById('weekWoW').textContent='';
    document.getElementById('weekLabel').textContent='';
    return;
  }
  if(!selectedMondayISO){ selectedMondayISO = weeklyAgg.at(-1).monday; }
  const idx = weeklyAgg.findIndex(w=>w.monday===selectedMondayISO);
  const cur = weeklyAgg[idx];
  const prev = weeklyAgg[idx-1] || null;

  document.getElementById('weekLabel').textContent = weekRangeLabel(new Date(cur.monday + "T00:00:00"));

  const keys = ['Total','Toptan','Online','CKM','Trendyol','Hepsiburada','Kuaför'];
  const labels = {Total:'Toplam', Toptan:'B2B', Online:'Online', CKM:'Shop', Trendyol:'Trendyol', Hepsiburada:'Hepsiburada', Kuaför:'Grooming'};
  const wrap = document.getElementById('weekCards'); wrap.innerHTML='';
  keys.forEach(k=>{
    const v = cur[k]||0;
    const p = prev ? prev[k]||0 : 0;
    const wow = p ? (v-p)/p : 0;
    const card = document.createElement('div');
    card.className='glass card-3d rounded-2xl p-3';
    const usdV = fxRateUSDPerTRY ? numberUSD(v * fxRateUSDPerTRY) : '–';
    card.innerHTML = `<div class="hint text-xs">${labels[k]}</div>
      <div class="text-slate-800 dark:text-slate-100 font-semibold">${numberTL(v)}</div>
      <div class="hint text-[10px]">≈ ${usdV}</div>
      <div class="${wow>=0?'kpi-up':'kpi-down'} text-xs">${(wow*100).toFixed(1)}%</div>`;
    wrap.appendChild(card);
  });

  const wowTotal = prev ? (cur.Total - prev.Total) / prev.Total : 0;
  document.getElementById('weekWoW').textContent = `WoW (Toplam): ${(wowTotal*100).toFixed(1)}%`;
}
document.getElementById('weekPrev').onclick = ()=>{
  if(!weeklyAgg.length || !selectedMondayISO) return;
  const idx = weeklyAgg.findIndex(w=>w.monday===selectedMondayISO);
  if(idx>0){ selectedMondayISO = weeklyAgg[idx-1].monday; renderWeek(); }
};
document.getElementById('weekNext').onclick = ()=>{
  if(!weeklyAgg.length || !selectedMondayISO) return;
  const idx = weeklyAgg.findIndex(w=>w.monday===selectedMondayISO);
  if(idx<weeklyAgg.length-1){ selectedMondayISO = weeklyAgg[idx+1].monday; renderWeek(); }
};

/* ================== Monthly View UI ================== */
let selectedMonthKey = null; // Seçili ay (ör: "2025-01")

function getMonthName(monthKey) {
  // "2025-01" → "Ocak 2025"
  const [year, month] = monthKey.split('-');
  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const monthIdx = parseInt(month, 10) - 1;
  return `${monthNames[monthIdx] || month} ${year}`;
}

function renderMonthlyView(){
  const mc = monthlyCache || [];
  const wrap = document.getElementById('monthCards');
  const labelEl = document.getElementById('monthLabel');
  const momEl = document.getElementById('monthMoM');
  if(!wrap) return;

  if(!mc.length){
    wrap.innerHTML = '<div class="hint text-sm">Aylık veri yok.</div>';
    if(labelEl) labelEl.textContent = '';
    if(momEl) momEl.textContent = '';
    return;
  }

  // Varsayılan: son ay seçili
  if(!selectedMonthKey){ selectedMonthKey = mc[mc.length - 1].month; }

  const idx = mc.findIndex(m => m.month === selectedMonthKey);
  const curMonth = mc[idx];
  const prevMonth = mc[idx - 1] || null;

  if(!curMonth){
    wrap.innerHTML = '<div class="hint text-sm">Seçili ay bulunamadı.</div>';
    return;
  }

  // Ay label'ı
  if(labelEl) labelEl.textContent = getMonthName(curMonth.month);

  const keys = ['Total', 'Toptan', 'Online', 'CKM', 'Trendyol', 'Hepsiburada', 'Kuaför'];
  const labels = {Total: 'Toplam', Toptan: 'B2B', Online: 'Online', CKM: 'Shop', Trendyol: 'Trendyol', Hepsiburada: 'Hepsiburada', Kuaför: 'Grooming'};

  wrap.innerHTML = '';
  keys.forEach(k => {
    const curVal = curMonth[k] || 0;
    const prvVal = prevMonth ? (prevMonth[k] || 0) : 0;
    const mom = prvVal ? (curVal - prvVal) / prvVal : 0;

    const card = document.createElement('div');
    card.className = 'glass card-3d rounded-2xl p-3';
    const usdCurVal = fxRateUSDPerTRY ? numberUSD(curVal * fxRateUSDPerTRY) : '–';
    card.innerHTML = `
      <div class="hint text-xs">${labels[k]}</div>
      <div class="text-slate-800 dark:text-slate-100 font-semibold">${numberTL(curVal)}</div>
      <div class="hint text-[10px]">≈ ${usdCurVal}</div>
      <div class="${mom >= 0 ? 'kpi-up' : 'kpi-down'} text-xs">MoM: ${(mom * 100).toFixed(1)}%</div>`;
    wrap.appendChild(card);
  });

  // MoM özet
  if(momEl && prevMonth){
    const totalMom = prevMonth.Total ? (curMonth.Total - prevMonth.Total) / prevMonth.Total : 0;
    momEl.textContent = `Önceki ay (${getMonthName(prevMonth.month)}): ${numberTL(prevMonth.Total)} | MoM: ${(totalMom * 100).toFixed(1)}%`;
  } else if(momEl){
    momEl.textContent = 'Önceki ay verisi yok';
  }
}

// Ay gezinme butonları
document.getElementById('monthPrev')?.addEventListener('click', () => {
  const mc = monthlyCache || [];
  if(!mc.length || !selectedMonthKey) return;
  const idx = mc.findIndex(m => m.month === selectedMonthKey);
  if(idx > 0){
    selectedMonthKey = mc[idx - 1].month;
    renderMonthlyView();
  }
});

document.getElementById('monthNext')?.addEventListener('click', () => {
  const mc = monthlyCache || [];
  if(!mc.length || !selectedMonthKey) return;
  const idx = mc.findIndex(m => m.month === selectedMonthKey);
  if(idx < mc.length - 1){
    selectedMonthKey = mc[idx + 1].month;
    renderMonthlyView();
  }
});

/* ================== Kanal Satışları (Orders) ================== */
let selectedChannelPeriod = 'ytd';

function renderChannelSales(){
  const wrap = document.getElementById('channelSalesCards');
  const periodEl = document.getElementById('channelSalesPeriod');
  const totalEl = document.getElementById('channelSalesTotal');
  if(!wrap) return;

  const data = buildChannelSalesFromOrders({ period: selectedChannelPeriod });
  const channels = data.channels || {};
  const total = data.total || { amountTRY: 0, usd: 0, qty: 0 };

  // Period label
  const periodLabels = { ytd: 'YTD', month: 'Bu Ay', week: 'Bu Hafta', all: 'Tümü' };
  if(periodEl) periodEl.textContent = periodLabels[selectedChannelPeriod] || 'YTD';

  // Kanalları sırala (toplam TRY'ye göre)
  const sortedChannels = Object.entries(channels).sort((a, b) => b[1].amountTRY - a[1].amountTRY);

  if(!sortedChannels.length){
    wrap.innerHTML = '<div class="hint text-sm">Shopify sipariş verisi bulunamadı. Orders CSV yükleniyor...</div>';
    if(totalEl) totalEl.textContent = '';
    return;
  }

  wrap.innerHTML = '';

  // Kanal ikonları
  const icons = {
    'CKM': '🏪',
    'Online': '🌐',
    'Trendyol': '🟠',
    'Hepsiburada': '🟡',
    'Kuaför': '💇',
    'Toptan': '📦'
  };

  sortedChannels.forEach(([ch, val]) => {
    const card = document.createElement('div');
    card.className = 'glass card-3d rounded-2xl p-3';
    const icon = icons[ch] || '📊';
    const tryFormatted = numberTL(val.amountTRY);
    const usdFormatted = val.usd ? `$${numberUSD(val.usd)}` : '–';
    // Yüzde hesapla
    const pct = total.amountTRY > 0 ? ((val.amountTRY / total.amountTRY) * 100).toFixed(1) : 0;
    card.innerHTML = `
      <div class="hint text-xs flex items-center gap-1">${icon} ${chLabel(ch)}</div>
      <div class="text-slate-800 dark:text-slate-100 font-semibold">${tryFormatted}</div>
      <div class="hint text-xs">${usdFormatted}</div>
      <div class="hint text-xs mt-1">${pct}% • ${(val.qty||0).toLocaleString('tr-TR')} adet</div>`;
    wrap.appendChild(card);
  });

  // Toplam
  if(totalEl){
    const totalTRYFormatted = numberTL(total.amountTRY);
    const totalUSD = total.usd ? `$${numberUSD(total.usd)}` : '–';
    const totalQty = (total.qty||0).toLocaleString('tr-TR');
    totalEl.textContent = `Toplam: ${totalTRYFormatted} • ${totalUSD} • ${totalQty} adet`;
  }
}

// Period seçici event listener
document.getElementById('channelSalesPeriodSelect')?.addEventListener('change', (e) => {
  selectedChannelPeriod = e.target.value;
  renderChannelSales();
});

/* ================== WhatsApp Paste → stage table ================== */
function grab(line, keys){ const s=line.toLowerCase(); return keys.some(k=>s.startsWith(k)); }
function extractValue(line){
  const m=line.match(/-?\d[\d\s.,]*/);
  if(!m) return 0;
  return parseTL(m[0]);
}
function parseDailyText(txt){
  const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let dateISO = '';
  let kk=0, qnb=0, nakit=0, toplam=0, kasaNakit=0, online=0, toptan=0, trendyol=0, hb=0, kuafor=0;

  for (const line of lines){
    const low = line.toLowerCase();

    if (low.includes('tarih')){ dateISO = parseTRDateString(line); continue; }

    // Kuaför / Grooming (must NOT be treated as CKM Nakit)
    if (low.startsWith('kuaf') || low.includes('kuaför') || low.includes('kuafor') || low.includes('grooming')){
      kuafor = extractValue(line);
      continue;
    }

    if (grab(low,['kredi kartı','kredi karti'])){ kk = extractValue(line); continue; }
    if (grab(low,['qnb','iş','is','garanti'])){ qnb = extractValue(line); continue; }

    // Nakit (exclude kasa nakit and kuaför)
    if ((low.includes('nakit') && !low.includes('kasa') && !low.includes('kuaf'))){
      nakit = extractValue(line);
      continue;
    }

    if (low.includes('toplam ciro')){ toplam = extractValue(line); continue; }
    if (low.includes('kasa nakit')){ kasaNakit = extractValue(line); continue; }
    if (low.includes('pop dog online')){ online = extractValue(line); continue; }
    if (low.includes('pop dog toptan')){ toptan = extractValue(line); continue; }
    if (low.startsWith('trendyol')){ trendyol = extractValue(line); continue; }
    if (low.startsWith('hepsiburada')){ hb = extractValue(line); continue; }
  }

  const ckm = (toplam > 0) ? toplam : (kk + qnb + nakit);
  return {
    Date: dateISO || '',
    Toptan: toptan || 0,
    Online: online || 0,
    CKM: ckm || 0,
    'Kuaför': kuafor || 0,
    'CKM Nakit': nakit || 0,
    'Kasa Nakit (EoD)': kasaNakit || 0,
    Trendyol: trendyol || 0,
    Hepsiburada: hb || 0,
    Total: (toptan + online + ckm + trendyol + hb)
  };
}
document.getElementById('parseAddBtn').onclick = ()=>{
  const txt=document.getElementById('dailyText').value;
  if(!txt.trim()){ document.getElementById('parseInfo').textContent='Metin boş.'; return; }
  const row=parseDailyText(txt);
  if(!row.Date){ document.getElementById('parseInfo').textContent='Tarih bulunamadı. "Tarih 07/09/2025" gibi.'; return; }
  stagedRows.push(row);
  document.getElementById('parseInfo').textContent=`Eklendi: ${row.Date}`;
  document.getElementById('dailyText').value='';
  refreshAll();
};
function renderStaged(){
  const tbody = document.getElementById('stagedTbody'); tbody.innerHTML='';
  for(const r of stagedRows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-2 pr-4">${r.Date}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.Toptan)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.Online)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.CKM)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r['Kuaför']||0)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r["CKM Nakit"]||0)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r["Kasa Nakit (EoD)"]||0)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.Trendyol)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.Hepsiburada)}</td>
      <td class="py-2 pr-4 text-right">${numberTL(r.Total)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ================== CSV I/O (local import/export) ================== */
document.getElementById('fileInput').addEventListener('change', e=>{
  const file = e.target.files && e.target.files[0]; if(!file) return;
  Papa.parse(file, { header:true, skipEmptyLines:true, complete:(res)=>{
    const data = (res.data||[]).map(r=>{
      const iso = r.Date ? String(r.Date).trim().slice(0,10) : '';
      const kuaforVal = parseTL(r['Kuaför'] ?? r['Kuafor'] ?? r['Grooming'] ?? 0);
      const row = {
        Date: iso,
        Toptan: parseTL(r.Toptan), Online: parseTL(r.Online),
        CKM: parseTL(r.CKM), ["CKM Nakit"]: parseTL(r["CKM Nakit"]),
        Kuaför: kuaforVal,
        Trendyol: parseTL(r.Trendyol), Hepsiburada: parseTL(r.Hepsiburada),
      };
      const rawSheetTotal = parseTL(r.Total);
      row.Total = rawSheetTotal > 0 ? rawSheetTotal : (row.Toptan + row.Online + row.CKM + row.Kuaför + row.Trendyol + row.Hepsiburada);
      return row;
    }).filter(r=>r.Date);
    loadedRows = data; localStorage.setItem('popdog_loaded_rows', JSON.stringify(loadedRows));
    refreshAll();
  }});
});
const _downloadBtn = null;   // HTML'de downloadBtn yok; blok korunuyor ama bağlanmıyor
if(_downloadBtn) _downloadBtn.onclick = ()=>{
  // loaded + staged → tekilleştir ve tarihe göre sırala
  const mergedRaw = [...loadedRows, ...stagedRows];
  const merged = dedupeDailyRows(mergedRaw); // aynı güne ait en anlamlı satırı seçer

  const headers = ['Date','Toptan','Online','CKM','Kuaför','CKM Nakit','Kasa Nakit (EoD)','Trendyol','Hepsiburada','Total'];
  const lines = [headers.join(",")].concat(merged.map(r=>[
    r.Date,
    r.Toptan,
    r.Online,
    r.CKM,
    (r['Kuaför']||0),
    (r['CKM Nakit']||0),
    (r['Kasa Nakit (EoD)']||0),
    r.Trendyol,
    r.Hepsiburada,
    r.Total
  ].join(",")));

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'revenue_2025_YTD.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ================== FX (TRY→USD) ================== */
async function fetchFX(){
  const fetchWithTimeout = async (url, timeout = 10000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };

  // Geçen yılın aynı günü için tarih hesapla
  async function fetchYoYRate(){
    try{
      const now = new Date();
      const lyDate = new Date(now);
      lyDate.setFullYear(lyDate.getFullYear() - 1);
      const yyyy = lyDate.getFullYear();
      const mm = String(lyDate.getMonth()+1).padStart(2,'0');
      const dd = String(lyDate.getDate()).padStart(2,'0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const url = `https://api.frankfurter.app/${dateStr}?from=USD&to=TRY`;
      const r = await fetchWithTimeout(url, 8000);
      const j = await r.json();
      if(j && j.rates && j.rates.TRY){
        const tryPerUsd = j.rates.TRY;
        const el = document.getElementById('fxNoteYoY');
        if(el) el.textContent = `Geçen yıl bugün (${dateStr}): 1 $ = ${tryPerUsd.toFixed(2)} ₺`;
      }
    }catch(e){}
  }

  try{
    const r = await fetchWithTimeout('https://open.er-api.com/v6/latest/TRY');
    const j = await r.json();
    if(j && j.rates && j.rates.USD){
      fxRateUSDPerTRY = j.rates.USD;
      fxDate = j.time_last_update_utc ? new Date(j.time_last_update_utc) : new Date();
      const tryPerUsd = fxRateUSDPerTRY ? (1 / fxRateUSDPerTRY) : null;
      document.getElementById('fxNote').textContent =
  tryPerUsd ? `Kur: ${fxDate.toLocaleDateString('tr-TR')} • 1 $ = ${tryPerUsd.toFixed(4)} ₺` : `Kur alınamadı`;
      fetchYoYRate();
try { refreshExpenses(); } catch(e) {}
try { renderMainExpensesTable(); } catch(e) {}
return;
    }
  }catch(e){}
  try{
    const r2 = await fetchWithTimeout('https://api.exchangerate.host/latest?base=TRY&symbols=USD');
    const j2 = await r2.json();
    if(j2 && j2.rates && j2.rates.USD){
      fxRateUSDPerTRY = j2.rates.USD;
      fxDate = j2.date ? new Date(j2.date) : new Date();
      const tryPerUsd = fxRateUSDPerTRY ? (1 / fxRateUSDPerTRY) : null;
      document.getElementById('fxNote').textContent =
  tryPerUsd ? `Kur: ${fxDate.toLocaleDateString('tr-TR')} • 1 $ = ${tryPerUsd.toFixed(4)} ₺` : `Kur alınamadı`;
      fetchYoYRate();
try { refreshExpenses(); } catch(e) {}
try { renderMainExpensesTable(); } catch(e) {}
return;
    }
  }catch(e){}
  document.getElementById('fxNote').textContent = `Kur alınamadı`;
}

/* ================== DEDUPE HELPERS (daily revenue rows) ================== */
function dedupeDailyRows(rows){
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const r of rows){
    if (!r || !r.Date) continue;
    const key = String(r.Date).slice(0,10);
    const cur = byDate.get(key);
    // Daha büyük Total'ı seç. Eşitse dolu sütunu fazla olanı al.
    if (!cur) { byDate.set(key, r); continue; }
    const tNew = (+r.Total||0);
    const tOld = (+cur.Total||0);
    if (tNew > tOld) { byDate.set(key, r); continue; }
    if (tNew === tOld) {
      const nzNew = ((+r.Toptan||0)>0) + ((+r.Online||0)>0) + ((+r.CKM||0)>0) + ((+r.Trendyol||0)>0) + ((+r.Hepsiburada||0)>0);
      const nzOld = ((+cur.Toptan||0)>0) + ((+cur.Online||0)>0) + ((+cur.CKM||0)>0) + ((+cur.Trendyol||0)>0) + ((+cur.Hepsiburada||0)>0);
      if (nzNew > nzOld) byDate.set(key, r);
    }
  }
  // Tarihe göre sırala
  return Array.from(byDate.values()).sort((a,b)=> (a.Date||'').localeCompare(b.Date||''));
}
/* ================== PIPELINE (Revenue) ================== */
function refreshAll(){
  // 1) loaded + staged → tekilleştir (aynı güne ait satırlarda en anlamlı olanı seç)
  const mergedRaw = [...loadedRows, ...stagedRows];
  const merged = dedupeDailyRows(mergedRaw); // zaten tarihe göre sıralı döner

  // 2) cache
  mergedRowsCache = merged;

  // 3) agregasyonlar
  const monthly = buildMonthly(merged);
  monthlyCache = monthly;
  const weekly  = buildWeekly(merged); weeklyAgg = weekly;

  // 4) Haftalık seçimi güncel son haftaya sabitle (varsa)
  const lastMonday = weeklyAgg.length ? weeklyAgg[weeklyAgg.length - 1].monday : null;
  if (
    !selectedMondayISO ||
    !weeklyAgg.some(w => w.monday === selectedMondayISO) ||
    (lastMonday && selectedMondayISO < lastMonday)
  ) {
    selectedMondayISO = lastMonday;
  }

  // 5) KPI + UI
  setKPIs(monthly);
  buildAlerts(monthly);
  drawCharts(monthly);
  renderTargets(monthly);
  renderStaged();
  renderWeek();
  renderMonthlyView();
  renderChannelSales();
  renderLast7();

  // 6) Stok bloğu
  renderStockBlock();
 // === Expenses (CFO) render ===
try {
  if (Array.isArray(expensesMonthlyCache) && expensesMonthlyCache.length) {
    drawExpensesCharts(expensesMonthlyCache);
  }
} catch (e) {
  console.warn('Expenses render error', e);
}

  // 7) Finansal Sağlık Metrikleri
  try {
    // Sabit gecikme yerine girdiler hazır olduğunda çalışan zamanlayıcı.
    if (typeof scheduleFinancialHealth === 'function') {
      scheduleFinancialHealth(0);
    }
  } catch(e) {
    console.warn('Financial health render error', e);
  }
}
// ================== BOOTSTRAP (safe, idempotent) ==================
(function bootPopdog(){
  if (window.__popdog_bootstrapped) return; // idempotent
  window.__popdog_bootstrapped = true;

  // Quick placeholders to avoid blank UI perception
  try{
    const el1 = document.getElementById('kpiYTD');
    if (el1) el1.textContent = 'yükleniyor…';
    const el2 = document.getElementById('kpiInvCost');
    if (el2) el2.textContent = 'yükleniyor…';
    const el3 = document.getElementById('kpiInvPrice');
    if (el3) el3.textContent = 'yükleniyor…';
  }catch(e){}

  async function boot(){
    try {
      // START ALL LOADS IN PARALLEL (guard against missing defaults)
      const sheetUrl = localStorage.getItem('popdog_sheet_csv')    || (window.DEFAULT_SHEET_CSV    || '');
      const invUrl   = localStorage.getItem('popdog_inv_csv')      || (window.DEFAULT_INV_CSV      || '');
      const ordUrl   = localStorage.getItem('popdog_orders_csv')   || (window.DEFAULT_ORDERS_CSV   || '');
      const expUrl   = localStorage.getItem('popdog_expenses_csv') || (window.DEFAULT_EXPENSES_CSV || '');

      const pRev = (async()=>{
        try{
          if(!sheetUrl) return;
          const revRows = await loadFromSheet(sheetUrl);
          loadedRows = Array.isArray(revRows) ? revRows : [];
          const monthly = buildMonthly(loadedRows);
          setKPIs(monthly);
          try { renderMainExpensesTable(); } catch(e) {}
          drawCharts(monthly);
          buildAlerts(monthly);
          renderTargets(monthly);
        } catch(e){ console.warn('Revenue render error', e); }
      })();

      const pInv = (async()=>{
        try{
          const gasBase = (typeof getSheetWebAppURL === 'function' ? getSheetWebAppURL() : null)
                       || (typeof SHEET_WEBAPP_URL !== 'undefined' ? SHEET_WEBAPP_URL : '');
          let loaded = false;
          if (gasBase) {
            try {
              const r = await fetch(`${gasBase}?action=stocksummary&t=${Date.now()}`, { cache:'no-store', redirect:'follow' });
              if (r.ok) {
                const d = await r.json();
                if (d.ok && Array.isArray(d.rows) && d.rows.length) {
                  localStorage.setItem('popdog_inv_cache', JSON.stringify(d.rows));
                  loaded = true;
                }
              }
            } catch(e){ console.warn('stocksummary fetch error', e); }
          }
          if (!loaded && invUrl) {
            const invRows = await loadCSV(invUrl);
            if (invRows && invRows.length) localStorage.setItem('popdog_inv_cache', JSON.stringify(invRows));
          }
          renderStockBlock();
        } catch(e){ console.warn('Inventory load/render error', e); }
      })();

      const pOrd = (async()=>{
        try{
          if(!ordUrl) return;
          const ordRaw = await loadCSV(ordUrl);
          const mapped = (ordRaw || []).map(mapOrderRow).filter(o=>o && (o.sku || o.channel==='Kuaför') && o.qty>0 && o.date);
          const persist = mapped.map(o=>({ sku:o.sku, qty:o.qty, price:o.price, date:o.date.toISOString(), channel:o.channel }));
          try { localStorage.setItem('popdog_orders_cache', JSON.stringify(persist)); } catch(e){}
          renderStockBlock();
        } catch(e){ console.warn('Orders load/render error', e); }
      })();

      const pExp = (async()=>{
        try{
          if(!expUrl) return;
          const expRows = await loadCSV(expUrl);
          expensesRowsCache = Array.isArray(expRows) ? expRows : [];
          if (!Array.isArray(expensesRowsAdjustedCache) || !expensesRowsAdjustedCache.length){
            expensesRowsAdjustedCache = expensesRowsCache.slice();
          }
          // Build monthly + KPIs + charts
          try { refreshExpenses(); } catch(e) { console.warn('refreshExpenses error', e); }
          // Ensure main table visible ASAP
          try { renderMainExpensesTable(); } catch(e){}
        } catch(e){ console.warn('Expenses load/render error', e); }
      })();

      const results = await Promise.allSettled([pRev, pInv, pOrd, pExp]);
      // Log any failed promises for debugging
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const names = ['Revenue', 'Inventory', 'Orders', 'Expenses'];
          console.warn(`${names[index]} load failed:`, result.reason);
        }
      });

      // Derive FX once (if needed) after first paints
      try {
        if (!fxRateUSDPerTRY){
          const tryPerUsd = deriveTryPerUsdFromKPI();
          if (tryPerUsd && isFinite(tryPerUsd)){
            fxRateUSDPerTRY = 1 / tryPerUsd;
          }
        }
      } catch(e){}
    } catch(err){
      console.error('BOOT error', err);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    // DOM is already ready
    boot();
  }
})();

/* ================== Last 7 Days Summary ================== */
function startOfDayLocal(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function renderLast7(){
  const wrap = document.getElementById('last7Wrap');
  if(!wrap) return;
  const note = document.getElementById('last7Note');

  const rows = Array.isArray(mergedRowsCache) ? mergedRowsCache : [];
  if(!rows.length){
    wrap.innerHTML = '<div class="hint text-sm">Veri yok.</div>';
    if (note) note.textContent = '';
    return;
  }

  // Gün gün toplamlar (bugün dahil son 7 gün)
  const dayMs = 24*60*60*1000;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for(let i=6; i>=0; i--){
    const d = new Date(today.getTime() - i*dayMs);
    days.push(d);
  }

  const byDate = new Map(); // ISO-> {Total, Toptan, Online, CKM, Kuafor, Trendyol, Hepsiburada}
  rows.forEach(r=>{
    if(!r.Date) return;
    const d = new Date(r.Date + 'T00:00:00'); d.setHours(0,0,0,0);
    const iso = d.toISOString().slice(0,10);
    const acc = byDate.get(iso) || {Total:0,Toptan:0,Online:0,CKM:0,Kuafor:0,Trendyol:0,Hepsiburada:0};
    const tpt=+r.Toptan||0, onl=+r.Online||0, ckm=+r.CKM||0, kua=+(r['Kuaför']||r.Kuafor)||0, trn=+r.Trendyol||0, hb=+r.Hepsiburada||0;
    const sheetTotal = +r.Total || 0;
    acc.Total += sheetTotal > 0 ? sheetTotal : (tpt+onl+ckm+trn+hb);
    acc.Toptan += tpt; acc.Online += onl; acc.CKM += ckm; acc.Kuafor += kua; acc.Trendyol += trn; acc.Hepsiburada += hb;
    byDate.set(iso, acc);
  });

  wrap.innerHTML = '';
  days.forEach(d=>{
    const iso = d.toISOString().slice(0,10);
    const acc = byDate.get(iso) || {Total:0,Toptan:0,Online:0,CKM:0,Kuafor:0,Trendyol:0,Hepsiburada:0};
    const card = document.createElement('div');
    card.className = 'glass card-3d rounded-2xl p-3';
    const lbl = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`;
    const usdTotal = fxRateUSDPerTRY ? numberUSD(acc.Total * fxRateUSDPerTRY) : '–';
    card.innerHTML = `
      <div class="hint text-xs">${lbl}</div>
      <div class="text-slate-800 dark:text-slate-100 font-semibold">${numberTL(acc.Total)}</div>
      <div class="hint text-[10px]">≈ ${usdTotal}</div>
      <div class="hint text-[11px]">T:${numberTL(acc.Toptan)} • O:${numberTL(acc.Online)} • C:${numberTL(acc.CKM)} • K:${numberTL(acc.Kuafor)} • Tr:${numberTL(acc.Trendyol)} • H:${numberTL(acc.Hepsiburada)}</div>
    `;
    wrap.appendChild(card);
  });

  if (note) {
    const first = days[0], last = days[days.length-1];
    const fmt = x => `${String(x.getDate()).padStart(2,'0')}.${String(x.getMonth()+1).padStart(2,'0')}`;
    note.textContent = `Gün gün: ${fmt(first)} – ${fmt(last)} (bugün dahil)`;
  }
}

/* ================== BOOT & SAVE ================== */
// No longer binding Data Source DOM elements

async function boot(){
  // 0) URL query param override (sheet, inv, orders) → directly persist
  const qpSheet  = getParam('sheet');
  const qpInv    = getParam('inv');
  const qpOrders = getParam('orders');
  if (qpSheet)  localStorage.setItem('popdog_sheet_csv_url',  qpSheet);
  if (qpInv)    localStorage.setItem('popdog_inv_csv_url',    qpInv);
  if (qpOrders) localStorage.setItem('popdog_orders_csv_url', qpOrders);

  // Optional: persist clean flag from URL (?clean=1/0)
  (function(){
    const p = getParam('clean');
    if (p === '1' || p === '0') {
      try { localStorage.setItem('popdog_clean_on_load', p); } catch(e){}
    }
  })();

  // 1) config.json (same folder) fallback if nothing set yet
  const hasAnyStored = !!(localStorage.getItem('popdog_sheet_csv_url')   ||
                          localStorage.getItem('popdog_inv_csv_url')     ||
                          localStorage.getItem('popdog_orders_csv_url')  ||
                          localStorage.getItem('popdog_expenses_csv_url'));
  if (!hasAnyStored) {
    try {
      const r = await fetch('config.json', { cache: 'no-store' });
      if (r.ok) {
        const cfg = await r.json();
        if (cfg.sheetCsv)     localStorage.setItem('popdog_sheet_csv_url',     cfg.sheetCsv);
        if (cfg.inventoryCsv) localStorage.setItem('popdog_inv_csv_url',       cfg.inventoryCsv);
        if (cfg.ordersCsv)    localStorage.setItem('popdog_orders_csv_url',    cfg.ordersCsv);
        if (cfg.expensesCsv)  localStorage.setItem('popdog_expenses_csv_url',  cfg.expensesCsv);
      }
    } catch (e) { /* silent */ }
  }

  // 2) Resolve URLs: localStorage → defaults
  const sheetUrl    = localStorage.getItem('popdog_sheet_csv_url')     || (typeof DEFAULT_SHEET_CSV     !== 'undefined' ? DEFAULT_SHEET_CSV     : '');
  const invUrl      = localStorage.getItem('popdog_inv_csv_url')       || (typeof DEFAULT_INV_CSV       !== 'undefined' ? DEFAULT_INV_CSV       : '');
  const ordersUrl   = localStorage.getItem('popdog_orders_csv_url')    || (typeof DEFAULT_ORDERS_CSV    !== 'undefined' ? DEFAULT_ORDERS_CSV    : '');
  const expensesUrl = localStorage.getItem('popdog_expenses_csv_url')  || (typeof DEFAULT_EXPENSES_CSV  !== 'undefined' ? DEFAULT_EXPENSES_CSV  : '');


// Expenses load (CSV)
try {
  expensesRowsCache = await loadExpensesCsv(expensesUrl);
  expensesMonthlyCache = []; // eskiden buildExpensesMonthly(...) idi
} catch(e) {
  expensesRowsCache = [];
  expensesMonthlyCache = [];
}
  // 3) FX
  try { await fetchFX(); } catch(e){}



  // 5) Load revenue (sheet)
  if (sheetUrl) {
    try {
      const data = await loadFromSheet(sheetUrl);
      if (!data.length) throw new Error('Sheet boş döndü');
      loadedRows = data;
      localStorage.setItem('popdog_loaded_rows', JSON.stringify(loadedRows));
      const first = loadedRows[0]?.Date || '—';
      const last  = loadedRows.at(-1)?.Date || '—';
    } catch (e) {
      console.warn('Sheet yüklenemedi. URL ve yayınlama ayarlarını kontrol et.', e);
    }
  } else {
    console.warn('CSV URL yok: Sheet verisi yüklenemedi.');
  }

  // 6) inventory_value — Apps Script'ten direkt JSON olarak çek (published CSV cache'ini bypass eder)
  try {
    const gasBase = (typeof getSheetWebAppURL === 'function' ? getSheetWebAppURL() : null)
                 || SHEET_WEBAPP_URL || '';
    if (gasBase) {
      const gasResp = await fetch(`${gasBase}?action=stocksummary&t=${Date.now()}`, {
        cache: 'no-store',
        redirect: 'follow'
      });
      if (gasResp.ok) {
        const gasData = await gasResp.json();
        if (gasData.ok && Array.isArray(gasData.rows) && gasData.rows.length) {
          localStorage.setItem('popdog_inv_cache', JSON.stringify(gasData.rows));
        } else {
          console.warn('stocksummary boş/hatalı döndü, CSV fallback deneniyor:', gasData);
          if (invUrl) {
            const invRows = await loadCSV(invUrl);
            if (invRows.length) localStorage.setItem('popdog_inv_cache', JSON.stringify(invRows));
          }
        }
      } else {
        throw new Error(`stocksummary HTTP ${gasResp.status}`);
      }
    } else if (invUrl) {
      const invRows = await loadCSV(invUrl);
      if (invRows.length) localStorage.setItem('popdog_inv_cache', JSON.stringify(invRows));
    }
  } catch (e) {
    console.warn('INV load error, CSV fallback deneniyor:', e);
    try {
      if (invUrl) {
        const invRows = await loadCSV(invUrl);
        if (invRows.length) localStorage.setItem('popdog_inv_cache', JSON.stringify(invRows));
      }
    } catch (e2) { console.warn('INV CSV fallback da başarısız:', e2); }
  }

  // 7) orders_raw (Shopify)
  try {
    if (ordersUrl) {
      const rawRows = await loadCSV(ordersUrl);
      const mapped = rawRows.map(mapOrderRow)
                            .filter(o => (o.sku || o.channel === 'Kuaför') && o.qty > 0 && o.date && !isNaN(+o.date));
      localStorage.setItem('popdog_orders_cache', JSON.stringify(mapped));
    }
  } catch (e) { console.warn('ORDERS CSV error', e); }

  initSalesWindowSelector();
  initStockSearch();
  initStockExport();
  refreshAll();
  (function(){
    // yoyToggle/yoyState HTML'den kaldırılmış; Giderler sayfasındaki
    // expYoyToggle ayrı bir kontrol ve kendi kodu var.
    const t = null;
    if (!t) return;
    const syncLabel = () => {};
  })();
}

/* ================== WRITE TO SHEET ================== */
async function writeStagedToSheet(){
  const infoEl = document.getElementById('parseInfo');
  const rows = Array.isArray(window.stagedRows)
    ? window.stagedRows.slice()
    : (Array.isArray(stagedRows) ? stagedRows.slice() : []);

  if (!rows.length) {
    if (infoEl) infoEl.textContent = 'Önce satır ekleyin (Satıra çevir ve ekle).';
    return;
  }

  if (infoEl) infoEl.textContent = 'Sheet’e yazılıyor...';

  // Normalize payload to guarantee Kuaför is sent
  const payloadRows = rows.map(r => {
    const kuafor = parseTL((r && (r['Kuaför'] ?? r['Kuafor'] ?? r['Grooming'] ?? r['grooming'])) ?? 0) || 0;
    return {
      Date: String((r && r.Date) || ''),
      Toptan: Number((r && r.Toptan) || 0) || 0,
      Online: Number((r && r.Online) || 0) || 0,
      CKM: Number((r && r.CKM) || 0) || 0,
      'Kuaför': kuafor,
      'CKM Nakit': Number((r && r['CKM Nakit']) || 0) || 0,
      'Kasa Nakit (EoD)': Number((r && r['Kasa Nakit (EoD)']) || 0) || 0,
      Trendyol: Number((r && r.Trendyol) || 0) || 0,
      Hepsiburada: Number((r && r.Hepsiburada) || 0) || 0,
      Total: Number((r && r.Total) || 0) || 0,
    };
  });

  const WEBAPP_URL = (typeof getSheetWebAppURL === 'function')
    ? getSheetWebAppURL()
    : (typeof SHEET_WEBAPP_URL !== 'undefined' ? SHEET_WEBAPP_URL : '');

  if (!isValidWebAppURL(String(WEBAPP_URL||''))) {
    if (infoEl) infoEl.textContent = '⚠️ Apps Script Web App URL tanımlı değil.';
    try{ await setupSheetWebAppURL(infoEl); }catch(_){ }
    return;
  }

  try {
    // IMPORTANT (Apps Script Web App + CORS):
    // Use "simple" requests (text/plain or x-www-form-urlencoded) to avoid an OPTIONS preflight,
    // which Apps Script Web Apps often reject (showing "Load failed" in Safari/Chrome).
    async function postOnce(opts){
      const res = await fetch(WEBAPP_URL, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        cache: 'no-store',
        ...opts
      });
      const raw = await res.text().catch(()=> '');
      let json = null;
      try{ json = JSON.parse(raw); }catch(_){ json = null; }
      return { res, raw, json };
    }


    let out;
    try{
      out = await postOnce({
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'appenddaily', rows: payloadRows })
      });
    }catch(_e1){
      out = null;
    }

    // Retry with classic form-urlencoded if the first attempt failed (network/preflight quirks)
    if (!out || !out.res || !out.res.ok){
      const form = new URLSearchParams();
      form.set('action', 'appenddaily');
      form.set('rows', JSON.stringify(payloadRows));
      out = await postOnce({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form.toString()
      });
    }

    const res = out.res;
    const raw = out.raw;
    let j = out.json;


    if (!res.ok || (j && j.ok === false)) {
      const msg = (j && (j.error || j.message)) ? (j.error || j.message) : raw;
      throw new Error(msg || ('HTTP ' + res.status));
    }

    const added = (j && typeof j.added === 'number') ? j.added : payloadRows.length;

    if (infoEl) infoEl.textContent = `Sheet'e yazıldı (${added} satır).`;

    // Clear staged rows
    if (Array.isArray(window.stagedRows)) window.stagedRows.length = 0;
    try{ if (typeof renderStagedRows === 'function') renderStagedRows([]); }catch(_){ }
    try{ if (typeof renderStaged === 'function') renderStaged(); }catch(_){ }

  } catch (err) {
    if (infoEl) infoEl.textContent = `Hata: ${String(err && err.message ? err.message : err)}`;
  }
}

// Bind daily sheet write buttons (single writer)
(function(){
  // writeSheetBtn HTML'de yok; yazma butonu pushRowsBtn.
  const a = document.getElementById('pushRowsBtn');
  if (a) a.onclick = writeStagedToSheet;
})();












/* ================== BOOT! ================== */
boot();
// === FUND AUTO QUOTES (FI5 / SAS / ISY) — frontend fetch to Apps Script ===
(function(){
  const HOUR = 60*60*1000;
  const STALE_MS = 22*HOUR;

  const FUND = {
    fi5: { inputId:'fi5UnitInput', unitKey:'popdog_fi5_unit_try', tsKey:'popdog_fi5_updated_at', stateKey:'fi5UnitTRY' },
    sas: { inputId:'sasUnitInput', unitKey:'popdog_sas_unit_try', tsKey:'popdog_sas_updated_at', stateKey:'sasUnitTRY' },
    isy: { inputId:'isyUnitInput', unitKey:'popdog_isy_unit_try', tsKey:'popdog_isy_updated_at', stateKey:'isyUnitTRY' },
  };

  function now(){ return Date.now(); }
  function isStale(ts){ if(!ts) return true; const age = now() - Number(ts||0); return !(age>0) || age > STALE_MS; }

  async function fetchFundQuote(type){
    const url = getSheetWebAppURL();
    if (!isValidWebAppURL(url)) throw new Error('Apps Script URL geçersiz.');
    const req = `${url}?action=fundQuote&type=${encodeURIComponent(type)}`;
    const r = await fetch(req, { method:'GET', cache:'no-store' });
    let j = null; try{ j = await r.json(); }catch(_){}
    if (!r.ok || !j || j.ok === false) throw new Error(`HTTP ${r.status}`);
    const val = Number(j.unitTRY ?? j.price ?? j.value ?? 0);
    if (!val || isNaN(val)) throw new Error('Geçersiz değer');
    return { unit: val, source: j.source || 'server' };
  }

  function applyFundUnit(type, unit, source){
    const cfg = FUND[type]; if(!cfg) return;
    try{
      localStorage.setItem(cfg.unitKey, String(unit));
      localStorage.setItem(cfg.tsKey, String(now()));
    }catch(_){}
    try{
      const st = getLoansState();
      if (st && st.demoBank){ st.demoBank[cfg.stateKey] = unit; setLoansState(st); }
    }catch(_){}
    try{
      const inp = document.getElementById(cfg.inputId);
      if (inp && !inp.value) inp.value = String(unit);
      if (typeof renderLoansBlock === 'function') renderLoansBlock();
    }catch(_){}
  }

  async function maybeRefreshFund(type){
    const cfg = FUND[type]; if(!cfg) return;

    // If user has entered a value into the input, don't override
    const manual = (function(){
      try{
        const el = document.getElementById(cfg.inputId);
        return parseTL(el && el.value ? el.value : 0);
      }catch(_){ return 0; }
    })();
    if (manual > 0) return;

    const cached = Number(localStorage.getItem(cfg.unitKey) || 0);
    const ts     = Number(localStorage.getItem(cfg.tsKey)   || 0);
    if (cached > 0 && !isStale(ts)) return; // fresh enough

    try{
      const { unit, source } = await fetchFundQuote(type);
      if (unit && unit > 0) applyFundUnit(type, unit, source);
    }catch(e){
      console.warn('fundQuote fetch failed:', type, e && e.message ? e.message : e);
    }
  }

  // Run after DOM is ready so inputs exist
  document.addEventListener('DOMContentLoaded', ()=>{
    ['fi5','sas','isy'].forEach(maybeRefreshFund);
    // periodic gentle refresh
    setInterval(()=> ['fi5','sas','isy'].forEach(maybeRefreshFund), 6*HOUR);
  });
})();
// ===== Auto fund unit price fetchers (FI5 / SAS / ISY) =====
async function fetchFundQuote_(kind){
  const base = getSheetWebAppURL();
  const url = `${base}?action=${encodeURIComponent(kind + 'Quote')}`; // expects doPost/doGet handler fi5Quote/sasQuote/isyQuote
  try{
    const r = await fetch(url, { method:'GET', cache:'no-store' });
    if(!r.ok) return null;
    const j = await r.json().catch(()=>null);
    if (!j || j.ok === false) return null;
    const v = Number(j.unitTRY || j.unit || j.price || 0);
    return (v && v>0) ? { unitTRY: v, source: j.source || kind } : null;
  }catch(_){ return null; }
}

async function autoUpdateFI5(){
  try{
    const st = getLoansState();
    const cur = st.demoBank?.fi5UnitTRY || Number(localStorage.getItem('popdog_fi5_unit_try')||0) || 0;
    const input = document.getElementById('fi5UnitInput');
    const need = !(cur>0) && input && !String(input.value||'').trim();
    if(!need) return; // don't overwrite user-entered value
    const q = await fetchFundQuote_('fi5');
    if(q && q.unitTRY>0){
      if(input) input.value = String(q.unitTRY);
      st.demoBank.fi5UnitTRY = q.unitTRY;
      setLoansState(st);
      try{
        localStorage.setItem('popdog_fi5_unit_try', String(q.unitTRY));
        localStorage.setItem('popdog_fi5_updated_at', String(Date.now()));
      }catch(_){ }
      try{ renderLoansBlock(); }catch(_){}
    }
  }catch(_){ }
}

async function autoUpdateSAS(){
  try{
    const st = getLoansState();
    const cur = st.demoBank?.sasUnitTRY || Number(localStorage.getItem('popdog_sas_unit_try')||0) || 0;
    const input = document.getElementById('sasUnitInput');
    const need = !(cur>0) && input && !String(input.value||'').trim();
    if(!need) return;
    const q = await fetchFundQuote_('sas');
    if(q && q.unitTRY>0){
      if(input) input.value = String(q.unitTRY);
      st.demoBank.sasUnitTRY = q.unitTRY;
      setLoansState(st);
      try{
        localStorage.setItem('popdog_sas_unit_try', String(q.unitTRY));
        localStorage.setItem('popdog_sas_updated_at', String(Date.now()));
      }catch(_){ }
      try{ renderLoansBlock(); }catch(_){}
    }
  }catch(_){ }
}

async function autoUpdateISY(){
  try{
    const st = getLoansState();
    const cur = st.demoBank?.isyUnitTRY || Number(localStorage.getItem('popdog_isy_unit_try')||0) || 0;
    const input = document.getElementById('isyUnitInput');
    const need = !(cur>0) && input && !String(input.value||'').trim();
    if(!need) return;
    const q = await fetchFundQuote_('isy');
    if(q && q.unitTRY>0){
      if(input) input.value = String(q.unitTRY);
      st.demoBank.isyUnitTRY = q.unitTRY;
      setLoansState(st);
      try{
        localStorage.setItem('popdog_isy_unit_try', String(q.unitTRY));
        localStorage.setItem('popdog_isy_updated_at', String(Date.now()));
      }catch(_){ }
      try{ renderLoansBlock(); }catch(_){}
    }
  }catch(_){ }
}

async function autoUpdateFunds(){
  await Promise.all([ autoUpdateFI5(), autoUpdateSAS(), autoUpdateISY() ]);
}

// Run once on load; do not overwrite user input if present
try{ document.addEventListener('DOMContentLoaded', ()=>{ autoUpdateFunds(); }, { once:true }); }catch(_){ }

// Optional: refresh quotes every 6h if fields are still empty
try{ setInterval(()=>{ autoUpdateFunds(); }, 6*60*60*1000); }catch(_){ }
