/**
 * Letras das próximas da fila (2026-11-04). Quando a fila anda (ou muda), as
 * três músicas seguintes vão ao POST /lyrics/prefetch: as letras que o
 * servidor já tem entram já na cache do React Query (a página das letras
 * abre sem esqueleto) e as que faltam ele vai buscá-las em segundo plano,
 * com a tradução se a tradução estava ligada. Espera um segundo e meio de
 * calma antes de pedir, para não disparar a cada salto rápido na fila.
 */
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { prefetchLyrics } from "@/api/queries/lyrics";
import type { SongId } from "@/domain/ids";
import { initialTranslationTarget, translationWasOn } from "@/features/lyrics/targetStore";
import { playerStore, type PlayerStoreState } from "@/player/store";

const AHEAD = 3;
const SETTLE_MS = 1500;

/** As próximas `AHEAD` músicas pela ordem da fila (sem a actual). Puro. */
export const upcomingSongIds = (state: Pick<PlayerStoreState, "queue" | "queueOrder" | "queueIndex">): SongId[] => {
  const ids: SongId[] = [];
  for (let k = 1; ids.length < AHEAD && state.queueIndex + k < state.queueOrder.length; k++) {
    const song = state.queue[state.queueOrder[state.queueIndex + k] ?? -1];
    if (song && !ids.includes(song.id as SongId)) ids.push(song.id as SongId);
  }
  return ids;
};

let installed = false;

export const registerLyricsQueuePrefetch = (): void => {
  if (installed) return;
  installed = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  playerStore.subscribe((state) => {
    const ids = upcomingSongIds(state).filter((id) => queryClient.getQueryData(keys.lyrics(id)) === undefined);
    const key = ids.join(",");
    if (key === lastKey) return;
    lastKey = key;
    if (timer) clearTimeout(timer);
    if (ids.length === 0) return;
    timer = setTimeout(() => {
      const target = translationWasOn() ? initialTranslationTarget() : null;
      prefetchLyrics(ids, target)
        .then(({ lyrics }) => {
          for (const [id, payload] of Object.entries(lyrics)) {
            const songId = Number(id) as SongId;
            if (queryClient.getQueryData(keys.lyrics(songId)) === undefined) {
              queryClient.setQueryData(keys.lyrics(songId), payload);
            }
          }
        })
        .catch(() => {
          // Pré-carregar é um extra: sem rede ou com o servidor antigo, a
          // página das letras pede como sempre.
        });
    }, SETTLE_MS);
  });
};
