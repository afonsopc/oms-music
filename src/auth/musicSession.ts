/**
 * As sessões da própria app de música (login pelo id no cliente "OMS Music",
 * token `omsm_…`, cookie `oms_music_session` na web) e a passagem, sem login,
 * de quem ainda tem a sessão antiga do omelhorsite.
 *
 *  - nativo: um token guardado que não é `omsm_` troca-se no arranque
 *    (POST /music/auth/exchange) pelo da música, com o mesmo id de sessão;
 *  - web: a troca faz-se uma vez por browser (marca em localStorage). Depois
 *    disso só uma sessão da música conta: o cookie antigo do omelhorsite.pt,
 *    se ainda existir, já não volta a entrar depois de "Sair".
 */
import { Platform } from "react-native";

export const MUSIC_TOKEN_PREFIX = "omsm_";
const WEB_MIGRATED_KEY = "oms-music.music-session";

export const isMusicToken = (token: string | null | undefined): boolean =>
  typeof token === "string" && token.startsWith(MUSIC_TOKEN_PREFIX);

export const webMigrated = (): boolean => {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WEB_MIGRATED_KEY) === "1";
  } catch {
    return false;
  }
};

export const markWebMigrated = (): void => {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WEB_MIGRATED_KEY, "1");
  } catch {
    // Sem localStorage a troca só se repete no próximo arranque.
  }
};
