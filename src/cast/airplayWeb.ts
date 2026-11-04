/**
 * AirPlay no Safari (macOS e iOS) e no computador em macOS (WKWebView): o
 * próprio <audio> do leitor muda de saída. O leitor continua a ser este
 * aparelho - fila, lista bloqueada, teclas de media - e só o som vai para a
 * coluna ou a TV, por isso não há sessão de transmitir nem driver.
 */
import { getMainWebMedia, onMainWebMedia } from "@/player/webMainMedia";
import { castStore } from "./store";

type AirPlayElement = HTMLMediaElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

let wired = false;

export const airplayWebSupported = (): boolean =>
  typeof window !== "undefined" && !!(window as any).WebKitPlaybackTargetAvailabilityEvent;

const bind = (el: AirPlayElement): void => {
  el.setAttribute?.("x-webkit-airplay", "allow");
  el.addEventListener("webkitplaybacktargetavailabilitychanged", (e: Event) => {
    const availability = (e as Event & { availability?: string }).availability;
    castStore.setState({ airplayAvailable: availability === "available" });
  });
  el.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", () => {
    castStore.setState({ airplayRoute: el.webkitCurrentPlaybackTargetIsWireless ? "AirPlay" : null });
  });
};

export const initAirplayWeb = (): void => {
  if (wired || !airplayWebSupported()) return;
  wired = true;
  // Sem esperar pelo evento: o Safari só o manda depois de o elemento ter
  // ouvintes, e o botão deve aparecer logo (a lista do sistema diz se há).
  castStore.setState({ airplayAvailable: true });
  onMainWebMedia((media) => bind(media as unknown as AirPlayElement));
};

/** A lista de colunas/TVs do sistema; a escolha muda a saída sozinha. */
export const showAirplayPickerWeb = (): boolean => {
  const el = getMainWebMedia() as unknown as AirPlayElement | null;
  if (!el?.webkitShowPlaybackTargetPicker) return false;
  el.webkitShowPlaybackTargetPicker();
  return true;
};
