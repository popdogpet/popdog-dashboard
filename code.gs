/***** === POP DOG — MASTER Code.gs (REV: 2025-01-20 • COMPLETE & FIXED) === *****/

/** ---- 1) REVENUE'e satır yazmak ---- */
const SHEET_ID   = '1UQTm38jAhtrIyZaH4pPtU-HpHFOreiKvH6Gu8HALkCU';
const SHEET_NAME = 'popdog_revenue_clean_v4';
const EXPENSES_SHEET_NAME = 'expenses_master';

/** ---- 2) Sekme adları / ayarlar ---- */
const CFG = {
  productsSheet:  'products raw',
  inventorySheet: 'inventory raw',
  ordersSheet:    'orders raw',
  out_products:   'products_clean',
  out_inventory:  'inventory_clean',
  out_orders:     'orders_clean',
  out_inv_value:  'inventory_value',
  out_sales_ytd:  'sales_ytd',
  costsSheet:     'Costs',
  locationFilter: '',
  salesYear: 2025,
  ordersLookbackDays: 365
};

/* ============================================================
   UTIL
   ============================================================ */
function norm(s){
  if (s == null) return '';
  return String(s)
    .replace(/\u00A0/g,' ')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/^['"]+|['"]+$/g,'')
    .trim();
}

function toNumber(v){
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = norm(v);
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.includes('.') && s.includes(',')){
    const ld = s.lastIndexOf('.');
    const lc = s.lastIndexOf(',');
    if (lc > ld){
      s = s.replace(/\./g,'').replace(',', '.');
    }else{
      s = s.replace(/,/g,'');
    }
  }else if (s.includes(',') && !s.includes('.')){
    s = s.replace(/\./g,''); s = s.replace(',', '.');
  }
  const n = Number(s.replace(/,/g,''));
  return isNaN(n) ? 0 : n;
}

