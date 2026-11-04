/**
 * Transmitir: a TV fica com o som e o motor fica calado mas a seguir a
 * fila. Os botões vão para a TV; a TV a mudar de música move o cursor do
 * motor; sem fila nativa (DLNA) é a sessão que manda a seguinte.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { getTransport, setBaseTransport, type TransportActions } from "@/contracts/transport";
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { playerStore, resetPlayerStore } from "@/player/store";
import type { RemoteEngine } from "@/remote/localPlayer";
import { buildCastItems } from "../media";
import {
  attachCastDriver,
  configureCastSession,
  endCast,
  handleCastEnded,
  handleCastStatus,
  resetCastSessionForTests,
} from "../session";
import { castDeviceLabel, castStore } from "../store";
import type { CastDriver, CastItem } from "../types";

const song = (id: number, extra: Partial<Song> = {}): Song =>
  ({
    id: id as SongId,
    title: `Song ${id}`,
    album: null,
    duration: 200,
    artists: [],
    audio_media_id: `a${id}`,
    compressed_audio_media_id: null,
    artwork_media_id: `art${id}`,
    compressed_artwork_media_id: null,
    vocals_media_id: null,
    instrumental_media_id: null,
    ...extra,
  }) as unknown as Song;

const tick = () => new Promise((r) => setTimeout(r, 0));

class FakeEngine {
  queue: Song[] = [song(1), song(2), song(3), song(4)];
  order = [0, 1, 2, 3];
  index = 1;
  silenced = 0;
  aligned: [number, number][] = [];
  getQueueState() {
    return { queue: this.queue, queueOrder: this.order, queueIndex: this.index, shuffle: false };
  }
  getCurrentSong() {
    return this.queue[this.order[this.index]!] ?? null;
  }
  stopAndClearSource() {
    this.silenced++;
  }
  alignQueueIndex(i: number, position = 0) {
    this.index = i;
    this.aligned.push([i, position]);
  }
}

class FakeDriver implements CastDriver {
  readonly kind;
  readonly deviceName = "Sala";
  readonly nativeQueue;
  readonly maxItems;
  calls: string[] = [];
  loads: { keys: string[]; position: number }[] = [];
  upcoming: string[][] = [];
  constructor(native: boolean) {
    this.nativeQueue = native;
    this.maxItems = native ? 30 : 1;
    this.kind = native ? ("chromecast" as const) : ("dlna" as const);
  }
  async load(items: CastItem[], _start: number, position: number) {
    this.loads.push({ keys: items.map((i) => i.key), position });
  }
  async replaceUpcoming(items: CastItem[]) {
    this.upcoming.push(items.map((i) => i.key));
  }
  play() {
    this.calls.push("play");
  }
  pause() {
    this.calls.push("pause");
  }
  seek(s: number) {
    this.calls.push(`seek:${s}`);
  }
  next() {
    this.calls.push("next");
  }
  previous() {
    this.calls.push("previous");
  }
  setVolume(v: number) {
    this.calls.push(`volume:${v}`);
  }
  end(stopTv: boolean) {
    this.calls.push(`end:${stopTv}`);
  }
}

const inertCalls: string[] = [];
const base: TransportActions = new Proxy({} as TransportActions, {
  get: (_t, prop) => (...args: unknown[]) => {
    inertCalls.push(`${String(prop)}${args.length ? `:${args.map(String).join(",")}` : ""}`);
  },
});

const build = async (songs: Song[]): Promise<CastItem[]> =>
  songs.map((s) => ({
    key: String(s.id),
    url: `https://s3.test/${s.id}`,
    contentType: "audio/mpeg",
    title: s.title,
    artist: "",
    album: null,
    artworkUrl: null,
    duration: s.duration,
  }));

let engine: FakeEngine;
let clock = 1000;

beforeEach(() => {
  resetPlayerStore();
  resetCastSessionForTests();
  inertCalls.length = 0;
  engine = new FakeEngine();
  clock = 1000;
  setBaseTransport(base);
  configureCastSession({
    engine: engine as unknown as RemoteEngine,
    build,
    now: () => clock,
    setInterval: () => 1,
    clearInterval: () => undefined,
  });
});

describe("cast session", () => {
  it("hands the queue from the current song to the TV and silences the phone", async () => {
    playerStore.setState({ position: 42, playing: true });
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    expect(engine.silenced).toBeGreaterThan(0);
    expect(d.loads).toEqual([{ keys: ["2", "3", "4"], position: 42 }]);
    expect(castStore.getState().phase).toBe("connected");
  });

  it("routes the buttons to the TV while casting, and back after", async () => {
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    getTransport().toggle();
    getTransport().seek(30);
    getTransport().setVolume(0.5);
    getTransport().next();
    expect(d.calls).toEqual(["pause", "seek:30", "volume:0.5", "next"]);
    expect(inertCalls).toEqual([]);
    endCast({ resumeHere: false, stopTv: true });
    getTransport().pause();
    expect(inertCalls).toEqual(["pause"]);
  });

  it("follows the TV to the next song without loading audio here", async () => {
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    handleCastStatus(d, { currentKey: "3", position: 0, playing: true });
    expect(engine.index).toBe(2);
    expect(engine.aligned.at(-1)).toEqual([2, 0]);
  });

  it("app-driven TVs get the next song when the current one finishes", async () => {
    const d = new FakeDriver(false);
    attachCastDriver(d);
    await tick();
    expect(d.loads.at(-1)?.keys).toEqual(["2"]);
    handleCastStatus(d, { finished: true });
    await tick();
    expect(engine.index).toBe(2);
    expect(d.loads.at(-1)).toEqual({ keys: ["3"], position: 0 });
  });

  it("editing the queue refreshes what comes next on the TV", async () => {
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    getTransport().addToQueue(song(9));
    await tick();
    expect(inertCalls).toEqual(["addToQueue:[object Object]"]);
    expect(d.upcoming.length).toBe(1);
  });

  it("Tocar aqui brings the position back and resumes locally", async () => {
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    handleCastStatus(d, { playing: true, buffering: false, position: 80 });
    clock += 5000;
    endCast({ resumeHere: true, stopTv: true });
    expect(d.calls).toContain("end:true");
    expect(engine.aligned.at(-1)).toEqual([1, 85]);
    expect(inertCalls).toEqual(["play"]);
    expect(castStore.getState().phase).toBe("idle");
  });

  it("a TV that went away leaves the phone paused", async () => {
    const d = new FakeDriver(true);
    attachCastDriver(d);
    await tick();
    handleCastStatus(d, { playing: true, position: 10 });
    handleCastEnded(d);
    expect(inertCalls).toEqual([]);
    expect(castStore.getState().phase).toBe("idle");
  });

  it("labels the device with its kind once", () => {
    expect(castDeviceLabel("Sala", "chromecast")).toBe("Sala (Chromecast)");
    expect(castDeviceLabel("Chromecast da sala", "chromecast")).toBe("Chromecast da sala");
    expect(castDeviceLabel(null, "dlna")).toBe("TV");
  });
});

describe("buildCastItems", () => {
  it("only the custom receiver gets the viz token", async () => {
    const [item] = await buildCastItems([song(1)], async () => ({
      items: { a1: { url: "https://s3/a1", content_type: "audio/mp4" } },
      vizToken: "vt",
    }), { api: "https://backend.omelhorsite.pt" });
    expect(item!.custom?.viz).toEqual({ api: "https://backend.omelhorsite.pt", t: "vt" });
  });

  it("signs audio and artwork in one go and drops what could not be signed", async () => {
    const asked: string[][] = [];
    const items = await buildCastItems(
      [song(1), song(2), song(3, { audio_url: "https://jam/3", artwork_url: "https://jam/3.jpg" })],
      async (ids) => {
        asked.push(ids);
        return {
          items: {
            a1: { url: "https://s3/a1?sig", content_type: "audio/mpeg" },
            art1: { url: "https://s3/art1?sig", content_type: "image/webp" },
          },
          vizToken: "vt",
        };
      },
    );
    expect(asked).toEqual([["a1", "art1", "a2", "art2"]]);
    expect(items.map((i) => i.key)).toEqual(["1", "3"]);
    const [a, b] = items;
    expect([a!.url, a!.contentType, a!.artworkUrl]).toEqual(["https://s3/a1?sig", "audio/mpeg", "https://s3/art1?sig"]);
    expect([b!.url, b!.artworkUrl]).toEqual(["https://jam/3", "https://jam/3.jpg"]);
    // Sem receptor próprio não vai token nenhum para a TV.
    expect(a!.custom?.viz).toBeUndefined();
  });
});
