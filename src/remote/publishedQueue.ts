/**
 * A fila que sai pelo cabo. As intervencoes do DJ (features/dj) ficam em
 * casa: o audio delas e um ficheiro local a ESTE dispositivo e o id e
 * sintetico e negativo, por isso do outro lado seriam um buraco - o
 * servidor hidrata `queue_songs` a partir dos ids e nao encontraria nada.
 *
 * Tirar um elemento da fila obriga a reindexar: `queue_order` guarda
 * POSICOES no array e `queue_index` uma posicao dentro de `queue_order`.
 * Enquanto o DJ fala, o que sai e a musica que vem A SEGUIR - e a proxima
 * coisa do reportorio da conta que vai mesmo tocar, e mostrar "nada" a
 * quem esta a ver noutro ecra era mais falso do que adiantar dez segundos.
 */
import { isDjClip, type Song } from "@/domain/song";

export interface PublishableState {
  queue: Song[];
  queueOrder: number[];
  queueIndex: number;
  currentSong: Song | null;
}

export interface PublishedQueue {
  songId: string | null;
  queue: string[];
  queueOrder: number[];
  queueIndex: number;
}

export const publishedQueue = (state: PublishableState): PublishedQueue => {
  const plain = !state.queue.some(isDjClip);
  if (plain) {
    return {
      songId: state.currentSong ? String(state.currentSong.id) : null,
      queue: state.queue.map((song) => String(song.id)),
      queueOrder: [...state.queueOrder],
      queueIndex: state.queueIndex,
    };
  }

  const remap = new Map<number, number>();
  const queue: string[] = [];
  state.queue.forEach((song, backing) => {
    if (isDjClip(song)) return;
    remap.set(backing, queue.length);
    queue.push(String(song.id));
  });

  const queueOrder: number[] = [];
  let queueIndex = 0;
  state.queueOrder.forEach((backing, position) => {
    const mapped = remap.get(backing);
    if (mapped === undefined) return;
    // Quantas entradas sobreviventes ficam ANTES da actual: e essa a nova
    // posicao do cursor. Com a actual a ser um clip, cai na seguinte.
    if (position < state.queueIndex) queueIndex = queueOrder.length + 1;
    queueOrder.push(mapped);
  });
  queueIndex = Math.min(queueIndex, Math.max(0, queueOrder.length - 1));

  const backing = queueOrder[queueIndex];
  return {
    songId: backing === undefined ? null : (queue[backing] ?? null),
    queue,
    queueOrder,
    queueIndex,
  };
};
