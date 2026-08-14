#!/usr/bin/env bash
# DEPLOY DOCUMENTATION ONLY - this script NEVER deploys, by decision ("uma so
# app", F2): publishing music.omelhorsite.pt is an owner step, sequenced
# AFTER the four backend allowlists (CORS, oauth_callback_base,
# web_app_origin, WebAuthn allowed_origins - plano, secção 2.2), otherwise
# the published app cannot do social login or passkeys. This only prints the
# path.
set -euo pipefail

cat <<'EOF'
================================================================
 music.omelhorsite.pt - deploy do export web (NÃO executado)
================================================================

Este script não executa nada, de propósito. Passos, pela ordem certa:

0. Pré-requisito de build:
     ./scripts/build-web.sh
   (exporta, gera _redirects/404.html/sitemap.xml e verifica os <title>)

1. UMA VEZ, criar o projecto Pages novo (separado do "oms" do site, com
   orçamento próprio de 100 regras de _redirects - usamos 7):
     bunx wrangler pages project create oms-music --production-branch main

2. Em cada release (SÓ com as allowlists de backend da F2 já em produção):
     bunx wrangler pages deploy dist --project-name oms-music --branch main

   - `--branch main` = deploy de PRODUÇÃO do projecto oms-music.
   - Qualquer outro valor de --branch cria um preview *.oms-music.pages.dev,
     útil para validar as 7 regras de _redirects antes do domínio custom.

3. UMA VEZ, no dashboard do Cloudflare (Pages > oms-music > Custom domains):
   ligar music.omelhorsite.pt. O token MCP/API actual não gere rulesets nem
   domínios custom de Pages, por isso este passo é manual.

4. Verificar depois de cada deploy:
     - https://music.omelhorsite.pt/login           -> 200, <title> "Iniciar sessão"
     - https://music.omelhorsite.pt/artist/Nirvana  -> 200, o shell hidrata
     - https://music.omelhorsite.pt/nao-existe      -> 404 verdadeiro
     - https://music.omelhorsite.pt/sitemap.xml     -> XML com as rotas estáticas
     - Cache-Control immutable em /_expo/static/*

Lembretes:
  - NUNCA fazer deploy a partir deste repo sem as allowlists da F2 no ar.
  - O site (projecto Pages "oms") tem pipeline próprio (publish-osnosite.sh)
    e não tem nada a ver com este projecto.
================================================================
EOF
