    // Simple page router (hide/show data-page sections)
    (function(){
      const KEY = 'popdog_active_page';
      const $all = () => Array.from(document.querySelectorAll('[data-page]'));
      function showPage(key){
        $all().forEach(el => {
          if (el.dataset.page === key) el.classList.remove('hidden');
          else el.classList.add('hidden');
        });
        try{ localStorage.setItem(KEY, key); }catch(e){}
        // set active button look (optional subtle bold)
        ['navSummary','navRevenue','navExpenses','navStock','navAI'].forEach(id=>{
          const b = document.getElementById(id);
          if(!b) return;
          const k = id.replace('nav','').toLowerCase();
          if((k==='summary' && key==='summary') || (k==='revenue' && key==='revenue') || (k==='expenses' && key==='expenses') || (k==='stock' && key==='stock') || (k==='ai' && key==='ai')){
            b.classList.add('ring-1','ring-indigo-400');
          } else {
            b.classList.remove('ring-1','ring-indigo-400');
          }
        });
      }
      window.showPage = showPage;

      // Giderler sayfası PIN koruması — PIN sunucuda (EXPENSES_PIN secret),
      // doğrulama /api/login üzerinden yapılır ve /api/sheet?key=expenses
      // ancak bu çerezle veri döner.
      const EXPENSES_SESSION_KEY = 'popdog_expenses_unlocked';
      function tryShowExpenses(){
        if(sessionStorage.getItem(EXPENSES_SESSION_KEY) === 'true'){
          showPage('expenses'); return;
        }
        const overlay = document.getElementById('expensesLock');
        if(!overlay) { showPage('expenses'); return; }
        overlay.style.display = 'flex';
        const inputs = document.querySelectorAll('#expPinInputs input');
        const errEl  = document.getElementById('expPinError');
        inputs.forEach(i=>{ i.value=''; });
        errEl.textContent = '';
        inputs[0].focus();
        inputs.forEach((inp, idx)=>{
          // Clone to remove old listeners
          const clone = inp.cloneNode(true);
          inp.parentNode.replaceChild(clone, inp);
        });
        const fresh = document.querySelectorAll('#expPinInputs input');
        fresh.forEach((inp, idx)=>{
          inp.addEventListener('input', e=>{
            const v = e.target.value.replace(/[^0-9]/g,'');
            e.target.value = v;
            errEl.textContent = '';
            if(v && idx < fresh.length-1) fresh[idx+1].focus();
            const pin = Array.from(fresh).map(i=>i.value).join('');
            if(pin.length === 4){
              errEl.textContent = 'Kontrol ediliyor…';
              fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: pin, scope: 'expenses' })
              })
              .then(async r => ({ ok: r.ok, body: await r.json().catch(()=>({})) }))
              .then(({ ok, body }) => {
                if(ok && body.ok){
                  sessionStorage.setItem(EXPENSES_SESSION_KEY,'true');
                  try{ localStorage.setItem('popdog_active_page','expenses'); }catch(_){}
                  overlay.style.display = 'none';
                  errEl.textContent = 'Giderler yükleniyor…';
                  // Gider CSV'si kilitliyken atlanmıştı; çerez artık var, tazeleyip çekiyoruz.
                  location.reload();
                } else {
                  errEl.textContent = body.error || 'Yanlış şifre';
                  fresh.forEach(i=>{ i.value=''; });
                  fresh[0].focus();
                }
              })
              .catch(()=>{
                errEl.textContent = 'Bağlantı hatası';
                fresh.forEach(i=>{ i.value=''; });
                fresh[0].focus();
              });
            }
          });
          inp.addEventListener('keydown', e=>{
            if(e.key==='Backspace' && !e.target.value && idx>0) fresh[idx-1].focus();
          });
        });
      }
      window.tryShowExpenses = tryShowExpenses;

      // Bind buttons
      const btnMap = [
        ['navSummary','summary'],
        ['navRevenue','revenue'],
        ['navExpenses','expenses'],
        ['navStock','stock'],
        ['navAI','ai']
      ];
      btnMap.forEach(([id,key])=>{
        const b = document.getElementById(id);
        if(b) b.onclick = ()=> key === 'expenses' ? tryShowExpenses() : showPage(key);
      });
      // Initial
      const start = (function(){ try{ return localStorage.getItem(KEY) || 'summary'; }catch(e){ return 'summary'; } })();
      if(start === 'expenses') tryShowExpenses(); else showPage(start);
    })();
  
