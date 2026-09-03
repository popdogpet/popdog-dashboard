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
BEKLEME_SN=900        # en fazla 15 dakika (build kuyrukta bekleyebiliyor)
ARALIK_SN=15

command -v wrangler >/dev/null 2>&1 || { echo "HATA: wrangler bulunamadı."; exit 2; }

echo "Deploy bekleniyor: ${COMMIT}  (proje: ${PROJE}, en fazla $((BEKLEME_SN/60)) dk)"

# Gecen sure duvar saatinden olculur. Sayaci "her tur ARALIK_SN kadar
# bekledik" varsayimiyla artirmak yanlisti: sleep calismadigi ortamlarda
# dongu aninda tukeniyor ve build daha bitmeden zaman asimi veriyordu.
BASLANGIC=$(date +%s)
GECEN=0
while [ "$GECEN" -lt "$BEKLEME_SN" ]; do
  CIKTI="$(wrangler pages deployment list --project-name "$PROJE" 2>/dev/null)"
  SATIR="$(printf '%s\n' "$CIKTI" | grep -i "$COMMIT" | head -1)"

  if [ -n "$SATIR" ]; then
    # Wrangler basarili deploy'da Status sutununa "Success" YAZMAZ, deploy
    # zamanini yazar ("13 minutes ago"). Sadece basarisiz/suren durumlarin
    # kendi kelimeleri var. Bu yuzden once onlari eleyip kalanı basari sayiyoruz.
    if printf '%s' "$SATIR" | grep -qiE 'failure|failed|canceled|cancelled'; then
      echo
      echo "BUILD PATLADI  ${COMMIT}  -- canlı site HÂLÂ ESKİ SÜRÜMDE."
      printf '%s\n' "$SATIR"
      echo
      echo "Yapılacak: boş commit ile yeniden tetikle"
      echo "  git commit --allow-empty -m 'Deploy yeniden tetikleniyor' && git push"
      exit 1
    fi
    if ! printf '%s' "$SATIR" | grep -qiE 'queued|building|initializ|in progress|deploying|pending'; then
      echo
      echo "YAYINDA  ${COMMIT}"
      printf '%s\n' "$SATIR"
      exit 0
    fi
  fi

  printf '.'
  sleep "$ARALIK_SN" 2>/dev/null || :
  GECEN=$(( $(date +%s) - BASLANGIC ))
done

echo
echo "ZAMAN AŞIMI  ${COMMIT} için $((BEKLEME_SN/60)) dakikada sonuç alınamadı."
echo "Elle bak:  wrangler pages deployment list --project-name ${PROJE}"
exit 2
