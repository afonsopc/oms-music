#!/usr/bin/env bash
# Web export pipeline for music.omelhorsite.pt ("uma so app" F1 / plano 2.1).
#
#   ./scripts/build-web.sh [extra expo export args]
#
# Produces a dist/ that is EXACTLY what the future "oms-music" Cloudflare
# Pages project should receive (see scripts/deploy-music-web.sh - which only
# documents the deploy, it never runs one). Steps, in order:
#
#  1. `bunx expo export -p web` under a watchdog. The export sometimes never
#     terminates (expo/expo#43890); spike 1 measured a healthy run at 2-3
#     minutes, so the default ceiling of 15 minutes (OMS_EXPORT_TIMEOUT_S to
#     override) only ever fires on the pathological hang.
#  2. Promote the seven dynamic-route shells ([artist].html etc.) to
#     bracket-free names (__dynamic.html) and generate dist/_redirects with
#     one 200 rewrite per unbounded route. Spike 1's verdict: per-route rules
#     beat a SPA catch-all (real 404s for typos, per-route <head> stays
#     meaningful), and renaming dodges the open question of "[" needing
#     URL-encoding in _redirects targets.
#  3. Real 404: copy the exported +not-found.html to 404.html. Its presence
#     is what stops Pages from assuming SPA mode and answering 200 to any
#     typo.
#  4. Generate dist/sitemap.xml from the shells that actually exist
#     (scripts/generate-sitemap.ts, enumerable routes only).
#  5. Verify the contract: per-route HTML present, _headers + robots.txt
#     copied from public/, the seven rewrite shells in place, and a correct
#     non-empty <title> on at least two routes (F1's acceptance line).
#
# web.output "static" comes from app.config.js, not from a flag here.
set -euo pipefail
cd "$(dirname "$0")/.."

DIST="dist"
TIMEOUT_S="${OMS_EXPORT_TIMEOUT_S:-900}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# --- 1. export under a watchdog --------------------------------------------

rm -rf "$DIST"

echo "==> bunx expo export -p web (tecto: ${TIMEOUT_S}s)"
CI=1 bunx expo export -p web "$@" &
export_pid=$!

# stdout goes to /dev/null on purpose: the watchdog's `sleep` would otherwise
# inherit this script's stdout and, when stdout is a pipe (build-web.sh | tee),
# hold it open for the full timeout after the script itself has exited. The
# watchdog's own message goes to stderr anyway.
(
  sleep "$TIMEOUT_S"
  echo "watchdog: o export passou os ${TIMEOUT_S}s (expo/expo#43890), a matar o processo" >&2
  kill -TERM "$export_pid" 2>/dev/null || true
  sleep 10
  kill -KILL "$export_pid" 2>/dev/null || true
) > /dev/null &
watchdog_pid=$!

set +e
wait "$export_pid"
export_status=$?
set -e
# The watchdog subshell may already be gone (normal case) - all kills are
# best-effort by design. pkill reaps its sleep child, which would otherwise
# linger as an orphan until the timeout expires.
pkill -P "$watchdog_pid" 2>/dev/null || true
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true

[ "$export_status" -eq 0 ] || fail "expo export saiu com ${export_status} (143 = morto pelo watchdog)"
[ -f "$DIST/index.html" ] || fail "o export terminou mas não há ${DIST}/index.html"

# --- 2. dynamic shells -> bracket-free names + _redirects -------------------

REDIRECTS="$DIST/_redirects"
cat > "$REDIRECTS" <<'EOF'
# Gerado por scripts/build-web.sh - NÃO editar à mão; a fonte é a lista de
# rotas dinâmicas do próprio script. Uma regra 200 por rota de domínio
# ilimitado (spike 1): o shell hidrata e o expo-router resolve o path real no
# cliente. Caminhos fora destas sete formas caem no 404.html verdadeiro.
EOF

