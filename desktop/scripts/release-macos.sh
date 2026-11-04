#!/usr/bin/env bash
# Release do desktop macOS numa linha (a partir de desktop/):
#
#   bun run release
#
# Compila o .app + .dmg (arm64) assinados com o Developer ID, notariza e
# agrafa (stapler) os dois, verifica tudo, gera o latest.json do updater e
# publica a release vX.Y.Z no GitHub (a versao vem do tauri.conf.json; sobe-se
# antes em tauri.conf.json, Cargo.toml, Cargo.lock e package.json). As apps
# instaladas veem-na pelo updates.omelhorsite.pt, que da 302 para o
# latest.json da release "latest".
#
# Notas da release: OMS_RELEASE_NOTES="..." (uma linha vai para o latest.json,
# o texto todo para a pagina da release). O Linux nao passa por aqui
# (scripts/build-linux.sh / scripts/release-local.sh).
#
# Pre-requisitos neste Mac:
#   - "Developer ID Application: Afonso Coutinho (6FYT6632J8)" no keychain
#     de login (copia .p12 em ~/.appstoreconnect/devid/);
#   - ~/.appstoreconnect/oms-ci.env (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH):
#     a chave da API do App Store Connect com que o notarytool autentica;
#   - desktop/keys/updater.key (assinatura do updater, separada da Apple);
#   - gh autenticado com push para afonsopc/oms-music.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="Developer ID Application: Afonso Coutinho (6FYT6632J8)"
ARCH="aarch64"
REPO="afonsopc/oms-music"
ENV_FILE="${OMS_ASC_ENV:-$HOME/.appstoreconnect/oms-ci.env}"

fail() { echo "FALHOU: $*" >&2; exit 1; }

VERSION="$(bun -e 'console.log(require("./src-tauri/tauri.conf.json").version)')"
TAG="v${VERSION}"
NOTES="${OMS_RELEASE_NOTES:-Versao assinada com o Developer ID e notarizada pela Apple.}"
echo "==> release desktop ${TAG} (${ARCH})"

# --- verificacoes antes de gastar 10 minutos de build -------------------------
[ "$(bun -e 'console.log(require("./package.json").version)')" = "$VERSION" ] \
  || fail "desktop/package.json nao esta em ${VERSION}"
grep -q "^version = \"${VERSION}\"" src-tauri/Cargo.toml || fail "Cargo.toml nao esta em ${VERSION}"
# A fonte da versao e o package.json da raiz (bun run version:bump acerta tudo).
[ "$(bun -e 'console.log(require("../package.json").version)')" = "$VERSION" ] \
  || fail "o package.json da raiz nao esta em ${VERSION} (bun run version:bump)"
security find-identity -v -p codesigning | grep -qF "$IDENTITY" || fail "falta a identidade ${IDENTITY}"
[ -f keys/updater.key ] || fail "falta keys/updater.key"
[ -f "$ENV_FILE" ] || fail "falta ${ENV_FILE}"
gh release view "$TAG" -R "$REPO" > /dev/null 2>&1 && fail "a release ${TAG} ja existe"
# A release tem de corresponder a um commit: nada por commitar no que entra
# no bundle (o export web da app + o shell).
DIRTY="$(git -C .. status --porcelain -- desktop src app.config.js app.json package.json bun.lock patches assets public | grep -v '^??' || true)"
[ -z "$DIRTY" ] || fail "alteracoes por commitar no que entra no bundle:
${DIRTY}"

# Credenciais da notarizacao (lidas, nunca impressas). O bundler do Tauri
# notariza e agrafa o .app quando estas tres existem.
set -a; . "$ENV_FILE"; set +a
export APPLE_API_KEY="$ASC_KEY_ID" APPLE_API_ISSUER="$ASC_ISSUER_ID" APPLE_API_KEY_PATH="$ASC_KEY_PATH"
NOTARY=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")

# --- build: assina (Developer ID + Hardened Runtime), notariza e agrafa o .app
# Export web sempre novo num release: um dist/ velho nao entra numa versao.
OMS_FORCE_WEB_BUILD="${OMS_FORCE_WEB_BUILD:-1}" bash scripts/build-macos.sh

BUNDLE="src-tauri/target/release/bundle"
APP="${BUNDLE}/macos/OMS Music.app"
TGZ="${BUNDLE}/macos/OMS Music.app.tar.gz"
DMG="${BUNDLE}/dmg/OMS Music_${VERSION}_${ARCH}.dmg"
for f in "$APP" "$TGZ" "$TGZ.sig" "$DMG"; do [ -e "$f" ] || fail "falta ${f}"; done

# --- o .dmg notariza-se a parte (o Tauri so notariza o .app) -------------------
codesign --verify --strict "$DMG" 2> /dev/null \
  || codesign --force --sign "$IDENTITY" --timestamp "$DMG"
