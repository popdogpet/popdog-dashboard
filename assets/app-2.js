  (function(){
    var FALLBACK = 'Veri henüz gelmedi';
    var TR_MONTHS = ['Oca','\u015eub','Mar','Nis','May','Haz','Tem','\u0102u','Eyl','Eki','Kas','Ara'];

    /* ── Helpers ─────────────────────────────────────────── */
    function fmtTimestamp(raw){
      if(!raw) return '';
      try{
        var d = new Date(raw);
        if(isNaN(d.getTime())) return raw;
        return d.getDate()+' '+TR_MONTHS[d.getMonth()]+' \u2022 '
               +String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      }catch(e){ return raw; }
    }

    function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function setOverflow(el){ el.style.wordBreak='break-word'; el.style.overflowWrap='anywhere'; }

    /* Kalın metin: CEO raporu markdown (**kalın**), Instagram raporu Telegram
       biçimi (*kalın*) kullanıyor. İkisi de aynı ayraca indirgenip tek geçişte
       basılır; yoksa yıldızlar ham hâliyle ekrana düşüyor. */
    function kalinMetin(s){
      var hazir = String(s == null ? '' : s)
        .replace(/\*\*(.+?)\*\*/g, '\u0001$1\u0001')
        .replace(/\*(.+?)\*/g,      '\u0001$1\u0001');
      var parcalar = hazir.split('\u0001'), r='';
      for(var k=0;k<parcalar.length;k++){
        var c = esc(parcalar[k]);
        r += (k%2===1) ? '<strong>'+c+'</strong>' : c;
      }
      return r;
    }

    // Header timestamp: keep the most recent across all four files
    var _latestTs = null;
    function setHeaderTs(raw){
      if(!raw) return;
      try{
        var d = new Date(raw);
        if(!isNaN(d.getTime()) && (!_latestTs || d > _latestTs)){
          _latestTs = d;
          var el = document.getElementById('aiLastUpdate');
          if(el) el.textContent = 'Son g\u00fcncelleme: '+fmtTimestamp(raw);
        }
      }catch(e){}
    }

    // Compact sub-section label
    function sLabel(txt){
      return '<div style="font-size:.565rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.36;margin:11px 0 4px">'+esc(txt)+'</div>';
    }

    // Bullet list from string array
    /* Bot bazen markdown tablo satırlarını highlights dizisine tek tek koyuyor
       ("| Kampanya | Harcama |", "|----|----|", "| #Sales | 17.495 |").
       Bunlar madde madde basılınca ayraç satırı da ekrana düşüyordu.
       Ardışık tablo satırları toplanıp gerçek tablo olarak basılır. */
    function tabloSatiriMi(s){ return /^\s*\|.*\|\s*$/.test(String(s||'')); }
    function ayracSatiriMi(hucreler){
      return hucreler.length > 0 && hucreler.every(function(c){ return /^:?-{2,}:?$/.test(c); });
    }
    function tabloHtml(satirlar){
      var veri = satirlar.map(function(s){
        return String(s).trim().replace(/^\||\|$/g,'').split('|').map(function(c){ return c.trim(); });
      }).filter(function(h){ return !ayracSatiriMi(h); });
      if(!veri.length) return '';
      var h = '<div style="overflow-x:auto;margin:4px 0"><table style="width:100%;border-collapse:collapse;font-size:.72rem">';
      for(var t=0;t<veri.length;t++){
        var etiket = (t===0) ? 'th' : 'td';
        var stil = (t===0)
          ? 'text-align:left;padding:3px 6px;opacity:.55;font-weight:600;border-bottom:1px solid rgba(148,163,184,.25)'
          : 'padding:3px 6px;border-bottom:1px solid rgba(148,163,184,.12)';
        h += '<tr>';
        for(var c=0;c<veri[t].length;c++) h += '<'+etiket+' style="'+stil+'">'+kalinMetin(veri[t][c])+'</'+etiket+'>';
        h += '</tr>';
      }
      return h + '</table></div>';
    }

    function bList(arr, accentColor){
      if(!Array.isArray(arr)||!arr.length) return '';
      var wrap = accentColor
        ? '<div style="border-left:2px solid '+accentColor+';padding-left:8px">{inner}</div>'
        : '{inner}';
      var inner = '';
      for(var i=0;i<arr.length;i++){
        if(tabloSatiriMi(arr[i])){
          var blok=[];
          while(i<arr.length && tabloSatiriMi(arr[i])){ blok.push(arr[i]); i++; }
          i--;
          inner += tabloHtml(blok);
          continue;
        }
        inner += '<div style="display:flex;gap:6px;margin-bottom:3px">'
          +'<span style="opacity:.32;flex-shrink:0;margin-top:2px;font-size:.7rem">\u203a</span>'
          +'<span style="font-size:.78rem;line-height:1.52">'+esc(arr[i])+'</span></div>';
      }
      return wrap.replace('{inner}',inner);
    }

    // Tiny freshness line
    /* Kartlar farklı hızlarda güncelleniyor; hepsi aynı soluk zaman damgasıyla
       görününce aylar önceki veri günceli sanılıyor. 48 saatten eskiyse
       görünür bir uyarı rozeti basılır. */
    var BAYAT_SAAT = 48;
    function veriYasiSaat(ts){
      if(!ts) return null;
      var ms = Date.now() - new Date(ts).getTime();
      if (isNaN(ms) || ms < 0) return null;
      return ms / 3600000;
    }
    function yasEtiketi(saat){
      if (saat < 48) return Math.round(saat) + ' saat';
      var gun = Math.round(saat / 24);
      return gun + ' gün';
    }
    function freshLine(ts){
      if(!ts) return '';
      var damga = '<span style="opacity:.3">'+esc(fmtTimestamp(ts))+'</span>';
      var saat = veriYasiSaat(ts);
      if (saat === null || saat <= BAYAT_SAAT){
        return '<div style="font-size:.585rem;margin-top:9px;letter-spacing:.01em">'+damga+'</div>';
      }
      var rozet = '<span style="display:inline-block;font-size:.585rem;font-weight:700;'
        + 'padding:1px 6px;border-radius:999px;margin-right:6px;'
        + 'background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.35)">'
        + '\u26a0 ' + esc(yasEtiketi(saat)) + ' önce</span>';
      return '<div style="font-size:.585rem;margin-top:9px;letter-spacing:.01em">'+rozet+damga+'</div>';
    }

    /* ── Legacy text-blob fallback (backward compat) ─────── */
    function mdToHtml(raw){
      if(!raw) return '<span class="hint">'+esc(FALLBACK)+'</span>';
      var applyBold = kalinMetin;
      var lines = raw
        .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
        .replace(/^[-*_]{3,}\s*$/gm,'').replace(/^\|+\s*$/gm,'')
        .replace(/^#{1,4}\s*/gm,'').replace(/\n{3,}/g,'\n\n')
        .trim().split('\n');
      var html='';
      for(var i=0;i<lines.length;i++){
        var line=lines[i].trim(); if(!line) continue;

        /* Markdown tablosu: ardışık "|" satırları. Eskiden başlık ve ayraç
           satırları ham hâliyle madde gibi basılıyordu. */
        if(/^\|.*\|$/.test(line)){
          var tablo=[];
          while(i<lines.length && /^\|.*\|$/.test(lines[i].trim())){
            var hucreler=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();});
            if(!hucreler.every(function(c){return /^:?-{2,}:?$/.test(c);})) tablo.push(hucreler);
            i++;
          }
          i--;
          if(tablo.length){
            html+='<div style="overflow-x:auto;margin:4px 0"><table style="width:100%;border-collapse:collapse;font-size:.72rem">';
            for(var t=0;t<tablo.length;t++){
              var etiket = (t===0) ? 'th' : 'td';
              var stil = (t===0)
                ? 'text-align:left;padding:3px 6px;opacity:.55;font-weight:600;border-bottom:1px solid rgba(148,163,184,.25)'
                : 'padding:3px 6px;border-bottom:1px solid rgba(148,163,184,.12)';
              html+='<tr>';
              for(var c2=0;c2<tablo[t].length;c2++){
                html+='<'+etiket+' style="'+stil+'">'+applyBold(tablo[t][c2])+'</'+etiket+'>';
              }
              html+='</tr>';
            }
            html+='</table></div>';
          }
          continue;
        }

        if(/^[-*\u2022]\s+/.test(line)){
          html+='<div style="display:flex;gap:6px;margin-bottom:3px"><span style="opacity:.45;flex-shrink:0">\u203a</span><span>'+applyBold(line.replace(/^[-*\u2022]\s+/,''))+'</span></div>';
        } else {
          html+='<div style="margin-bottom:3px">'+applyBold(line)+'</div>';
        }
      }
      return html||'<span class="hint">'+esc(FALLBACK)+'</span>';
    }

    /* ── Focus card ──────────────────────────────────────── */
    function renderFocus(el, d){
      if(!el) return;
      setOverflow(el);
      // Legacy fallback
      /* Metin yedeği de kendi zaman damgasını basmalı: yoksa kart en taze
         kardeşinin başlık damgasıyla güncel sanılıyor. */
      if(!d||(!d.title&&d.text)){
        el.innerHTML = mdToHtml(d&&d.text?d.text:null) + freshLine(d&&d.updated_at);
        if(d&&d.updated_at) setHeaderTs(d.updated_at);
        return;
      }
      if(!d.title){ el.innerHTML='<span class="hint">'+esc(FALLBACK)+'</span>'; return; }
      var h='';
      h+='<div style="font-size:.875rem;font-weight:600;line-height:1.35;margin-bottom:6px;letter-spacing:-.01em">'+esc(d.title)+'</div>';
      if(d.why)    h+='<div style="font-size:.775rem;opacity:.58;line-height:1.52;margin-bottom:6px">'+esc(d.why)+'</div>';
      if(d.impact) h+='<div style="font-size:.775rem;border-left:2px solid rgba(96,165,250,.6);padding-left:8px;line-height:1.52;margin-bottom:5px">'+esc(d.impact)+'</div>';
      if(Array.isArray(d.next_steps)&&d.next_steps.length){
        h+=sLabel('Sonraki Ad\u0131mlar');
        h+=bList(d.next_steps);
      }
      h+=freshLine(d.updated_at);
      el.innerHTML=h;
      setHeaderTs(d.updated_at);
    }

    /* ── Action card ─────────────────────────────────────── */
    var URGENCY_STYLE={
      'y\u00fcksek':'background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3)',
      'orta':'background:rgba(251,191,36,.13);color:#fbbf24;border:1px solid rgba(251,191,36,.28)',
      'd\u00fc\u015f\u00fck':'background:rgba(52,211,153,.13);color:#34d399;border:1px solid rgba(52,211,153,.28)',
      'high':'background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3)',
      'medium':'background:rgba(251,191,36,.13);color:#fbbf24;border:1px solid rgba(251,191,36,.28)',
      'low':'background:rgba(52,211,153,.13);color:#34d399;border:1px solid rgba(52,211,153,.28)'
    };
    function urgencyBadge(u){
      if(!u) return '';
      var style=URGENCY_STYLE[(u||'').toLowerCase()]||'background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid rgba(148,163,184,.25)';
      return '<span style="display:inline-block;font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px;'+style+'">'+esc(u)+'</span>';
    }
    function renderAction(el, d){
      if(!el) return;
      setOverflow(el);
      /* Metin yedeği de kendi zaman damgasını basmalı: yoksa kart en taze
         kardeşinin başlık damgasıyla güncel sanılıyor. */
      if(!d||(!d.title&&d.text)){
        el.innerHTML = mdToHtml(d&&d.text?d.text:null) + freshLine(d&&d.updated_at);
        if(d&&d.updated_at) setHeaderTs(d.updated_at);
        return;
      }
      if(!d.title){ el.innerHTML='<span class="hint">'+esc(FALLBACK)+'</span>'; return; }
      var h='';
      h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">';
      h+='<div style="font-size:.875rem;font-weight:600;line-height:1.35;letter-spacing:-.01em">'+esc(d.title)+'</div>';
      if(d.urgency) h+=urgencyBadge(d.urgency);
      h+='</div>';
      if(d.why)    h+='<div style="font-size:.775rem;opacity:.58;line-height:1.52;margin-bottom:6px">'+esc(d.why)+'</div>';
      if(d.impact) h+='<div style="font-size:.775rem;border-left:2px solid rgba(52,211,153,.62);padding-left:8px;line-height:1.52">'+esc(d.impact)+'</div>';
      h+=freshLine(d.updated_at);
      el.innerHTML=h;
      setHeaderTs(d.updated_at);
    }

    /* ── Alerts ──────────────────────────────────────────── */
    var ALERT_ACCENT={critical:'rgba(248,113,113,.7)',warning:'rgba(251,191,36,.7)',positive:'rgba(52,211,153,.65)'};
    var ALERT_ICON  ={critical:'\ud83d\udd34',warning:'\u26a0\ufe0f',positive:'\u2705'};
    function renderAlerts(el, d){
      if(!el) return;
      if(!d||!Array.isArray(d.items)||!d.items.length){
        el.innerHTML='<li class="hint" style="font-size:.75rem">'+esc(FALLBACK)+'</li>';
        return;
      }
      var structured = typeof d.items[0]==='object'&&d.items[0]!==null;
      if(!structured){
        // Legacy string array
        el.innerHTML=d.items.map(function(s){
          var parts=(s||'').split(/\*\*(.+?)\*\*/g), out='';
          for(var j=0;j<parts.length;j++){
            var c=parts[j].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            out+=(j%2===1)?'<strong>'+c+'</strong>':c;
          }
          return '<li style="font-size:.78rem;line-height:1.52;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07);word-break:break-word;overflow-wrap:anywhere">'+out+'</li>';
        }).join('');
      } else {
        el.innerHTML=d.items.map(function(item){
          var lvl=(item.level||'warning').toLowerCase();
          var accent=ALERT_ACCENT[lvl]||ALERT_ACCENT.warning;
          var icon=ALERT_ICON[lvl]||'\u26a0\ufe0f';
          return '<li style="padding:7px 0 7px 10px;border-left:2px solid '+accent
            +';margin-bottom:4px;word-break:break-word;overflow-wrap:anywhere">'
            +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
            +'<span style="font-size:.6rem;flex-shrink:0;line-height:1">'+icon+'</span>'
            +'<span style="font-size:.78rem;font-weight:600;line-height:1.35">'+esc(item.title||'')+'</span>'
            +'</div>'
            +(item.detail?'<div style="font-size:.71rem;opacity:.52;margin-top:2px;line-height:1.48;padding-left:18px">'+esc(item.detail)+'</div>':'')
            +'</li>';
        }).join('');
      }
      setHeaderTs(d.updated_at);
    }

    /* ── Daily summary ───────────────────────────────────── */
    function renderSummary(el, d){
      if(!el) return;
      setOverflow(el);
      // Legacy fallback
      if(!d||(!d.highlights&&!d.risks&&!d.opportunities&&d.text)){
        el.innerHTML=mdToHtml(d&&d.text?d.text:null) + freshLine(d&&d.updated_at);
        if(d&&d.updated_at) setHeaderTs(d.updated_at);
        return;
      }
      if(!d.highlights&&!d.risks&&!d.opportunities){
        el.innerHTML='<span class="hint">'+esc(FALLBACK)+'</span>'; return;
      }
      var h='';
      if(d.title) h+='<div style="font-size:.875rem;font-weight:600;margin-bottom:6px;letter-spacing:-.01em">'+esc(d.title)+'</div>';
      if(Array.isArray(d.highlights)&&d.highlights.length){
        h+=sLabel('\u00d6ne \u00c7\u0131kanlar');
        h+=bList(d.highlights);
      }
      if(Array.isArray(d.risks)&&d.risks.length){
        h+=sLabel('Riskler');
        h+=bList(d.risks,'rgba(248,113,113,.4)');
      }
      if(Array.isArray(d.opportunities)&&d.opportunities.length){
        h+=sLabel('F\u0131rsatlar');
        h+=bList(d.opportunities,'rgba(52,211,153,.4)');
      }
      h+=freshLine(d.updated_at);
      el.innerHTML=h;
      setHeaderTs(d.updated_at);
    }

    /* ── Fetch + wire ────────────────────────────────────── */
    /* Uçlar her zaman 200 döner; durum yanıttaki _meta.source alanında:
         kv           → gerçek veri
         empty        → KV'de henüz kayıt yok  (normal, "veri gelmedi")
         config_error → KV binding yok         (sistem sorunu)
         parse_error  → KV kaydı bozuk         (sistem sorunu)
       Son ikisini normal boşluktan ayırmazsak bozuk sistem "veri gelmedi"
       gibi görünüyor ve fark edilmiyor. */
    /* cb içindeki bir hata .catch'e düşüp "Sunucuya ulaşılamadı" olarak
       görünmesin: çizim hatası ağ hatası gibi raporlanınca yanlış yerde
       aranıyor. cb ayrı try/catch içinde çağrılır, hatası konsola yazılır. */
    function guvenliCb(path, cb, d, durum){
      try { cb(d, durum); }
      catch(err){ console.error('[AI] ' + path + ' — çizim hatası:', err); }
    }

    function loadJSON(path, cb){
      fetch(path+'?_='+Date.now(), {cache:'no-store'})
        .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
        .then(function(d){
          var src = d && d._meta && d._meta.source;
          if (src === 'config_error' || src === 'parse_error'){
            console.warn('[AI] ' + path + ' — sunucu sorunu: ' + src);
            guvenliCb(path, cb, null, { hata: true, kaynak: src });
            return;
          }
          guvenliCb(path, cb, d);
        })
        .catch(function(err){
          console.warn('[AI] ' + path + ' — ulaşılamadı:', err && err.message);
          guvenliCb(path, cb, null, { hata: true, kaynak: 'network' });
        });
    }

    /* Sistem sorunu olan kartlar sessiz kalmasın. */
    function hataKutusu(el, durum){
      if (!el || !durum || !durum.hata) return false;
      var mesaj = durum.kaynak === 'network'
        ? 'Sunucuya ulaşılamadı'
        : 'Sunucu verisi okunamadı (' + durum.kaynak + ')';
      el.innerHTML = '<span style="color:#f87171;font-size:.775rem">\u26a0 ' + esc(mesaj) + '</span>';
      return true;
    }

    function renderCaddebostan(d) {
      var dateEl  = document.getElementById('caddeBannerDate');
      var staleEl = document.getElementById('caddeBannerStale');
      var bodyEl  = document.getElementById('caddeBannerBody');
      if (!bodyEl) return;

      if (!d || !d.grand_total) {
        bodyEl.innerHTML = '<span class="cadde-meta">Caddebostan verisi henüz gelmedi</span>';
        if (dateEl)  dateEl.textContent = '';
        if (staleEl) staleEl.classList.add('hidden');
        return;
      }

      // Freshness
      var freshLabel = '';
      var isStale = false;
      var tsRaw = d.source_generated_at || d.updated_at;
      if (tsRaw) {
        var ageMin = Math.round((Date.now() - new Date(tsRaw).getTime()) / 60000);
        if (!isNaN(ageMin) && ageMin >= 0) {
          freshLabel = ageMin < 60 ? ageMin + ' dk önce' : Math.round(ageMin / 60) + ' sa önce';
        }
      }
      if (d.is_today === false || (typeof d.stale_minutes === 'number' && d.stale_minutes > 120)) isStale = true;
      if (dateEl)  dateEl.textContent = [d.date, freshLabel].filter(Boolean).join('  ·  ');
      if (staleEl) staleEl.classList.toggle('hidden', !isStale);

      var fmt = function(v){
        if (v == null) return '—';
        var n = parseFloat(v);
        if (isNaN(n)) return String(v);
        return n.toLocaleString('tr-TR', { maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
      };
      var fmtPct = function(p) {
        if (p == null) return '';
        var n = parseFloat(p);
        if (isNaN(n)) return '';
        return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
      };
      /* Gün ortasındaki kısmi ciroyu dünün kapanmış toplamıyla kıyaslamak
         her sabah "-%93" gibi sahte bir çöküş gösteriyordu. Gün sürerken
         yüzde basılmaz; onun yerine nötr bir "gün içi" rozeti çıkar.
         Mağaza kapandıktan sonra (saat 21+) kıyas dürüst hale geldiği için
         gerçek yüzde geri gelir. */
      var gunKapandi = new Date().getHours() >= 21;
      var gunIci = (d.is_today === true) && !gunKapandi;

      var deltaChip = function(pct) {
        if (gunIci) {
          return '<span style="font-size:.62rem;color:#94a3b8;font-weight:600;margin-left:4px;'
            + 'padding:0 5px;border-radius:999px;background:rgba(148,163,184,.14)">gün içi</span>';
        }
        if (pct == null) return '';
        var n = parseFloat(pct);
        if (isNaN(n)) return '';
        var col = n > 0 ? '#34d399' : n < 0 ? '#f87171' : '#94a3b8';
        var arrow = n > 0 ? '\u25b2' : n < 0 ? '\u25bc' : '\u25cf';
        return '<span style="font-size:.62rem;color:'+col+';font-weight:700;margin-left:4px">'+arrow+fmtPct(pct)+'</span>';
      };

      // Primary metrics row
      var primary = '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:4px 20px">';

      primary += '<div style="display:flex;flex-direction:column;gap:1px">'
        + '<span class="cadde-meta" style="font-size:.565rem;text-transform:uppercase;letter-spacing:.08em">Toplam</span>'
        + '<div style="display:flex;align-items:baseline;gap:3px">'
        + '<span class="cadde-num-primary">' + fmt(d.grand_total) + '</span>'
        + deltaChip(d.delta_total_pct)
        + (d.previous_total != null ? '<span class="cadde-meta" style="font-size:.62rem">&thinsp;dün tamamı ' + fmt(d.previous_total) + '</span>' : '')
        + '</div></div>';

      /* Bot alanı `zeedog_units` diye yazıyor; kart `zee_dog_units` arıyordu,
         bu yüzden Zee.Dog adedi hiç basılmıyordu. İkisi de kabul edilir. */
      var zeeAdet = d.zeedog_units != null ? d.zeedog_units : d.zee_dog_units;
      var zeeDunAdet = d.previous_zeedog_units != null ? d.previous_zeedog_units : d.previous_zee_dog_units;
      if (zeeAdet != null) {
        primary += '<div style="display:flex;flex-direction:column;gap:1px">'
          + '<span class="cadde-meta" style="font-size:.565rem;text-transform:uppercase;letter-spacing:.08em">Zee.Dog</span>'
          + '<div style="display:flex;align-items:baseline;gap:3px">'
          + '<span class="cadde-num-secondary">' + fmt(zeeAdet) + ' adet</span>'
          + deltaChip(d.delta_units_pct)
          + (zeeDunAdet != null ? '<span class="cadde-meta" style="font-size:.62rem">&thinsp;dün tamamı ' + fmt(zeeDunAdet) + '</span>' : '')
          + '</div></div>';
      }
      primary += '</div>';

      // Secondary stats
      var fields = [
        ['Kredi Kartı', d.credit_card],
        ['Nakit',       d.cash],
        ['Ciro',        d.total_ciro],
        ['Kuaför',      d.grooming],
        ['Kasa',        d.cash_register],
        ['Online',      d.online],
        ['Toptan',      d.wholesale],
        ['Trendyol',    d.trendyol],
        ['Hepsiburada', d.hepsiburada],
      ];
      var secondary = '<div class="cadde-secondary-row">';
      fields.forEach(function(f){
        if (f[1] != null && f[1] !== '' && f[1] !== 0) {
          secondary += '<span class="cadde-stat">' + f[0] + '&thinsp;<span class="cadde-stat-val">' + fmt(f[1]) + '</span></span>';
        }
      });
      secondary += '</div>';

      bodyEl.innerHTML = primary + secondary;
    }

    /* ── Telegram raporları (düz metin) ──────────────────── */
    /* Bot raporları markdown olarak yazıyor: başlık (#), tablo (|…|),
       kalın (**…**) ve Instagram raporunda hizalı sütunlar için ``` blokları.
       mdToHtml kod bloklarını bozduğu için raporlar ayrı basılıyor. */
    function raporBaslik(txt, seviye){
      var boy = seviye <= 1 ? '.82rem' : '.72rem';
      var op  = seviye <= 1 ? '.9' : '.62';
      return '<div style="font-size:'+boy+';font-weight:700;opacity:'+op
        +';margin:12px 0 5px;letter-spacing:-.01em">'+esc(txt)+'</div>';
    }

    function renderRapor(el, d){
      if(!el) return;
      setOverflow(el);

      var ham = d && typeof d.text === 'string' ? d.text.trim() : '';
      if(!ham){
        el.innerHTML = '<span class="hint" style="font-size:.75rem">'
          + esc('Bu rapor henüz üretilmedi') + '</span>' + freshLine(d && d.updated_at);
        return;
      }

      var satirlar = ham.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      var h = '';

      for(var i=0;i<satirlar.length;i++){
        var s = satirlar[i];
        var t = s.trim();

        /* ``` blokları: Instagram raporunun hizalı tabloları burada.
           İçerik olduğu gibi, tek aralıklı fontla basılır. */
        if(/^```/.test(t)){
          var blok = [];
          i++;
          while(i<satirlar.length && !/^```/.test(satirlar[i].trim())){ blok.push(satirlar[i]); i++; }
          if(blok.length){
            h += '<pre style="overflow-x:auto;margin:6px 0;padding:8px 10px;border-radius:8px;'
              + 'background:rgba(148,163,184,.08);font-size:.66rem;line-height:1.45;'
              + 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace">'
              + esc(blok.join('\n')) + '</pre>';
          }
          continue;
        }

        if(!t) continue;
        if(/^[-*_]{3,}$/.test(t)) continue;              // yatay çizgi
        if(/^\|+$/.test(t)) continue;                     // boş tablo satırı

        if(/^\|.*\|$/.test(t)){                           // markdown tablosu
          var blok2 = [];
          while(i<satirlar.length && /^\|.*\|$/.test(satirlar[i].trim())){ blok2.push(satirlar[i]); i++; }
          i--;
          h += tabloHtml(blok2);
          continue;
        }

        var basl = t.match(/^(#{1,4})\s*(.+)$/);
        if(basl){ h += raporBaslik(basl[2], basl[1].length); continue; }

        if(/^[-*•]\s+/.test(t)){
          h += '<div style="display:flex;gap:6px;margin-bottom:3px">'
            + '<span style="opacity:.32;flex-shrink:0;margin-top:2px;font-size:.7rem">›</span>'
            + '<span style="font-size:.75rem;line-height:1.5">'+kalinMetin(t.replace(/^[-*\u2022]\s+/,''))+'</span></div>';
          continue;
        }

        h += '<div style="font-size:.75rem;line-height:1.5;margin-bottom:3px">'+kalinMetin(t)+'</div>';
      }

      el.innerHTML = h + freshLine(d && d.updated_at);
    }

    /* ── Instagram Intelligence ─────────────────────────────── */

    function fmtK(n) {
      if (n == null) return '–';
      var v = parseFloat(n);
      if (isNaN(v)) return String(n);
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
      return String(Math.round(v));
    }

    function init(){
      // Reset so header timestamp always reflects the current cycle's freshest file
      _latestTs = null;
      loadJSON('/api/focus',        function(d, h){ var el=document.getElementById('aiFocus');   if(!hataKutusu(el,h)) renderFocus(el, d); });
      loadJSON('/api/action',       function(d, h){ var el=document.getElementById('aiAction');  if(!hataKutusu(el,h)) renderAction(el, d); });
      loadJSON('/api/alerts',       function(d, h){ var el=document.getElementById('aiAlerts');  if(!hataKutusu(el,h)) renderAlerts(el, d); });
      loadJSON('/api/daily',        function(d, h){ var el=document.getElementById('aiSummary'); if(!hataKutusu(el,h)) renderSummary(el, d); });
      loadJSON('/api/caddebostan_live',  function(d){ renderCaddebostan  (d); });

      var raporlar = [
        ['/api/report_ceo',        'repCeo'],
        ['/api/report_caddebostan','repCadde'],
        ['/api/report_weekly',     'repWeekly'],
        ['/api/report_instagram',  'repInstagram'],
      ];
      raporlar.forEach(function(r){
        loadJSON(r[0], function(d, h){
          var el = document.getElementById(r[1]);
          if(!hataKutusu(el, h)) renderRapor(el, d);
        });
      });
    }

    /* ── Auto-refresh: only while AI page is visible ─────── */
    var _aiTimer = null;

    function startAiRefresh(){
      if(_aiTimer) return;                        // no duplicate intervals
      _aiTimer = setInterval(init, 30000);
    }
    function stopAiRefresh(){
      if(_aiTimer){ clearInterval(_aiTimer); _aiTimer = null; }
    }

    function setup(){
      var section = document.getElementById('execAI');

      // Watch for hidden class toggled by showPage()
      if(section && window.MutationObserver){
        new MutationObserver(function(){
          section.classList.contains('hidden') ? stopAiRefresh() : startAiRefresh();
        }).observe(section, {attributes:true, attributeFilter:['class']});
      }

      // Pause auto-refresh when tab is backgrounded, resume when foregrounded
      document.addEventListener('visibilitychange', function(){
        if(document.hidden){ stopAiRefresh(); }
        else {
          var s = document.getElementById('execAI');
          if(s && !s.classList.contains('hidden')){ init(); startAiRefresh(); }
        }
      });

      // Manual refresh button
      var btn = document.getElementById('aiRefreshBtn');
      if(btn) btn.onclick = function(){ init(); };

      // Initial load + start timer if AI page is the landing page
      init();
      if(section && !section.classList.contains('hidden')) startAiRefresh();
    }

    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', setup);
    } else { setup(); }
  })();
  
