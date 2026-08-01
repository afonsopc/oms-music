/**
 * DeepLinkTarget -> native route mapping (FR-20 registration half). The pure
 * URL parsing lives in lib/deepLinks.ts (WP1); this file owns the route-tree
 * knowledge and is consumed by src/app/+native-intent.ts.
 */
import { parseDeepLink, type DeepLinkTarget } from "@/lib/deepLinks";

const enc = encodeURIComponent;

export const routeForTarget = (target: DeepLinkTarget): string => {
  switch (target.kind) {
    case "home":
      return "/(main)/(tabs)/home";
    case "liked":
      return "/(main)/liked";
    case "artists":
      return "/(main)/artists";
    case "playlists":
      return "/(main)/playlists";
    case "search":
      return target.query
        ? `/(main)/(tabs)/search?query=${enc(target.query)}`
        : "/(main)/(tabs)/search";
    case "playlist":
      return `/(main)/playlist/${target.id}`;
    case "mix":
      // Mix slugs contain ":" and MUST be URL-encoded (FR-121).
      return `/(main)/mix/${enc(target.slug)}`;
    case "radioArtist":
      return `/(main)/radio/artist/${enc(target.artist)}`;
    case "radioSong":
      return `/(main)/radio/song/${target.id}`;
    case "artist":
      return `/(main)/artist/${enc(target.artist)}`;
    case "album": {
      // The literal "null" segment is preserved: the album screen maps it to
      // exact_search[album]="\b" (unknown album) / no context artist.
      const artist = target.artist === null ? "null" : enc(target.artist);
      const album = target.album === null ? "null" : enc(target.album);
      const highlight = target.highlight ? `?highlight=${enc(target.highlight)}` : "";
      return `/(main)/album/${artist}/${album}${highlight}`;
    }
    case "settings":
      switch (target.page) {
        case "import":
          return "/(main)/settings/import";
        case "songs":
          return "/(main)/settings/songs";
        case "artists":
          return "/(main)/settings/artists";
        case "playback":
          return "/(main)/settings/playback";
        case "downloads":
          return "/(main)/settings/downloads";
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
