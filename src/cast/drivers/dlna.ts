/**
 * TVs DLNA/UPnP no computador (desktop/src-tauri/src/dlna.rs): descoberta
 * SSDP, SetAVTransportURI e o resto por SOAP, um proxy HTTP local para as TVs
 * que não abrem HTTPS. Sem fila nativa: uma música de cada vez, e a sessão
 * manda a seguinte quando a TV diz que acabou. Pergunta o estado uma vez por
 * segundo enquanto transmite.
 */
import { getTauriGlobals } from "@/desktop/tauri";
import { attachCastDriver, getCastDriver, handleCastEnded, handleCastStatus, markCastConnectFailed, markCastConnecting } from "../session";
import { castStore } from "../store";
import type { CastDriver, CastItem, CastTarget } from "../types";

interface DlnaDevice {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
}

interface DlnaStatus {
  state: string;
  positionS: number;
  durationS: number;
  volume: number | null;
}

const invoke = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const tauri = getTauriGlobals();
  if (!tauri) return Promise.reject(new Error("no tauri"));
  return tauri.core.invoke(command, args) as Promise<T>;
};

export const dlnaSupported = (): boolean => getTauriGlobals() !== null;

const POLL_MS = 1000;
/** Erros seguidos ao perguntar o estado até se dar a TV por perdida. */
const MAX_FAILURES = 8;

class DlnaDriver implements CastDriver {
  readonly kind = "dlna" as const;
  readonly nativeQueue = false;
  readonly maxItems = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;
  private wasPlaying = false;
  private lastPosition = 0;
  private lastDuration = 0;
  private failures = 0;
  private currentKey: string | null = null;
  private ended = false;

  constructor(
    readonly id: string,
    readonly deviceName: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  private async poll(): Promise<void> {
    if (this.ended || this.loading) return;
    let st: DlnaStatus;
    try {
      st = await invoke<DlnaStatus>("dlna_status", { id: this.id });
      this.failures = 0;
    } catch {
      this.failures++;
      if (this.failures >= MAX_FAILURES && getCastDriver() === this) handleCastEnded(this);
      return;
    }
    if (this.ended || this.loading) return;
    const playing = st.state === "PLAYING" || st.state === "TRANSITIONING";
    const stopped = st.state === "STOPPED" || st.state === "NO_MEDIA_PRESENT";
    const duration = st.durationS > 0 ? st.durationS : this.lastDuration;
    // Acabou: estava a tocar e parou perto do fim (ou a TV voltou ao 0).
    const finished =
      this.wasPlaying && stopped && (duration === 0 || this.lastPosition >= duration - 4);
    handleCastStatus(this, {
      playing,
      buffering: st.state === "TRANSITIONING",
      position: stopped ? this.lastPosition : st.positionS,
      ...(st.durationS > 0 ? { duration: st.durationS } : {}),
      ...(st.volume != null ? { volume: st.volume / 100 } : {}),
      currentKey: this.currentKey,
      finished,
    });
    if (stopped) this.wasPlaying = false;
    else {
      this.wasPlaying = playing || this.wasPlaying;
      this.lastPosition = st.positionS;
    }
    if (st.durationS > 0) this.lastDuration = st.durationS;
  }

  async load(items: CastItem[], startIndex: number, position: number): Promise<void> {
    const item = items[startIndex];
    if (!item) return;
    this.loading = true;
    this.currentKey = item.key;
    this.wasPlaying = false;
    this.lastPosition = position;
    this.lastDuration = item.duration;
    try {
      await invoke("dlna_load", {
        id: this.id,
        media: {
          url: item.url,
          contentType: item.contentType,
          title: item.title,
          artist: item.artist,
          album: item.album,
          artworkUrl: item.artworkUrl,
          durationS: item.duration > 0 ? item.duration : null,
        },
        positionS: position,
      });
      handleCastStatus(this, { currentKey: item.key, playing: true, buffering: true });
    } finally {
      this.loading = false;
    }
  }

  private control(action: string, value: number | null = null): void {
    void invoke("dlna_control", { id: this.id, action, value }).catch(() => undefined);
  }

  play(): void {
    this.control("play");
  }

  pause(): void {
    // Uma pausa nossa não é "acabou".
    this.wasPlaying = false;
    this.control("pause");
  }

  seek(seconds: number): void {
    this.lastPosition = seconds;
    this.control("seek", seconds);
  }

  setVolume(volume: number): void {
    this.control("volume", volume);
  }

  end(stopTv: boolean): void {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (stopTv) this.control("stop");
  }
}

const toTarget = (d: DlnaDevice): CastTarget => ({
  id: `dlna:${d.id}`,
  kind: "dlna",
  name: d.name,
  detail: [d.manufacturer, d.model].filter(Boolean).join(" ") || null,
});

let discovering = false;

/** Procura TVs (2,5 s) e põe-nas na lista. */
export const discoverDlna = async (): Promise<void> => {
  if (!dlnaSupported() || discovering) return;
  discovering = true;
  try {
    const devices = await invoke<DlnaDevice[]>("dlna_discover");
    const others = castStore.getState().targets.filter((t) => t.kind !== "dlna");
    castStore.setState({ targets: [...others, ...devices.map(toTarget)] });
  } catch {
    // sem rede local, ou um shell antigo sem DLNA
  } finally {
    discovering = false;
  }
};

export const startDlnaSession = (target: CastTarget): void => {
  markCastConnecting("dlna", target.name);
  const driver = new DlnaDriver(target.id.replace(/^dlna:/, ""), target.name);
  try {
    attachCastDriver(driver);
    driver.start();
  } catch {
    markCastConnectFailed();
  }
};
