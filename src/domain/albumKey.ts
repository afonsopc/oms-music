/**
 * Composite offline-collection key for albums: "album:<artistSlug>:<album>",
 * lowercased - matches the backend's (album, lead artist) grouping and stays
 * deterministic across refreshes (FR-87).
 */
export const albumKey = (artistSlug: string | null, album: string | null): string => {
  const slugPart = (artistSlug ?? "null").toLowerCase();
  const albumPart = (album ?? "null").toLowerCase();
  return `album:${slugPart}:${albumPart}`;
};

export const isAlbumKey = (key: string): boolean => key.startsWith("album:");

/**
 * Chave de colecção offline para um ARTISTA inteiro (downloads com
 * granularidade, dono 2026-08-17): "artist:<slug>", minúsculas. Vive ao
 * lado da do álbum porque é o mesmo contrato - uma string determinística
 * que o downloads/collections usa como identidade da colecção.
 */
export const artistKey = (artistSlug: string | null): string =>
  `artist:${(artistSlug ?? "null").toLowerCase()}`;

export const isArtistKey = (key: string): boolean => key.startsWith("artist:");
