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
    const savedTarget = localStorage.getItem(ANNUAL_TARGET_KEY);
    const targetInput = document.getElementById('annualTargetInput');

    if (targetInput) {
      if (savedTarget && !targetInput.value) {
        targetInput.value = Number(savedTarget).toLocaleString('tr-TR');
      }
      targetInput.addEventListener('change', function(){
        const val = parseFloat(this.value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (val > 0) {
          localStorage.setItem(ANNUAL_TARGET_KEY, val.toString());
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
      payments.push({ name: 'Ticari Kredi Taksiti', amount: inst, type: 'loan' });
    }

    if (loans.car && loans.car.paid < loans.car.total) {
      const inst = Number(loans.car.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Araç Kredisi Taksiti', amount: inst, type: 'loan' });
    }

    if (loans.biz2 && loans.biz2.paid < loans.biz2.total) {
      const inst = Number(loans.biz2.instTRY || 0);
      totalUpcoming += inst;
      payments.push({ name: 'Ticari Kredi 2 Taksiti', amount: inst, type: 'loan' });
    }

    // Zee.Dog bekleyen ödemeler
    const zeeList = Array.isArray(st.zeeAwaitUSD) ? st.zeeAwaitUSD : [];
    const fxRate = (typeof tryPerUsd === 'function') ? tryPerUsd() : 35;

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

    const elTotal = document.getElementById('upcomingPaymentsTotal');
    if (elTotal) elTotal.textContent = `Toplam: ${numberTL(totalUpcoming)}`;

    const elList = document.getElementById('upcomingPaymentsList');
    if (elList) {
      if (payments.length === 0) {
        elList.innerHTML = '<div class="hint text-xs">Bu ay bekleyen ödeme yok.</div>';
      } else {
        elList.innerHTML = payments.map(p => {
          const bgColor = p.type === 'loan' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400' :
                          p.type === 'supplier' ? 'bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-400' :
                          'bg-slate-50 dark:bg-slate-800/50';
          const usdNote = p.amountUSD ? `<div class="hint text-[10px]">≈ $${p.amountUSD.toLocaleString('en-US', {maximumFractionDigits: 0})}</div>` : '';
          return `<div class="${bgColor} rounded-lg p-2">
            <div class="text-xs font-medium text-slate-700 dark:text-slate-200">${p.name}</div>
            <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">${numberTL(p.amount)}</div>
            ${usdNote}
          </div>`;
        }).join('');
      }
    }

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

// Financial health'i başlat
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(renderFinancialHealth, 2000);
  setTimeout(renderChannelProfitability, 2500);
  setTimeout(renderYoYComparison, 2500);
}, { once:true });

window.renderFinancialHealth = renderFinancialHealth;
window.renderChannelProfitability = renderChannelProfitability;
window.renderYoYComparison = renderYoYComparison;
