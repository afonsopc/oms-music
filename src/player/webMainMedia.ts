/**
 * O <audio> principal do leitor web, para quem precisa do elemento em si:
 * o AirPlay do Safari (src/cast/airplayWeb.ts) escolhe a saída dele.
 */
import type { WebMediaElement } from "./webAudioAdapter";

let main: WebMediaElement | null = null;
const listeners = new Set<(media: WebMediaElement) => void>();

export const setMainWebMedia = (media: WebMediaElement): void => {
  main = media;
  for (const cb of listeners) cb(media);
};

export const getMainWebMedia = (): WebMediaElement | null => main;

/** Chama já com o actual (se houver) e de cada vez que mudar. */
export const onMainWebMedia = (cb: (media: WebMediaElement) => void): (() => void) => {
  listeners.add(cb);
  if (main) cb(main);
  return () => listeners.delete(cb);
};
