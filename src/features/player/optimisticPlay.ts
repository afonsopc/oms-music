/**
 * Play/pausa instantâneo (ronda 2): o ícone muda no toque, antes de o motor
 * responder (no telemóvel o primeiro byte pode demorar). A intenção fica
 * guardada até o estado verdadeiro a alcançar, ou 2,5 s, o que vier primeiro;
 * se o motor recusar, o ícone volta ao que é.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { getTransport } from "@/contracts/transport";
import { getPlaybackView, usePlaybackView } from "@/remote/mirror";

interface OptimisticState {
  wanted: boolean | null;
  at: number;
}

const useOptimistic = create<OptimisticState>(() => ({ wanted: null, at: 0 }));
const HOLD_MS = 2500;

export const hasOptimisticPlay = (): boolean => useOptimistic.getState().wanted !== null;

export const togglePlaybackOptimistic = (): void => {
  const { wanted } = useOptimistic.getState();
  const current = wanted ?? getPlaybackView().playing;
  useOptimistic.setState({ wanted: !current, at: Date.now() });
  getTransport().toggle();
  setTimeout(() => {
    const now = useOptimistic.getState();
    if (now.wanted !== null && Date.now() - now.at >= HOLD_MS) useOptimistic.setState({ wanted: null });
  }, HOLD_MS + 20);
};

/** O estado a mostrar: a intenção do toque, ou o verdadeiro. */
export const useShownPlaying = (): boolean => {
  const playing = usePlaybackView((v) => v.playing);
  const wanted = useOptimistic((s) => s.wanted);
  useEffect(() => {
    if (wanted !== null && wanted === playing) useOptimistic.setState({ wanted: null });
  }, [wanted, playing]);
  return wanted ?? playing;
};
