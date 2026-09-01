document.addEventListener('DOMContentLoaded', async () => {
  // Eski Service Worker’ları iptal et
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    } catch (e) { /* yoksay */ }
  }

  // Cache Storage’ı temizle
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) { /* yoksay */ }
  }

  // İstersen localStorage da sıfırlanabilir (tamamen cachesiz istiyorsan):
  // localStorage.clear();

  // UI render’dan sonra canlı veriyi çek
  setTimeout(refreshFundQuotes, 300);

  // Çift tıklamada tazele (kullanışlı)
  ['fi5UnitInput','sasUnitInput','isyUnitInput'].forEach(id=>{
    const el = document.getElementById(id);
    if (el){
      el.title = 'Çift tıkla: sunucudan en son birim fiyatı çek';
      el.addEventListener('dblclick', refreshFundQuotes);
    }
  });
});
// === Krediler & Bekleyen Ödemeler bloğunu başlangıçta bir kez render et ===
document.addEventListener('DOMContentLoaded', function(){
  try{ renderLoansBlock(); }catch(_){}
  // Yeni: expenses_master'tan dinamik sayım yap
  try{ refreshLoansFromExpenses(); }catch(_){}
}, { once:true });

// === Nakit Akış & Finansal Sağlık Metrikleri ===
const ANNUAL_TARGET_KEY = 'popdog_annual_target';

