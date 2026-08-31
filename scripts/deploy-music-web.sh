#!/usr/bin/env bash
# OBSOLETO - o deploy real é ./scripts/publish-osnosite.sh.
#
# Este script descrevia um projecto Cloudflare Pages "oms-music" gerido por
# wrangler. Não é assim que o site vai a produção: music.omelhorsite.pt é o
# website `oms-music` da plataforma osnosite (raw_publish), publicado pela CLI
# do osnosite a partir do branch `oms-music` de osnosite-codebases. Wrangler
# nunca entra.
set -euo pipefail

cat <<'EOF'
================================================================
 music.omelhorsite.pt - deploy
================================================================

  ./scripts/publish-osnosite.sh ["notas da release"]

Faz build (scripts/build-web.sh), empurra o export para o branch `oms-music`
de osnosite-codebases, corta a release e deploya para produção.

Produção precisa de sessão elevada:

  osnosite auth step-up --passkey     # 1 dia

Sem step-up o script deixa o pedido em fila e o dono aprova no dashboard.
Estado: `osnosite website oms-music status` / `releases` / `deployments`.
EOF
