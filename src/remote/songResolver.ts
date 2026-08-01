/**
 * The cache/REST half of `add_to_queue` / `play_next` resolution (FR-109):
 * commands carry song ids ONLY, so the active device looks the song up
 * itself. Order: the react-query detail entry, then any cached songs list
 * (plain or infinite), then `GET /songs/:id` as the last resort.
 *
 * Lives apart from commands.ts (which is injected with this at boot) so the
 * command router stays free of api imports and unit-tests in bun.
 */
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { getSong } from "@/api/endpoints/songs";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import type { RemoteSongLookup } from "./commands";

const fromCachedLists = (songId: SongId): Song | null => {
  for (const [, data] of queryClient.getQueriesData({ queryKey: keys.songs.all })) {
    const list = Array.isArray(data)
      ? (data as unknown[])
      : ((data as { pages?: unknown[][] } | null | undefined)?.pages?.flat() ?? null);
    const hit = list?.find(
      (s): s is Song =>
        !!s && typeof s === "object" && (s as Song).id === songId && !!(s as Song).title,
    );
    if (hit) return hit;
  }
  return null;
};

export const querySongLookup: RemoteSongLookup = async (songId) => {
  const detail = queryClient.getQueryData<Song>(keys.songs.detail(songId));
  if (detail) return detail;
  const cached = fromCachedLists(songId);
  if (cached) return cached;
  try {
    return await getSong(songId);
  } catch {
    // A command for a song we cannot resolve is dropped silently: the
    // sender sees no change and can retry from its own UI.
    return null;
  }
};