function renderFinancialHealth(){
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    // YTD Ciro - mevcut KPI'dan al
    let ytdRevenue = 0;
    try {
      const kpiYTDEl = document.getElementById('kpiYTD');
      if (kpiYTDEl) {
        const txt = kpiYTDEl.textContent || '';
        ytdRevenue = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      }
    } catch(e){}

    // YTD Giderler - mevcut KPI'dan al
    let ytdExpenses = 0;
    try {
      const kpiExpEl = document.getElementById('kpiExpYTD');
      if (kpiExpEl) {
        const txt = kpiExpEl.textContent || '';
        ytdExpenses = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      }
    } catch(e){}

    // Stok maliyeti - mevcut KPI'dan al
    let stockCost = 0;
    try {
      const kpiStockEl = document.getElementById('kpiInvCost');
      if (kpiStockEl) {
        const txt = kpiStockEl.textContent || '';
        stockCost = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      }
    } catch(e){}

    // Stok satış değeri
    let stockSaleValue = 0;
    try {
      const kpiStockSaleEl = document.getElementById('kpiInvPrice');
      if (kpiStockSaleEl) {
        const txt = kpiStockSaleEl.textContent || '';
        stockSaleValue = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      }
    } catch(e){}

    // GERÇEK COGS: Sipariş ve envanter verilerinden hesapla
    let realCOGS = 0;
    let cogsMatchRate = 0;
    let useRealCOGS = false;

    try {
      // Envanter ve sipariş verilerini al
      const invCache = JSON.parse(localStorage.getItem('popdog_inv_cache') || '[]');
      const ordCache = JSON.parse(localStorage.getItem('popdog_orders_cache') || '[]');

      // Tarihleri düzelt (string → Date)
      const ordersWithDates = ordCache.map(o => ({
        ...o,
        date: o.date ? new Date(o.date) : null
      })).filter(o => o.date);

      if (invCache.length > 0 && ordersWithDates.length > 0) {
        // YTD filtresi
        const ytdStart = new Date(currentYear, 0, 1);
        const ytdEnd = new Date();

        const cogsResult = calculateRealCOGS(ordersWithDates, invCache, {
          startDate: ytdStart,
          endDate: ytdEnd
        });

        if (cogsResult.totalCOGS > 0 && cogsResult.matchRate > 50) {
          realCOGS = cogsResult.totalCOGS;
          cogsMatchRate = cogsResult.matchRate;
          useRealCOGS = true;
          // Global'de sakla (kanal karlılığı için)
          window.__ytdCOGSResult = cogsResult;
        }
      }
    } catch(e) {
      console.warn('Real COGS calculation error:', e);
    }

    // Fallback: Stok maliyet/satış oranı üzerinden tahmini COGS
    let cogsRatio = 0.45; // varsayılan %45
    if (stockCost > 0 && stockSaleValue > 0) {
      cogsRatio = stockCost / stockSaleValue;
    }
    const estimatedCOGS = ytdRevenue * cogsRatio;

    // Kullanılacak COGS
    const finalCOGS = useRealCOGS ? realCOGS : estimatedCOGS;

    // Brüt Kar
    const grossProfit = ytdRevenue - finalCOGS;
    const grossMargin = ytdRevenue > 0 ? (grossProfit / ytdRevenue) * 100 : 0;

    // Net Kar (Ciro - COGS - Giderler)
    const netProfit = grossProfit - ytdExpenses;
    const netMargin = ytdRevenue > 0 ? (netProfit / ytdRevenue) * 100 : 0;

    // Gider/Ciro oranı
    const expenseRatio = ytdRevenue > 0 ? (ytdExpenses / ytdRevenue) * 100 : 0;

    // Runway: Stok değeri / aylık ortalama gider
    const monthsElapsed = currentMonth + 1;
    const avgMonthlyExpense = monthsElapsed > 0 ? ytdExpenses / monthsElapsed : 0;
    const runway = avgMonthlyExpense > 0 ? stockCost / avgMonthlyExpense : 0;

    // USD dönüşümü için FX
    let fxRate = 0;
    try {
      fxRate = Number(localStorage.getItem('popdog_fx_try_per_usd') || '0');
      if (!fxRate) {
        const derived = (typeof deriveTryPerUsdFromKPI === 'function') ? deriveTryPerUsdFromKPI() : 0;
        fxRate = derived || 35;
      }
    } catch(e){ fxRate = 35; }
    const usdPerTry = fxRate > 0 ? 1 / fxRate : 0;

    // KPI'ları güncelle
    const elGrossMargin = document.getElementById('kpiGrossMargin');
    if (elGrossMargin) {
      elGrossMargin.textContent = grossMargin > 0 ? `%${grossMargin.toFixed(1)}` : '–%';
      elGrossMargin.className = grossMargin >= 40 ? 'text-xl font-bold text-green-600 dark:text-green-400' :
                                 grossMargin >= 25 ? 'text-xl font-bold text-yellow-600 dark:text-yellow-400' :
                                 'text-xl font-bold text-red-600 dark:text-red-400';
    }

    // Brüt Kar Marjı notu güncelle (gerçek vs tahmini)
    const elGrossMarginNote = document.getElementById('kpiGrossMarginNote');
    if (elGrossMarginNote) {
      if (useRealCOGS) {
        elGrossMarginNote.innerHTML = `<span class="text-green-600 dark:text-green-400">✓ Gerçek COGS</span> (eşleşme: %${cogsMatchRate.toFixed(0)})`;
      } else {
        elGrossMarginNote.innerHTML = `<span class="text-orange-500">Tahmini</span> (stok oranı: %${(cogsRatio * 100).toFixed(0)})`;
      }
    }

    const elNetMargin = document.getElementById('kpiNetMargin');
    if (elNetMargin) {
      elNetMargin.textContent = netMargin !== 0 ? `%${netMargin.toFixed(1)}` : '–%';
      elNetMargin.className = netMargin >= 15 ? 'text-xl font-bold text-green-600 dark:text-green-400' :
                               netMargin >= 5 ? 'text-xl font-bold text-yellow-600 dark:text-yellow-400' :
                               'text-xl font-bold text-red-600 dark:text-red-400';
    }

    const elExpenseRatio = document.getElementById('kpiExpenseRatio');
    if (elExpenseRatio) {
      elExpenseRatio.textContent = expenseRatio > 0 ? `%${expenseRatio.toFixed(1)}` : '–%';
      elExpenseRatio.className = expenseRatio <= 30 ? 'text-xl font-bold text-green-600 dark:text-green-400' :
                                  expenseRatio <= 50 ? 'text-xl font-bold text-yellow-600 dark:text-yellow-400' :
                                  'text-xl font-bold text-red-600 dark:text-red-400';
    }

    const elRunway = document.getElementById('kpiRunway');
    if (elRunway) {
      elRunway.textContent = runway > 0 ? `${runway.toFixed(1)} ay` : '– ay';
      elRunway.className = runway >= 6 ? 'text-xl font-bold text-green-600 dark:text-green-400' :
                            runway >= 3 ? 'text-xl font-bold text-yellow-600 dark:text-yellow-400' :
                            'text-xl font-bold text-red-600 dark:text-red-400';
    }

    const elRunwayNote = document.getElementById('kpiRunwayNote');
    if (elRunwayNote && avgMonthlyExpense > 0) {
      elRunwayNote.textContent = `Ort. aylık gider: ${numberTL(avgMonthlyExpense)}`;
    }

    // Karlılık detay tablosu
    const elProfRevenue = document.getElementById('profRevenue');
    if (elProfRevenue) elProfRevenue.textContent = numberTL(ytdRevenue);

    const elProfRevenueUSD = document.getElementById('profRevenueUSD');
    if (elProfRevenueUSD) elProfRevenueUSD.textContent = usdPerTry > 0 ? `$${(ytdRevenue * usdPerTry).toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–';

    const elProfCOGS = document.getElementById('profCOGS');
    if (elProfCOGS) elProfCOGS.textContent = numberTL(estimatedCOGS);

    const elProfCOGSUSD = document.getElementById('profCOGSUSD');
    if (elProfCOGSUSD) elProfCOGSUSD.textContent = usdPerTry > 0 ? `$${(estimatedCOGS * usdPerTry).toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–';

    const elProfGrossProfit = document.getElementById('profGrossProfit');
    if (elProfGrossProfit) elProfGrossProfit.textContent = numberTL(grossProfit);

    const elProfGrossProfitUSD = document.getElementById('profGrossProfitUSD');
    if (elProfGrossProfitUSD) elProfGrossProfitUSD.textContent = usdPerTry > 0 ? `$${(grossProfit * usdPerTry).toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–';

    const elProfExpenses = document.getElementById('profExpenses');
    if (elProfExpenses) elProfExpenses.textContent = numberTL(ytdExpenses);

    const elProfExpensesUSD = document.getElementById('profExpensesUSD');
    if (elProfExpensesUSD) elProfExpensesUSD.textContent = usdPerTry > 0 ? `$${(ytdExpenses * usdPerTry).toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–';

    const elProfNetProfit = document.getElementById('profNetProfit');
    if (elProfNetProfit) elProfNetProfit.textContent = numberTL(netProfit);

    const elProfNetProfitUSD = document.getElementById('profNetProfitUSD');
    if (elProfNetProfitUSD) elProfNetProfitUSD.textContent = usdPerTry > 0 ? `$${(netProfit * usdPerTry).toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–';

    // Son güncelleme
    const elUpdate = document.getElementById('cashFlowLastUpdate');
    if (elUpdate) elUpdate.textContent = `Son güncelleme: ${now.toLocaleString('tr-TR')}`;

    // Hedef vs Gerçekleşen
    renderAnnualTarget(ytdRevenue, currentMonth);

    // Yaklaşan ödemeler
    renderUpcomingPayments();

  } catch(e) {
    console.warn('renderFinancialHealth error:', e);
  }
}

function renderAnnualTarget(ytdRevenue, currentMonth){
  try {
    /* Hedef önce KV'den (cihazlar arası ortak), yoksa localStorage'dan,
       o da yoksa varsayılandan gelir. Eskiden yalnızca localStorage'daydı ve
       sürüm sıfırlamasında kayboluyordu. */
    let savedTarget = null;
    try {
      const st = (typeof getLoansState === 'function') ? getLoansState() : null;
      if (st && Number(st.yillikHedef) > 0) savedTarget = String(st.yillikHedef);
    } catch(_){}
    if (!savedTarget) savedTarget = localStorage.getItem(ANNUAL_TARGET_KEY);
    const targetInput = document.getElementById('annualTargetInput');

    if (targetInput) {
      if (savedTarget && !targetInput.value) {
        targetInput.value = Number(savedTarget).toLocaleString('tr-TR');
      }
      targetInput.addEventListener('change', function(){
        const val = parseFloat(this.value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (val > 0) {
          localStorage.setItem(ANNUAL_TARGET_KEY, val.toString());
          // KV'ye de yaz ki telefonda da aynı hedef görünsün
          try {
            if (typeof getLoansState === 'function' && typeof setLoansState === 'function') {
              const st = getLoansState(); st.yillikHedef = val; setLoansState(st);
            }
          } catch(_){}
          renderAnnualTarget(ytdRevenue, currentMonth);
        }
      });
    }

    const annualTarget = parseFloat(savedTarget || '0') || 0;

    if (annualTarget <= 0) {
      const elBar = document.getElementById('targetProgressBar');
      if (elBar) elBar.style.width = '0%';
      const elPct = document.getElementById('targetProgressPct');
      if (elPct) elPct.textContent = '–';
      const elCurrent = document.getElementById('targetCurrentVal');
      if (elCurrent) elCurrent.textContent = `Gerçekleşen: ${numberTL(ytdRevenue)}`;
      const elRemain = document.getElementById('targetRemainingVal');
      if (elRemain) elRemain.textContent = 'Hedef belirlenmedi';
      return;
    }

    const progress = Math.min(100, (ytdRevenue / annualTarget) * 100);
    const remaining = Math.max(0, annualTarget - ytdRevenue);

    const elBar = document.getElementById('targetProgressBar');
    if (elBar) {
      elBar.style.width = `${progress}%`;
      if (progress >= 100) {
        elBar.className = 'h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500';
      } else {
        const expectedProgress = ((currentMonth + 1) / 12) * 100;
        if (progress >= expectedProgress * 0.9) {
          elBar.className = 'h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500';
        } else if (progress >= expectedProgress * 0.7) {
          elBar.className = 'h-full bg-gradient-to-r from-yellow-500 to-orange-400 rounded-full transition-all duration-500';
        } else {
          elBar.className = 'h-full bg-gradient-to-r from-red-500 to-rose-400 rounded-full transition-all duration-500';
        }
      }
    }

    const elPct = document.getElementById('targetProgressPct');
    if (elPct) elPct.textContent = `${progress.toFixed(1)}%`;

    const elCurrent = document.getElementById('targetCurrentVal');
    if (elCurrent) elCurrent.textContent = `Gerçekleşen: ${numberTL(ytdRevenue)}`;

    const elRemain = document.getElementById('targetRemainingVal');
    if (elRemain) elRemain.textContent = `Kalan: ${numberTL(remaining)}`;

    const elPace = document.getElementById('targetPaceNote');
    if (elPace) {
      const monthsRemaining = 12 - (currentMonth + 1);
      if (monthsRemaining > 0 && remaining > 0) {
        const requiredMonthly = remaining / monthsRemaining;
        const currentMonthlyAvg = ytdRevenue / (currentMonth + 1);
        const paceStatus = currentMonthlyAvg >= (annualTarget / 12) ? '✅ Hedefe uygun tempoda' : '⚠️ Tempo artmalı';
        elPace.textContent = `Kalan ${monthsRemaining} ay için aylık ${numberTL(requiredMonthly)} gerekli • ${paceStatus}`;
      } else if (remaining <= 0) {
        elPace.textContent = '🎉 Yıllık hedef tutturuldu!';
      } else {
        elPace.textContent = '';
      }
    }

    // USD karşılığını göster
    const elUsdNote = document.getElementById('targetUsdNote');
    if (elUsdNote) {
      let fxRate = Number(localStorage.getItem('popdog_fx_try_per_usd') || '0');
      if (!fxRate) fxRate = (typeof deriveTryPerUsdFromKPI === 'function') ? deriveTryPerUsdFromKPI() : 35;
      if (fxRate > 0) {
        const targetUSD = annualTarget / fxRate;
        const currentUSD = ytdRevenue / fxRate;
        elUsdNote.textContent = `USD: Hedef $${targetUSD.toLocaleString('en-US', {maximumFractionDigits: 0})} • Gerçekleşen $${currentUSD.toLocaleString('en-US', {maximumFractionDigits: 0})}`;
      }
    }

  } catch(e) {
    console.warn('renderAnnualTarget error:', e);
  }
}

// Otomatik hedef hesapla: Geçen yıl toplam ciro (USD) + %10, güncel kurla TRY'ye çevir
function calculateAutoTarget(){
  try {
    if (!Array.isArray(monthlyCache) || monthlyCache.length === 0) {
      alert('Veri henüz yüklenmedi. Lütfen bekleyin.');
      return;
    }

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Geçen yılın toplam cirosunu al
    const lastYearTotal = monthlyCache
      .filter(m => m.year === lastYear)
      .reduce((sum, m) => sum + (m.Total || 0), 0);

    if (lastYearTotal <= 0) {
      alert(`${lastYear} yılına ait veri bulunamadı.`);
      return;
    }

    // USD kurunu al
    let fxRate = Number(localStorage.getItem('popdog_fx_try_per_usd') || '0');
    if (!fxRate) fxRate = (typeof deriveTryPerUsdFromKPI === 'function') ? deriveTryPerUsdFromKPI() : 35;
    if (!fxRate || fxRate <= 0) fxRate = 35;

    // Geçen yılın USD değeri
    // Not: Geçen yılın kuru farklı olabilir, ama şu anki kurla hesaplıyoruz
    // Daha doğru hesap için: geçen yılın ortalama kuru kullanılabilir
    const lastYearUSD = lastYearTotal / fxRate;

    // %10 artış
    const targetUSD = lastYearUSD * 1.10;

    // Güncel kurla TRY'ye çevir
    const targetTRY = targetUSD * fxRate;

    // Kaydet
    localStorage.setItem(ANNUAL_TARGET_KEY, targetTRY.toString());

    // Input'u güncelle
    const input = document.getElementById('annualTargetInput');
    if (input) input.value = Math.round(targetTRY).toLocaleString('tr-TR');

    // Yeniden render et
    const ytdRevenue = monthlyCache
      .filter(m => m.year === currentYear)
      .reduce((sum, m) => sum + (m.Total || 0), 0);
    renderAnnualTarget(ytdRevenue, new Date().getMonth());

    alert(`Hedef hesaplandı!\n\n${lastYear} Ciro: ${numberTL(lastYearTotal)} (≈$${lastYearUSD.toLocaleString('en-US', {maximumFractionDigits: 0})})\n+%10 = $${targetUSD.toLocaleString('en-US', {maximumFractionDigits: 0})}\n\n${currentYear} Hedef: ${numberTL(targetTRY)}`);

  } catch(e) {
    console.warn('calculateAutoTarget error:', e);
    alert('Hedef hesaplanamadı: ' + e.message);
  }
}

// Otomatik hedef butonu event listener
document.addEventListener('DOMContentLoaded', function(){
  const btn = document.getElementById('autoTargetBtn');
  if (btn) {
    btn.addEventListener('click', calculateAutoTarget);
  }
}, { once: true });

function esc2(t){ return String(t==null?'':t).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

/* Ödeme girişi.
 *
 * Kalemlerin çoğu her ay değişiyor (kredi kartları %55–70, maaş %38 oynuyor),
 * bu yüzden tek tık yetmiyor: butona basınca tutar satır içinde düzenlenebilir
 * hale geliyor, son ayın değeri hazır geliyor. Sabit kalemlerde (kredi
 * taksitleri, sabit faturalar) doğrudan onay yeterli.
 *
 * Yazma işini appendExpenseRow() yapıyor — manuel formun da kullandığı,
 * kategori eşleştirmesi ve Apps Script payload denemelerini içeren yol.
 */
function odemeGirisiAc(btn, satir){
  if (!satir || !satir.alt) return;
  const kap = btn.closest('[data-satir]');
  if (!kap || kap.dataset.acik === '1') return;
  kap.dataset.acik = '1';

  const tutarAlan = kap.querySelector('.tutar-alan');
  const eskiHTML = tutarAlan.innerHTML, eskiBtn = btn.outerHTML;

  /* Tarih girişi: varsayılan BUGÜN. Eskiden geçmişin medyan ödeme günü
     yazılıyordu ve ay başında girilen kayıt gelecek tarihli oluyordu. */
  const bugunISO = (function(){ const x=new Date();
    return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); })();
  const dInp = document.createElement('input');
  dInp.type = 'date'; dInp.value = bugunISO;
  dInp.style.cssText = 'width:118px;font-size:.66rem;border:1px solid rgba(148,163,184,.35);'
    + 'border-radius:6px;padding:1px 4px;background:transparent;color:inherit;outline:none;margin-right:4px';

  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'decimal';
  inp.value = Math.round(Number(satir.kalan || satir.beklenen) || 0).toLocaleString('tr-TR');
  inp.style.cssText = 'width:92px;font-size:.72rem;font-weight:600;text-align:right;'
    + 'font-variant-numeric:tabular-nums;border:1px solid rgba(96,165,250,.5);border-radius:6px;'
    + 'padding:1px 5px;background:rgba(96,165,250,.08);color:inherit;outline:none';
  tutarAlan.innerHTML = ''; tutarAlan.appendChild(dInp); tutarAlan.appendChild(inp);
  inp.focus(); inp.select();

  const iptal = function(){
    const x = kap.querySelector('.odeme-iptal');
    if (x) x.remove();                       // iptal butonu satırda kalmasın
    tutarAlan.innerHTML = eskiHTML;
    btn.outerHTML = eskiBtn;
    kap.dataset.acik = '';
    const yeniBtn = kap.querySelector('.odeme-gir');
    if (yeniBtn) yeniBtn.onclick = function(){ odemeGirisiAc(yeniBtn, satir); };
  };
  const onayla = function(){
    const ham = inp.value.replace(/\./g,'').replace(',', '.').replace(/[^\d.]/g,'');
    const tutar = Number(ham);
    if (!(tutar > 0)) { inp.style.borderColor = '#f87171'; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dInp.value)) { dInp.style.borderColor = '#f87171'; return; }
    odemeyiYaz(satir, tutar, dInp.value, btn, kap);
  };
  inp.onkeydown = function(e){
    if (e.key === 'Enter') { e.preventDefault(); onayla(); }
    if (e.key === 'Escape') { e.preventDefault(); iptal(); }
  };
  btn.textContent = '✓'; btn.onclick = onayla;
  btn.insertAdjacentHTML('afterend',
    '<button class="odeme-iptal" style="font-size:.6rem;padding:1px 5px;border-radius:999px;'
    + 'border:1px solid rgba(148,163,184,.35);background:transparent;color:#94a3b8;cursor:pointer">×</button>');
  kap.querySelector('.odeme-iptal').onclick = iptal;
}

/* Çift yazmaya karşı kilit.
   Sheet'e yazma geri alınamıyor (Apps Script'te silme ucu yok), bu yüzden
   art arda iki tetikleme (Enter + tık, ya da hızlı çift tık) tek satır yazmalı. */
let _odemeYaziliyor = false;

async function odemeyiYaz(satir, tutar, iso, btn, kap){
  if (typeof appendExpenseRow !== 'function'){ alert('Yazma fonksiyonu yüklenmemiş.'); return; }
  /* Kilit yalnızca uçuştaki isteği kapsar. Aynı kaleme ay içinde birden çok
     parça ödeme girilebilmeli, o yüzden "bu satır bir kez yazıldı" diye kalıcı
     olarak kilitlemiyoruz. */
  if (_odemeYaziliyor) return;
  _odemeYaziliyor = true;

  // Girişleri hemen kilitle ki Enter tekrar tetiklemesin
  kap.querySelectorAll('input').forEach(function(x){ x.disabled = true; x.onkeydown = null; });
  btn.textContent = '…'; btn.disabled = true; btn.onclick = null;
  const iptalBtn = kap.querySelector('.odeme-iptal'); if (iptalBtn) iptalBtn.remove();
  try{
    await appendExpenseRow({ dateISO: iso, subcat: satir.alt, amountTRY: tutar, note: 'plandan girildi' });
    kap.style.opacity = '.45';
    kap.querySelector('.tutar-alan').textContent = numberTL(tutar);
    btn.textContent = '✓'; btn.style.color = '#34d399'; btn.style.borderColor = 'rgba(52,211,153,.4)';
    try{ localStorage.removeItem('popdog_expenses_cache'); }catch(_){}
    setTimeout(function(){ location.reload(); }, 1400);
    // kilit bilerek açılmıyor: sayfa yenilenene kadar başka yazma olmasın
  }catch(e){
    _odemeYaziliyor = false;
    kap.querySelectorAll('input').forEach(function(x){ x.disabled = false; });
    btn.textContent = 'gir'; btn.disabled = false;
    btn.onclick = function(){ odemeGirisiAc(btn, satir); };
    alert('Yazılamadı: ' + (e && e.message ? e.message : e));
  }
}
window.odemeGirisiAc = odemeGirisiAc;

function renderUpcomingPayments(){
  try {
    const st = (typeof getLoansState === 'function') ? getLoansState() : (window.defaultLoansState || {});
    const loans = st.loans || {};

    let totalUpcoming = 0;
    const payments = [];

    // Kredi taksitleri
    if (loans.biz && loans.biz.paid < loans.biz.total) {
      const inst = Number(loans.biz.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Ticari Kredi Taksiti', amount: inst, type: 'loan', gun: 4 });
    }

    if (loans.car && loans.car.paid < loans.car.total) {
      const inst = Number(loans.car.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Araç Kredisi Taksiti', amount: inst, type: 'loan', gun: 18 });
    }

    if (loans.biz2 && loans.biz2.paid < loans.biz2.total) {
      const inst = Number(loans.biz2.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Ticari Kredi 2 Taksiti', amount: inst, type: 'loan', gun: 21 });
    }

    if (loans.garanti && loans.garanti.paid < loans.garanti.total) {
      const inst = Number(loans.garanti.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Garanti Kredi Taksiti', amount: inst, type: 'loan', gun: Number(loans.garanti.dueDay) || 26 });
    }

    // Zee.Dog bekleyen ödemeler — ana kalem toplama girmez (alt kalemleri sayılır)
    const zeeHam = Array.isArray(st.zeeAwaitUSD) ? st.zeeAwaitUSD : [];
    const zeeList = (typeof zeeToplananlar === 'function') ? zeeToplananlar(zeeHam) : zeeHam;
    /* getTryPerUsd() kullanılıyor: tryPerUsd() yalnızca localStorage'a ve
       KPI'dan türetmeye bakıyor, ikisi de yoksa 0 dönüyordu ve Zee.Dog satırı
       "₺0" görünüyordu. getTryPerUsd() ayrıca canlı kuru da tersine çevirir. */
    let fxRate = 0;
    if (typeof getTryPerUsd === 'function') fxRate = Number(getTryPerUsd()) || 0;
    if (!fxRate && typeof tryPerUsd === 'function') fxRate = Number(tryPerUsd()) || 0;
    if (!fxRate) fxRate = 35;

    let zeeTotal = 0;
    zeeList.forEach(z => {
      if (!z.paid && z.status !== 'paid') {
        const remaining = Number(z.remainingUsd || z.usd || 0);
        zeeTotal += remaining;
      }
    });

    if (zeeTotal > 0) {
      const zeeTRY = zeeTotal * fxRate;
      totalUpcoming += zeeTRY;
      payments.push({ name: 'Zee.Dog Ödemeleri', amount: zeeTRY, amountUSD: zeeTotal, type: 'supplier' });
    }

    /* Kredi taksitlerine expenses_master'dan çıkarılan düzenli giderleri de
       ekleyip ayın tam ödeme takvimini basıyoruz. Ödenmişler işaretli gelir;
       ödenmemişlerde tek tıkla Sheet'e yazma butonu var. */
    let planKalemleri = [];
    try {
      const plan = (typeof aylikOdemePlani === 'function') ? aylikOdemePlani() : { kalemler: [] };
      const KREDI_ALT = /^(kredi|araç kredi|taksitli ticari kredi 2|garanti kredi)$/i;
      planKalemleri = (plan.kalemler || []).filter(function(k){ return !KREDI_ALT.test(k.alt); });
    } catch(e){ console.warn('aylikOdemePlani:', e && e.message); }

    const bugun = new Date().getDate();
    const KREDI_SHEET_ADI = {
      'Ticari Kredi Taksiti': 'Kredi',
      'Araç Kredisi Taksiti': 'Araç Kredi',
      'Ticari Kredi 2 Taksiti': 'Taksitli Ticari Kredi 2',
      'Garanti Kredi Taksiti': 'Garanti Kredi',
    };
    /* Bir kalem parça parça ödenebiliyor (ör. kredi kartı borcu ay içinde
       birkaç seferde kapanıyor). Bu yüzden "bu ay kayıt var" ≠ "bitti":
       beklenen tutar ile bu ay girilen toplam ayrı tutulur, buton hep açık
       kalır, toplama sadece KALAN yazılır. */
    const satirlar = payments.filter(function(p){ return p.type !== 'supplier'; }).map(function(p){
      return { gun: p.gun || 0, ad: p.name, beklenen: p.amount, girilen: 0,
               alt: KREDI_SHEET_ADI[p.name] || null, sabit: true };
    }).concat(planKalemleri.map(function(k){
      return { gun: k.gun, ad: k.alt, beklenen: k.tutar, girilen: k.odenenTutar || 0,
               alt: k.alt, sabit: k.sabit };
    })).sort(function(a,b){ return a.gun - b.gun; });

    satirlar.forEach(function(r){ r.kalan = Math.max(0, Number(r.beklenen||0) - Number(r.girilen||0)); });
    totalUpcoming = satirlar.reduce(function(a,r){ return a + r.kalan; }, 0);

    const elTotal = document.getElementById('upcomingPaymentsTotal');
    if (elTotal) elTotal.textContent = `Kalan: ${numberTL(totalUpcoming)}`;

    const elList = document.getElementById('upcomingPaymentsList');
    if (!elList) return;
    if (!satirlar.length) {
      elList.innerHTML = '<div class="hint text-xs">Bu ay bekleyen ödeme yok.</div>';
      return;
    }
    elList.innerHTML = satirlar.map(function(r, i){
      const bitti = r.girilen > 0 && r.kalan <= 0.5;
      const gecti = !bitti && r.gun && r.gun < bugun;
      const renk = bitti ? 'opacity:.5' : (gecti ? 'color:#f87171' : '');
      const yaklasik = (!r.sabit && !bitti) ? '~' : '';
      /* Kısmi ödeme varsa ne girildiği görünsün; buton her hâlükârda kalır. */
      const girildiNot = r.girilen > 0
        ? `<span style="font-size:.6rem;opacity:.55;white-space:nowrap">${numberTL(r.girilen)} girildi</span>`
        : '';
      const gosterilen = r.girilen > 0 ? r.kalan : r.beklenen;
      const buton = r.alt
        ? `<button class="odeme-gir" data-i="${i}"
             style="font-size:.6rem;padding:1px 6px;border-radius:999px;border:1px solid rgba(96,165,250,.4);
                    background:rgba(96,165,250,.12);color:#60a5fa;cursor:pointer">${bitti ? '+' : 'gir'}</button>`
        : '<span style="width:26px;display:inline-block"></span>';
      return `<div data-satir="${i}" style="display:flex;align-items:baseline;gap:6px;padding:2px 0;${renk}">
          <span style="font-size:.62rem;opacity:.5;min-width:22px;text-align:right">${r.gun || '–'}.</span>
          <span style="font-size:.72rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc2(r.ad)}</span>
          ${girildiNot}
          <span class="tutar-alan" style="font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums">${bitti ? '✓' : yaklasik + numberTL(gosterilen)}</span>
          ${buton}
        </div>`;
    }).join('');
    elList.querySelectorAll('.odeme-gir').forEach(function(b){
      b.onclick = function(){ odemeGirisiAc(b, satirlar[Number(b.dataset.i)]); };
    });

  } catch(e) {
    console.warn('renderUpcomingPayments error:', e);
  }
}

