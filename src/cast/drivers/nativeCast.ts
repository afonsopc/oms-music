/**
 * Chromecast em iOS e Android (react-native-google-cast, o SDK do Google).
 * As TVs aparecem na lista Transmitir pela descoberta do SDK; a fila vai
 * para a TV (loadMedia com queueData) e a TV passa de música sozinha, com o
 * telemóvel bloqueado ou a app fechada. No Android o SDK põe a notificação
 * de controlo e o volume pelos botões; no iOS os botões de volume também.
 *
 * O módulo nativo é opcional: um binário sem ele (Expo Go, build antigo)
 * simplesmente não mostra Chromecasts.
 */
import { NativeModules } from "react-native";
import { CAST_RECEIVER_APP_ID, CHROMECAST_WINDOW } from "../config";
import {
  attachCastDriver,
  getCastDriver,
  handleCastEnded,
  handleCastStatus,
  markCastConnectFailed,
  markCastConnecting,
} from "../session";
import { castStore } from "../store";
import type { CastDriver, CastItem, CastTarget } from "../types";

type GC = typeof import("react-native-google-cast");

let lib: GC | null | undefined;

const gc = (): GC | null => {
  if (lib !== undefined) return lib;
  if (!NativeModules.RNGCCastContext) {
    lib = null;
    return lib;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("react-native-google-cast") as GC;
  } catch {
    lib = null;
  }
  return lib;
};

export const nativeCastSupported = (): boolean => gc() !== null;

const toQueueItem = (item: CastItem, startTime = 0): any => ({
  autoplay: true,
  preloadTime: 15,
  ...(startTime > 0 ? { startTime } : {}),
  mediaInfo: {
    contentUrl: item.url,
    contentType: item.contentType,
    streamType: "buffered",
    ...(item.duration > 0 ? { streamDuration: item.duration } : {}),
    customData: { ...(item.custom ?? {}), key: item.key },
    metadata: {
      type: "musicTrack",
      title: item.title,
      artist: item.artist,
      ...(item.album ? { albumTitle: item.album } : {}),
      images: item.artworkUrl ? [{ url: item.artworkUrl }] : [],
    },
  },
});

const keyOf = (status: any): string | null => {
  const items: any[] = status?.queueItems ?? [];
  const current = items.find((i) => i.itemId === status?.currentItemId);
  const key = current?.mediaInfo?.customData?.key ?? status?.mediaInfo?.customData?.key;
  return typeof key === "string" ? key : null;
};

class NativeCastDriver implements CastDriver {
  readonly kind = "chromecast" as const;
  readonly nativeQueue = true;
  readonly maxItems = CHROMECAST_WINDOW;
  private subs: { remove(): void }[] = [];
  private ended = false;
  /** Itens que mandámos, para saber se um reabastecimento só acrescenta. */
  private sent: CastItem[] = [];

  constructor(
    private readonly session: any,
    readonly deviceName: string,
  ) {
    const client = session.client ?? session.getClient?.();
    this.subs.push(
      client.onMediaStatusUpdated((status: any) => this.report(status)),
      client.onMediaProgressUpdated((progress: number, duration: number) => {
        if (this.ended) return;
        handleCastStatus(this, { position: progress, ...(duration > 0 ? { duration } : {}) });
      }, 1),
    );
  }

  private client(): any {
    return this.session.client ?? this.session.getClient?.();
  }

  private report(status: any): void {
    if (this.ended || !status) return;
    const state = status.playerState;
    handleCastStatus(this, {
      playing: state === "playing" || state === "buffering" || state === "loading",
      buffering: state === "buffering" || state === "loading",
      position: typeof status.streamPosition === "number" ? status.streamPosition : undefined,
      duration: status.mediaInfo?.streamDuration ?? undefined,
      currentKey: keyOf(status),
      volume: typeof status.volume === "number" ? status.volume : undefined,
      finished: state === "idle" && status.idleReason === "finished",
    });
  }

  async load(items: CastItem[], startIndex: number, position: number, autoplay: boolean): Promise<void> {
    this.sent = items;
    await this.client().loadMedia({
      autoplay,
      queueData: {
        items: items.map((item, i) => toQueueItem(item, i === startIndex ? position : 0)),
        startIndex,
        repeatMode: "off",
      },
    });
  }