echo "==> notarytool: ${DMG}"
xcrun notarytool submit "$DMG" "${NOTARY[@]}" --wait | tee /tmp/oms-notary-dmg.log
grep -q "status: Accepted" /tmp/oms-notary-dmg.log || fail "notarizacao do dmg nao aceite"
xcrun stapler staple "$DMG"

# --- verificacao ---------------------------------------------------------------
echo "==> verificacao"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "^(Authority=Developer ID Application|TeamIdentifier|Runtime Version)" \
  || fail "o .app nao esta assinado com o Developer ID / Hardened Runtime"
spctl -a -vvv -t exec "$APP"
spctl -a -vvv -t open --context context:primary-signature "$DMG"
# -t install e a avaliacao de instaladores; num dmg o Gatekeeper usa a de cima.
# Fica no log por ser a que o checklist pede.
spctl -a -vvv -t install "$DMG" || true
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
# O .app que o updater entrega e o de dentro do tar.gz: tem de ser o agrafado.
CHECK="$(mktemp -d /tmp/oms-updater-check-XXXX)"
tar -xzf "$TGZ" -C "$CHECK"
codesign --verify --deep --strict "$CHECK/OMS Music.app"
xcrun stapler validate "$CHECK/OMS Music.app"
rm -rf "$CHECK"
# Assinatura do updater (minisign): a chave que assinou e a do tauri.conf.json.
bun -e '
  const fs = require("fs");
  const keyId = (b64) => Buffer.from(Buffer.from(b64, "base64").toString().split("\n")[1], "base64").subarray(2, 10).reverse().toString("hex");
  const pub = require("./src-tauri/tauri.conf.json").plugins.updater.pubkey;
  const sig = fs.readFileSync(process.argv[1], "utf8").trim();
  if (keyId(pub) !== keyId(sig)) { console.error("chave do .sig != pubkey do updater"); process.exit(1); }
  console.log("updater: .sig da chave " + keyId(pub).toUpperCase());
' "$TGZ.sig"

# --- artefactos + latest.json --------------------------------------------------
OUT="$(mktemp -d /tmp/oms-desktop-${TAG}-XXXX)"
BASE="OMS-Music_${VERSION}_${ARCH}"
cp "$DMG" "${OUT}/${BASE}.dmg"
cp "$TGZ" "${OUT}/${BASE}.app.tar.gz"
cp "$TGZ.sig" "${OUT}/${BASE}.app.tar.gz.sig"
bun -e '
  const fs = require("fs");
  const [out, version, tag, base, notes, repo] = process.argv.slice(1);
  const manifest = {
    version,
    notes: notes.split("\n")[0],
    pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    platforms: {
      "darwin-aarch64": {
        signature: fs.readFileSync(`${out}/${base}.app.tar.gz.sig`, "utf8").trim(),
        url: `https://github.com/${repo}/releases/download/${tag}/${base}.app.tar.gz`,
      },
    },
  };
  fs.writeFileSync(`${out}/latest.json`, JSON.stringify(manifest, null, 2) + "\n");
' "$OUT" "$VERSION" "$TAG" "$BASE" "$NOTES" "$REPO"
ls -la "$OUT"

# --- publicar --------------------------------------------------------------------
SHA="$(git rev-parse HEAD)"
git rev-parse -q --verify "refs/tags/${TAG}" > /dev/null || git tag -a "$TAG" -m "OMS Music ${VERSION} (desktop)" "$SHA"
git push origin "refs/tags/${TAG}"
gh release create "$TAG" -R "$REPO" "$OUT"/* --verify-tag --latest \
  --title "OMS Music ${VERSION} (desktop)" \
  --notes "${NOTES}

**Instalar**

- **macOS (arm64):** \`${BASE}.dmg\`. Assinado com o Developer ID e notarizado pela Apple: abre com duplo clique, sem aviso de programador nao identificado. O \`app.tar.gz\` e o \`.sig\` sao para o updater.
- \`latest.json\`: o manifesto do updater (as apps instaladas atualizam-se sozinhas).
- **Linux:** sem build nesta versao; continua a da ultima release com \`.deb\`/\`.AppImage\`."

# O que as apps instaladas veem (o 302 do Traefik para o latest.json).
sleep 5
SEEN="$(curl -fsSL "https://updates.omelhorsite.pt/oms-music-desktop/darwin/${ARCH}/0.0.0" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).version)')"
[ "$SEEN" = "$VERSION" ] || fail "updates.omelhorsite.pt ainda da ${SEEN}"
echo "RELEASE_OK ${TAG} ${SHA} https://github.com/${REPO}/releases/tag/${TAG}"
