#!/bin/bash
set -uo pipefail

# Ubuntu 24.04 da cloud: node, bun, ruby, go, rust, python, playwright+chromium
# e as ferramentas de dev ja vem na imagem. Este script so acrescenta o que
# falta para os tres repos (oms-music, omelhorsite, osnosite) e diz o que ficou.
#
# NAO instala dependencias de projecto: cada repo faz o seu install quando for
# aberto, com o lockfile que traz.

# --- CLI do osnosite: a unica ferramenta nossa que nao vem na imagem.
#     Serve para LER estado (status, releases, deployments); publicar exige
#     aprovacao do dono com passkey no dashboard.
if ! command -v osnosite >/dev/null 2>&1; then
  bun add -g osnosite >/dev/null 2>&1 || npm i -g osnosite >/dev/null 2>&1 || true
  BIN="${BUN_INSTALL:-$HOME/.bun}/bin/osnosite"
  [ -x "$BIN" ] && { ln -sf "$BIN" /usr/local/bin/osnosite 2>/dev/null \
    || sudo ln -sf "$BIN" /usr/local/bin/osnosite 2>/dev/null; }
fi

# --- bundler: o ruby 3.3.6 vem, o bundler nem sempre. Backend do omelhorsite.
command -v bundle >/dev/null 2>&1 || gem install bundler --no-document >/dev/null 2>&1 || true

# --- Diagnostico. Se algo disser EM FALTA, e melhor saber agora do que a meio
#     de uma tarefa.
echo "--- ferramentas"
for t in bun node ruby bundle osnosite git rg; do
  printf '%-10s %s\n' "$t" "$(command -v "$t" 2>/dev/null || echo 'EM FALTA')"
done
printf '%-10s %s\n' "chromium" "$(ls -d /opt/pw-browsers/chromium* 2>/dev/null | head -1 || echo 'EM FALTA')"
