/**
 * DeepLinkTarget -> native route mapping (FR-20 registration half). The pure
 * URL parsing lives in lib/deepLinks.ts (WP1); this file owns the route-tree
 * knowledge and is consumed by src/app/+native-intent.ts.
 */
import { parseDeepLink, type DeepLinkTarget } from "@/lib/deepLinks";

const enc = encodeURIComponent;

/**
 * Prefixo de grupo EXPLICITO, ao contrario de lib/routes.ts: um deep link
 * chega sem tab focada, e sem o grupo o expo-router desempatava as tres copias
 * de cada rota pela ordem da arvore - uma escolha por acaso, nao por decisao.
 * Fixar o Inicio faz com que um link para uma playlist acenda sempre a mesma
 * tab e deixe a Home por baixo como ecra de saida.
 */
const HOME = "/(main)/(tabs)/(home)";

export const routeForTarget = (target: DeepLinkTarget): string => {
  switch (target.kind) {
    case "home":
      return `${HOME}/home`;
    case "liked":
      return `${HOME}/liked`;
    case "artists":
      return `${HOME}/artists`;
    case "playlists":
      return `${HOME}/playlists`;
    case "search":
      // A Pesquisa vive na sua propria tab, por isso este e o unico destino
      // que sai do grupo do Inicio.
      return target.query
        ? `/(main)/(tabs)/(search)/search?query=${enc(target.query)}`
        : "/(main)/(tabs)/(search)/search";
    case "playlist":
      return `${HOME}/playlist/${target.id}`;
    case "mix":
      // Mix slugs contain ":" and MUST be URL-encoded (FR-121).
      return `${HOME}/mix/${enc(target.slug)}`;
    case "radioArtist":
      return `${HOME}/radio/artist/${enc(target.artist)}`;
    case "radioSong":
      return `${HOME}/radio/song/${target.id}`;
    case "artist":
      return `${HOME}/artist/${enc(target.artist)}`;
    case "album": {
      // The literal "null" segment is preserved: the album screen maps it to
      // exact_search[album]="\b" (unknown album) / no context artist.
      const artist = target.artist === null ? "null" : enc(target.artist);
      const album = target.album === null ? "null" : enc(target.album);
      const highlight = target.highlight ? `?highlight=${enc(target.highlight)}` : "";
      return `${HOME}/album/${artist}/${album}${highlight}`;
    }
    case "settings":
      switch (target.page) {
        case "import":
          return `${HOME}/settings/import`;
        case "songs":
          return `${HOME}/settings/songs`;
        case "artists":
          return `${HOME}/settings/artists`;
        case "playback":
          return `${HOME}/settings/playback`;
        case "downloads":
          return `${HOME}/settings/downloads`;
      }
  }
};

/**
 * Full URL/path -> route, or null when the URL is not a music deep link (the
 * router then applies its default handling - dev client URLs, plain route
 * paths, etc.).
 */
export const routeForDeepLinkUrl = (url: string): string | null => {
  const target = parseDeepLink(url);
  return target ? routeForTarget(target) : null;
};
