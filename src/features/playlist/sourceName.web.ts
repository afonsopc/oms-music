import type { Playlist } from "@/domain/playlist";

/** Na web e no computador: o nome que o núcleo manda (provider_name). */
export const sourceName = (playlist: Playlist): string | null =>
  playlist.provider_name ?? null;
