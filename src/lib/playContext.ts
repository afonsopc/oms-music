/**
 * Marcas locais de escuta por álbum (regras em albumPlayMarks.ts): o motor
 * chama `noteSongPlayed` sempre que regista um play, com o QueueContext da
 * fila, e o Início lê as marcas para esconder da grelha os álbuns que só
 * lá estão porque uma playlist os atravessou. kv-backed como
 * recentCollections, para sobreviver ao relançamento.
 */
import { kvGetJson, kvSetJson } from "@/db/kv";
import { primaryArtistSegment } from "@/domain/format";
import type { QueueContext } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { albumTileKey, withAlbumPlayMark, type AlbumPlayMarks } from "./albumPlayMarks";

const KV_KEY = "oms-music.album-play-marks";

let cached: AlbumPlayMarks | null = null;
const listeners = new Set<() => void>();

const load = (): AlbumPlayMarks => {
  cached ??= kvGetJson<AlbumPlayMarks>(KV_KEY) ?? {};
  return cached;
};

export const getAlbumPlayMarks = (): AlbumPlayMarks => load();

export const subscribeAlbumPlayMarks = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const commit = (next: AlbumPlayMarks): void => {
  cached = next;
  kvSetJson(KV_KEY, next);
  for (const cb of listeners) cb();
};

/** Chamado pelo motor (register.ts) ao registar um play. */
export const noteSongPlayed = (song: Song, context: QueueContext | null): void => {
  if (!song.album) return; // sem álbum não há cartão para esconder
  commit(
    withAlbumPlayMark(
      load(),
      albumTileKey(primaryArtistSegment(song), song.album),
      context != null,
      Date.now(),
    ),
  );
};

/** Media-id wipe hook, como clearRecentCollections. */
export const clearAlbumPlayMarks = (): void => commit({});
