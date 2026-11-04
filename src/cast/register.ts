/**
 * Arranque do transmitir (boot/wireup.ts): a sessão por cima do transporte,
 * os drivers de cada plataforma e as regras de convivência com o resto -
 * outro aparelho a ficar com o som acaba a transmissão, sair da conta
 * também, e no iOS a rota AirPlay actual vai para o store.
 */
import { Platform } from "react-native";
import { registerLogoutTask } from "@/auth/session";
import { getPlayerEngine } from "@/player/register";
import { remoteStore } from "@/remote/store";
import { currentAudioRoute, isAirPlayPickerAvailable, onAudioRouteChange, type AudioRoute } from "../../modules/oms-native";
import { airplayWebSupported, initAirplayWeb } from "./airplayWeb";
import { dlnaSupported } from "./drivers/dlna";
import { initNativeCast, nativeCastSupported } from "./drivers/nativeCast";
import { initWebCast, webCastSupported } from "./drivers/webCast";
import { API_BASE_URL } from "@/api/oms";
import { usesCustomReceiver } from "./config";
import { buildCastItems } from "./media";
import { configureCastSession, endCast } from "./session";
import { signMediaIds } from "./sign";
import { castStore, isCasting } from "./store";

let registered = false;

const routeLabel = (route: AudioRoute | null): string | null =>
  route && route.kind === "airplay" ? route.name || "AirPlay" : null;

export const registerCast = (): void => {
  if (registered) return;
  registered = true;
  configureCastSession({
    engine: getPlayerEngine(),
    build: (songs) =>
      buildCastItems(songs, signMediaIds, usesCustomReceiver() ? { api: API_BASE_URL } : undefined),
  });

  if (Platform.OS === "web") {
    if (webCastSupported()) {
      // Sem pressa: o SDK do Google só vem quando o resto já está de pé.
      setTimeout(() => void initWebCast(), 3000);
    }
    if (airplayWebSupported()) initAirplayWeb();
  } else if (nativeCastSupported()) {
    initNativeCast();
  }

  if (Platform.OS === "ios" && isAirPlayPickerAvailable()) {
    castStore.setState({ airplayAvailable: true, airplayRoute: routeLabel(currentAudioRoute()) });
    onAudioRouteChange((route) => castStore.setState({ airplayRoute: routeLabel(route) }));
  }

  // Outro aparelho ficou com o som: a TV pára (senão tocavam os dois).
  remoteStore.subscribe((s, prev) => {
    if (s.role === "controller" && prev.role !== "controller" && isCasting()) {
      endCast({ resumeHere: false, stopTv: true });
    }
  });

  registerLogoutTask(() => endCast({ resumeHere: false, stopTv: true }));
};

/** O que esta plataforma sabe fazer (para a lista Transmitir). */
export const castCapabilities = () => ({
  chromecast: Platform.OS === "web" ? webCastSupported() : nativeCastSupported(),
  chromecastNativeList: Platform.OS !== "web" && nativeCastSupported(),
  airplay: Platform.OS === "ios" ? isAirPlayPickerAvailable() : airplayWebSupported(),
  dlna: dlnaSupported(),
});
