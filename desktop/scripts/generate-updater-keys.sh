#!/usr/bin/env bash
# Gera o par de chaves do updater (minisign, via `tauri signer generate`).
#
#  - desktop/keys/updater.key      chave PRIVADA. NUNCA entra no git (o
#                                  .gitignore da raiz ja apanha *.key). Para
#                                  producao a seria: gerar numa maquina de
#                                  release, guardar num gestor de segredos e
#                                  apagar a copia local, como a politica da
#                                  production.key do site.
#  - desktop/keys/updater.key.pub  chave publica; o conteudo vai para
#                                  plugins.updater.pubkey no tauri.conf.json.
#
# A assinatura e OBRIGATORIA e nao desactivavel por decisao (plano 3.6):
# um updater sem assinatura e um RCE a espera do primeiro MITM. Rodar a chave
# = correr isto de novo, actualizar o pubkey no conf e reassinar o proximo
# release; clientes antigos so aceitam updates assinados pela chave antiga,
# portanto a rotacao exige um release-ponte assinado pelas duas.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p keys
if [ -f keys/updater.key ]; then
  echo "keys/updater.key ja existe; apaga primeiro se queres MESMO rodar a chave." >&2
  exit 1
fi

# Password vazia de proposito: a protecao real da chave e nunca sair desta
# maquina / do gestor de segredos, nao uma password no mesmo disco.
# Invocado pelo caminho directo e nao por `bun run`: o bun engole o "" da
# password ao reencaminhar argumentos e o CLI queixa-se de valor em falta.
./node_modules/.bin/tauri signer generate -w keys/updater.key --password ""

echo
echo "==> Copia o conteudo de keys/updater.key.pub para plugins.updater.pubkey em src-tauri/tauri.conf.json"
