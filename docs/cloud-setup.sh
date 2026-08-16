#!/bin/bash
set -uo pipefail

# Ferramentas partilhadas pelos tres repos (oms-music, omelhorsite, osnosite).
# Nada aqui e especifico de um projecto: as dependencias de cada um instalam-se
# dentro dele, com o lockfile que ele traz.

# --- bun: gestor de pacotes e runner de testes
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
# O PATH acima morre com este script; o link e o que faz o bun existir para a
# sessao que arranca a seguir.
ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null \
  || sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null || true

# --- CLI do osnosite (so para LER estado; publicar exige aprovacao do dono)
bun add -g osnosite >/dev/null 2>&1 || true
ln -sf "$BUN_INSTALL/bin/osnosite" /usr/local/bin/osnosite 2>/dev/null \
  || sudo ln -sf "$BUN_INSTALL/bin/osnosite" /usr/local/bin/osnosite 2>/dev/null || true

# --- Ruby + bundler: backend Rails do omelhorsite
if ! command -v ruby >/dev/null 2>&1; then
  (sudo apt-get update -qq && sudo apt-get install -y -qq ruby-full build-essential libpq-dev) || true
fi
command -v gem >/dev/null 2>&1 && (gem install bundler --no-document >/dev/null 2>&1 || true)

# --- Diagnostico: o que ficou disponivel, para nao haver surpresas depois.
echo "--- ferramentas"
for t in bun node ruby bundle osnosite git; do
  printf '%-10s %s\n' "$t" "$(command -v "$t" 2>/dev/null || echo 'EM FALTA')"
done
