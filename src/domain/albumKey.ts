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
