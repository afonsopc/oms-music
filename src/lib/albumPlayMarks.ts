/**
 * Regras puras (bun-testáveis) por trás de lib/playContext: que álbuns o
 * Início deve ESCONDER da grelha de recentes.
 *
 * O servidor devolve "álbuns recentes" a partir de todos os play events, sem
 * saber de que colecção cada música veio. Tocar a playlist "pagman" põe lá
 * os álbuns de todas as músicas dela, quando o que o utilizador carregou
 * foi a playlist (dono, 2026-09-17). Este dispositivo sabe mais do que o
 * servidor: por cada álbum guarda a última escuta local e se veio de dentro
 * de uma colecção. Um álbum cuja última escuta do servidor coincide com uma
 * escuta local "de dentro de uma colecção" não foi escolhido: fica de fora.
 * Uma escuta posterior noutro dispositivo (ou uma escolha deliberada aqui,
 * que reescreve a marca) volta a mostrá-lo.
 */

export interface AlbumPlayMark {
  /** Quando esta escuta foi registada localmente (Date.now()). */
  at: number;
  /** true = a fila tinha um QueueContext (a música veio de uma colecção). */
  fromCollection: boolean;
}

export type AlbumPlayMarks = Readonly<Record<string, AlbumPlayMark>>;

/** Quantas marcas guardar; álbuns tocados há muito não estão na grelha. */
export const ALBUM_PLAY_MARKS_CAP = 64;

/**
 * O relógio do servidor e o deste aparelho não são o mesmo, e o evento é
 * registado depois de ~30 s de escuta: qualquer escuta do servidor até este
 * tanto DEPOIS da marca local ainda é "a mesma escuta".
 */
export const ALBUM_PLAY_MARK_SLACK_MS = 5 * 60 * 1000;

/** A identidade de um cartão de álbum, igual à que o Início usa para dedupe. */
export const albumTileKey = (
  artistSegment: string | null | undefined,
  album: string | null | undefined,
): string => `album:${artistSegment || "null"}::${album || "null"}`;

/** Reducer puro: regista uma escuta, mantendo só as mais recentes. */
export const withAlbumPlayMark = (
  marks: AlbumPlayMarks,
  key: string,
  fromCollection: boolean,
  now: number,
): AlbumPlayMarks => {
  const next: Record<string, AlbumPlayMark> = { ...marks, [key]: { at: now, fromCollection } };
  const keys = Object.keys(next);
  if (keys.length > ALBUM_PLAY_MARKS_CAP) {
    keys.sort((a, b) => next[b]!.at - next[a]!.at);
    for (const stale of keys.slice(ALBUM_PLAY_MARKS_CAP)) delete next[stale];
  }
  return next;
};

/**
 * true quando a última escuta que o servidor conhece deste álbum é a que
 * este aparelho viu vir de dentro de uma colecção.
 */
export const hiddenByCollectionPlay = (
  mark: AlbumPlayMark | undefined,
  lastPlayedAt: string,
  slackMs: number = ALBUM_PLAY_MARK_SLACK_MS,
): boolean => {
  if (!mark || !mark.fromCollection) return false;
  const serverAt = Date.parse(lastPlayedAt);
  if (!Number.isFinite(serverAt)) return false;
  return serverAt <= mark.at + slackMs;
};
