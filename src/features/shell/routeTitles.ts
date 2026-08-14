/**
 * Route -> document <title> for the web export ("uma so app" F1 / plano 2.1).
 *
 * Why this lives in the ROOT layout and not in each route file: SessionGate
 * returns null while the session status is "booting", and during the static
 * prerender (`expo export -p web`, Node, no effects) that is FOREVER - no
 * route screen ever mounts, so a <Head> inside a screen can never serialize
 * into the emitted HTML. The root layout renders ABOVE the gate on every
 * route, so a pathname-driven title there is the ONE place that reaches both
 * the prerendered shells and live client-side navigation with the same code.
 *
 * Prefix rules cover the dynamic routes twice over: at export time the
 * pathname is the pattern itself ("/artist/[artist]"), at runtime it is the
 * real path ("/artist/Nirvana") - both share the prefix. A screen that later
 * learns the real entity name can still mount its own deeper <Head> and win
 * (react-helmet: deepest instance takes the title); this map is the floor,
 * not the ceiling.
 *
 * Names follow the PT-PT strings in src/i18n/catalogs/pt.json (tabHome,
 * tabSearch, tabLibrary, settings...). Static titles are deliberately not
 * run through the runtime i18n: the export emits ONE shell per route, and
 * the app's product language is PT-PT.
 */
const SITE = "Música - omelhorsite.pt";

/** Exact canonical pathname -> screen name. */
const EXACT: Record<string, string> = {
  "/login": "Iniciar sessão",
  "/signup": "Criar conta",
  "/reset": "Recuperar conta",
  "/home": "Início",
  "/search": "Pesquisar",
  "/library": "Biblioteca",
  "/liked": "Músicas Gostadas",
  "/playlists": "Playlists",
  "/artists": "Artistas",
  "/artists-roster": "Artistas",
  "/friends": "Amigos",
  "/gallery": "Galeria",
  "/jam": "Jam",
  "/queue": "Fila",
  "/lyrics": "Letras",
  "/now-playing": "A tocar",
};

/** First-segment prefixes: dynamic patterns and whole sections. */
const PREFIX: [string, string][] = [
  ["/settings", "Definições"],
  ["/artist/", "Artista"],
  ["/album/", "Álbum"],
  ["/playlist/", "Playlist"],
  ["/mix/", "Mix"],
  ["/radio/", "Rádio"],
  ["/profile/", "Perfil"],
];

/** Full document title for a pathname; the bare site name when unknown. */
export const routeTitle = (pathname: string | null): string => {
  if (!pathname || pathname === "/") return SITE;
  const exact = EXACT[pathname];
  if (exact) return `${exact} - ${SITE}`;
  for (const [prefix, name] of PREFIX) {
    if (pathname === prefix || pathname.startsWith(prefix)) return `${name} - ${SITE}`;
  }
  return SITE;
};
