/* Istegi popdog-dashboard.pages.dev'e iletip cevabi aynen dondurur.
   Bkz. wrangler.toml — neden var oldugu orada yaziyor. */

const HEDEF = 'https://popdog-dashboard.pages.dev';

export default {
  async fetch(request) {
    const gelen = new URL(request.url);
    const hedef = new URL(gelen.pathname + gelen.search, HEDEF);

    /* Metot, basliklar ve govde oldugu gibi tasinir. Oturum cerezi
       (pd_auth) Domain niteligi tasimadigi icin tarayicida bu Worker'in
       adresine baglanir — Pages adresindeki oturumdan bagimsiz calisir. */
    const istek = new Request(hedef, request);
    istek.headers.set('X-Forwarded-Host', gelen.host);

    /* redirect:'manual' — yonlendirmeyi biz cozmeliyiz ki Location basligi
       kullaniciyi tekrar acilmayan pages.dev adresine atmasin. */
    const cevap = await fetch(istek, { redirect: 'manual' });
    const cikti = new Response(cevap.body, cevap);

    const konum = cikti.headers.get('Location');
    if (konum) {
      try {
        const l = new URL(konum, hedef);
        if (l.host === hedef.host) {
          l.protocol = gelen.protocol;
          l.host = gelen.host;
          cikti.headers.set('Location', l.toString());
        }
      } catch (_) { /* mutlak olmayan Location — dokunma */ }
    }

    return cikti;
  },
};
