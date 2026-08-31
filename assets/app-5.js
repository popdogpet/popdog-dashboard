/* ============================================================
   i18n Language Switcher — Pop Dog CFO Dashboard
   TR / EN toggle — v1.0
   ============================================================ */
(function(){
  'use strict';
  var LANG_KEY = 'popdog_lang';

  /* ── Elements accessed directly by ID ─────────────────────── */
  var ID_MAP = {
    navSummary:    ['Özet',           'Summary'],
    navRevenue:    ['Ciro',           'Revenue'],
    navExpenses:   ['Giderler',       'Expenses'],
    navStock:      ['Stok',           'Stock'],
    navAI:         ['🤖 AI',          '🤖 AI'],
    themeBtn:      ['🌗 Tema',        '🌗 Theme'],
    refreshBtn:    ['Yenile',         'Refresh'],
    uploadBtn:     ['CSV Yükle',      'Upload CSV'],
    downloadBtn:   ['CSV İndir',      'Download CSV'],
    writeSheetBtn: ["Sheet'e Kaydet", 'Save to Sheet'],
    expAddBtn:     ['Gideri Ekle',    'Add Expense'],
    autoTargetBtn: ['🔄 Otomatik',    '🔄 Auto'],
  };

  /* ── data-i18n key → [trText, enText] ─────────────────────── */
  var I18N = {
    sec_weekly:       ['Haftalık Görünüm',                    'Weekly View'],
    sec_monthly:      ['Aylık Görünüm',                       'Monthly View'],
    sec_channel_sales:['🛒 Kanal Satışları',                  '🛒 Channel Sales'],
    sec_exp_add:      ['Aylık Gider Ekle',                    'Add Monthly Expense'],
    sec_monthly_exp:  ['Aylık Giderler',                      'Monthly Expenses'],
    sec_cat_breakdown:['Kategori Kırılımı',                   'Category Breakdown'],
    sec_rev_monthly:  ['Aylık Toplam Ciro',                   'Monthly Total Revenue'],
    sec_rev_channel:  ['Kanal Bazlı Aylık Ciro',              'Monthly Revenue by Channel'],
    sec_rev_groomer:  ['Grooming Aylık Toplam',               'Grooming Monthly Total'],
    sec_cat_detail:   ['Ana Kategoriler (YTD) — Detay',       'Main Categories (YTD) — Detail'],
    sec_cat_grouped:  ['Ana Kategoriler (YTD) — Gruplanmış',  'Main Categories (YTD) — Grouped'],
  };

  /* ── TR → EN exact-match map (auto-scanned elements) ─────── */
  var TR_EN = {
    /* Channel labels (permanent renames, shown in both TR+EN) */
    'B2B':        'B2B',
    'Shop':       'Shop',
    'Grooming':   'Grooming',
    /* Section headers (auto-scanned via .font-medium) */
    '💰 Nakit Akış & Finansal Sağlık':       '💰 Cash Flow & Financial Health',
    'Son 7 Gün Özeti':                        'Last 7 Days Summary',
    '💳 Krediler & Bekleyen Ödemeler':        '💳 Loans & Pending Payments',
    'Giderler (YTD) & Net Kâr':              'Expenses (YTD) & Net Profit',
    'Stok Özeti':                            'Stock Summary',
    'Satış & Devir Listeleri':               'Sales & Turnover Lists',
    /* Loan card titles */
    'Taksitli Ticari Kredi':                 'Commercial Installment Loan',
    'Taksitli Araç Kredisi':                 'Vehicle Installment Loan',
    'Taksitli Ticari Kredi 2':               'Commercial Installment Loan 2',
    'Zee.Dog Bekleyen Ödemeler':             'Zee.Dog Pending Payments',
    'Demoş Bank — Altın Borç':              'Demoş Bank — Gold Debt',
    'QNB Portföy Para Piyasası (FI5)':       'QNB Portfolio Money Market (FI5)',
    /* KPI labels (.hint divs) */
    'Toplam Ciro (YTD)':                     'Total Revenue (YTD)',
    'En Büyük Kanal':                        'Top Channel',
    'Stok Değeri (Maliyet)':                 'Inventory Value (Cost)',
    'Stok Değeri (Satış)':                   'Inventory Value (Retail)',
    'Brüt Kar Marjı (YTD)':                  'Gross Margin (YTD)',
    'Net Kar Marjı (YTD)':                   'Net Profit Margin (YTD)',
    'Gider / Ciro Oranı':                    'Expense / Revenue Ratio',
    'Tahmini Runway':                        'Estimated Runway',
    'MoM Değişim':                           'MoM Change',
    'Uyarılar':                              'Alerts',
    '🎯 Yıllık Hedef İlerlemesi':            '🎯 Annual Target Progress',
    '📅 Bu Ay Yaklaşan Ödemeler':            '📅 Upcoming Payments This Month',
    '📊 Karlılık Detayı (tıkla: aç/kapat)': '📊 Profitability Details (click to expand)',
    '📈 Kanal Bazlı Karlılık (tıkla: aç/kapat)': '📈 Channel-Based Profitability (click to expand)',
    'Toplam Gider (YTD)':                    'Total Expenses (YTD)',
    'Net Kâr (YTD)':                         'Net Profit (YTD)',
    'Gider MoM':                             'Expense MoM',
    'Toplam Stok Değeri (Maliyet)':          'Total Inventory Value (Cost)',
    'Toplam Stok Değeri (Satış)':            'Total Inventory Value (Retail)',
    'Maliyet +%65 (Vergi+Navlun)':           'Cost +65% (Tax+Freight)',
    'Satış KDV Hariç (−%20)':               'Retail Ex-VAT (−20%)',
    /* Table headers */
    'Metrik':         'Metric',
    'Değer':          'Value',
    'Açıklama':       'Description',
    'Kanal':          'Channel',
    'Brüt Ciro':      'Gross Revenue',
    'KDV Hariç':      'Ex-VAT',
    'Pay':            'Share',
    'Kom./KK':        'Comm./CC',
    'Brüt Kar':       'Gross Profit',
    'Marj':           'Margin',
    'Kategori':       'Category',
    'Tutar':          'Amount',
    'Tarih':          'Date',
    'Alt Kat.':       'Sub Cat.',
    'Durum':          'Status',
    'Satılan (adet)': 'Qty Sold',
    'Yaş (gün)':      'Age (days)',
    'Adet/gün':       'Units/day',
    /* Stock KPI table labels */
    'Stok Devir Hızı':                       'Inventory Turnover',
    '90+ gün elde':                          '90+ days on hand',
    'Median Stok Yaşı':                      'Median Stock Age',
    'Toplam Ürün Adedi':                     'Total Unit Count',
    /* Form labels */
    'Alt Kategori':    'Subcategory',
    'Tutar (₺)':      'Amount (₺)',
    'Not (opsiyonel)': 'Note (optional)',
    /* Hint texts */
    'Vergi + Navlun dahil (+%65)':           'Incl. Tax + Freight (+65%)',
    'KDV Hariç (−%20)':                     'Ex-VAT (−20%)',
    '(tıkla: aç/kapat)':                     '(click to expand)',
    '(yukarıdaki ay seçimine göre)':         '(based on selected month)',
    /* Sales/stock lists */
    'En çok satan 5 ürün':                   'Top 5 Best Sellers',
    'En az satan 5 ürün':                    'Bottom 5 Sellers',
    'Stoğu en hızlı giden 5 ürün':           'Top 5 Fastest Moving',
    'Stokta en uzun süredir kalan 5 ürün':   'Top 5 Slowest Moving',
    /* Stock page labels */
    'Pencere:':                              'Window:',
    '📦 Diğer':                             '📦 Other',
    'Yüksek öncelik':                        'High priority',
    'Orta öncelik':                          'Medium priority',
    'Düşük öncelik':                         'Low priority',
    'ABC Analizi (Satış Değerine Göre)':     'ABC Analysis (By Sales Value)',
    'A: %80 satış, B: %15, C: %5':          'A: 80% sales, B: 15%, C: 5%',
    'Stok Yaşlandırma Dağılımı (adet bazında)': 'Inventory Aging Distribution (by units)',
    '₺ maliyet bazında en yüksek 10 SKU':   'Top 10 SKUs by ₺ cost',
    '90+ gün elde (₺ bazında ilk 10)':      '90+ days on hand (top 10 by ₺)',
    '💀 Dead Stock (180+ gün satış yok)':   '💀 Dead Stock (180+ days no sales)',
    '🔥 Stokout Riski (≤14 gün) — Pencere:': '🔥 Stockout Risk (≤14 days) — Window:',
    '📦 Stoğu En Fazla Olan (Top 25)':      '📦 Largest Inventory (Top 25)',
    /* Table headers */
    'Son Satış':    'Last Sale',
    'Günlük hız':   'Daily rate',
    'Kalan gün':    'Days left',
    /* KPI table description column */
    'Yıllık satış değeri / ortalama stok maliyeti': 'Annual sales value / avg. inventory cost',
    'Son satışı 90+ gün önce olan stok toplamı':    'Items with last sale 90+ days ago',
    '6 aydan fazla satış görmeyen \u201cölü\u201d stok': '"Dead" stock with no sales in 6+ months',
    'SKU\'ların son satıştan bugüne medyan gün sayısı': 'Median days since last sale across SKUs',
    'Mevcut stokun kaç günlük satışa yeteceği':     'How many days current inventory will last',
    /* Loading / empty states */
    'Henüz veri yok.':  'No data yet.',
    'Yükleniyor...':    'Loading...',
    'Yükleniyor…':      'Loading…',
    /* Select options */
    'Yıl Başından':  'Year to Date',
    'Bu Ay':         'This Month',
    'Bu Hafta':      'This Week',
    'Tümü':          'All',
    '30 gün':        '30 days',
    '90 gün':        '90 days',
    '120 gün':       '120 days',
    '180 gün':       '180 days',
    /* PIN overlay */
    'Devam etmek için PIN kodunu girin': 'Enter PIN to continue',
  };

  /* Build EN→TR reverse map lazily */
  var EN_TR = null;
  function getEnTr() {
    if (EN_TR) return EN_TR;
    EN_TR = {};
    Object.keys(TR_EN).forEach(function(tr) { EN_TR[TR_EN[tr]] = tr; });
    Object.keys(I18N).forEach(function(k) { EN_TR[I18N[k][1]] = I18N[k][0]; });
    Object.keys(ID_MAP).forEach(function(id) { EN_TR[ID_MAP[id][1]] = ID_MAP[id][0]; });
    return EN_TR;
  }

  /* CSS selectors for auto-scanned leaf elements */
  var SCAN = [
    'th', 'option', 'label', 'summary',
    '.hint',
    '.font-medium',
  ].join(',');

  /* Replace text content of an element safely */
  function replaceEl(el, srcMap) {
    var id = el.id;
    if (id && ID_MAP[id]) return;    /* handled by ID_MAP */
    if (id === 'langBtn') return;

    var txt = el.textContent.trim();
    var newText = srcMap[txt];
    if (!newText) return;

    if (el.children.length === 0) {
      /* Leaf element: safe to replace all textContent */
      el.textContent = newText;
    } else {
      /* Has children: replace first non-whitespace text node only */
      for (var i = 0; i < el.childNodes.length; i++) {
        var node = el.childNodes[i];
        if (node.nodeType === 3 && node.textContent.trim()) {
          node.textContent = node.textContent.replace(txt, newText);
          break;
        }
      }
    }
  }

  function applyLang(lang) {
    var isEN = lang === 'en';
    var srcMap = isEN ? TR_EN : getEnTr();

    /* 1 ── ID-based elements */
    Object.keys(ID_MAP).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = isEN ? ID_MAP[id][1] : ID_MAP[id][0];
    });

    /* 2 ── [data-i18n] elements (section headers with children) */
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var pair = I18N[key];
      if (!pair) return;
      var text = isEN ? pair[1] : pair[0];
      var search = isEN ? pair[0] : pair[1];
      if (el.children.length === 0) {
        el.textContent = text;
      } else {
        /* Replace first non-whitespace text node */
        for (var i = 0; i < el.childNodes.length; i++) {
          var node = el.childNodes[i];
          if (node.nodeType === 3 && node.textContent.trim()) {
            node.textContent = node.textContent.replace(search, text);
            break;
          }
        }
      }
    });

    /* 3 ── Auto-scanned elements (exact text-content match) */
    document.querySelectorAll(SCAN).forEach(function(el) {
      replaceEl(el, srcMap);
    });

    /* 4 ── Lang button + <html lang="…"> */
    var btn = document.getElementById('langBtn');
    if (btn) btn.textContent = isEN ? '🌐 TR' : '🌐 EN';
    document.documentElement.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch(e) {}
  }

  /* Public API */
  window.setLanguage = applyLang;

  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('langBtn');
    if (btn) {
      btn.addEventListener('click', function() {
        var cur = localStorage.getItem(LANG_KEY) || 'tr';
        applyLang(cur === 'tr' ? 'en' : 'tr');
      });
    }
    /* Restore saved language (skip if TR — default) */
    var saved = localStorage.getItem(LANG_KEY) || 'tr';
    if (saved !== 'tr') applyLang(saved);
  }, { once: true });
})();
