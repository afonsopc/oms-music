/**
 * Core song-menu slot registrations (FR-74): Play/Pause, Like/Unlike, Play
 * next, Add to queue, Open album, Open artist, Add to playlist. The frozen
 * order and the renderer live in contracts/songMenu + ui/SongMenu; this file
 * only fills the core slots. startRadio stays with WP6, download with WP8,
 * proposeToJam with WP10, separateVocals with WP11.
 *
 * Slot hooks are React hooks (the renderer isolates each slot in its own
 * component): hooks first, conditional item lists after.
 *
 * Imported (and `registerCoreSongMenuSlots()` called) by boot/wireup.ts.
 */
import { router } from "expo-router";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import {
  registerSongMenuSlot,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { getTransport } from "@/contracts/transport";
import { songAlbumRoute, songArtistRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { openAddToPlaylist } from "@/features/playlists/addToPlaylist";

/** Play / Pause: label flips when this row IS the current song and playing.
 *  Rows pass their own onPlay; player surfaces omit it so the item toggles
 *  the current song (web useSongActions parity). */
const usePlayPauseSlot: SongMenuSlotHook = (ctx) => {
  const isCurrent = usePlaybackView((v) => v.song != null && v.song.id === ctx.song.id);
  const playing = usePlaybackView((v) => v.playing);
  const showPause = isCurrent && playing;
  return [
    {
      id: "playPause",
      labelKey: showPause
        ? "components.music.SongRow.pause"
        : "components.music.SongRow.play",
      icon: showPause ? "pause" : "play",
      onPress: () => {
        if (isCurrent) {
          getTransport().toggle();
        } else if (ctx.onPlay) {
          ctx.onPlay();
        } else {
          getTransport().setQueue([ctx.song], 0);
        }
      },
    },
  ];
};

/** Like / Unlike via /liked_songs/ids, optimistic with rollback (FR-46).
 *  Hidden for jam-injected songs: they are another user's rows and are never
 *  persisted (DESIGN 10.3). */
const useLikeToggleSlot: SongMenuSlotHook = (ctx) => {
  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  if (ctx.song.jam_song) return [];
  const liked = (likedIds.data ?? []).includes(ctx.song.id);
  return [
    {
      id: "likeToggle",
      labelKey: liked
        ? "components.music.SongCard.unlike"
        : "components.music.SongCard.like",
      icon: "heart",
      onPress: () => toggleLike.mutate({ songId: ctx.song.id, liked }),
    },
  ];
};

const usePlayNextSlot: SongMenuSlotHook = (ctx) => [
  {
    id: "playNext",
    labelKey: "components.music.SongCard.playNext",
    icon: "list-start",
    onPress: () => getTransport().playNext(ctx.song),
  },
];

const useAddToQueueSlot: SongMenuSlotHook = (ctx) => [
  {
    id: "addToQueue",
    labelKey: "components.music.SongCard.addToQueue",
    icon: "list-plus",
    onPress: () => getTransport().addToQueue(ctx.song),
  },
];

const useOpenAlbumSlot: SongMenuSlotHook = (ctx) => [
  {
    id: "openAlbum",
    labelKey: "components.music.SongCard.openAlbum",
    icon: "disc",
    onPress: () => router.push(songAlbumRoute(ctx.song)),
  },
];

const useOpenArtistSlot: SongMenuSlotHook = (ctx) => [
  {
    id: "openArtist",
    labelKey: "components.music.SongCard.openArtist",
    icon: "user",
    onPress: () => router.push(songArtistRoute(ctx.song)),
  },
];

/** Opens the one shared AddToPlaylist dialog (FR-49 behavior is WP6's
 *  AddToPlaylistHost; wireup must registerShellProvider it). Hidden for jam
 *  songs (never persisted). */
const useAddToPlaylistSlot: SongMenuSlotHook = (ctx) => {
  if (ctx.song.jam_song) return [];
  return [
    {
      id: "addToPlaylist",
      labelKey: "components.music.SongCard.addToPlaylist",
      icon: "library",
      onPress: () => openAddToPlaylist(ctx.song),
    },
  ];
};

let registered = false;

/** Idempotent; boot/wireup.ts calls this once. */
export const registerCoreSongMenuSlots = (): void => {
  if (registered) return;
  registered = true;
  registerSongMenuSlot("playPause", usePlayPauseSlot);
  registerSongMenuSlot("likeToggle", useLikeToggleSlot);
  registerSongMenuSlot("playNext", usePlayNextSlot);
  registerSongMenuSlot("addToQueue", useAddToQueueSlot);
  registerSongMenuSlot("openAlbum", useOpenAlbumSlot);
  registerSongMenuSlot("openArtist", useOpenArtistSlot);
  registerSongMenuSlot("addToPlaylist", useAddToPlaylistSlot);
};
