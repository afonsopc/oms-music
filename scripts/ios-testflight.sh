#!/usr/bin/env bash
# A app iOS "Música" (pt.omelhorsite.music) para o TestFlight, a partir deste Mac.
#
#   bun run ios:testflight            compila o último commit (HEAD) e envia
#   UPLOAD=0 bun run ios:testflight   só faz o .ipa (sem enviar)
#
# Compila sempre numa cópia limpa do HEAD ($WORK), nunca na pasta do repo:
# só vai o que está commitado e não pisa o ios/ de outros agentes.
# Passos: clone -> bun install -> expo prebuild (conta paga: Associated
# Domains) -> pod install -> verificação App Store (docs/app-store.md) ->
# xcodebuild archive -> exportArchive (Apple Distribution, perfil App Store)
# -> envio para o App Store Connect. Build number = data e hora (AAMMDD.HHMM,
# scripts/ios-build-number.js: o Google Cast aborta com partes de mais de 6 dígitos).
# Chave da API em ~/.appstoreconnect/oms-ci.env; docs/testflight.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-${TMPDIR:-/tmp}/oms-music-testflight}"
BUNDLE_ID="pt.omelhorsite.music"
ASC_ENV="${ASC_ENV:-$HOME/.appstoreconnect/oms-ci.env}"
[ -f "$ASC_ENV" ] || { echo "falta $ASC_ENV (chave da App Store Connect API)" >&2; exit 1; }
set -a; . "$ASC_ENV"; set +a
TEAM="${APPLE_TEAM_ID:-6FYT6632J8}"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
BUILD_NUMBER="$(bun "$REPO/scripts/ios-build-number.js")"
bun "$REPO/scripts/ios-build-number.js" check "$BUILD_NUMBER"
# app.config.js lê-o (CFBundleVersion e expo-constants); a versão vem do package.json.
export OMS_IOS_BUILD_NUMBER="$BUILD_NUMBER"
DEST=upload; [ "${UPLOAD:-1}" = "0" ] && DEST=export

echo "» cópia limpa de $(git -C "$REPO" rev-parse --short HEAD) em $WORK"
rm -rf "$WORK"
git clone -q "$REPO" "$WORK"
cd "$WORK"
bun install --frozen-lockfile >/dev/null

if [ "$DEST" = "upload" ] && ! bun scripts/asc.ts app "$BUNDLE_ID"; then
  echo "a app $BUNDLE_ID ainda não existe no App Store Connect (docs/testflight.md)" >&2; exit 1
fi

echo "» expo prebuild (conta paga)"
OMS_PAID_TEAM=1 CI=1 bunx expo prebuild -p ios --no-install >/dev/null

echo "» pod install"
# O gem json-3.0.2 em ~/.local/share/gem parte o CocoaPods do brew
# (unknown keyword: quirks_mode): usar só os gems do brew e os do sistema.
PODS_LIBEXEC="$(brew --prefix cocoapods)/libexec"
(cd ios && GEM_PATH="$PODS_LIBEXEC:$(ruby -e 'print Gem.default_dir')" pod install >/dev/null)

if [ "${SKIP_STORE_CHECK:-0}" != "1" ]; then
  echo "» verificação App Store (nada de importar de fora no bundle)"
  rm -rf "$WORK/.store-check"
  bunx expo export --platform ios --no-bytecode --output-dir "$WORK/.store-check" >/dev/null
  if grep -i -o -E "spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes" -r "$WORK/.store-check" | sort | uniq -c | grep .; then
    echo "o bundle iOS fala de serviços de fora (docs/app-store.md); parei" >&2; exit 1
  fi
fi

WS="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WS" .xcworkspace)"
PLIST="ios/$SCHEME/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion $(CURRENT_PROJECT_VERSION)' "$PLIST"

# Assinatura de distribuição: certificado "Apple Distribution" no porta-chaves
# oms-ci e perfil App Store feito/renovado pela API.
CI_KC="$HOME/Library/Keychains/oms-ci.keychain-db"
[ -f "$CI_KC" ] && security unlock-keychain -p "$(cat "$HOME/.appstoreconnect/dist/keychain.pass")" "$CI_KC"
PROFILE="$(bun scripts/asc.ts profile "$BUNDLE_ID")"

LOGS="$WORK/build/logs"; mkdir -p "$LOGS"
ARCHIVE="$WORK/build/Musica.xcarchive"
EXPORT="$WORK/build/export"
VERSION="$(bun -e 'console.log(require("./package.json").version)')"
echo "» xcodebuild archive ($VERSION, build $BUILD_NUMBER, team $TEAM)"
archive() {
  xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$WORK/build/dd" -archivePath "$ARCHIVE" \
    "${AUTH[@]}" DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
    MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive > "$LOGS/archive$1.log" 2>&1
}
# O xcodebuild aninhado do ExpoModulesJSI às vezes cai sem dizer porquê
# ("failed with exit code 0 but produced no further output"); à segunda passa.
archive "" || { echo "  archive falhou, segunda tentativa"; archive 2; } \
  || { grep -E "error:" "$LOGS/archive2.log" | head -20; echo "o archive falhou ($LOGS/archive2.log)" >&2; exit 1; }

# O que ficou no binário (o Cast lê-o do Info.plist do .app).
BUILT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$(ls -d "$ARCHIVE"/Products/Applications/*.app | head -1)/Info.plist")"
[ "$BUILT" = "$BUILD_NUMBER" ] || { echo "o CFBundleVersion do archive é $BUILT, esperava $BUILD_NUMBER" >&2; exit 1; }
bun scripts/ios-build-number.js check "$BUILT"

OPTS="$WORK/build/ExportOptions.plist"
cat > "$OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$PROFILE</string></dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
echo "» exportArchive ($DEST)"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
  -exportOptionsPlist "$OPTS" "${AUTH[@]}" > "$LOGS/export.log" 2>&1 \
  || { grep -iE "error" "$LOGS/export.log" | head -20; echo "o export/envio falhou ($LOGS/export.log)" >&2; exit 1; }

if [ "$DEST" = "upload" ]; then
  echo "» enviada: build $BUILD_NUMBER. O TestFlight leva uns minutos a processar"
  echo "  (bun scripts/asc.ts builds $BUNDLE_ID)."
else
  echo "» feito: $(ls "$EXPORT"/*.ipa) (build $BUILD_NUMBER, sem envio)"
fi
