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
    function bList(arr, accentColor){
      if(!Array.isArray(arr)||!arr.length) return '';
      var wrap = accentColor
        ? '<div style="border-left:2px solid '+accentColor+';padding-left:8px">{inner}</div>'
        : '{inner}';
      var inner = arr.map(function(s){
        return '<div style="display:flex;gap:6px;margin-bottom:3px">'
          +'<span style="opacity:.32;flex-shrink:0;margin-top:2px;font-size:.7rem">\u203a</span>'
          +'<span style="font-size:.78rem;line-height:1.52">'+esc(s)+'</span></div>';
      }).join('');
      return wrap.replace('{inner}',inner);
    }

    // Tiny freshness line
    function freshLine(ts){
      if(!ts) return '';
      return '<div style="font-size:.585rem;opacity:.3;margin-top:9px;letter-spacing:.01em">'+esc(fmtTimestamp(ts))+'</div>';
    }

    /* ── Legacy text-blob fallback (backward compat) ─────── */
    function mdToHtml(raw){
      if(!raw) return '<span class="hint">'+esc(FALLBACK)+'</span>';
      function applyBold(s){
        var parts = s.split(/\*\*(.+?)\*\*/g), r='';
        for(var k=0;k<parts.length;k++){
          var c=parts[k].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          r += (k%2===1)?'<strong>'+c+'</strong>':c;
        }
        return r;
      }
      var lines = raw
        .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
        .replace(/^[-*_]{3,}\s*$/gm,'').replace(/^\|+\s*$/gm,'')
        .replace(/^#{1,4}\s*/gm,'').replace(/\n{3,}/g,'\n\n')
        .trim().split('\n');
      var html='';
      for(var i=0;i<lines.length;i++){
        var line=lines[i].trim(); if(!line) continue;
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
      if(!d||(!d.title&&d.text)){ el.innerHTML=mdToHtml(d&&d.text?d.text:null); return; }
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
      if(!d||(!d.title&&d.text)){ el.innerHTML=mdToHtml(d&&d.text?d.text:null); return; }
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
        el.innerHTML=mdToHtml(d&&d.text?d.text:null);
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
    function loadJSON(path, cb){
      fetch(path+'?_='+Date.now(), {cache:'no-store'})
        .then(function(r){ if(!r.ok) throw new Error('missing'); return r.json(); })
        .then(function(d){
          var src = d && d._meta && d._meta.source;
          if (src === 'config_error' || src === 'parse_error'){
            console.warn('[AI] ' + path + ' — sunucu sorunu: ' + src);
            cb(null, { hata: true, kaynak: src });
            return;
          }
          cb(d);
        })
        .catch(function(){ cb(null, { hata: true, kaynak: 'network' }); });
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

      var fmt = function(v){ return v != null ? String(v) : '—'; };
      var fmtPct = function(p) {
        if (p == null) return '';
        var n = parseFloat(p);
        if (isNaN(n)) return '';
        return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
      };
      var deltaChip = function(pct) {
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
        + (d.previous_total != null ? '<span class="cadde-meta" style="font-size:.62rem">&thinsp;dün ' + fmt(d.previous_total) + '</span>' : '')
        + '</div></div>';

      if (d.zee_dog_units != null) {
        primary += '<div style="display:flex;flex-direction:column;gap:1px">'
          + '<span class="cadde-meta" style="font-size:.565rem;text-transform:uppercase;letter-spacing:.08em">Zee.Dog</span>'
          + '<div style="display:flex;align-items:baseline;gap:3px">'
          + '<span class="cadde-num-secondary">' + fmt(d.zee_dog_units) + ' adet</span>'
          + deltaChip(d.delta_units_pct)
          + (d.previous_zeedog_units != null ? '<span class="cadde-meta" style="font-size:.62rem">&thinsp;dün ' + fmt(d.previous_zeedog_units) + '</span>' : '')
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

    /* ── Instagram Intelligence ─────────────────────────────── */

    function fmtK(n) {
      if (n == null) return '–';
      var v = parseFloat(n);
      if (isNaN(v)) return String(n);
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
      return String(Math.round(v));
    }

    function renderInstaMain(d) {
      var el    = document.getElementById('instaMain');
      var tsEl  = document.getElementById('instaLastUpdate');
      var momEl = document.getElementById('instaMomentumBadge');
      if (!el || !d) return;

      if (tsEl && d.updated_at) {
        var ageMin = Math.round((Date.now() - new Date(d.updated_at).getTime()) / 60000);
        if (!isNaN(ageMin) && ageMin >= 0)
          tsEl.textContent = ageMin < 60 ? ageMin + ' dk önce' : Math.round(ageMin / 60) + ' sa önce';
      }

      var mom = d.momentum_state || d.momentum || null;
      if (momEl && mom) {
        var mMap = {
          growing:  { cls: 'insta-momentum-up',     icon: '▲', txt: 'Büyüyor' },
          peaked:   { cls: 'insta-momentum-peaked',  icon: '◆', txt: 'Zirve'   },
          stable:   { cls: 'insta-momentum-flat',    icon: '●', txt: 'Stabil'  },
          declining:{ cls: 'insta-momentum-down',    icon: '▼', txt: 'Düşüyor' },
          fading:   { cls: 'insta-momentum-down',    icon: '▼', txt: 'Düşüyor' },
        };
        var m = mMap[mom] || { cls: 'insta-momentum-flat', icon: '●', txt: mom };
        momEl.innerHTML = '<span class="insta-momentum ' + m.cls + '">' + m.icon + ' ' + esc(m.txt) + '</span>';
      }

      var html = '';

      var dec = d.decision || ((d.title && d.reason) ? d : null);
      if (dec && dec.title) {
        var typeMap = {
          post_now: 'Şimdi Paylaş', wait: 'Bekle', story_now: 'Story At',
          carousel_today: 'Carousel', reel_today: 'Reel'
        };
        var typeLabel = typeMap[dec.type || dec.decision_type] || dec.type || dec.decision_type || '';
        html += '<div class="insta-action-card">'
          + (typeLabel ? '<div class="insta-action-type">' + esc(typeLabel) + '</div>' : '')
          + '<div class="insta-action-title">' + esc(dec.title) + '</div>'
          + '<div class="insta-action-reason">' + esc(dec.reason || '') + '</div>'
          + '<div class="insta-action-meta">'
          + (dec.recommended_time ? '⏰ ' + esc(dec.recommended_time) + '&ensp;·&ensp;' : '')
          + (dec.confidence != null ? Math.round(dec.confidence * 100) + '% güven' : '')
          + '</div>'
          + '</div>';
      }

      var metrics = [];
      if (d.followers != null)         metrics.push({ num: fmtK(d.followers),   lbl: 'Takipçi' });
      if (d.daily_reach != null)       metrics.push({ num: fmtK(d.daily_reach), lbl: 'Günlük Erişim' });
      if (d.recent_engagement != null) metrics.push({ num: parseFloat(d.recent_engagement).toFixed(1) + '%', lbl: 'Etkileşim' });
      if (d.best_format)               metrics.push({ num: esc(d.best_format),  lbl: 'En İyi Format' });

      if (metrics.length) {
        html += '<div class="insta-stats">'
          + metrics.map(function(m){
              return '<div class="insta-stat">'
                + '<div class="insta-stat-num">' + m.num + '</div>'
                + '<div class="insta-stat-lbl">' + m.lbl + '</div>'
                + '</div>';
            }).join('')
          + '</div>';
      }

      el.innerHTML = html || '<div style="font-size:.75rem;color:#94a3b8">Veri henüz gelmedi</div>';
    }

    function renderInstaRecs(d) {
      var el = document.getElementById('instaRecs');
      if (!el) return;
      if (!d || !d.items || !d.items.length) {
        el.innerHTML = '<div style="font-size:.75rem;color:#94a3b8">Öneri verisi henüz gelmedi</div>';
        return;
      }
      var dotMap = { urgent: 'insta-dot-urgent', high: 'insta-dot-high', medium: 'insta-dot-medium', low: 'insta-dot-low' };
      el.innerHTML = '<div class="insta-rec-list">'
        + d.items.map(function(r){
            var dot = dotMap[r.priority] || 'insta-dot-low';
            return '<div class="insta-rec-item">'
              + '<div class="insta-rec-dot ' + dot + '"></div>'
              + '<div class="insta-rec-body">'
              +   '<div class="insta-rec-title">' + esc(r.title || r.action || '') + '</div>'
              +   '<div class="insta-rec-reason">' + esc(r.reason || '') + '</div>'
              +   (r.recommended_time ? '<div class="insta-rec-time">⏰ ' + esc(r.recommended_time) + '</div>' : '')
              + '</div>'
              + '</div>';
          }).join('')
        + '</div>';
    }

    function init(){
      // Reset so header timestamp always reflects the current cycle's freshest file
      _latestTs = null;
      loadJSON('/api/focus',        function(d, h){ var el=document.getElementById('aiFocus');   if(!hataKutusu(el,h)) renderFocus(el, d); });
      loadJSON('/api/action',       function(d, h){ var el=document.getElementById('aiAction');  if(!hataKutusu(el,h)) renderAction(el, d); });
      loadJSON('/api/alerts',       function(d, h){ var el=document.getElementById('aiAlerts');  if(!hataKutusu(el,h)) renderAlerts(el, d); });
      loadJSON('/api/daily',        function(d, h){ var el=document.getElementById('aiSummary'); if(!hataKutusu(el,h)) renderSummary(el, d); });
      loadJSON('/api/caddebostan_live',  function(d){ renderCaddebostan  (d); });
      loadJSON('/api/instagram_live_summary',    function(d){ renderInstaMain(d); });
      loadJSON('/api/instagram_recommendations', function(d){ renderInstaRecs(d); });
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
  