// Kanal maliyet yapıları
// Toptan: %40 indirimle satış yapılıyor, yani liste fiyatının %60'ına
// CKM/Online: Kredi kartı komisyonu ~%2.5
// Trendyol/HB: %20 komisyon
// Kuaför: Hizmet geliri (COGS yok varsayalım veya düşük)

const CHANNEL_CONFIG = {
  'Toptan': {
    commission: 0,           // Komisyon yok
    discountFromList: 0.40,  // Liste fiyatından %40 indirim
    ccFee: 0,                // Genelde nakit/havale
    note: '%40 indirimli satış'
  },
  'Online': {
    commission: 0,
    discountFromList: 0,
    ccFee: 0.025,            // Kredi kartı ~%2.5
    note: 'KK kom. %2.5'
  },
  'CKM': {
    commission: 0,
    discountFromList: 0,
    ccFee: 0.025,            // Kredi kartı ~%2.5
    note: 'KK kom. %2.5'
  },
  'Trendyol': {
    commission: 0.20,        // %20 komisyon
    discountFromList: 0,
    ccFee: 0,                // Komisyona dahil
    note: '%20 komisyon'
  },
  'Hepsiburada': {
    commission: 0.20,        // %20 komisyon
    discountFromList: 0,
    ccFee: 0,
    note: '%20 komisyon'
  },
  'Kuaför': {
    commission: 0,
    discountFromList: 0,
    ccFee: 0.025,
    isService: true,         // Hizmet geliri
    serviceCostRatio: 0.30,  // %30 hizmet maliyeti
    note: 'Hizmet %30 maliyet'
  }
};

