#!/usr/bin/env bash
# Release LOCAL, a custo zero (dono, 2026-08-18: "n podemos correr essa CI
# nunca mais... custou 3$"). Compila tudo o que este Mac consegue e publica
# numa GitHub release com o gh CLI:
#
#   ./scripts/release-local.sh v1.1.0
#
# O que sai daqui:
#   web    zip do export estatico            (bun, nativo)
#   macOS  .dmg + .app.tar.gz + .sig         (cargo, nativo, chave real)
#   Linux  .deb + .AppImage (+ .sig)         (docker linux/amd64 + qemu)
#   flatpak .flatpak                         (docker, reempacota o deb)
#   Android .apk                             (gradle local, debug keystore)
#   iOS    .ipa SEM assinatura               (xcodebuild; AltStore reassina)
#
# O que NAO sai: o .exe do Windows. Tauri nao cruza para Windows a partir
# de macOS sem uma maquina Windows; se for mesmo preciso, corre-se o
# workflow "release" por workflow_dispatch UMA vez (pago) ou compila-se num
# PC. A release fica sem exe e ninguem chora.
#
# Pre-requisitos: docker a correr, gh autenticado, Xcode, JDK 21 + Android
# SDK do brew (ver docs/cloud-setup.md), e desktop/keys/updater.key.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:?uso: release-local.sh vX.Y.Z}"
OUT="$(mktemp -d /tmp/oms-release-XXXX)"
echo "==> release ${TAG} -> ${OUT}"

# --- web --------------------------------------------------------------------
./scripts/build-web.sh
(cd dist && zip -qr "${OUT}/oms-music-web-${TAG}.zip" .)

