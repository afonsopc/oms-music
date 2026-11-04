#!/usr/bin/env bash
# O APK de Android da "Música" (pt.omelhorsite.music), assinado, a partir deste Mac.
#
#   bun run android:apk              compila o último commit (HEAD)
#   PUBLISH=1 bun run android:apk    e põe-no para descarregar em
#                                    https://music.omelhorsite.pt/app/oms-music.apk
#                                    (escreve public/app/android.json; falta
#                                    commit + ./scripts/publish-osnosite.sh)
#
# Compila sempre numa cópia limpa do HEAD ($WORK), nunca na pasta do repo:
# só vai o que está commitado e não pisa o trabalho de outros agentes.
# Passos: clone -> bun install -> verificação "nada de importar de fora"
# (docs/app-store.md) -> expo prebuild -p android -> gradle assembleRelease
# (arm64-v8a; ABIS= para mais) -> assinado com a chave de ~/.appstoreconnect/android.
# versionCode = data e hora (AAMMDDHH, cabe no inteiro do Android); versionName
# = "version" do package.json (a mesma do iOS e do desktop). Ver docs/android.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-${TMPDIR:-/tmp}/oms-music-android}"
OUT="${OUT:-$HOME/Documents/oms/builds/android}"
SLUG="oms-music"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
KEYS="${OMS_ANDROID_KEYS:-$HOME/.appstoreconnect/android/keystore.env}"
[ -f "$KEYS" ] || { echo "falta $KEYS (chave de assinatura, docs/android.md)" >&2; exit 1; }
set -a; . "$KEYS"; set +a
VERSION_CODE="${VERSION_CODE:-$(date +%y%m%d%H)}"
# app.config.js lê-o: vai para o build.gradle e para o expo-constants.
export OMS_ANDROID_VERSION_CODE="$VERSION_CODE"
# Só arm64-v8a: o armeabi-v7a (telemóveis de 32 bits) quase duplica o APK
# (68 MB contra ~40). Para os dois: ABIS=arm64-v8a,armeabi-v7a.
ABIS="${ABIS:-arm64-v8a}"
REV="$(git -C "$REPO" rev-parse HEAD)"

echo "» cópia limpa de ${REV:0:7} em $WORK"
rm -rf "$WORK"
git clone -q --no-checkout "$REPO" "$WORK"
git -C "$WORK" checkout -q "$REV"
cd "$WORK"
bun install --frozen-lockfile >/dev/null
VERSION_NAME="$(bun -e 'console.log(require("./package.json").version)')"

if [ "${SKIP_STORE_CHECK:-0}" != "1" ]; then
  echo "» verificação (nada de importar de fora no bundle, docs/app-store.md)"
  rm -rf "$WORK/.store-check"
  bunx expo export --platform android --no-bytecode --output-dir "$WORK/.store-check" >/dev/null
  # As duas "youtube" do Android são nomes de ícones do Material
  # (youtube_activity, youtube_searched_for) do expo-symbols, no JS e na fonte.
  if grep -r -a -o -i -E "(spotify|youtube|soundcloud|bandcamp|yt-dlp|ytdlp|import\.omelhorsite|song_imports|external_search|rematch|match_candidates|artist_imports|artist_syncs|playlist_imports|itunes)[a-z_]*" "$WORK/.store-check" \
      | grep -v -i -E ":(youtube_activity|youtube_searched_for)$" | sort | uniq -c | grep .; then
    echo "o bundle Android fala de serviços de fora (docs/app-store.md); parei" >&2; exit 1
  fi
fi

echo "» expo prebuild -p android"
CI=1 bunx expo prebuild -p android --no-install >/dev/null

# Assinatura de release (a chave nunca entra no repo nem no log).
GRADLE=android/app/build.gradle
grep -q "versionCode $VERSION_CODE" "$GRADLE" || { echo "o prebuild não pôs o versionCode $VERSION_CODE" >&2; exit 1; }
cat >> "$GRADLE" <<'GRADLE'

// scripts/android-apk.sh: assinatura de release com a chave do dono.
android {
    signingConfigs {
        omsRelease {
            storeFile file(System.getenv("OMS_KEYSTORE"))
            storePassword System.getenv("OMS_KEYSTORE_PASSWORD")
            keyAlias System.getenv("OMS_KEY_ALIAS")
            keyPassword System.getenv("OMS_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.omsRelease
        }
    }
}
GRADLE

echo "» gradle assembleRelease (versionCode $VERSION_CODE, $VERSION_NAME, $ABIS)"
mkdir -p "$WORK/build"
(cd android && ./gradlew --no-daemon -q assembleRelease -PreactNativeArchitectures="$ABIS" \
  > "$WORK/build/gradle.log" 2>&1) \
  || { grep -E "error|FAILURE|What went wrong" -A3 "$WORK/build/gradle.log" | head -40; echo "o gradle falhou ($WORK/build/gradle.log)" >&2; exit 1; }

APK="android/app/build/outputs/apk/release/app-release.apk"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
"$BT/apksigner" verify "$APK" >/dev/null || { echo "o APK não está assinado" >&2; exit 1; }
mkdir -p "$OUT"
FINAL="$OUT/oms-music-$VERSION_CODE.apk"
cp "$APK" "$FINAL"
cp "$APK" "$OUT/oms-music.apk"
SIZE="$(stat -f %z "$FINAL")"
SHA="$(shasum -a 256 "$FINAL" | cut -d' ' -f1)"
echo "» feito: $FINAL ($((SIZE / 1048576)) MB)"

if [ "${PUBLISH:-0}" = "1" ]; then
  # Acima do cap de 25 MiB do Pages: vai para o heavy-asset storage, com o
  # número no nome (uma cache nunca serve um APK velho no endereço novo).
  ASSET="/app/oms-music-$VERSION_CODE.apk"
  echo "» heavy asset $ASSET"
  osnosite website "$SLUG" assets push "$FINAL" --path "$ASSET" \
    --content-type application/vnd.android.package-archive >/dev/null
  mkdir -p "$REPO/public/app"
  cat > "$REPO/public/app/android.json" <<JSON
{
  "versionCode": $VERSION_CODE,
  "versionName": "$VERSION_NAME",
  "url": "https://api.osnosite.com/site_assets/$SLUG$ASSET",
  "size": $SIZE,
  "sha256": "$SHA",
  "commit": "$REV"
}
JSON
  echo "  public/app/android.json escrito. Falta: commit e ./scripts/publish-osnosite.sh"
fi
