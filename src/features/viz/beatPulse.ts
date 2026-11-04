/**
 * Um pulso nas batidas da música, para a app (o mini-leitor brilha com
 * elas). Sem trabalho por frame: um setTimeout para a próxima batida, a
 * partir da análise (GET /songs/:id/analysis) e da posição medida; a
 * animação corre no driver nativo. Mais forte no primeiro tempo do compasso.
 * Parado com a música em pausa, sem análise, ou com "reduzir movimento".
 */
import { useEffect, useState } from "react";
import { Animated, Platform } from "react-native";
import { subscribePlaybackView, usePlaybackView } from "@/remote/mirror";
import { useReducedMotion } from "@/ui/motion";
import { useSongAnalysis } from "./analysis";
import { estimatedPosition, noteTick } from "./vizMessages";

const nextIndex = (beats: number[], ms: number): number => {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export const useBeatPulse = (enabled = true): Animated.Value => {
  const [pulse] = useState(() => new Animated.Value(0));
  const songId = usePlaybackView((v) => (v.song ? String(v.song.id) : null));
  const playing = usePlaybackView((v) => v.playing);
  const reduceMotion = useReducedMotion();
  const analysis = useSongAnalysis(songId, enabled && !reduceMotion);
  const beats = analysis.data?.status === "ready" ? analysis.data.data.beats : null;

  useEffect(() => {
    if (!enabled || reduceMotion || !playing || !beats || beats.length === 0) return;
    const unsub = subscribePlaybackView(noteTick);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const native = Platform.OS !== "web";
    const schedule = () => {
      const now = estimatedPosition() * 1000;
      const i = nextIndex(beats, now + 15);
      if (i >= beats.length) return;
      timer = setTimeout(() => {
        const strong = i % 4 === 0;
        Animated.sequence([
          Animated.timing(pulse, { toValue: strong ? 1 : 0.55, duration: 40, useNativeDriver: native }),
          Animated.timing(pulse, { toValue: 0, duration: strong ? 380 : 240, useNativeDriver: native }),
        ]).start();
        schedule();
      }, Math.max(0, beats[i] - now));
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      pulse.setValue(0);
    };
  }, [enabled, reduceMotion, playing, beats, pulse]);

  return pulse;
};
