/**
 * A sessão de transmitir: o que acontece quando uma TV fica com o som.
 *
 * A fila continua a ser a do motor (a mesma que o ecrã da fila mostra e que
 * os outros aparelhos vêem); o motor fica CALADO, sem fonte, e a TV toca.
 * Com fila nativa (Chromecast) a TV recebe uma janela da fila e passa de
 * música sozinha - com o telemóvel bloqueado ou a app fechada. Sem ela
 * (DLNA) a TV recebe uma música de cada vez e é a app que manda a seguinte.
 *
 * Por cima de tudo fica um decorador do transporte (contracts/transport):
 * play, pausa, saltar, voltar, procurar e o volume vão para a TV; mexer na
 * fila mexe no motor (calado) e a TV recebe a fila nova.
 */
import { getTransport, setCastTransportDecorator, type TransportActions } from "@/contracts/transport";
import type { Song } from "@/domain/song";
import * as ops from "@/player/queueOps";
import { playerStore } from "@/player/store";
import type { RemoteEngine } from "@/remote/localPlayer";
import { castPositionNow, castStore, initialCastState } from "./store";
import type { CastDriver, CastItem, CastStatus } from "./types";

export interface CastSessionDeps {
  engine: RemoteEngine;
  /** Músicas -> itens com URLs assinados (register.ts: media + sign). */
  build: (songs: Song[]) => Promise<CastItem[]>;
  /** Relógio e temporizador (os testes conduzem-nos à mão). */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** Quando faltam estas músicas na janela da TV, manda-se mais. */
const REFILL_AT = 3;
const TICK_MS = 500;

let deps: CastSessionDeps | null = null;
let driver: CastDriver | null = null;
/** As chaves que a TV tem, pela ordem (fila nativa). */
let loadedKeys: string[] = [];
let loadGen = 0;
let upcomingGen = 0;
let ticker: unknown = null;

const now = (): number => (deps?.now ?? Date.now)();
const build = (songs: Song[]): Promise<CastItem[]> =>
  deps ? deps.build(songs) : Promise.reject(new Error("cast session not configured"));

const engine = (): RemoteEngine => {
  if (!deps) throw new Error("cast session not configured");
  return deps.engine;
};

export const getCastDriver = (): CastDriver | null => driver;

const visibleSongs = (): { songs: Song[]; index: number } => {
  const q = engine().getQueueState();
  const songs = q.queueOrder.map((i) => q.queue[i]).filter((s): s is Song => !!s);
  return { songs, index: q.queueIndex };
};

const silenceEngine = (): void => {
  // Sempre, e não só com fonte: um setQueue começa a carregar de forma
  // assíncrona e ainda não tem fonte quando chegamos aqui; isto invalida a
  // carga (transitionGen) antes de sair som do telemóvel.
  engine().stopAndClearSource();
};

const startTicker = (): void => {
  if (ticker !== null) return;
  const set = deps?.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  ticker = set(() => {
    const s = castStore.getState();
    if (s.phase !== "connected" || !s.playing || s.buffering) return;
    const t = now();
    castStore.setState({ position: castPositionNow(s, t), positionAt: t });
  }, TICK_MS);
};

const stopTicker = (): void => {
  if (ticker === null) return;
  const clear = deps?.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  clear(ticker);
  ticker = null;
};

/** Manda à TV a fila a partir da música actual do motor. */
const loadFromEngine = async (position: number, autoplay: boolean): Promise<void> => {
  const d = driver;
  if (!d) return;
  const gen = ++loadGen;
  upcomingGen++;
  const { songs, index } = visibleSongs();
  if (!songs[index]) return;
  const window = songs.slice(index, index + Math.max(1, d.maxItems));
  castStore.setState({
    currentKey: String(songs[index]!.id),
    position,
    positionAt: now(),
    duration: songs[index]!.duration ?? 0,
    buffering: true,
    playing: autoplay,
  });
  try {
    const items = await build(window);
    if (gen !== loadGen || driver !== d) return;
    if (items.length === 0) throw new Error("nothing castable");
    loadedKeys = items.map((i) => i.key);
    const first = items[0]!.key === String(songs[index]!.id) ? position : 0;
    await d.load(items, 0, first, autoplay);
  } catch {
    if (gen !== loadGen || driver !== d) return;
    castStore.setState({ error: "load_failed", buffering: false, playing: false });
  }
};

/** Fila nativa: refaz o que vem depois da actual, sem a interromper. */
const refreshUpcoming = async (): Promise<void> => {
  const d = driver;
  if (!d || !d.nativeQueue || !d.replaceUpcoming) return;
  const gen = ++upcomingGen;
  const { songs, index } = visibleSongs();
  const current = songs[index];
  if (!current) return;
  const rest = songs.slice(index + 1, index + Math.max(1, d.maxItems));
  try {
    const items = await build(rest);
    if (gen !== upcomingGen || driver !== d) return;
    await d.replaceUpcoming(items);
    if (gen !== upcomingGen || driver !== d) return;
    loadedKeys = [String(current.id), ...items.map((i) => i.key)];
  } catch {
    // A música actual continua; a seguinte tenta outra vez quando chegar.
  }
};

/** A seguinte pelas regras do motor (repetir tudo/uma/nada). */
const advance = (cause: "user" | "ended"): void => {
  const loop = playerStore.getState().loopMode;
  if (cause === "ended" && loop === "one") {
    driver?.seek(0);
    driver?.play();
    return;
  }
  const r = ops.nextIndex(engine().getQueueState(), loop);
  if (!r) {
    castStore.setState({ playing: false, buffering: false });
    return;
  }
  if (r.restart) {
    driver?.seek(0);
    driver?.play();
    return;
  }
  engine().alignQueueIndex(r.index, 0);
  void loadFromEngine(0, true);
};

const findVisibleIndex = (key: string): number => {
  const { songs, index } = visibleSongs();
  for (let i = index; i < songs.length; i++) if (String(songs[i]!.id) === key) return i;
  for (let i = 0; i < index; i++) if (String(songs[i]!.id) === key) return i;
  return -1;
};

/** O driver diz o que a TV está a fazer. */
export const handleCastStatus = (d: CastDriver, st: CastStatus): void => {
  if (d !== driver) return;
  const s = castStore.getState();
  const patch: Partial<typeof s> = {};
  if (st.playing !== undefined) patch.playing = st.playing;
  if (st.buffering !== undefined) patch.buffering = st.buffering;
  if (st.volume !== undefined) patch.volume = st.volume;
  if (st.duration !== undefined && st.duration > 0) patch.duration = st.duration;
  if (st.position !== undefined) {
    patch.position = st.position;
    patch.positionAt = now();
  }
  const keyChanged = st.currentKey != null && st.currentKey !== s.currentKey;
  if (keyChanged) patch.currentKey = st.currentKey!;
  castStore.setState(patch);

  if (keyChanged) {
    const idx = findVisibleIndex(st.currentKey!);
    if (idx >= 0 && idx !== engine().getQueueState().queueIndex) {
      engine().alignQueueIndex(idx, st.position ?? 0);
    }
    if (d.nativeQueue) {
      const at = loadedKeys.indexOf(st.currentKey!);
      if (at >= 0 && loadedKeys.length - at - 1 < REFILL_AT) void refreshUpcoming();
    }
  }
  if (st.finished) {
    // Sem fila nativa é sempre aqui; com fila nativa só quando a janela
    // acabou antes da fila do motor.
    advance("ended");
  }
};

/** A sessão acabou do lado de lá. */
export const handleCastEnded = (d: CastDriver): void => {
  if (d !== driver) return;
  endCast({ resumeHere: false, stopTv: false });
};

/**
 * Um driver ligou-se a uma TV: ela passa a ter o som. Se o telemóvel estava
 * a tocar, a TV continua do mesmo sítio.
 */
export const attachCastDriver = (d: CastDriver, opts?: { resume?: boolean }): void => {
  if (!deps) return;
  if (driver && driver !== d) endCast({ resumeHere: false, stopTv: true });
  driver = d;
  const local = playerStore.getState();
  const position = local.position;
  silenceEngine();
  castStore.setState({
    phase: "connected",
    kind: d.kind,
    deviceName: d.deviceName,
    error: null,
    volume: local.volume,
  });
  startTicker();
  // Voltar a uma sessão que já tocava (recarregar a página): a TV manda,
  // só a seguimos; o motor alinha pela música que ela disser.
  if (opts?.resume) return;
  void loadFromEngine(position, true);
};

/** Mostrar "a ligar a…" enquanto o driver negoceia. */
export const markCastConnecting = (kind: CastDriver["kind"], deviceName: string | null): void => {
  if (driver) return;
  castStore.setState({ phase: "connecting", kind, deviceName, error: null });
};

export const markCastConnectFailed = (): void => {
  if (driver) return;
  castStore.setState({ phase: "idle", kind: null, deviceName: null, error: "connect_failed" });
};

/**
 * Acabar. `resumeHere`: o som volta para este aparelho (Tocar aqui), do
 * sítio onde a TV ia; senão fica em pausa cá. `stopTv`: parar a TV.
 */
export const endCast = (opts: { resumeHere: boolean; stopTv: boolean }): void => {
  const d = driver;
  if (!d && castStore.getState().phase === "idle") return;
  driver = null;
  loadGen++;
  upcomingGen++;
  loadedKeys = [];
  stopTicker();
  const s = castStore.getState();
  const position = castPositionNow(s, now());
  const wasPlaying = s.playing;
  try {
    d?.end(opts.stopTv);
  } catch {
    // A TV já não responde; cá continua igual.
  }
  const { targets, chromecastAvailable, airplayAvailable, airplayRoute } = s;
  castStore.setState({
    ...initialCastState,
    targets,
    chromecastAvailable,
    airplayAvailable,
    airplayRoute,
  });
  if (deps) {
    const q = engine().getQueueState();
    engine().alignQueueIndex(q.queueIndex, position);
    if (opts.resumeHere && wasPlaying) getTransport().play();
  }
};

const casting = (): CastDriver | null =>
  driver && castStore.getState().phase === "connected" ? driver : null;

export const createCastTransportDecorator =
  () =>
  (inner: TransportActions): TransportActions => {
    /** Mexeu na fila: o motor fica calado e a TV recebe a fila nova. */
    const queueReplaced = (): void => {
      silenceEngine();
      void loadFromEngine(0, true);
    };
    const queueEdited = (): void => {
      const d = casting();
      if (!d) return;
      const key = castStore.getState().currentKey;
      const current = engine().getCurrentSong();
      silenceEngine();
      if (current && String(current.id) !== key) {
        // A fila estava vazia, ou a actual saiu: carregar do zero.
        void loadFromEngine(0, true);
      } else {
        void refreshUpcoming();
      }
    };
    const optimistic = (patch: Partial<ReturnType<typeof castStore.getState>>): void => {
      castStore.setState(patch);
    };

    return {
      ...inner,
      play: () => {
        const d = casting();
        if (!d) return inner.play();
        optimistic({ playing: true, positionAt: now() });
        d.play();
      },
      pause: () => {
        const d = casting();
        if (!d) return inner.pause();
        const s = castStore.getState();
        optimistic({ playing: false, position: castPositionNow(s, now()), positionAt: now() });
        d.pause();
      },
      toggle: () => {
        const d = casting();
        if (!d) return inner.toggle();
        const s = castStore.getState();
        if (s.playing) {
          optimistic({ playing: false, position: castPositionNow(s, now()), positionAt: now() });
          d.pause();
        } else {
          optimistic({ playing: true, positionAt: now() });
          d.play();
        }
      },
      seek: (seconds: number) => {
        const d = casting();
        if (!d) return inner.seek(seconds);
        const target = Math.max(0, seconds);
        optimistic({ position: target, positionAt: now() });
        d.seek(target);
      },
      next: () => {
        const d = casting();
        if (!d) return inner.next();
        const key = castStore.getState().currentKey;
        const at = key ? loadedKeys.indexOf(key) : -1;
        const loop = playerStore.getState().loopMode;
        if (d.nativeQueue && d.next && at >= 0 && at < loadedKeys.length - 1 && loop !== "one") {
          d.next();
        } else {
          advance("user");
        }
      },
      previous: () => {
        const d = casting();
        if (!d) return inner.previous();
        const s = castStore.getState();
        const loop = playerStore.getState().loopMode;
        const r = ops.previousIndex(engine().getQueueState(), loop, castPositionNow(s, now()));
        if (r.restart) {
          optimistic({ position: 0, positionAt: now() });
          d.seek(0);
          return;
        }
        engine().alignQueueIndex(r.index, 0);
        void loadFromEngine(0, true);
      },
      setVolume: (volume: number) => {
        const d = casting();
        if (!d) return inner.setVolume(volume);
        const v = Math.min(1, Math.max(0, volume));
        optimistic({ volume: v });
        d.setVolume(v);
      },
      setQueueIndex: (visibleIndex: number) => {
        inner.setQueueIndex(visibleIndex);
        if (casting()) queueReplaced();
      },
      setQueue: (songs, startIndex, opts) => {
        inner.setQueue(songs, startIndex, opts);
        if (casting()) queueReplaced();
      },
      addToQueue: (song: Song) => {
        inner.addToQueue(song);
        queueEdited();
      },
      playNext: (song: Song) => {
        inner.playNext(song);
        queueEdited();
      },
      removeFromQueue: (visibleIndex: number) => {
        inner.removeFromQueue(visibleIndex);
        queueEdited();
      },
      reorderQueue: (fromVisible: number, toVisible: number) => {
        inner.reorderQueue(fromVisible, toVisible);
        queueEdited();
      },
      setShuffle: (on: boolean) => {
        inner.setShuffle(on);
        queueEdited();
      },
      warm: (song: Song) => {
        if (casting()) return;
        inner.warm?.(song);
      },
    };
  };

/**
 * Os comandos de OUTROS aparelhos (remote/commands.ts) vão direitos ao
 * motor. Enquanto a TV toca, estes passam pelo transporte, senão um "play"
 * vindo do computador punha o telemóvel a tocar por cima da TV.
 */
const ROUTED = new Set<string>([
  "play",
  "pause",
  "toggle",
  "playFromIdle",
  "seek",
  "next",
  "previous",
  "setVolume",
  "setQueueIndex",
  "addToQueue",
  "playNext",
  "removeFromQueue",
  "reorderQueue",
  "setShuffle",
]);

export const castAwareEngine = <E extends object>(target: E): E =>
  new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && ROUTED.has(prop)) {
        return (...args: unknown[]) => {
          if (!casting()) return (value as (...a: unknown[]) => unknown).apply(t, args);
          const transport = getTransport() as unknown as Record<string, (...a: unknown[]) => unknown>;
          const name = prop === "playFromIdle" ? "play" : prop;
          return transport[name]!(...args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(t);
    },
  });

let configured = false;

/** Uma vez, no arranque (src/cast/register.ts). */
export const configureCastSession = (d: CastSessionDeps): void => {
  deps = d;
  if (configured) return;
  configured = true;
  setCastTransportDecorator(createCastTransportDecorator());
};

/** Testes. */
export const resetCastSessionForTests = (): void => {
  driver = null;
  loadedKeys = [];
  loadGen++;
  upcomingGen++;
  stopTicker();
  castStore.setState({ ...initialCastState });
};