  async replaceUpcoming(items: CastItem[]): Promise<void> {
    const status = await this.client().getMediaStatus();
    const currentKey = keyOf(status);
    const at = this.sent.findIndex((i) => i.key === currentKey);
    const upcoming = at >= 0 ? this.sent.slice(at + 1) : [];
    const isPrefix = upcoming.every((u, i) => items[i]?.key === u.key);
    if (at >= 0 && isPrefix) {
      const extra = items.slice(upcoming.length);
      if (extra.length > 0) await this.client().queueInsertItems(extra.map((i) => toQueueItem(i)));
      this.sent = [...this.sent, ...extra];
      return;
    }
    // A fila mudou a meio (tocar a seguir, reordenar, tirar): este SDK não
    // tira itens da fila da TV, por isso volta a carregar a actual no sítio
    // onde ia, com a fila nova atrás. Um soluço de um segundo.
    const current = at >= 0 ? this.sent[at] : null;
    if (!current) return;
    const position = (await this.client().getStreamPosition()) ?? 0;
    await this.load([current, ...items], 0, position, status?.playerState !== "paused");
  }

  play(): void {
    void this.client().play().catch(() => undefined);
  }

  pause(): void {
    void this.client().pause().catch(() => undefined);
  }

  seek(seconds: number): void {
    void this.client().seek({ position: seconds }).catch(() => undefined);
  }

  next(): void {
    void this.client().queueNext().catch(() => undefined);
  }

  previous(): void {
    void this.client().queuePrev().catch(() => undefined);
  }

  setVolume(volume: number): void {
    try {
      this.session.setVolume(volume);
    } catch {
      // sem volume remoto (grupos de colunas, por exemplo)
    }
  }

  end(stopTv: boolean): void {
    this.ended = true;
    for (const s of this.subs) s.remove();
    this.subs = [];
    void gc()?.default.getSessionManager().endCurrentSession(stopTv).catch(() => undefined);
  }
}

let wired = false;
let current: NativeCastDriver | null = null;

const attach = async (session: any, resume: boolean): Promise<void> => {
  let name = "Chromecast";
  try {
    const device = await session.getCastDevice();
    if (device?.friendlyName) name = device.friendlyName;
  } catch {
    // fica "Chromecast"
  }
  const driver = new NativeCastDriver(session, name);
  current = driver;
  attachCastDriver(driver, { resume });
};

const toTargets = (devices: any[]): CastTarget[] =>
  devices.map((d) => ({
    id: `cc:${d.deviceId}`,
    kind: "chromecast" as const,
    name: d.friendlyName || d.modelName || "Chromecast",
    detail: d.modelName ?? null,
  }));

const setChromecastTargets = (targets: CastTarget[]): void => {
  const others = castStore.getState().targets.filter((t) => t.kind !== "chromecast");
  castStore.setState({ targets: [...others, ...targets], chromecastAvailable: targets.length > 0 });
};

export const initNativeCast = (): void => {
  const g = gc();
  if (!g || wired) return;
  wired = true;
  void CAST_RECEIVER_APP_ID; // o id vai no build (plugin em app.config.js)
  const sessions = g.default.getSessionManager();
  sessions.onSessionStarting(() => markCastConnecting("chromecast", null));
  sessions.onSessionStarted((s: any) => void attach(s, false));
  sessions.onSessionResumed((s: any) => void attach(s, true));
  sessions.onSessionStartFailed(() => markCastConnectFailed());
  sessions.onSessionEnded(() => {
    const d = current;
    current = null;
    if (d && getCastDriver() === d) handleCastEnded(d);
  });
  const discovery = g.default.getDiscoveryManager();
  discovery.onDevicesUpdated((devices: any[]) => setChromecastTargets(toTargets(devices)));
  // Uma sessão que já existia (a app foi morta com a TV a tocar).
  void sessions
    .getCurrentCastSession()
    .then((s: any) => {
      if (s && !current) void attach(s, true);
    })
    .catch(() => undefined);
};

/** A lista Transmitir abriu: procurar TVs enquanto está aberta. */
export const startNativeCastDiscovery = (): (() => void) => {
  const g = gc();
  if (!g) return () => undefined;
  const discovery = g.default.getDiscoveryManager();
  void discovery.startDiscovery().catch(() => undefined);
  void discovery
    .getDevices()
    .then((devices: any[]) => setChromecastTargets(toTargets(devices)))
    .catch(() => undefined);
  return () => undefined;
};

export const startNativeCastSession = async (target: CastTarget): Promise<void> => {
  const g = gc();
  if (!g) return;
  markCastConnecting("chromecast", target.name);
  try {
    const ok = await g.default.getSessionManager().startSession(target.id.replace(/^cc:/, ""));
    if (!ok) markCastConnectFailed();
  } catch {
    markCastConnectFailed();
  }
};
