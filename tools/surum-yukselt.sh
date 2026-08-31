#!/bin/bash
#
# Sürüm bumplama. index.html içindeki APP_VERSION'ı ve /assets/ dosyalarının
# ?v= parametrelerini tek seferde günceller.
#
# Ne zaman çalıştırılır: assets/ altındaki bir dosyayı düzenlediğinizde.
# Yapmazsanız tarayıcılar eski dosyayı cache'ten kullanmaya devam eder.
#
# Kullanım:  ./tools/surum-yukselt.sh
#
set -e
cd "$(dirname "$0")/.."

YENI="$(date +%Y.%m.%d)-$(date +%H%M)"

# APP_VERSION
sed -i '' -E "s/var APP_VERSION = '[^']*';/var APP_VERSION = '${YENI}';/" index.html
# asset ?v= parametreleri
sed -i '' -E "s|(/assets/[A-Za-z0-9._-]+)\?v=[^\"]*|\1?v=${YENI}|g" index.html

echo "Sürüm -> ${YENI}"
grep -o "APP_VERSION = '[^']*'" index.html
grep -oE '/assets/[^"]+' index.html