# --- macOS (nativo; reutiliza o dist acabado de fazer) ----------------------
OMS_FORCE_WEB_BUILD=0 bash desktop/scripts/build-macos.sh
BUNDLE="desktop/src-tauri/target/release/bundle"
cp "${BUNDLE}"/dmg/*.dmg "${OUT}/" 2>/dev/null || true
cp "${BUNDLE}"/macos/*.app.tar.gz "${BUNDLE}"/macos/*.app.tar.gz.sig "${OUT}/" 2>/dev/null || true

# --- Linux x86_64 (docker + qemu; lento mas gratis) -------------------------
# O linux-builder.Dockerfile ja e a receita canonica de deps; o build corre
# dentro dele com o repo montado. O target/ do container fica em cache local
# para a segunda release nao pagar o cargo do zero.
docker build --platform linux/amd64 -t oms-linux-builder \
  -f desktop/scripts/linux-builder.Dockerfile desktop/scripts
docker run --rm --platform linux/amd64 \
  -v "$PWD:/repo" -v oms-linux-cargo:/root/.cargo -v oms-linux-target:/target \
  -w /repo/desktop oms-linux-builder bash -c '
    set -e
    export CARGO_TARGET_DIR=/target
    # linuxdeploy e um AppImage e nao ha FUSE dentro do docker.
    export APPIMAGE_EXTRACT_AND_RUN=1
    bun install --frozen-lockfile
    export TAURI_SIGNING_PRIVATE_KEY="$(cat /repo/desktop/keys/updater.key)"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
    # O passo AppImage do tauri MORRE sob o Rosetta (Docker no Apple Silicon)
    # e deixa o AppDir preparado: o binfmt do Rosetta nao reconhece um
    # AppImage como ELF x86-64 (os bytes 8-10 do cabecalho levam a marca
    # "AI\x02" e o padrao magico exige-os a zero), por isso o plugin AppImage
    # que o linuxdeploy lanca falha com "Exec format error", visto como
    # "subprocess failed (exit code 2)" (v1.1.0, 2026-08-31). O tauri volta a
    # descarregar o plugin em cada build, logo nao ha cache para remendar: o
    # deb sai do tauri e o AppImage acaba-se A MAO com ferramentas de cabecalho
    # zerado (o runtime nao precisa da marca para correr), e assina-se com a
    # mesma chave do updater.
    bun run tauri build --bundles deb,appimage || echo "(AppImage do tauri falhou como esperado sob Rosetta; a acabar a mao)"
    T=/tmp/appimage-tools; mkdir -p "$T"
    curl -fsSL -o "$T/linuxdeploy-x86_64.AppImage" \
      https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage
    curl -fsSL -o "$T/linuxdeploy-plugin-appimage-x86_64.AppImage" \
      https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage
    curl -fsSL -o "$T/linuxdeploy-plugin-gtk.sh" \
      https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh
    for f in "$T"/linuxdeploy-x86_64.AppImage "$T"/linuxdeploy-plugin-appimage-x86_64.AppImage; do
      printf "\x00\x00\x00" | dd of="$f" bs=1 seek=8 count=3 conv=notrunc 2>/dev/null
    done
    chmod +x "$T"/*
    APPIMAGE_DIR=/target/release/bundle/appimage
    APPDIR="$(ls -d "$APPIMAGE_DIR"/*.AppDir | head -1)"
    VERSION="$(grep -o "\"version\": *\"[^\"]*\"" src-tauri/tauri.conf.json | head -1 | sed "s/.*\"\\([^\"]*\\)\"$/\\1/")"
    APPIMAGE="OMS Music_${VERSION}_amd64.AppImage"
    (cd "$APPIMAGE_DIR" && rm -f *.AppImage *.AppImage.sig \
      && ARCH=x86_64 OUTPUT="$APPIMAGE" PATH="$T:$PATH" \
         "$T/linuxdeploy-x86_64.AppImage" --appimage-extract-and-run \
           --appdir "$APPDIR" --plugin gtk --output appimage > /tmp/linuxdeploy.log 2>&1 \
      || { tail -30 /tmp/linuxdeploy.log; exit 1; })
    bun run tauri signer sign -k "$TAURI_SIGNING_PRIVATE_KEY" -p "" "$APPIMAGE_DIR/$APPIMAGE" > /dev/null
    ls -la "$APPIMAGE_DIR"
  '
LINUX_BUNDLE="$(docker run --rm -v oms-linux-target:/target ubuntu:24.04 \
  find /target/release/bundle -name "*.deb" -o -name "*.AppImage" -o -name "*.AppImage.sig" | head -0; true)"
# copiar do volume para fora
# So os artefactos DESTA versao: o volume guarda os das releases anteriores
# (o deb 0.1.0 da v1.0.0 ainda la estava na v1.1.0) e um glob nu levava os dois.
DESKTOP_VERSION="$(grep -o '"version": *"[^"]*"' desktop/src-tauri/tauri.conf.json | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
docker run --rm -v oms-linux-target:/target -v "${OUT}:/out" -e V="${DESKTOP_VERSION}" ubuntu:24.04 bash -c '
  cp /target/release/bundle/deb/*_"$V"_*.deb /out/ 2>/dev/null || true
  cp /target/release/bundle/appimage/*_"$V"_*.AppImage* /out/ 2>/dev/null || true'

# --- flatpak (reempacota o deb; runtime GNOME em cache no volume) -----------
# MONTADO A MAO, sem flatpak-builder: o bwrap nao consegue seccomp sob a
# emulacao amd64 do Docker no Apple Silicon, e o nosso "build" e so copiar
# ficheiros - build-init/finish/export/bundle nao precisam de sandbox
# (aprendido na v1.0.0, 2026-08-18). Manter em sintonia com o manifest
# desktop/flatpak/*.yml (command, finish-args, renomeacoes).
FLATPAK_STAGE="$(mktemp -d /tmp/oms-flatpak-XXXX)"
cp "${OUT}"/*_"${DESKTOP_VERSION}"_*.deb "${FLATPAK_STAGE}/oms-music.deb"
docker run --rm --privileged --platform linux/amd64 \
  -v "${FLATPAK_STAGE}:/work" -v oms-flatpak-cache:/var/lib/flatpak -w /work \
  ubuntu:24.04 bash -c '
    set -e
    apt-get update -qq >/dev/null
    apt-get install -y -qq flatpak binutils ca-certificates >/dev/null 2>&1
    flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
    flatpak install -y --noninteractive flathub org.gnome.Platform//46 org.gnome.Sdk//46
    rm -rf appdir repo extracted && mkdir extracted
    (cd extracted && ar -x ../oms-music.deb && tar -xf data.tar.gz)
    flatpak build-init --arch=x86_64 appdir pt.omelhorsite.music.desktop org.gnome.Sdk org.gnome.Platform 46
    install -Dm755 extracted/usr/bin/oms-music-desktop appdir/files/bin/oms-music-desktop
    for f in extracted/usr/share/applications/*.desktop; do
      install -Dm644 "$f" appdir/files/share/applications/pt.omelhorsite.music.desktop.desktop
    done
    sed -i "s/^Icon=.*/Icon=pt.omelhorsite.music.desktop/" \
      appdir/files/share/applications/pt.omelhorsite.music.desktop.desktop
    for f in extracted/usr/share/icons/hicolor/*/apps/*.png; do
      size=${f#extracted/usr/share/icons/hicolor/}; size=${size%%/*}
      install -Dm644 "$f" "appdir/files/share/icons/hicolor/$size/apps/pt.omelhorsite.music.desktop.png"
    done
    flatpak build-finish appdir --command=oms-music-desktop \
      --socket=wayland --socket=fallback-x11 --device=dri \
      --share=ipc --share=network --socket=pulseaudio
    flatpak build-export --arch=x86_64 repo appdir
    flatpak build-bundle --arch=x86_64 repo oms-music.flatpak pt.omelhorsite.music.desktop
  '
cp "${FLATPAK_STAGE}/oms-music.flatpak" "${OUT}/oms-music-${TAG}.flatpak"

# --- Android ----------------------------------------------------------------
export JAVA_HOME="$(brew --prefix openjdk@21)"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export PATH="$JAVA_HOME/bin:$PATH"
CI=1 bunx expo prebuild -p android
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
# O :app:packageRelease falhou uma vez de forma transitoria (v1.1.0) e passou
# a segunda sem tocar em nada: uma repeticao antes de desistir.
(cd android && { ./gradlew assembleRelease --no-daemon -q || ./gradlew assembleRelease --no-daemon -q; })
cp android/app/build/outputs/apk/release/app-release.apk "${OUT}/oms-music-${TAG}.apk"

# --- iOS (sem assinatura) ---------------------------------------------------
# `build` e nao `archive`: com o Xcode 27 beta o archive morria no SwiftCompile
# de quatro pods (RNScreens, ExpoSQLite, ExpoUI, ReactNativePasskeys) com
# "failed with exit code 0 but produced no further output", mesmo com o
# DerivedData e as caches de modulos limpos; o mesmo Release em `build` para
# generic/platform=iOS, com a cache de compilacao do Xcode 26+ desligada e um
# DerivedData proprio, compila (v1.1.0, 2026-08-31). O .app de
# Build/Products/Release-iphoneos e o mesmo que iria dentro do xcarchive.
# Nunca apagar ios/build/: e la que o codegen do React Native escreve os
# ficheiros gerados (ios/build/generated/ios/ReactCodegen) no pod install.
CI=1 bunx expo prebuild -p ios
WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
IOS_DD="${OUT}/ios-derived-data"
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$IOS_DD" build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  COMPILATION_CACHE_ENABLE_CACHING=NO -quiet
IOS_APP="$(ls -d "$IOS_DD"/Build/Products/Release-iphoneos/*.app | head -1)"
(cd "${OUT}" && mkdir -p Payload \
  && cp -R "$IOS_APP" Payload/ \
  && zip -qry "oms-music-${TAG}-unsigned.ipa" Payload \
  && rm -rf Payload "$IOS_DD")

# --- publicar ---------------------------------------------------------------
ls -la "${OUT}"
gh release create "${TAG}" "${OUT}"/* \
  --title "OMS Music ${TAG#v}" \
  --generate-notes \
  --notes "Builds locais (scripts/release-local.sh - a CI paga esta reformada).
- Web: export estatico | macOS: dmg (ad-hoc) | Linux: deb/AppImage/flatpak
- Android: apk (debug keystore) | iOS: ipa SEM assinatura (AltStore reassina)
- Windows: sem exe nesta release (sem maquina Windows; workflow_dispatch pago se for mesmo preciso)"
echo "RELEASE_OK ${TAG}"
