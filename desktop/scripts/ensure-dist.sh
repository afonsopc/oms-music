#!/usr/bin/env bash
# beforeBuildCommand do tauri.conf.json: garante que ../dist existe e e um
# export completo (scripts/build-web.sh da app, o MESMO pipeline que alimenta
# music.omelhorsite.pt - o shell embrulha exactamente o que a web serve).
#
# So reconstroi quando falta o dist ou quando OMS_FORCE_WEB_BUILD=1: o export
# demora 2-3 minutos e iterar no shell Rust nao deve pagar esse custo de cada
# vez. Nada aqui publica coisa alguma.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${OMS_FORCE_WEB_BUILD:-0}" = "1" ] || [ ! -f dist/index.html ]; then
  echo "==> dist/ em falta ou build forcado: a correr scripts/build-web.sh"
  ./scripts/build-web.sh
else
  echo "==> dist/ presente; a reutilizar (OMS_FORCE_WEB_BUILD=1 para reconstruir)"
fi
