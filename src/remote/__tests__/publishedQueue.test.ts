import { describe, expect, it } from "bun:test";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { publishedQueue, type PublishableState } from "../publishedQueue";

const song = (id: number): Song =>
  ({ id: id as SongId, title: `#${id}`, duration: 100 }) as Song;

const clip = (id: number): Song =>
  ({ ...song(id), audio_url: "file:///dj.wav", dj_clip: { theme: "X", script: "hi" } }) as Song;

const state = (queue: Song[], queueIndex: number, order?: number[]): PublishableState => {
  const queueOrder = order ?? queue.map((_, i) => i);
  return { queue, queueOrder, queueIndex, currentSong: queue[queueOrder[queueIndex]!] ?? null };
};

describe("publishedQueue", () => {
  it("deixa uma fila sem DJ exactamente como esta", () => {
    const out = publishedQueue(state([song(1), song(2), song(3)], 1));
    expect(out).toEqual({ songId: "2", queue: ["1", "2", "3"], queueOrder: [0, 1, 2], queueIndex: 1 });
  });

  it("tira a voz do DJ e reindexa o que fica", () => {
    const out = publishedQueue(state([clip(-1), song(1), song(2)], 1));
    expect(out.queue).toEqual(["1", "2"]);
    expect(out.queueOrder).toEqual([0, 1]);
    expect(out.songId).toBe("1");
  });

  it("com o DJ a falar publica a musica que vem a seguir", () => {
    const out = publishedQueue(state([clip(-1), song(1), song(2)], 0));
    expect(out.songId).toBe("1");
    expect(out.queueIndex).toBe(0);
  });

  it("mantem o cursor na musica certa depois de varios clips", () => {
    // fila: clip, 1, clip, 2, 3 - a tocar a 2 (posicao 3)
    const out = publishedQueue(state([clip(-1), song(1), clip(-2), song(2), song(3)], 3));
    expect(out.queue).toEqual(["1", "2", "3"]);
    expect(out.songId).toBe("2");
    expect(out.queueIndex).toBe(1);
  });

  it("respeita uma ordem baralhada", () => {
    // ordem 2,0,1 sobre [clip, 1, 2]: a tocar a posicao 1 da ordem = clip
    const out = publishedQueue(state([clip(-1), song(1), song(2)], 1, [2, 0, 1]));
    expect(out.queue).toEqual(["1", "2"]);
    // o clip sai da ordem; sobram [2, 1] mapeados para [1, 0]
    expect(out.queueOrder).toEqual([1, 0]);
    expect(out.songId).toBe("1");
  });

  it("uma fila so de clips nao publica musica nenhuma", () => {
    const out = publishedQueue(state([clip(-1)], 0));
    expect(out).toEqual({ songId: null, queue: [], queueOrder: [], queueIndex: 0 });
  });
});