# rule|exported shell|bracket-free target - one line per unbounded route.
# Keep in lockstep with src/app/(main)/**: a new [param] route needs a line
# here, and the check below fails loudly if a listed shell vanishes.
while IFS='|' read -r rule src dest; do
  [ -n "$rule" ] || continue
  [ -f "$DIST/$src" ] || fail "shell dinâmico em falta: ${DIST}/${src} (a rota mudou?)"
  mv "$DIST/$src" "$DIST/$dest"
  printf '%s /%s 200\n' "$rule" "$dest" >> "$REDIRECTS"
done <<'EOF'
/artist/:artist|artist/[artist].html|artist/__dynamic.html
/album/:artist/:album|album/[artist]/[album].html|album/__dynamic.html
/playlist/:id|playlist/[id].html|playlist/__dynamic.html
/mix/:slug|mix/[slug].html|mix/__dynamic.html
/radio/artist/:artist|radio/artist/[artist].html|radio/artist/__dynamic.html
/radio/song/:id|radio/song/[id].html|radio/song/__dynamic.html
/profile/:idOrHandle|profile/[idOrHandle].html|profile/__dynamic.html
EOF

# Leftover bracket shells are route-group ALIASES of the seven above
# ((main)/artist/[artist].html ...). Nothing links to them and their names
# are exactly the problem the rename dodges, so they do not ship.
find "$DIST" -type f -name '*\[*' -delete
find "$DIST" -type d -empty -delete

# --- 3. real 404 ------------------------------------------------------------

[ -f "$DIST/+not-found.html" ] || fail "o export não emitiu +not-found.html"
cp "$DIST/+not-found.html" "$DIST/404.html"

# The +not-found prerender is the one shell where the root RouteTitle does not
# serialize (expo-router's Unmatched view is NoSSR and the synthetic route
# renders helmet's empty default), so the copy ships with a blank <title>.
# 404.html is the page every typo serves; patch the title here at the host
# layer instead of adding a src/app/+not-found.tsx, which would also replace
# the default screen on NATIVE routing. Substitute only while the title is
# empty, so an upstream fix wins the day it lands; then assert either way.
perl -pi -e \
  's{<title data-rh="true"></title>}{<title data-rh="true">Página não encontrada - Música - omelhorsite.pt</title>}' \
  "$DIST/404.html"
grep -q '<title data-rh="true">[^<]' "$DIST/404.html" \
  || fail "404.html continua com <title> vazio"

# --- 4. sitemap -------------------------------------------------------------

bun scripts/generate-sitemap.ts "$DIST"

# --- 5. verification --------------------------------------------------------

for f in _headers robots.txt; do
  [ -f "$DIST/$f" ] || fail "public/${f} não foi copiado para ${DIST}/ pelo export"
done
for shell in \
  "artist/__dynamic.html" "album/__dynamic.html" "playlist/__dynamic.html" \
  "mix/__dynamic.html" "radio/artist/__dynamic.html" "radio/song/__dynamic.html" \
  "profile/__dynamic.html"; do
  [ -f "$DIST/$shell" ] || fail "shell de rewrite em falta: ${DIST}/${shell}"
done

# F1: "<title> correcto em pelo menos duas rotas verificadas". Verified on
# every build, not once by hand: the prerender serializes expo-router/head
# as <title data-rh="true">...</title>.
grep -q '<title data-rh="true">Iniciar sess' "$DIST/login.html" \
  || fail "login.html sem o <title> prerenderizado"
grep -q '<title data-rh="true">In' "$DIST/home.html" \
  || fail "home.html sem o <title> prerenderizado"
grep -q '<title data-rh="true">M' "$DIST/index.html" \
  || fail "index.html sem o <title> de fallback"

html_count=$(find "$DIST" -name '*.html' | wc -l | tr -d ' ')
total_size=$(du -sh "$DIST" | cut -f1)
echo "==> dist/ pronto: ${html_count} ficheiros .html, ${total_size} no total"
echo "==> deploy: ver scripts/deploy-music-web.sh (documentação, nunca executa)"
