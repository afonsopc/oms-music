/** Na web e no computador o Chromecast é o do SDK do browser (webCast.ts). */
import type { CastTarget } from "../types";

export const nativeCastSupported = (): boolean => false;
export const initNativeCast = (): void => undefined;
export const startNativeCastDiscovery = (): (() => void) => () => undefined;
export const startNativeCastSession = async (_target: CastTarget): Promise<void> => undefined;
