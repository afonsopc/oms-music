#!/usr/bin/env bash
# Build macOS local (plano F5): .app + .dmg assinados com o Developer ID
# (signingIdentity no tauri.conf.json, Hardened Runtime + Entitlements.plist).
# Sem as variaveis APPLE_API_* nao notariza nem publica nada; o release
# assinado, notarizado e publicado e scripts/release-macos.sh.
#
# A chave privada do updater tem de existir porque createUpdaterArtifacts
# esta ligado: o bundler assina o .app.tar.gz do updater no build. Isto e
# deliberado - e a prova, a cada build, de que o pipeline de assinatura
# funciona de ponta a ponta em vez de so no dia do primeiro release.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f keys/updater.key ] || {
  echo "FALTA keys/updater.key - corre: bun run keys" >&2
  exit 1
}

export TAURI_SIGNING_PRIVATE_KEY="$(cat keys/updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

# CI=true (o CLI exige literalmente "true", "1" e rejeitado) faz o bundler
# passar --skip-jenkins ao bundle_dmg.sh: salta o passo
# AppleScript que decora a janela do Finder do DMG. Neste Mac o TCC bloqueia
# automacao do Finder a processos nao interactivos (mesma parede do spike 4),
# e sem o skip o build morre DEPOIS de o .app ja estar assinado. Um DMG sem
# icones posicionados e cosmetica a menos; o .app la dentro e identico.
export CI=true

exec bun run tauri build "$@"
