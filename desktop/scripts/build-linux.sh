#!/usr/bin/env bash
# Build Linux do shell desktop (plano F5 / 3.6): .deb + AppImage a partir de
# um container Ubuntu 22.04 (scripts/linux-builder.Dockerfile), porque este
# Mac nao tem toolchain GTK/WebKitGTK e porque 22.04 e o glibc mais antigo
# suportado - o unico sitio honesto para linkar.
#
#   ./scripts/build-linux.sh                     # arch nativa do Docker
#   OMS_LINUX_PLATFORM=linux/amd64 ./scripts/... # cross via Rosetta/QEMU
#
# O que este script FAZ: constroi a imagem (cacheada), corre `tauri build
# --bundles deb,appimage` la dentro e copia os artefactos para
# desktop/dist-linux/. O que NUNCA faz: publicar, assinar para loja, tocar
# em servidores. O updater assina na mesma (createUpdaterArtifacts esta
# ligado), pela mesma razao do build-macos.sh: provar o pipeline de
# assinatura em todos os builds, nao so no dia do release.
#
# Decisoes que merecem explicacao:
# - O dist/ web e construido NO HOST (scripts/build-web.sh da app, o mesmo
#   pipeline de music.omelhorsite.pt). O container so faz Rust + bundling;
#   meter o expo export dentro do Docker duplicaria o pipeline e pagaria o
#   virtiofs em cima.
# - CARGO_TARGET_DIR aponta para um volume Docker nomeado: nao pisa o
#   target/ macOS do host, e o I/O do build fica em disco nativo do
#   container em vez do bind mount (o virtiofs tem tecto de fds e e lento
#   para as dezenas de milhar de ficheiros intermedios do cargo).
# - APPIMAGE_EXTRACT_AND_RUN=1 porque o linuxdeploy e ele proprio um
#   AppImage e dentro de um container nao ha FUSE; sem isto o passo do
#   AppImage morre com um erro criptico de mount.
# - Por omissao usa a arch nativa do Docker (arm64 neste Mac): um build
#   x86_64 emulado funciona mas e varias vezes mais lento. Para o artefacto
#   x86_64 "a serio" ha o workflow de CI (.github/workflows/
#   desktop-builds.yml), que corre em ubuntu-22.04 nativo.
set -euo pipefail
cd "$(dirname "$0")/.."
DESKTOP_DIR="$(pwd)"
ROOT_DIR="$(cd .. && pwd)"

IMAGE="oms-music-linux-builder"
PLATFORM="${OMS_LINUX_PLATFORM:-}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker nao esta no PATH"
docker info >/dev/null 2>&1 || fail "o daemon do Docker nao esta a correr"

[ -f keys/updater.key ] || fail "FALTA keys/updater.key - corre: bun run keys"

# O container reutiliza o dist/ do host via ensure-dist.sh (que so reconstroi
# se faltar). Mas o build-web.sh precisa de bun + expo, que NAO existem no
# container - por isso exigimos o dist/ pronto ANTES de entrar no Docker.
[ -f "$ROOT_DIR/dist/index.html" ] \
  || fail "falta ../dist/index.html - corre primeiro (na raiz da app): ./scripts/build-web.sh"

echo "==> A construir a imagem de build (cacheada apos a primeira vez)"
docker build \
  ${PLATFORM:+--platform "$PLATFORM"} \
  -t "$IMAGE" \
  -f scripts/linux-builder.Dockerfile \
  scripts/

echo "==> tauri build --bundles deb,appimage (dentro do container)"
docker run --rm \
  ${PLATFORM:+--platform "$PLATFORM"} \
  -v "$ROOT_DIR":/work \
  -v oms-music-linux-cargo-registry:/root/.cargo/registry \
  -v oms-music-linux-target:/cargo-target \
  -e CARGO_TARGET_DIR=/cargo-target \
  -e APPIMAGE_EXTRACT_AND_RUN=1 \
  -e CI=true \
  -e TAURI_SIGNING_PRIVATE_KEY="$(cat keys/updater.key)" \
  -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  -w /work/desktop \
  "$IMAGE" \
  bash -euo pipefail -c '
    tauri build --bundles deb,appimage "$@"

    # Copiar os artefactos para dentro do bind mount, porque o target vive
    # num volume que o host nao ve. Os .sig sao os do updater (o AppImage e
    # o alvo do tauri-plugin-updater em Linux, plano 3.6).
    OUT=/work/desktop/dist-linux
    mkdir -p "$OUT"
    cp -v /cargo-target/release/bundle/deb/*.deb "$OUT"/
    cp -v /cargo-target/release/bundle/appimage/*.AppImage "$OUT"/
    cp -v /cargo-target/release/bundle/appimage/*.AppImage.sig "$OUT"/ 2>/dev/null \
      || echo "(sem .sig do AppImage - verificar createUpdaterArtifacts)"
  ' _ "$@"

echo "==> Artefactos em $DESKTOP_DIR/dist-linux:"
ls -lh "$DESKTOP_DIR/dist-linux"
