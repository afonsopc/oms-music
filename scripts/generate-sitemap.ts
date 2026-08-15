/**
 * Sitemap generator for the static web export ("uma so app" F1 / plano 2.1).
 * Run AFTER `expo export -p web` (scripts/build-web.sh does):
 *
 *   bun scripts/generate-sitemap.ts [distDir]
 *
 * Optional: OMS_WEB_BASE_URL (default https://music.omelhorsite.pt).
 *
 * The route list is derived from the .html shells the export actually
 * emitted, never hand-maintained, so a new screen can never be silently
 * missing. Only ENUMERABLE routes make the sitemap:
 *
 *  - dynamic shells ([artist].html and the post-export __dynamic.html
 *    renames) are skipped: artist / album / playlist / mix / radio / profile
 *    are unbounded, per-user sets (spike 1) and a sitemap of shells would
 *    just be noise;
 *  - route-group aliases ((main)/(tabs)/home.html vs home.html) collapse to
 *    ONE canonical URL by stripping the (group) segments and deduping;
 *  - expo-router internals (+not-found, _sitemap), the generated 404.html,
 *    /oauth/* (robots.txt disallows it: ephemeral login tickets) and the
 *    /account ghost route (the native tab bar's "Perfil" item) stay out.
 *
 * Writes <distDir>/sitemap.xml, the file robots.txt already points at.
 * Paths are joined with "/" directly: this is bun-side tooling for macOS /
 * Linux / CI, exactly like the other scripts in this directory.
 */
import { readdirSync, writeFileSync } from "node:fs";

const DIST = process.argv[2] ?? "dist";
const BASE_URL = (process.env.OMS_WEB_BASE_URL ?? "https://music.omelhorsite.pt").replace(
  /\/$/,
  "",
);

/** All .html files under dir, as dist-relative "a/b/c.html" paths. */
const htmlFiles = (dir: string, prefix = ""): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      // _expo holds bundles, never pages.
      if (entry.name === "_expo") continue;
      out.push(...htmlFiles(`${dir}/${entry.name}`, rel));
    } else if (entry.name.endsWith(".html")) {
      out.push(rel);
    }
  }
  return out;
};

/** dist-relative html path -> canonical URL path, or null when excluded. */
const toRoute = (relPath: string): string | null => {
  const segments = relPath.slice(0, -".html".length).split("/");
  const kept: string[] = [];
  for (const segment of segments) {
    // Route groups exist for the navigator, not for the URL.
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    // Dynamic shells: bracket params from the export, __dynamic from the
    // post-export rename in build-web.sh. Unbounded domains, not enumerable.
    if (segment.startsWith("[") || segment === "__dynamic") return null;
    // Router internals and the Pages 404 copy.
    if (segment === "+not-found" || segment === "_sitemap" || segment === "404") return null;
    // A rota-fantasma por tras do item "Perfil" da barra nativa: o trigger e
    // `disabled` e nunca a mostra, so existe para o navegador de tabs ter um
    // filho valido. Renderiza um ecra vazio, logo nao pode ser indexada.
    if (segment === "account") return null;
    kept.push(segment);
  }
  // OAuth return leg: robots.txt disallows it, so the sitemap must not list it.
  if (kept[0] === "oauth") return null;
  if (kept.length === 1 && kept[0] === "index") return "/";
  return `/${kept.join("/")}`;
};

const routes = new Set<string>();
for (const file of htmlFiles(DIST)) {
  const route = toRoute(file);
  if (route !== null) routes.add(route);
}

if (routes.size === 0) {
  console.error(`FAIL: no enumerable routes found under ${DIST} - did the export run?`);
  process.exit(1);
}

// One deploy = one lastmod; the shells are all rewritten by every export.
const lastmod = new Date().toISOString().slice(0, 10);
const urls = [...routes]
  .sort()
  .map(
    (route) =>
      `  <url>\n    <loc>${BASE_URL}${route}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

writeFileSync(`${DIST}/sitemap.xml`, xml);
console.log(`sitemap.xml: ${routes.size} rotas -> ${DIST}/sitemap.xml`);