function toISODate(v){
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = norm(v);
  if (!s) return null;

  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2})(\d{2})$/);
  if (m){
    const d = new Date(m[1] + 'T' + m[2] + m[3] + ':' + m[4]);
    return isNaN(+d) ? null : d;
  }
  m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (m){
    const d = new Date(m[1] + 'T' + m[2] + 'Z');
    return isNaN(+d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

function headerIndexMap(h){
  const m = {};
  h.forEach(function(x,i){ m[norm(x).toLowerCase()] = i; });
  return m;
}

function findIdx(m,a){
  for (var i=0;i<a.length;i++){
    var n = a[i];
    var p = m[n.toLowerCase()];
    if (p != null) return p;
  }
  return null;
}

function ensureSheet(name){
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  return sh;
}

function writeSheet(name,data){
  const sh = ensureSheet(name);
  if (!data || !data.length) return sh;
  sh.getRange(1,1,data.length,data[0].length).setValues(data);
  return sh;
}

function normBarcode(s){
  return String(s || '')
    .trim()
    .replace(/^'+/,'')
    .replace(/\s+/g,'')
    .replace(/\D+/g,'');
}

function normSKU(s){
  return String(s || '').trim().replace(/^'+/,'');
}

/* ============================================================
   LOGGING
   ============================================================ */
function logError_(action, error, details){
  try{
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var logSheet = ss.getSheetByName('error_log');
    if (!logSheet){
      logSheet = ss.insertSheet('error_log');
      logSheet.getRange(1,1,1,4).setValues([['Timestamp','Action','Error','Details']]);
    }
    var row = [
      new Date(),
      action || '',
      String(error && error.message || error),
      JSON.stringify(details || {})
    ];
    logSheet.appendRow(row);
    Logger.log('ERROR: ' + action + ' - ' + error);
  }catch(e){
    Logger.log('Failed to log error: ' + e);
  }
}

/* ============================================================
   JSON RESPONSE
   ============================================================ */
function json(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   TEFAS FON FİYATLARI & ALTIN — Sunucu tarafından çek (CORS yok)
   ============================================================ */

/** TR sayı (1.234,56 → 1234.56) güvenli parse */
function parseTR_(s){
  if (s == null) return 0;
  var t = String(s).trim();
  t = t.replace(/\u00A0/g,' ').replace(/\s/g,'');
  t = t.replace(/\./g,'').replace(',', '.');
  var n = Number(t);
  return isNaN(n) ? 0 : n;
}

function isSaneFundPrice_(n){
  return typeof n === 'number' && isFinite(n) && n > 0 && n < 10000;
}

/** Altın gram fiyatı (TRY) — finans.truncgil.com/today.json üzerinden */
function getGoldGramTRY_(){
  var url = 'https://finans.truncgil.com/today.json';
  var req = {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent':'Mozilla/5.0 (AppsScript; PopDog)',
      'Accept':'application/json,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language':'tr-TR,tr;q=0.9,en-US;q=0.7',
      'Referer':'https://finans.truncgil.com/'
    }
  };
  try{
    var res = UrlFetchApp.fetch(url, req);
    var code = res.getResponseCode();
    if (code >= 300) throw new Error('HTTP ' + code);
    var text = res.getContentText() || '';
    var data;
    try{
      data = JSON.parse(text);
    }catch(err){
      throw new Error('JSON parse failed: ' + err);
    }
    if (!data || !data['gram-altin']) throw new Error('gram-altin missing');

    var g = data['gram-altin'];
    var raw =
      g.Alis ||
      g.alis ||
      g.Alış ||
      g['Alış'] ||
      g.al ||
      g['Alış Fiyatı'] ||
      '';
    var n = parseTR_(raw);
    if (!isSaneFundPrice_(n)){
      throw new Error('insane gram price: ' + n);
    }

    return { gramTRY: n, source: 'finans.truncgil.com/today.json' };
  }catch(e){
    logError_('getGoldGramTRY', e, { url: url });
    return {
      gramTRY: 0,
      source: 'gold:ERROR:' + String(e && e.message || e)
    };
  }
}

// TEFAS: Önce "Son Fiyat (TL)" etiketinden oku; bulunmazsa diğer yakalayıcılar
function getTEFASQuoteByCode_(code){
  if (!code) return null;
  var c = String(code).toUpperCase().trim();

  var req = {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent':'Mozilla/5.0 (AppsScript; PopDog)',
      'Accept':'text/html,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language':'tr-TR,tr;q=0.9,en-US;q=0.7',
      'Referer':'https://www.tefas.gov.tr/'
    }
  };

  var pages = [
    'https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=' + encodeURIComponent(c),
    'https://tefas.gov.tr/FonAnaliz.aspx?FonKod=' + encodeURIComponent(c)
  ];

  var REX_LIST = [
    /Son\s*Fiyat\s*\(\s*TL\s*\)[\s\S]{0,1200}?(\d{1,3}(?:\.\d{3})*,\d{2,8}|\d+\.\d{2,8})/i,
    /id="[^"]*lbl(?:Son)?Fiyat[^"]*"\s*[^>]*>\s*([\d.\s]*,\d{2,8}|\d+\.\d{2,8})/i,
    /Birim\s*Fiyat[ıi][^<]{0,1200}?(\d{1,3}(?:\.\d{3})*,\d{2,8}|\d+\.\d{2,8})/i,
    /content\s*=\s*"([\d.\s]*,\d{2,8}|\d+\.\d{2,8})"\s*[^>]*itemprop="price"/i,
    /data-value\s*=\s*"([\d.\s]*,\d{2,8}|\d+\.\d{2,8})"/i
  ];

  function normNum_(v){
    var s = String(v || '').trim();
    if (/,/.test(s)) s = s.replace(/\./g,'').replace(',', '.');
    s = s.replace(/\s/g,'');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  for (var i = 0; i < pages.length; i++){
    try{
      var r = UrlFetchApp.fetch(pages[i], req);
      if (r.getResponseCode() >= 300) continue;
      var html = r.getContentText() || '';

      for (var k = 0; k < REX_LIST.length; k++){
        var m = html.match(REX_LIST[k]);
        if (m && m[1]){
          var v = normNum_(m[1]);
          if (isSaneFundPrice_(v)) {
            return { code: c, unitTRY: v, source: 'tefas-sonfiyat' };
          }
        }
      }
    }catch(e){
      logError_('getTEFASQuoteByCode', e, { code: c, page: pages[i] });
    }
  }
  return null;
}

/* ============================================================
   doGet — Web App GET endpoint
   ============================================================ */
function doGet(e){
  try{
    var p0 = (e && e.parameter) ? e.parameter : {};
    var params = {};
    for (var k in p0){
      params[k.toLowerCase()] = String(p0[k]);
    }

    var action = (params.action || params.mode || params.type || '').trim().toLowerCase();
    var code = (params.code || params.fund || params.f || '').trim().toUpperCase();

    if (!action && code) action = 'fundquote';

    // ALTIN → ?action=goldquote
    if (action === 'goldquote'){
      var g = getGoldGramTRY_();
      return json({
        ok: g && g.gramTRY > 0,
        gramTRY: g ? g.gramTRY : 0,
        source: g ? g.source : '',
        method: 'GET'
      });
    }

    // FON → ?action=fundquote&code=FI5
    if (action === 'fundquote'){
      if (!code) return json({ ok:false, error:'MISSING_CODE' });
      var q = getTEFASQuoteByCode_(code);
      return json({
        ok: !!q && q.unitTRY > 0,
        code: code,
        unitTRY: q ? q.unitTRY : 0,
        source: q ? q.source : '',
        method:'GET'
      });
    }

    if (action === 'fi5quote'){
      var qfi = getTEFASQuoteByCode_('FI5');
      return json({
        ok: !!qfi && qfi.unitTRY > 0,
        code:'FI5',
        unitTRY: qfi ? qfi.unitTRY : 0,
        source: qfi ? qfi.source : '',
        method:'GET'
      });
    }

    if (action === 'sasquote'){
      var qsas = getTEFASQuoteByCode_('SAS');
      return json({
        ok: !!qsas && qsas.unitTRY > 0,
        code:'SAS',
        unitTRY: qsas ? qsas.unitTRY : 0,
        source: qsas ? qsas.source : '',
        method:'GET'
      });
    }

    if (action === 'isyquote' || action === 'ti3quote'){
      var qisy = getTEFASQuoteByCode_('TI3');
      return json({
        ok: !!qisy && qisy.unitTRY > 0,
        code:'TI3',
        unitTRY: qisy ? qisy.unitTRY : 0,
        source: qisy ? qisy.source : '',
        method:'GET'
      });
    }

    // Default ping
    return json({ ok:true, method:'GET', ts:new Date().toISOString() });

  }catch(err){
    logError_('doGet', err, { params: e && e.parameter });
    return json({ ok:false, error: String(err && err.message || err) });
  }
}

/* ============================================================
   GIDER YAZMA (appendExpense) — FIXED & COMPLETE
   ============================================================ */
function appendExpense_(row){
  try{
    if (!row || typeof row !== 'object') {
      return json({ ok:false, error:'INVALID_ROW_DATA' });
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(EXPENSES_SHEET_NAME);

    if (!sh){
      return json({
        ok:false,
        error:'SHEET_NOT_FOUND',
        sheetExpected: EXPENSES_SHEET_NAME,
        availableSheets: ss.getSheets().map(function(s){ return s.getName(); })
      });
    }

    // Read header (ensure at least 10 columns)
    var lastCol = Math.max(10, sh.getLastColumn() || 0);
    var headerRange = sh.getRange(1, 1, 1, lastCol);
    var header = headerRange.getValues()[0];

    // If no header exists, create one
    if (!header || header.length === 0 || !header[0]){
      header = ['Date', 'Subcategory', 'Category', 'FinalSubcategory', 'AmountTRY', 'Currency', 'Note'];
      sh.getRange(1, 1, 1, header.length).setValues([header]);
    }

    // Build header index map (case-insensitive)
    var idx = {};
    header.forEach(function(h, i){
      var k = norm(String(h || '')).toLowerCase();
      if (k && idx[k] == null) idx[k] = i;
    });

    // Create row array matching header length
    var rowArr = new Array(header.length).fill('');

    // Map input fields to columns
    Object.keys(row).forEach(function(k){
      var nk = norm(k).toLowerCase();

      // Handle field name variations and aliases
      var mappings = {
        'date': 'date',
        'subcategory': 'subcategory',
        'sub': 'subcategory',
        'finalsubcategory': 'finalsubcategory',
        'finalsub': 'finalsubcategory',
        'final': 'finalsubcategory',
        'category': 'category',
        'cat': 'category',
        'amounttry': 'amounttry',
        'amount': 'amounttry',
        'tutar': 'amounttry',
        'currency': 'currency',
        'parabirimi': 'currency',
        'note': 'note',
        'notes': 'note',
        'not': 'note',
        'aciklama': 'note'
      };

      var targetKey = mappings[nk] || nk;
      var col = idx[targetKey];

      if (col != null){
        rowArr[col] = row[k];
      }
    });

    // Validate required fields
    var dateCol = idx['date'];
    var amountCol = idx['amounttry'] || idx['amount'];

    if (dateCol == null || !rowArr[dateCol]){
      return json({
        ok: false,
        error: 'MISSING_DATE',
        message: 'Date field is required'
      });
    }

    // Append the row
    sh.getRange(sh.getLastRow() + 1, 1, 1, rowArr.length).setValues([rowArr]);

    return json({
      ok: true,
      message: 'Expense added successfully',
      row: row,
      debug: {
        sheetName: EXPENSES_SHEET_NAME,
        headerLength: header.length,
        rowLength: rowArr.length
      }
    });

  }catch(err){
    logError_('appendExpense', err, { row: row });
    return json({
      ok:false,
      error: String(err && err.message || err)
    });
  }
}

/* ============================================================
   CİRO YAZMA (appendDaily) — IMPROVED
   ============================================================ */
function appendDaily_(rows){
  try{
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length){
      return json({ ok:false, error:'NO_ROWS_PROVIDED' });
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(SHEET_NAME);

    if (!sh){
      return json({
        ok:false,
        error:'SHEET_NOT_FOUND',
        sheetExpected:SHEET_NAME,
        availableSheets:ss.getSheets().map(function(s){ return s.getName(); })
      });
    }

    // Ensure header exists
    if (sh.getLastRow() === 0){
      var defaultHeader = ['Date', 'Toptan', 'Online', 'CKM', 'CKM Nakit', 'Kasa Nakit (EoD)', 'Trendyol', 'Hepsiburada', 'Kuaför', 'Total'];
      sh.getRange(1, 1, 1, defaultHeader.length).setValues([defaultHeader]);
    }

    // Unicode-safe normalize
    function keyNorm_(s){
      s = String(s == null ? '' : s)
        .replace(/\u00A0/g,' ')
        .replace(/[\u200B-\u200D\uFEFF]/g,'')
        .trim();
      try{
        s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
      }catch(_){}
      return s.toLowerCase().replace(/\s+/g,' ');
    }

    // ✅ Read at least 10 columns to ensure Kuaför is included
    var MIN_COLS = 10;
    var lastCol = Math.max(MIN_COLS, sh.getLastColumn() || 0);
    var header = sh.getRange(1, 1, 1, lastCol)
      .getValues()[0]
      .map(function(h){ return String(h == null ? '' : h).trim(); });

    // Build header -> index map
    var idx = {};
    header.forEach(function(h, i){
      var k = keyNorm_(h);
      if (k && idx[k] == null) idx[k] = i;
    });

    // ✅ Find Kuaför column (prefer first match)
    var kuaforCol = null;
    var kuaforKeys = ['kuafor', 'kuaför', 'grooming', 'groom'];
    for (var i = 0; i < header.length; i++){
      var hn = keyNorm_(header[i]);
      if (kuaforKeys.some(function(k){ return hn.indexOf(k) !== -1; })){
        kuaforCol = i;
        break; // Use first match
      }
    }

    // ✅ If no Kuaför column exists, add it
    if (kuaforCol == null){
      kuaforCol = header.length;
      header.push('Kuaför');
      sh.getRange(1, kuaforCol + 1).setValue('Kuaför');
      idx[keyNorm_('Kuaför')] = kuaforCol;
    }

    // Build output rows
    var out = list.map(function(r){
      var rowArr = new Array(header.length).fill('');

      // Map fields
      Object.keys(r || {}).forEach(function(k){
        var nk = keyNorm_(k);

        // Field aliases
        var aliases = {
          'grooming': 'kuafor',
          'kuaför': 'kuafor',
          'kasa nakit': 'kasa nakit (eod)',
          'kasanakit': 'kasa nakit (eod)',
          'toplam': 'total'
        };

        var targetKey = aliases[nk] || nk;
        var col = idx[targetKey];

        if (col != null){
          rowArr[col] = r[k];
        }
      });

      // ✅ Ensure Kuaför gets written to correct column
      if (kuaforCol != null){
        var kuaforValue =
          r['Kuaför'] || r['Kuafor'] || r['kuaför'] || r['kuafor'] ||
          r['Grooming'] || r['grooming'] || 0;
        rowArr[kuaforCol] = toNumber(kuaforValue);
      }

      // Validate required field (Date)
      var dateCol = idx['date'] || idx['tarih'];
      if (dateCol == null || !rowArr[dateCol]){
        throw new Error('Date field is required for all rows');
      }

      return rowArr;
    });

    // Write to sheet
    if (out.length){
      sh.getRange(sh.getLastRow() + 1, 1, out.length, header.length).setValues(out);
    }

    return json({
      ok: true,
      added: out.length,
      sheetName: sh.getName(),
      debug: {
        kuaforCol: kuaforCol,
        headerLength: header.length,
        receivedKeys: list.length ? Object.keys(list[0] || {}) : []
      }
    });

  }catch(err){
    logError_('appendDaily', err, { rowCount: rows ? rows.length : 0 });
    return json({ ok:false, error:String(err && err.message || err) });
  }
}

/* ============================================================
   doPost — Esnek yönlendirici (IMPROVED)
   ============================================================ */
function doPost(e){
  try{
    function parseMaybeJson_(v){
      if (v == null) return null;
      if (typeof v === 'object') return v;
      try{ return JSON.parse(String(v)); }catch(_){ return null; }
    }

    var bodyRaw = e && e.postData && e.postData.contents || '';
    var body = {};
    try{
      body = JSON.parse(bodyRaw);
    }catch(_){
      body = {};
    }

    var params = e && e.parameter || {};

    var action = String(
      body.action || params.action || params.mode || params.type || ''
    ).trim().toLowerCase();

    var code = String(
      body.code || params.code || body.fund || params.fund || body.f || params.f || ''
    ).trim().toUpperCase();

    var rows = (body.rows || body.data) ||
               parseMaybeJson_(body.payload || body.rowsJson) ||
               parseMaybeJson_(params.rows || params.data || params.payload || params.rowsJson);

    var row  = body.row ||
               parseMaybeJson_(body.data || body.rowJson) ||
               parseMaybeJson_(params.row || params.data || params.rowJson);

    // Auto-detect action if not specified
    if (!action){
      if (row && !rows)      action = 'appendexpense';
      else if (rows && !row) action = 'appenddaily';
    }

    // Handle actions
    if (action === '__ping__')      return json({ ok:true, pong:true, ts: new Date().toISOString() });
    if (action === 'appendexpense' || action === 'append_expense') return appendExpense_(row || {});
    if (action === 'appenddaily' || action === 'append_daily')     return appendDaily_(Array.isArray(rows) ? rows : []);

    // ALTIN (POST)
    if (action === 'goldquote'){
      var g = getGoldGramTRY_();
      return json({
        ok: g && g.gramTRY > 0,
        gramTRY: g ? g.gramTRY : 0,
        source: g ? g.source : '',
        method: 'POST'
      });
    }

    // FON FİYATLARI (POST)
    if (action === 'fundquote'){
      if (!code) return json({ ok:false, error:'MISSING_CODE' });
      var q = getTEFASQuoteByCode_(code);
      return json({
        ok: !!q && q.unitTRY > 0,
        code: code.toUpperCase(),
        unitTRY: q ? q.unitTRY : 0,
        source: q ? q.source : '',
        method: 'POST'
      });
    }

    if (action === 'fi5quote'){
      var qfi = getTEFASQuoteByCode_('FI5');
      return json({
        ok: !!qfi && qfi.unitTRY > 0,
        code:'FI5',
        unitTRY: qfi ? qfi.unitTRY : 0,
        source: qfi ? qfi.source : '',
        method: 'POST'
      });
    }

    if (action === 'sasquote'){
      var qsas = getTEFASQuoteByCode_('SAS');
      return json({
        ok: !!qsas && qsas.unitTRY > 0,
        code:'SAS',
        unitTRY: qsas ? qsas.unitTRY : 0,
        source: qsas ? qsas.source : '',
        method: 'POST'
      });
    }

    if (action === 'isyquote' || action === 'ti3quote'){
      var qisy = getTEFASQuoteByCode_('TI3');
      return json({
        ok: !!qisy && qisy.unitTRY > 0,
        code:'TI3',
        unitTRY: qisy ? qisy.unitTRY : 0,
        source: qisy ? qisy.source : '',
        method: 'POST'
      });
    }

    return json({
      ok:false,
      error:'UNKNOWN_ACTION',
      action: action,
      hasRows: !!rows,
      hasRow: !!row,
      hint: 'Valid actions: appendExpense, appendDaily, goldQuote, fundQuote, fi5Quote, sasQuote, isyQuote'
    });
  }catch(err){
    logError_('doPost', err, { body: bodyRaw });
    return json({ ok:false, error:String(err && err.message || err) });
  }
}

/* ============================================================
   SHOPIFY REST ADMIN API → RAW (WITH VALIDATION)
   ============================================================ */
const SHOP = PropertiesService.getScriptProperties().getProperty('SHOPIFY_SHOP_DOMAIN');
const TOKEN = PropertiesService.getScriptProperties().getProperty('SHOPIFY_ACCESS_TOKEN');
const API_VERSION = PropertiesService.getScriptProperties().getProperty('SHOPIFY_API_VERSION') || '2024-10';

// Validate Shopify credentials
function validateShopifyCredentials_(){
  if (!SHOP || !TOKEN) {
    throw new Error('Missing Shopify credentials. Set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN in Script Properties (File > Project properties > Script properties)');
  }
}

function shopUrl_(path, params){
  if (!params) params = {};
  var base = 'https://' + SHOP + '/admin/api/' + API_VERSION + path;
  var qs = Object.keys(params).map(function(k){
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  return qs ? (base + '?' + qs) : base;
}

function fetchShopify_(url, retries){
  if (retries == null) retries = 3;

  try{
    var res = UrlFetchApp.fetch(url,{
      method:'get',
      headers:{
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type':'application/json'
      },
      muteHttpExceptions:true
    });

    var code = res.getResponseCode();

    // Handle rate limiting with exponential backoff
    if (code === 429 && retries > 0){
      var waitTime = Math.pow(2, 4 - retries) * 1000; // 2s, 4s, 8s
      Logger.log('Rate limited, waiting ' + waitTime + 'ms...');
      Utilities.sleep(waitTime);
      return fetchShopify_(url, retries - 1);
    }

    if (code >= 300) {
      throw new Error('Shopify HTTP ' + code + ': ' + res.getContentText());
    }

    var body = JSON.parse(res.getContentText() || '{}');
    var headers = res.getHeaders();
    var link = headers['Link'] || headers['link'] || '';
    return { body: body, link: link };
  }catch(err){
    logError_('fetchShopify', err, { url: url, retries: retries });
    throw err;
  }
}

function parseLinkNext_(h){
  var m = /<([^>]+)>\;\s*rel="next"/.exec(h || '');
  return m ? m[1] : null;
}

function sheet_(name){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  return sh;
}

function write_(name, rows){
  var sh = sheet_(name);
  if (!rows || !rows.length) return sh;
  sh.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  return sh;
}

/** PRODUCTS (variants + cost) */
function fetchInventoryItemCosts_(ids){
  var map = {};
  for (var i=0;i<ids.length;i+=50){
    var chunk = ids.slice(i,i+50).join(',');
    var url = shopUrl_('/inventory_items.json',{
      ids:chunk,
      limit:250,
      fields:'inventory_items'
    });
    var resp = fetchShopify_(url);
    var body = resp.body;
    (body.inventory_items || []).forEach(function(it){
      map[String(it.id)] = (it.cost != null ? Number(it.cost) : 0);
    });
  }
  return map;
}

function syncProductsRawWithCosts(){
  validateShopifyCredentials_();

  var head = [
    'Handle',
    'Title',
    'Variant SKU',
    'Variant Barcode',
    'Variant Price',
    'Cost per item',
    'Variant ID',
    'Inventory Item ID'
  ];
  var rows = [head];

  var url = shopUrl_('/products.json',{
    limit:250,
    fields:'id,handle,title,variants'
  });
  var variants = [];

  while (url){
    var resp = fetchShopify_(url);
    var body = resp.body;
    (body.products || []).forEach(function(p){
      (p.variants || []).forEach(function(v){
        variants.push({
          handle:  p.handle,
          title:   p.title,
          sku:     v.sku || '',
          barcode: v.barcode || '',
          price:   (v.price != null ? Number(v.price) : ''),
          vid:     v.id || '',
          iid:     v.inventory_item_id ? String(v.inventory_item_id) : ''
        });
      });
    });
    url = parseLinkNext_(resp.link);
  }

  var iidList  = variants.map(function(v){ return v.iid; }).filter(Boolean);
  var uniqueIids = Array.from(new Set(iidList));
  var costByIid = fetchInventoryItemCosts_(uniqueIids);

  variants.forEach(function(v){
    var cost = v.iid ? (costByIid[v.iid] != null ? costByIid[v.iid] : '') : '';
    rows.push([
      v.handle,
      v.title,
      v.sku,
      v.barcode,
      v.price,
      cost,
      v.vid,
      v.iid
    ]);
  });

  write_(CFG.productsSheet, rows);
  Logger.log('Products synced: ' + (rows.length - 1) + ' variants');
}

/** INVENTORY */
function getLocations_(){
  var list = [];
  var url = shopUrl_('/locations.json',{ limit:250 });
  while (url){
    var resp = fetchShopify_(url);
    var body = resp.body;
    (body.locations || []).forEach(function(l){
      list.push(l);
    });
    url = parseLinkNext_(resp.link);
  }
  return list;
}

function syncInventoryRaw(){
  validateShopifyCredentials_();

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var pr = ss.getSheetByName(CFG.productsSheet);
  if (!pr) throw new Error('Önce syncProductsRawWithCosts çalıştırın.');

  var vals = pr.getDataRange().getValues();
  var iInvItem = vals[0].indexOf('Inventory Item ID');
  var iSKU     = vals[0].indexOf('Variant SKU');
  if (iInvItem < 0 || iSKU < 0) throw new Error('products raw başlıkları eksik.');

  var itemIds = [];
  var skuByItem = {};
  for (var r=1;r<vals.length;r++){
    var id  = vals[r][iInvItem];
    var sku = vals[r][iSKU];
    if (id){
      itemIds.push(id);
      skuByItem[id] = sku;
    }
  }

  getLocations_();
  var out = [['SKU','Location','On hand (current)']];

  for (var i=0;i<itemIds.length;i+=50){
    var chunk = itemIds.slice(i,i+50).join(',');
    var url = shopUrl_('/inventory_levels.json',{
      inventory_item_ids:chunk,
      limit:250
    });
    while (url){
      var resp = fetchShopify_(url);
      var body = resp.body;
      (body.inventory_levels || []).forEach(function(lv){
        var loc = String(lv.location_id);
        out.push([
          skuByItem[lv.inventory_item_id] || '',
          loc,
          lv.available != null ? lv.available : (lv.available_quantity != null ? lv.available_quantity : 0)
        ]);
      });
      url = parseLinkNext_(resp.link);
    }
  }
  write_(CFG.inventorySheet, out);
  Logger.log('Inventory synced: ' + (out.length - 1) + ' records');
}

/** ORDERS (configurable lookback days) */
function syncOrdersRaw(){
  validateShopifyCredentials_();

  var head = ['Created at','Lineitem sku','Lineitem quantity','Lineitem price','Order ID'];
  var out  = [head];

  var since = new Date();
  since.setDate(since.getDate() - CFG.ordersLookbackDays);

  var url = shopUrl_('/orders.json',{
    status:'any',
    limit:250,
    created_at_min: since.toISOString(),
    fields:'id,created_at,line_items'
  });

  while (url){
    var resp = fetchShopify_(url);
    var body = resp.body;
    (body.orders || []).forEach(function(o){
      (o.line_items || []).forEach(function(li){
        out.push([
          o.created_at,
          li.sku || '',
          li.quantity || 0,
          li.price || 0,
          o.id || ''
        ]);
      });
    });
    url = parseLinkNext_(resp.link);
  }
  write_(CFG.ordersSheet, out);
  Logger.log('Orders synced: ' + (out.length - 1) + ' line items');
}

/* ============================================================
   AGGREGATIONS / OUTPUT
   ============================================================ */
function readCostsMap(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(CFG.costsSheet);
  if (!sh) return { byBc:{}, bySku:{} };

  var values = sh.getDataRange().getValues();
  if (!values.length) return { byBc:{}, bySku:{} };

  var head = values[0].map(norm);
  var idx  = headerIndexMap(head);

  var iBC   = findIdx(idx,['Barcode','Variant Barcode','EAN','Barkod']);
  var iSKU  = findIdx(idx,['SKU','Variant SKU','Product code','Ürün Kodu']);
  var iCost = findIdx(idx,['CostTRY','Cost per item','Cost','TRY Cost','Maliyet','Maliyet (TRY)']);

  if (iCost == null && iBC == null && iSKU == null) return { byBc:{}, bySku:{} };

  var byBc = {};
  var bySku = {};

  for (var r=1;r<values.length;r++){
    var bc   = iBC  != null ? normBarcode(values[r][iBC]) : '';
    var sku  = iSKU != null ? normSKU(values[r][iSKU])    : '';
    var cost = iCost!= null ? toNumber(values[r][iCost])  : 0;
    if (cost > 0){
      if (bc)  byBc[bc]  = cost;
      if (sku) bySku[sku] = cost;
    }
  }
  return { byBc:byBc, bySku:bySku };
}

function readProducts(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(CFG.productsSheet);
  if (!sh) throw new Error('products raw sheet bulunamadı');

  var values = sh.getDataRange().getValues();
  if (!values.length) return [['SKU','Title','Price','Cost']];

  var head = values[0].map(norm);
  var idx  = headerIndexMap(head);

  var iSKU   = findIdx(idx,['Variant SKU','SKU']);
  var iTitle = findIdx(idx,['Title','Product Title']);
  var iPrice = findIdx(idx,['Variant Price','Price']);
  var iCost  = findIdx(idx,['Cost per item','Variant Cost','Variant Cost Price','Cost']);
  var iBC    = findIdx(idx,['Variant Barcode','Barcode','EAN','Barkod']);

  if ([iSKU,iTitle,iPrice].some(function(i){ return i == null; })){
    throw new Error('products raw: Gerekli başlıklar yok (Variant SKU, Title, Variant Price [+ Cost])');
  }

  var costs = readCostsMap();
  var out   = [['SKU','Title','Price','Cost']];

  for (var r=1;r<values.length;r++){
    var row = values[r];
    var sku = normSKU(row[iSKU]);
    if (!sku) continue;
    var title = norm(row[iTitle]);
    var price = toNumber(row[iPrice]);
    var cost  = (iCost != null ? toNumber(row[iCost]) : 0);
    var bc    = (iBC   != null ? normBarcode(row[iBC]) : '');

    if (bc && costs.byBc[bc] != null){
      cost = costs.byBc[bc];
    }else if (costs.bySku[sku] != null){
      cost = costs.bySku[sku];
    }
    out.push([sku,title,price,cost]);
  }
  return out;
}

function readInventory(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(CFG.inventorySheet);
  if (!sh) throw new Error('inventory raw sheet bulunamadı');

  var values = sh.getDataRange().getValues();
  if (!values.length) return [['SKU','Location','OnHand']];

  var head = values[0].map(norm);
  var idx  = headerIndexMap(head);

  var iSKU = findIdx(idx,['SKU','Variant SKU']);
  var iLoc = findIdx(idx,['Location','Store','Warehouse','Lokasyon','Depo']);
  var iOn  = findIdx(idx,['On hand (current)','On Hand (current)','On hand','On Hand','Eldeki','Stok']);

  if ([iSKU,iLoc,iOn].some(function(i){ return i == null; })){
    throw new Error('inventory raw: Gerekli başlıklar bulunamadı (SKU, Location, On hand (current))');
  }

  var out = [['SKU','Location','OnHand']];
  var filterName = (CFG.locationFilter || '').toString().trim();

  for (var r=1;r<values.length;r++){
    var row = values[r];
    var sku = normSKU(row[iSKU]);
    if (!sku) continue;
    var loc = norm(row[iLoc]);
    var on  = toNumber(row[iOn]);
    if (filterName && loc !== filterName) continue;
    out.push([sku,loc,on]);
  }
  return out;
}

function readOrders(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(CFG.ordersSheet);
  if (!sh) throw new Error('orders raw sheet bulunamadı');

  var values = sh.getDataRange().getValues();
  if (!values.length) return [['date','sku','qty','price','revenue']];

  var head = values[0].map(norm);
  var idx  = headerIndexMap(head);

  var iCreated = findIdx(idx,['Created at','Created At','Created']);
  var iPaid    = findIdx(idx,['Paid at','Paid At','Paid']);
  var iFulfill = findIdx(idx,['Fulfilled at','Fulfilled At','Fulfilled']);
  var iQty     = findIdx(idx,['Lineitem quantity','Lineitem Quantity','Quantity']);
  var iSKU     = findIdx(idx,['Lineitem sku','Lineitem SKU','SKU']);
  var iPrice   = findIdx(idx,['Lineitem price','Lineitem Price','Price']);

  if ([iQty,iSKU,iPrice].some(function(v){ return v == null; }) ||
      (iCreated == null && iPaid == null && iFulfill == null)){
    throw new Error('orders raw: Gerekli başlıklar yok (Created/Paid/Fulfilled at, Lineitem quantity, Lineitem sku, Lineitem price)');
  }

  var out = [['date','sku','qty','price','revenue']];

  for (var r=1;r<values.length;r++){
    var row = values[r];
    var sku = normSKU(row[iSKU]);
    if (!sku) continue;
    var dStr = (iCreated != null ? row[iCreated] : '') ||
               (iPaid    != null ? row[iPaid]    : '') ||
               (iFulfill != null ? row[iFulfill] : '');
    var d = toISODate(dStr);
    if (!d) continue;

    var qty   = toNumber(row[iQty]);
    var price = toNumber(row[iPrice]);
    if (qty <= 0) continue;

    out.push([d, sku, qty, price, qty * price]);
  }
  return out;
}

function buildInventoryValue(productsTbl, invTbl){
  var idxP   = headerIndexMap(productsTbl[0]);
  var iPSKU  = findIdx(idxP,['sku']);
  var iTitle = findIdx(idxP,['title']);
  var iPrice = findIdx(idxP,['price']);
  var iCost  = findIdx(idxP,['cost']);

  var idxI   = headerIndexMap(invTbl[0]);
  var iISKU  = findIdx(idxI,['sku']);
  var iLoc   = findIdx(idxI,['location']);
  var iOn    = findIdx(idxI,['onhand','on hand','onhand (current)','on hand (current)']);

  var locSet = new Set();
  for (var r=1;r<invTbl.length;r++){
    locSet.add(norm(invTbl[r][iLoc]));
  }
  var locs = Array.from(locSet).filter(function(x){ return !!x; }).sort();

  var pmap = new Map();
  for (var r2=1;r2<productsTbl.length;r2++){
    var row2 = productsTbl[r2];
    var sku2 = normSKU(row2[iPSKU]);
    if (!sku2) continue;
    pmap.set(sku2,{
      title: row2[iTitle],
      price: toNumber(row2[iPrice]),
      cost:  toNumber(row2[iCost])
    });
  }

  var agg = new Map();
  for (var r3=1;r3<invTbl.length;r3++){
    var row3 = invTbl[r3];
    var sku3 = normSKU(row3[iISKU]);
    if (!sku3) continue;
    var loc  = norm(row3[iLoc]);
    var on   = toNumber(row3[iOn]);
    var cur  = agg.get(sku3) || {};
    cur[loc] = (cur[loc] || 0) + on;
    agg.set(sku3, cur);
  }

  var out = [[
    'SKU',
    'Title'
  ].concat(locs).concat([
    'TotalUnits',
    'UnitPrice',
    'UnitCost',
    'Value@Price',
    'Value@Cost',
    'GrossPotential'
  ])];

  agg.forEach(function(byLoc, sku){
    var p = pmap.get(sku) || { title:'', price:0, cost:0 };
    var locCols = locs.map(function(L){ return byLoc[L] || 0; });
    var totalUnit = locCols.reduce(function(a,b){ return a + b; }, 0);
    var valueP = totalUnit * p.price;
    var valueC = totalUnit * p.cost;
    var gross  = valueP - valueC;

    var row = [sku, p.title].concat(locCols).concat([
      totalUnit,
      p.price,
      p.cost,
      valueP,
      valueC,
      gross
    ]);
    out.push(row);
  });

  return out;
}

function buildSalesYTD(ordersTbl){
  var head = ordersTbl[0].map(norm);
  var idx  = headerIndexMap(head);

  var iDate = findIdx(idx,['date']);
  var iQty  = findIdx(idx,['qty']);
  var iRev  = findIdx(idx,['revenue']);

  var byMonth = {};
  for (var r=1;r<ordersTbl.length;r++){
    var d    = ordersTbl[r][iDate];
    var dt   = toISODate(d);
    if (!dt) continue;
    var y = dt.getFullYear();
    if (CFG.salesYear && y !== CFG.salesYear) continue;
    var m = ('0' + (dt.getMonth() + 1)).slice(-2);
    var key = y + '-' + m;
    if (!byMonth[key]) byMonth[key] = { qty:0, rev:0 };
    byMonth[key].qty += toNumber(ordersTbl[r][iQty]);
    byMonth[key].rev += toNumber(ordersTbl[r][iRev]);
  }

  var months = Object.keys(byMonth).sort();
  var out = [['Month','Qty','Revenue']];
  months.forEach(function(k){
    out.push([k, byMonth[k].qty, byMonth[k].rev]);
  });
  return out;
}

/* ============================================================
   MAIN
   ============================================================ */
function buildAll(){
  try{
    var productsTbl = readProducts();
    var invTbl      = readInventory();
    var ordersTbl   = readOrders();

    writeSheet(CFG.out_products,  productsTbl);
    writeSheet(CFG.out_inventory, invTbl);
    writeSheet(CFG.out_orders,    ordersTbl);
    writeSheet(CFG.out_inv_value, buildInventoryValue(productsTbl,invTbl));
    writeSheet(CFG.out_sales_ytd, buildSalesYTD(ordersTbl));

    Logger.log('buildAll completed successfully');
  }catch(err){
    logError_('buildAll', err, {});
    throw err;
  }
}

/* ============================================================
   CRON
   ============================================================ */
function syncAllFromShopify(){
  try{
    syncProductsRawWithCosts();
    Utilities.sleep(500);
    syncInventoryRaw();
    Utilities.sleep(500);
    syncOrdersRaw();
    Logger.log('syncAllFromShopify completed successfully');
  }catch(err){
    logError_('syncAllFromShopify', err, {});
    throw err;
  }
}

function cronJob(){
  try{
    syncAllFromShopify();
    buildAll();
    setLastUpdated_();
    Logger.log('cronJob completed successfully');
  }catch(err){
    logError_('cronJob', err, {});
    throw err;
  }
}

function setLastUpdated_(){
  try{
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('meta') || ss.insertSheet('meta');
    sh.clearContents();
    sh.getRange(1,1,1,2).setValues([['last_updated', new Date()]]);
  }catch(err){
    logError_('setLastUpdated', err, {});
  }
}

function installTriggers(){
  // Remove existing triggers first to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger){
    if (trigger.getHandlerFunction() === 'cronJob'){
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Install new trigger
  ScriptApp.newTrigger('cronJob')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger installed: cronJob runs every 15 minutes');
}

/* ============================================================
   MANUAL TEST FUNCTIONS
   ============================================================ */
function testAppendExpense(){
  var testRow = {
    Date: '2025-01-20',
    Subcategory: 'Kredi 2',
    Category: 'Kredi',
    FinalSubcategory: 'Kredi 2',
    AmountTRY: 71453,
    Note: 'Test payment'
  };
  var result = appendExpense_(testRow);
  Logger.log(result.getContent());
}

function testAppendDaily(){
  var testRows = [{
    Date: '2025-01-20',
    Toptan: 5000,
    Online: 3000,
    CKM: 2000,
    Kuaför: 1500,
    Total: 11500
  }];
  var result = appendDaily_(testRows);
  Logger.log(result.getContent());
}

function testGoldQuote(){
  var result = getGoldGramTRY_();
  Logger.log(JSON.stringify(result, null, 2));
}

function testFundQuote(){
  var result = getTEFASQuoteByCode_('FI5');
  Logger.log(JSON.stringify(result, null, 2));
}
