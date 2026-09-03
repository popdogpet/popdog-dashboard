#!/bin/bash
#
# Cloudflare Pages deploy'unun GERÇEKTEN yayına çıktığını doğrular.
#
# Neden var: 2 Eylül 2026'da bir push başarıyla gitti, Cloudflare build'i
# sessizce patladı (acc2734 -> Failure) ve canlı site günlerce eski sürümde
# kaldı. Ne push çıktısı ne de git bunu gösteriyor; hatayı ancak arayüzde
# eski veriyi görünce fark ettik. Bu betik o boşluğu kapatır.
#
# Kullanım:
#   ./tools/deploy-dogrula.sh            # HEAD commit'ini bekler
#   ./tools/deploy-dogrula.sh <commit>   # belirli bir commit'i bekler
#
# Çıkış kodu: 0 = yayında, 1 = build patladı, 2 = zaman aşımı.
#
set -uo pipefail
cd "$(dirname "$0")/.."

PROJE="popdog-dashboard"
COMMIT="${1:-$(git rev-parse --short HEAD)}"
COMMIT="${COMMIT:0:8}"
BEKLEME_SN=420        # en fazla 7 dakika
ARALIK_SN=15

command -v wrangler >/dev/null 2>&1 || { echo "HATA: wrangler bulunamadı."; exit 2; }

echo "Deploy bekleniyor: ${COMMIT}  (proje: ${PROJE}, en fazla $((BEKLEME_SN/60)) dk)"

GECEN=0
while [ "$GECEN" -lt "$BEKLEME_SN" ]; do
  CIKTI="$(wrangler pages deployment list --project-name "$PROJE" 2>/dev/null)"
  SATIR="$(printf '%s\n' "$CIKTI" | grep -i "$COMMIT" | head -1)"

  if [ -n "$SATIR" ]; then
    if printf '%s' "$SATIR" | grep -qi 'success'; then
      echo
      echo "YAYINDA  ${COMMIT}"
      printf '%s\n' "$SATIR"
      exit 0
    fi
    if printf '%s' "$SATIR" | grep -qiE 'failure|failed|canceled|cancelled'; then
      echo
      echo "BUILD PATLADI  ${COMMIT}  -- canlı site HÂLÂ ESKİ SÜRÜMDE."
      printf '%s\n' "$SATIR"
      echo
      echo "Yapılacak: boş commit ile yeniden tetikle"
      echo "  git commit --allow-empty -m 'Deploy yeniden tetikleniyor' && git push"
      exit 1
    fi
  fi

  printf '.'
  sleep "$ARALIK_SN"
  GECEN=$((GECEN + ARALIK_SN))
done

echo
echo "ZAMAN AŞIMI  ${COMMIT} için $((BEKLEME_SN/60)) dakikada sonuç alınamadı."
echo "Elle bak:  wrangler pages deployment list --project-name ${PROJE}"
exit 2
