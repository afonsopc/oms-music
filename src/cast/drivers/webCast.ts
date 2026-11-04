/**
 * Chromecast na web (Chrome, Edge; o Brave só com o Cast ligado nas
 * definições dele). O SDK de emissor do Google carrega-se à primeira vez
 * que a lista Transmitir abre; a lista de TVs é a do próprio Chrome
 * (requestSession abre-a), a web não as pode enumerar.
 *
 * A fila vai inteira (uma janela de CHROMECAST_WINDOW) com queueLoad: a TV
 * passa de música sozinha, mesmo com o separador fechado.
 */
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
import type { CastDriver, CastItem } from "../types";

type Any = any;

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

let sdkPromise: Promise<boolean> | null = null;
let wired = false;

const w = (): Any => globalThis as Any;

/** Só os browsers com o Cast (Chromium) carregam o SDK; o Safari não. */
export const webCastSupported = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if ((globalThis as Any).__TAURI__) return false;
  // O window.chrome é dos Chromium (Chrome, Edge, Brave, Opera); o Safari e
  // o Firefox não o têm, e o SDK do Cast não funciona neles.
  return !!(globalThis as Any).chrome && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
};

const loadSdk = (): Promise<boolean> => {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<boolean>((resolve) => {
    if (!webCastSupported()) return resolve(false);
    if (w().cast?.framework) return resolve(true);
    const timer = setTimeout(() => resolve(false), 15000);
    w().__onGCastApiAvailable = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok && !!w().cast?.framework);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
};

const toMediaInfo = (item: CastItem): Any => {
  const { chrome } = w();
  const info = new chrome.cast.media.MediaInfo(item.url, item.contentType);
  info.streamType = chrome.cast.media.StreamType.BUFFERED;
  if (item.duration > 0) info.duration = item.duration;
  const md = new chrome.cast.media.MusicTrackMediaMetadata();
  md.title = item.title;
  md.artist = item.artist;
  if (item.album) md.albumName = item.album;
  md.images = item.artworkUrl ? [new chrome.cast.Image(item.artworkUrl)] : [];
  info.metadata = md;
  info.customData = { ...(item.custom ?? {}), key: item.key };
  return info;
};

const toQueueItem = (item: CastItem, startTime = 0): Any => {
  const { chrome } = w();
  const q = new chrome.cast.media.QueueItem(toMediaInfo(item));
  q.autoplay = true;
  q.preloadTime = 15;
  if (startTime > 0) q.startTime = startTime;
  return q;
};

const keyOfMedia = (m: Any): string | null => {
  if (!m) return null;
  const item = (m.items as Any[] | undefined)?.find((i) => i.itemId === m.currentItemId);
  const key = item?.media?.customData?.key ?? m.media?.customData?.key;
  return typeof key === "string" ? key : null;
};

class WebCastDriver implements CastDriver {
  readonly kind = "chromecast" as const;
  readonly nativeQueue = true;
  readonly maxItems = CHROMECAST_WINDOW;
  private media: Any = null;
  private ended = false;

  constructor(
    private readonly castSession: Any,
    readonly deviceName: string,
  ) {}

  private sessionObj(): Any {
    return this.castSession.getSessionObj();
  }

  /** O Media da sessão (o nosso, ou o que já lá estava ao voltar à página). */
  currentMedia(): Any {
    return this.castSession.getMediaSession?.() ?? this.media;
  }

  bindMedia(m: Any): void {
    if (!m || m === this.media) return;
    this.media = m;
    m.addUpdateListener((alive: boolean) => {
      if (this.ended) return;
      if (!alive) return;
      this.report();
    });
    this.report();
  }

  report(): void {
    const m = this.currentMedia();
    if (!m) return;
    const { chrome } = w();
    const PS = chrome.cast.media.PlayerState;
    const state = m.playerState;
    const finished = state === PS.IDLE && m.idleReason === chrome.cast.media.IdleReason.FINISHED;
    handleCastStatus(this, {
      playing: state === PS.PLAYING || state === PS.BUFFERING,
      buffering: state === PS.BUFFERING,
      position: typeof m.getEstimatedTime === "function" ? m.getEstimatedTime() : m.currentTime,
      duration: m.media?.duration ?? undefined,
      currentKey: keyOfMedia(m),
      volume: typeof m.volume?.level === "number" ? m.volume.level : undefined,
      finished,
    });
  }

  load(items: CastItem[], startIndex: number, position: number, autoplay: boolean): Promise<void> {
    const { chrome } = w();
    return new Promise((resolve, reject) => {
      const queueItems = items.map((item, i) => toQueueItem(item, i === startIndex ? position : 0));
      const req = new chrome.cast.media.QueueLoadRequest(queueItems);
      req.startIndex = startIndex;
      req.repeatMode = chrome.cast.media.RepeatMode.OFF;
      if (!autoplay) queueItems[startIndex].autoplay = false;
      this.sessionObj().queueLoad(
        req,
        (m: Any) => {
          this.bindMedia(m);
          resolve();
        },
        (e: unknown) => reject(e),
      );
    });
  }

  async replaceUpcoming(items: CastItem[]): Promise<void> {
    const m = this.currentMedia();
    if (!m) return;
    const { chrome } = w();
    const list = (m.items as Any[] | undefined) ?? [];
    const at = list.findIndex((i) => i.itemId === m.currentItemId);
    const after = at >= 0 ? list.slice(at + 1).map((i) => i.itemId) : [];
    if (after.length > 0) {
      await new Promise<void>((resolve, reject) =>
        m.queueRemoveItems(new chrome.cast.media.QueueRemoveItemsRequest(after), resolve, reject),
      );
    }
    if (items.length > 0) {
      await new Promise<void>((resolve, reject) =>
        m.queueInsertItems(
          new chrome.cast.media.QueueInsertItemsRequest(items.map((i) => toQueueItem(i))),
          resolve,
          reject,
        ),
      );
    }
  }

  play(): void {
    this.currentMedia()?.play(null, () => this.report(), () => undefined);
  }

  pause(): void {
    this.currentMedia()?.pause(null, () => this.report(), () => undefined);
  }

  seek(seconds: number): void {
    const { chrome } = w();
    const req = new chrome.cast.media.SeekRequest();
    req.currentTime = seconds;
    this.currentMedia()?.seek(req, () => this.report(), () => undefined);
  }

  next(): void {
    this.currentMedia()?.queueNext(() => this.report(), () => undefined);
  }

  previous(): void {
    this.currentMedia()?.queuePrev(() => this.report(), () => undefined);
  }

  setVolume(volume: number): void {
    void this.castSession.setVolume(volume)?.catch?.(() => undefined);
  }

  end(stopTv: boolean): void {
    this.ended = true;
    try {
      w().cast.framework.CastContext.getInstance().endCurrentSession(stopTv);
    } catch {
      // já não há sessão
    }
  }
}

let current: WebCastDriver | null = null;

const onSessionStarted = (): void => {
  const context = w().cast.framework.CastContext.getInstance();
  const session = context.getCurrentSession();
  if (!session) return;
  const name = session.getCastDevice?.()?.friendlyName ?? "Chromecast";
  const driver = new WebCastDriver(session, name);
  current = driver;
  attachCastDriver(driver);
};

/** Ao voltar a uma sessão que já estava (recarregar a página): só segue a TV. */
const onSessionResumed = (): void => {
  const context = w().cast.framework.CastContext.getInstance();
  const session = context.getCurrentSession();
  if (!session) return;
  const name = session.getCastDevice?.()?.friendlyName ?? "Chromecast";
  const driver = new WebCastDriver(session, name);
  current = driver;
  attachCastDriver(driver, { resume: true });
  const m = driver.currentMedia();
  if (m) driver.bindMedia(m);
};

const wire = (): void => {
  if (wired) return;
  wired = true;
  const { cast, chrome } = w();
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: CAST_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  const syncAvailability = (): void => {
    const state = context.getCastState();
    castStore.setState({ chromecastAvailable: state !== cast.framework.CastState.NO_DEVICES_AVAILABLE });
  };
  context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, syncAvailability);
  syncAvailability();
  context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e: Any) => {
    const S = cast.framework.SessionState;
    if (e.sessionState === S.SESSION_STARTING) markCastConnecting("chromecast", null);
    else if (e.sessionState === S.SESSION_STARTED) onSessionStarted();
    else if (e.sessionState === S.SESSION_RESUMED) onSessionResumed();
    else if (e.sessionState === S.SESSION_START_FAILED) markCastConnectFailed();
    else if (e.sessionState === S.SESSION_ENDED) {
      const d = current;
      current = null;
      if (d && getCastDriver() === d) handleCastEnded(d);
    }
  });
  const player = new cast.framework.RemotePlayer();
  const controller = new cast.framework.RemotePlayerController(player);
  controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, () => {
    const d = current;
    if (!d || getCastDriver() !== d) return;
    const m = d.currentMedia();
    if (m) d.bindMedia(m);
    d.report();
  });
};

/** Carrega o SDK (uma vez) e começa a seguir a disponibilidade. */
export const initWebCast = async (): Promise<boolean> => {
  const ok = await loadSdk();
  if (ok) wire();
  return ok;
};

/** Abre a lista do Chrome; a sessão chega pelos eventos acima. */
export const requestWebCastSession = async (): Promise<void> => {
  const ok = await initWebCast();
  if (!ok) {
    markCastConnectFailed();
    return;
  }
  try {
    await w().cast.framework.CastContext.getInstance().requestSession();
  } catch (e) {
    // "cancel" é a pessoa a fechar a lista: não é erro.
    if (e !== "cancel" && castStore.getState().phase === "connecting") markCastConnectFailed();
    else if (castStore.getState().phase === "connecting") castStore.setState({ phase: "idle", kind: null });
  }
};