function renderChannelProfitability(){
  try {
    const tbody = document.getElementById('tblChannelProfitability');
    if (!tbody) return;

    if (!Array.isArray(monthlyCache) || monthlyCache.length === 0) {
      tbody.innerHTML = '<tr><td class="hint py-2" colspan="8">Veri yükleniyor...</td></tr>';
      return;
    }

    const currentYear = new Date().getFullYear();
    const ytdMonths = monthlyCache.filter(m => m.year === currentYear);

    if (ytdMonths.length === 0) {
      tbody.innerHTML = '<tr><td class="hint py-2" colspan="8">Bu yıla ait veri yok.</td></tr>';
      return;
    }

    // Kanal bazlı toplamları hesapla
    const channelTotals = {};
    let grandTotal = 0;

    ytdMonths.forEach(m => {
      ['Toptan', 'Online', 'CKM', 'Trendyol', 'Hepsiburada', 'Kuaför'].forEach(ch => {
        const val = Number(m[ch] || 0);
        if (!channelTotals[ch]) channelTotals[ch] = 0;
        channelTotals[ch] += val;
        grandTotal += val;
      });
    });

    // Stok maliyet oranını al (liste fiyatına göre maliyet) - fallback için
    let baseCostRatio = 0.40; // Varsayılan: liste fiyatının %40'ı maliyet
    try {
      const stockCostEl = document.getElementById('kpiInvCost');
      const stockSaleEl = document.getElementById('kpiInvPrice');
      if (stockCostEl && stockSaleEl) {
        const cost = parseFloat(stockCostEl.textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        const sale = parseFloat(stockSaleEl.textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (cost > 0 && sale > 0) baseCostRatio = cost / sale;
      }
    } catch(e){}

    // Gerçek COGS verisi varsa al (renderFinancialHealth'ten)
    const realCOGSData = window.__ytdCOGSResult || null;
    const useRealCOGS = realCOGSData && realCOGSData.byChannel && Object.keys(realCOGSData.byChannel).length > 0;

    const rows = [];
    const sortedChannels = Object.entries(channelTotals)
      .filter(([ch, val]) => val > 0)
      .sort((a, b) => b[1] - a[1]);

    let totalGrossProfit = 0;
    let totalCommissions = 0;

    sortedChannels.forEach(([channel, revenue]) => {
      const config = CHANNEL_CONFIG[channel] || {};
      const share = grandTotal > 0 ? (revenue / grandTotal) * 100 : 0;

      // 1) KDV'yi çıkar (%20 KDV dahil fiyattan → KDV hariç = fiyat / 1.20)
      const revenueExVAT = revenue / 1.20;
      const vatAmount = revenue - revenueExVAT;

      // 2) Komisyon ve kesintiler (KDV hariç tutar üzerinden)
      const commission = revenueExVAT * (config.commission || 0);
      const ccFee = revenueExVAT * (config.ccFee || 0);
      const totalDeductions = commission + ccFee;
      const netRevenue = revenueExVAT - totalDeductions;

      // 3) COGS hesabı - kanal bazlı
      let cogs = 0;
      let cogsSource = 'tahmini';

      // Önce gerçek COGS verisini dene
      if (useRealCOGS && realCOGSData.byChannel[channel]) {
        cogs = realCOGSData.byChannel[channel].cogs || 0;
        cogsSource = 'gerçek';
      } else if (config.isService) {
        // Kuaför hizmet geliri - %30 maliyet
        cogs = revenueExVAT * (config.serviceCostRatio || 0.30);
      } else if (config.discountFromList > 0) {
        // Toptan: %40 indirimle satış yapılıyor
        // Satış fiyatı = Liste × 0.60
        // Maliyet = Liste × baseCostRatio
        // Yani maliyet/satış = baseCostRatio / 0.60
        const effectiveCostRatio = baseCostRatio / (1 - config.discountFromList);
        cogs = revenueExVAT * Math.min(effectiveCostRatio, 0.95); // Max %95 COGS
      } else {
        // Normal satış - tahmini
        cogs = revenueExVAT * baseCostRatio;
      }

      const grossProfit = netRevenue - cogs;
      // Marj hesabı KDV hariç ciro üzerinden
      const grossMargin = revenueExVAT > 0 ? (grossProfit / revenueExVAT) * 100 : 0;

      totalGrossProfit += grossProfit;
      totalCommissions += totalDeductions;

      // Renk kodlaması
      const marginClass = grossMargin >= 30 ? 'text-green-600 dark:text-green-400' :
                          grossMargin >= 15 ? 'text-yellow-600 dark:text-yellow-400' :
                          grossMargin >= 0 ? 'text-orange-600 dark:text-orange-400' :
                          'text-red-600 dark:text-red-400';

      const deductionNote = config.note || '–';

      // COGS'un gerçek mi tahmini mi olduğunu göster
      const cogsIndicator = cogsSource === 'gerçek' ?
        '<span class="text-green-500 text-[9px]" title="Gerçek COGS">●</span>' :
        '<span class="text-orange-400 text-[9px]" title="Tahmini COGS">○</span>';

      rows.push(`
        <tr class="border-b border-slate-200 dark:border-slate-700">
          <td class="py-2 pr-2 font-medium">${chLabel(channel)}</td>
          <td class="py-2 pr-2 text-right text-[11px]">${numberTL(revenue)}</td>
          <td class="py-2 pr-2 text-right text-[11px]">${numberTL(revenueExVAT)}</td>
          <td class="py-2 pr-2 text-right hint text-[11px]">%${share.toFixed(1)}</td>
          <td class="py-2 pr-2 text-right text-orange-600 dark:text-orange-400 text-[11px]">${totalDeductions > 0 ? numberTL(totalDeductions) : '–'}</td>
          <td class="py-2 pr-2 text-right hint text-[11px]">${cogsIndicator} ${numberTL(cogs)}</td>
          <td class="py-2 pr-2 text-right text-[11px]">${numberTL(grossProfit)}</td>
          <td class="py-2 text-right font-semibold ${marginClass}">%${grossMargin.toFixed(1)}</td>
        </tr>
      `);
    });

    // Toplam satırı
    const grandTotalExVAT = grandTotal / 1.20;
    const overallMargin = grandTotalExVAT > 0 ? (totalGrossProfit / grandTotalExVAT) * 100 : 0;
    const overallMarginClass = overallMargin >= 30 ? 'text-green-600 dark:text-green-400' :
                               overallMargin >= 15 ? 'text-yellow-600 dark:text-yellow-400' :
                               'text-orange-600 dark:text-orange-400';

    rows.push(`
      <tr class="bg-slate-100 dark:bg-slate-800 font-semibold">
        <td class="py-2 pr-2">TOPLAM</td>
        <td class="py-2 pr-2 text-right text-[11px]">${numberTL(grandTotal)}</td>
        <td class="py-2 pr-2 text-right text-[11px]">${numberTL(grandTotalExVAT)}</td>
        <td class="py-2 pr-2 text-right hint">%100</td>
        <td class="py-2 pr-2 text-right text-orange-600 dark:text-orange-400 text-[11px]">${numberTL(totalCommissions)}</td>
        <td class="py-2 pr-2 text-right hint">–</td>
        <td class="py-2 pr-2 text-right text-green-600 dark:text-green-400 text-[11px]">${numberTL(totalGrossProfit)}</td>
        <td class="py-2 text-right ${overallMarginClass}">%${overallMargin.toFixed(1)}</td>
      </tr>
    `);

    tbody.innerHTML = rows.join('');

  } catch(e) {
    console.warn('renderChannelProfitability error:', e);
  }
}

// YoY Aylık Karşılaştırma
function renderYoYComparison(){
  try {
    // Mevcut YoY elementleri varsa güncelle
    const elYoY = document.getElementById('kpiYTD_YoY');
    if (!elYoY || !Array.isArray(monthlyCache) || monthlyCache.length === 0) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const lastYear = currentYear - 1;

    // Bu yılın ve geçen yılın aynı dönemini hesapla
    let thisYearTotal = 0;
    let lastYearTotal = 0;

    monthlyCache.forEach(m => {
      // m.month formatı: "2025-01" veya m.year sayısal
      const [y, mo] = (m.month || '').split('-').map(Number);
      const year = m.year || y;
      const month = mo || 0;
      if (year === currentYear && month <= currentMonth) {
        thisYearTotal += Number(m.Total || 0);
      }
      if (year === lastYear && month <= currentMonth) {
        lastYearTotal += Number(m.Total || 0);
      }
    });

    if (lastYearTotal > 0) {
      const yoyChange = ((thisYearTotal - lastYearTotal) / lastYearTotal) * 100;
      const arrow = yoyChange >= 0 ? '↑' : '↓';
      const color = yoyChange >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
      elYoY.innerHTML = `<span class="${color}">YoY ${arrow}${Math.abs(yoyChange).toFixed(1)}%</span> <span class="hint">(${lastYear}: ${numberTL(lastYearTotal)})</span>`;
    }

  } catch(e) {
    console.warn('renderYoYComparison error:', e);
  }
}

/* Financial health'i başlat.
 *
 * renderFinancialHealth() girdilerini (kpiExpYTD, kpiInvCost, kpiInvPrice)
 * DOM'dan okuyor; bu elemanlar başka async zincirler tarafından dolduruluyor.
 * Eskiden sabit bir setTimeout(2000) vardı — veri geç gelirse hesaplama boş
 * değerlerle çalışıp "–%" bırakıyor ve bir daha denenmiyordu. Artık girdiler
 * hazır olana kadar bekliyoruz, en fazla 10 saniye. */
function financialInputsReady(){
  return ['kpiExpYTD', 'kpiInvCost', 'kpiInvPrice'].every(function(id){
    var el = document.getElementById(id);
    if (!el) return false;
    var digits = (el.textContent || '').replace(/[^0-9]/g, '');
    return digits.length > 0 && Number(digits) > 0;
  });
}

function scheduleFinancialHealth(attempt){
  attempt = attempt || 0;
  if (financialInputsReady() || attempt >= 20){
    try { renderFinancialHealth(); } catch(e){ console.warn('renderFinancialHealth:', e); }
    try { renderChannelProfitability(); } catch(e){ console.warn('renderChannelProfitability:', e); }
    try { renderYoYComparison(); } catch(e){ console.warn('renderYoYComparison:', e); }
    return;
  }
  setTimeout(function(){ scheduleFinancialHealth(attempt + 1); }, 500);
}

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){ scheduleFinancialHealth(0); }, 1200);
}, { once:true });

window.scheduleFinancialHealth = scheduleFinancialHealth;
window.renderFinancialHealth = renderFinancialHealth;
window.renderChannelProfitability = renderChannelProfitability;
window.renderYoYComparison = renderYoYComparison;
