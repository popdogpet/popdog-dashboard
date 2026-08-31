# Pop Dog Dashboard

Cloudflare Pages üzerinde çalışan tek sayfalık CFO panosu.
Ciro, gider, stok ve AI özet kartlarını tek ekranda toplar.

- **Canlı:** https://popdog-dashboard.pages.dev
- **Repo:** https://github.com/popdogpet/popdog-dashboard

## Mimari

```
index.html            Sayfa iskeleti (~1.200 satır). Stil ve kod assets/ altında.
assets/app.css        Tüm stiller
assets/app-1..5.js    Arayüz kodu, index.html'deki sırayla yüklenir
tools/surum-yukselt.sh  assets/ düzenledikten sonra cache kırmak için
config.json           Veri kaynağı yolları — hepsi /api/sheet proxy'sine bakar
_routes.json          Her istek Functions'a uğrar (auth middleware için şart)
_headers              Cache + robots
functions/
  _middleware.js      Kimlik kapısı: oturumsuz istek index.html'i hiç görmez
  login-page.js       Giriş ekranı (HTML, sunucuda üretilir)
  lib/auth.js         HMAC imzalı çerez, rate limit
  lib/kv.js           AI kartları için ortak KV okuyucu
  api/login.js        PIN doğrulama → imzalı HttpOnly çerez
  api/logout.js       Oturum kapatma
  api/sheet.js        Google Sheets CSV proxy'si
  api/gas.js          Apps Script Web App proxy'si
  api/*.js            AI kartlarını KV'den okuyan uçlar
apps-script/code.gs   Google Apps Script kaynağı (web'e deploy edilmez, referans)
```

### Güvenlik modeli

Eskiden PIN `index.html` içinde düz metindi ve Google Sheets adresleri
istemciye iniyordu. Artık:

- **PIN sunucuda.** `APP_PIN` bir Cloudflare secret'ı. Oturumu olmayan istek
  `index.html`'i almaz, `_middleware.js` giriş ekranını döner.
- **Oturum çerezi imzalı.** `HttpOnly; Secure; SameSite=Lax`, HMAC-SHA256 ile
  `AUTH_SECRET` üzerinden imzalanır, 12 saat geçerlidir.
- **Kaba kuvvete karşı sınır.** 4 haneli PIN 15 dakikada IP başına 8 hatalı
  denemeden sonra kilitlenir (KV üzerinden).
- **Veri adresleri sunucuda.** Sheets CSV ve Apps Script adresleri secret'larda;
  istemci yalnızca `/api/sheet?key=...` ve `/api/gas?action=...` görür.
- **Giderler için ikinci PIN.** `EXPENSES_PIN` sunucuda doğrulanır, ama yalnızca
  **arayüz kapısıdır** — Giderler sekmesini açar. Gider CSV'si bu PIN'e bağlı
  değildir ve bağlanmamalıdır: aynı veri kredi taksiti sayımını, Zee.Dog ödeme
  eşleştirmesini, aylık gider tablolarını ve Özet'teki gider/ciro uyarısını da
  besliyor. Veriyi koruyan şey ana oturum kontrolüdür.

> Oturum kapısını atlayan hiçbir uç yok. (Eskiden `/api/ingest` muaftı; Telegram
> botu KV'ye Cloudflare API'si üzerinden doğrudan yazdığı için çağıranı yoktu,
> kaldırıldı.)

## Kurulum

Gerekli secret'lar (hepsi zorunlu, `EXPENSES_PIN` opsiyonel):

| Secret | Ne işe yarar |
|---|---|
| `AUTH_SECRET` | Oturum çerezlerini imzalar. Uzun ve rastgele olmalı. |
| `APP_PIN` | Dashboard giriş PIN'i |
| `EXPENSES_PIN` | Giderler sayfası için ikinci PIN |
| `GAS_EXEC_URL` | Apps Script Web App adresi (`.../exec`) |
| `SHEET_CSV_REVENUE` | Ciro sekmesi CSV adresi |
| `SHEET_CSV_INVENTORY` | Stok CSV adresi |
| `SHEET_CSV_ORDERS` | Sipariş CSV adresi |
| `SHEET_CSV_EXPENSES` | Gider CSV adresi |

Canlıya tanımlamak:

```bash
npx wrangler pages secret put AUTH_SECRET --project-name popdog-dashboard
```

`AI_KV` namespace binding'i `wrangler.toml` içinde tanımlı.

### Yerel çalıştırma

```bash
cp .dev.vars.example .dev.vars   # doldurun
npx wrangler pages dev .
```

### Yayınlama

```bash
npx wrangler pages deploy . --project-name popdog-dashboard
```

VS Code'da aynı işler **Terminal → Run Task** altında hazır görevler olarak da var.

## Bakım notları

- **`assets/` altını düzenlediyseniz `./tools/surum-yukselt.sh` çalıştırın.**
  Bu dosyalar bir yıl boyunca cache'leniyor; script hem `index.html`'deki
  `APP_VERSION`'ı hem de asset adreslerindeki `?v=` parametresini günceller.
  Çalıştırmazsanız tarayıcılar eski kodu kullanmaya devam eder.
- **Finansal Sağlık kartları** (`assets/app-4.js`) girdilerini başka KPI
  elemanlarının DOM metninden okuyor. Bu yüzden sabit `setTimeout` yerine
  `scheduleFinancialHealth()` kullanılıyor: girdiler dolana kadar (en fazla
  10 sn) bekler. Yeni bir gecikmeli veri kaynağı eklerseniz bunu unutmayın.
- **AI uçlarının durumu:** Tüm `/api/*` kartları her zaman 200 döner ama yanıtta
  `_meta.source` alanı vardır: `kv` (gerçek veri), `empty` (kayıt yok),
  `config_error` (KV binding yok), `parse_error` (bozuk kayıt).
- **KV'ye veri yazan taraf** Telegram botudur (`~/claude-lab/.claude/commands/
  telegram-bot`, `services/exporter.py`). Cloudflare API'siyle doğrudan KV'ye
  yazar; bu repodaki uçlar yalnızca okur.
- **`ai:caddebostan_close`** anahtarını okuyan bir uç yok, arayüzde kullanılmıyor.
