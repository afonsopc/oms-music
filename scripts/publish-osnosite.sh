#!/usr/bin/env bash
# Publica o export web em music.omelhorsite.pt, pela CLI do osnosite.
#
# É ASSIM que este site vai a produção, e não por wrangler: music.omelhorsite.pt
# é o website `oms-music` da plataforma osnosite (raw_publish), o conteúdo vive
# no branch `oms-music` de github.com/afonsopc/osnosite-codebases (pasta _site/),
# e a plataforma é que corta a release e faz o deploy para o Pages.
#
#   ./scripts/publish-osnosite.sh ["notas da release"]
#
# Produção precisa de step-up (`osnosite auth step-up --passkey`, 1 dia). Com a
# sessão elevada o deploy corre já; sem ela fica o pedido para o dono aprovar no
# dashboard. A ordem importa: pedir primeiro deixava um pedido pendente para
# sempre em cada publish.
#
# Ficheiros acima do cap de 25 MiB do Pages não podem ir no bundle: vivem no
# heavy-asset storage (`osnosite website oms-music assets push`) e são retirados
# do _site/ antes do push, com a lista vinda do próprio storage.
set -euo pipefail

SLUG="oms-music"
BRANCH="oms-music"
REPO="https://github.com/afonsopc/osnosite-codebases"
NOTES="${1:-publish-osnosite.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "» build"
cd "$HERE"
./scripts/build-web.sh

echo "» clone $REPO#$BRANCH"
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$WORK/codebases"

echo "» substituir _site/"
rm -rf "$WORK/codebases/_site"
cp -R "$HERE/dist" "$WORK/codebases/_site"

echo "» excluir heavy assets (cap de 25 MiB do Pages; servidos do storage)"
osnosite website "$SLUG" assets \
  | /usr/bin/python3 -c 'import json,sys; [print(a["path"].lstrip("/")) for a in json.load(sys.stdin)]' \
  | while IFS= read -r rel; do
      if [ -f "$WORK/codebases/_site/$rel" ]; then
        rm -f "$WORK/codebases/_site/$rel"
        echo "  - $rel"
      fi
    done

echo "» push"
cd "$WORK/codebases"
git add -A
if git diff --cached --quiet; then
  echo "sem alterações no export; nada a publicar"
  exit 0
fi
git commit --quiet -m "oms-music: export $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push --quiet origin "$BRANCH"

echo "» release"
VERSION=$(osnosite website "$SLUG" release --notes "$NOTES" \
  | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')

# A plataforma constrói a release no Mini a partir do tarball do branch. Um 400
# do codeload logo a seguir ao push já aconteceu e fica em cache para aquele
# sha: a saída é voltar a correr este script (novo commit, novo sha).
echo "» esperar que a release v$VERSION fique ready"
for _ in $(seq 1 40); do
  STATUS=$(osnosite website "$SLUG" releases \
    | /usr/bin/python3 -c "import json,sys; print([r['status'] for r in json.load(sys.stdin) if r['version']==$VERSION][0])")
  [ "$STATUS" = "ready" ] && break
  if [ "$STATUS" = "error" ] || [ "$STATUS" = "failed" ]; then
    echo "release v$VERSION falhou - volta a correr o script" >&2
    exit 1
  fi
  sleep 10
done
[ "$STATUS" = "ready" ] || { echo "release v$VERSION não ficou ready a tempo" >&2; exit 1; }

echo "» deploy v$VERSION (produção: directo com step-up, senão pedido ao dono)"
if osnosite website "$SLUG" deploy --env production --version "$VERSION" --wait; then
  echo "feito - v$VERSION em produção"
else
  osnosite website "$SLUG" deploy --env production --version "$VERSION" --request --note "$NOTES"
  echo "feito - pedido criado, aprova no dashboard"
fi
