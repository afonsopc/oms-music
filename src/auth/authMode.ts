/**
 * Which credential this runtime presents to the API (plano F2 / 2.2).
 *
 * The decision is a single hostname test made at call time (never cached:
 * it is trivially cheap and caching would only add a boot-order hazard),
 * and every consumer - the HTTP client, the token store, the boot/verify
 * paths, the cable registrars - asks HERE so the two modes can never drift
 * apart module by module.
 */
import { Platform } from "react-native";
import { isCookieOrigin } from "./cookieOrigin";

/**
 * True when the app is a web page on the API's own site (production:
 * music.omelhorsite.pt): requests then go out with credentials "include"
 * and NO Authorization header, and the httpOnly session cookie - which this
 * code can neither read nor store - is the whole session. False everywhere
 * else, where the stored Bearer token keeps working exactly as before.
 */
export const isCookieAuth = (): boolean =>
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  isCookieOrigin(window.location?.hostname);
