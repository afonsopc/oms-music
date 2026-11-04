/**
 * O relógio da letra ligado à reprodução (LyricClock, viz/clock.ts): lê a
 * vista da reprodução fora do React e devolve uma função estável com o
 * instante que se ouve agora, já com o atraso da letra deste aparelho.
 */
import { useCallback, useEffect, useRef } from "react";
import { getPlaybackView, subscribePlaybackView } from "@/remote/mirror";
import { LyricClock } from "../../viz/clock";
import { useLyricsDelay } from "./delay";

export const readView = (clock: LyricClock, now: number): void => {
  const v = getPlaybackView();
  clock.read(
    { position: v.position, playing: v.playing, rate: v.rate, duration: v.duration, key: String(v.song?.id ?? "") },
    now,
  );
};

export const useLyricClock = (): (() => number) => {
  const clock = useRef<LyricClock | null>(null);
  if (clock.current === null) clock.current = new LyricClock();
  const delay = useLyricsDelay((s) => s.ms);
  useEffect(() => {
    if (clock.current) clock.current.delayMs = delay;
  }, [delay]);
  useEffect(() => {
    const c = clock.current as LyricClock;
    readView(c, Date.now());
    return subscribePlaybackView(() => readView(c, Date.now()));
  }, []);
  return useCallback(() => (clock.current as LyricClock).now(Date.now()), []);
};
