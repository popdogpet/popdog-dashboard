/** Giriş ekranı — mevcut PIN tasarımıyla aynı görünür, PIN sunucuda doğrulanır. */
export function loginPage({ scope = 'app', message = '' } = {}) {
  const title = scope === 'expenses' ? 'Giderler' : 'Pop Dog CFO';
  return `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 100%);
       font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .pin-box{background:rgba(255,255,255,.1);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
           border:1px solid rgba(255,255,255,.2);border-radius:24px;padding:2.5rem;text-align:center;
           max-width:320px;width:90%}
  .pin-logo{font-size:3rem;margin-bottom:1rem}
  h2{color:#fff;font-size:1.5rem;font-weight:600;margin:0 0 .5rem}
  p{color:rgba(255,255,255,.6);font-size:.875rem;margin:0 0 1.5rem}
  form{display:flex;flex-direction:column;align-items:center;gap:.75rem;margin-bottom:1.25rem}
  input{width:160px;height:56px;text-align:center;font-size:1.75rem;font-weight:700;letter-spacing:.4em;
        border:2px solid rgba(255,255,255,.3);border-radius:14px;background:rgba(255,255,255,.1);
        color:#fff;outline:none;transition:border-color .2s,background .2s}
  input:focus{border-color:#60a5fa;background:rgba(255,255,255,.15)}
  input.error{border-color:#f87171;animation:shake .3s ease-in-out}
  button{width:160px;height:48px;background:#3b82f6;color:#fff;font-size:1rem;font-weight:600;
         border:none;border-radius:14px;cursor:pointer;transition:background .2s;
         -webkit-tap-highlight-color:transparent}
  button:active{background:#2563eb}
  button[disabled]{opacity:.6;cursor:default}
  .pin-error{color:#f87171;font-size:.875rem;min-height:1.25rem}
  @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
</style>
</head><body>
  <div class="pin-box">
    <div class="pin-logo">${scope === 'expenses' ? '\u{1F512}' : '\u{1F415}'}</div>
    <h2>${title}</h2>
    <p>Devam etmek için PIN kodunu girin</p>
    <form id="f" autocomplete="off">
      <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
             autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;" autofocus>
      <button type="submit" id="go">Giriş</button>
    </form>
    <div class="pin-error" id="err">${message}</div>
  </div>
<script>
(function(){
  var form = document.getElementById('f');
  var pin  = document.getElementById('pin');
  var err  = document.getElementById('err');
  var go   = document.getElementById('go');
  pin.addEventListener('input', function(){
    err.textContent = '';
    pin.value = pin.value.replace(/[^0-9]/g,'').slice(0,4);
  });
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    if (pin.value.length < 4){ err.textContent = '4 haneli PIN giriniz'; return; }
    go.disabled = true;
    try{
      var r = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pin: pin.value, scope: ${JSON.stringify(scope)} })
      });
      var j = await r.json().catch(function(){ return {}; });
      if (r.ok && j.ok){ location.replace(location.pathname + location.search); return; }
      pin.value = '';
      pin.classList.add('error');
      setTimeout(function(){ pin.classList.remove('error'); }, 600);
      err.textContent = j.error || 'Yanlış PIN kodu';
    }catch(_){
      err.textContent = 'Bağlantı hatası, tekrar deneyin';
    }finally{
      go.disabled = false;
      pin.focus();
    }
  });
})();
</script>
</body></html>`;
}
