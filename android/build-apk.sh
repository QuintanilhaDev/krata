#!/bin/bash
# Monta o Krata.apk sem Android Studio.
# Precisa de: Java 17+, Node 20+, e as ferramentas em $TOOLS:
#   aapt2 (binário Linux), android.jar (API 35), dx.jar e o pacote npm apk_sign_ts.
# A chave fica em $KEYS (krata-key.pem e krata-cert.pem). Guarde essa chave: as próximas
# versões do app PRECISAM ser assinadas com ela, senão o celular não deixa atualizar.
set -euo pipefail
cd "$(dirname "$0")"
TOOLS=${TOOLS:-/home/claude/apk/tools}
KEYS=${KEYS:-/home/claude/apk/keys}
AAPT2=${AAPT2:-$TOOLS/aaptjs3-2.0.2/package/bin/x64/linux/aapt2}
ANDROID_JAR=${ANDROID_JAR:-$TOOLS/android-35.jar}
DX=${DX:-$TOOLS/dx.jar}
OUT=${OUT:-../public/krata.apk}
VERSION_CODE=$(grep -o 'android:versionCode="[0-9]*"' AndroidManifest.xml | grep -o '[0-9]*')
VERSION_NAME=$(grep -o 'android:versionName="[^"]*"' AndroidManifest.xml | cut -d'"' -f2)

rm -rf build && mkdir -p build/gen build/classes
echo "• recursos"
"$AAPT2" compile --dir res -o build/res.zip
"$AAPT2" link -I "$ANDROID_JAR" --manifest AndroidManifest.xml -o build/base.apk --java build/gen \
  --min-sdk-version 26 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip
echo "• java"
javac -nowarn -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options -d build/classes \
  $(find src build/gen -name '*.java') 2>&1 | grep -v "JAVA_TOOL_OPTIONS" || true
[ -f build/classes/app/krata/MainActivity.class ] || { echo "falhou a compilação"; exit 1; }
echo "• dex"
java -jar "$DX" --dex --min-sdk-version=26 --output=build/classes.dex build/classes 2>&1 | grep -v "JAVA_TOOL_OPTIONS" || true
echo "• pacote"
cp build/base.apk build/unsigned.apk
(cd build && zip -q -X unsigned.apk classes.dex)
echo "• assinatura"
SIGNER="$TOOLS/node_modules/apk_sign_ts/dist/index.js" node sign.mjs build/unsigned.apk "$OUT" "$KEYS/krata-key.pem" "$KEYS/krata-cert.pem"
echo "pronto: $OUT ($VERSION_NAME)"
