/**
 * O encaixe do painel "Montagem" (edições ao estilo AMV, cortadas na batida)
 * dentro do visualizador em ecrã inteiro. O painel em si é de outro trabalho
 * (a busca dos clips, o motor da montagem e o que está lá dentro); aqui só
 * fica a porta: quem o fizer chama `registerMontagePanel` no arranque e o
 * visualizador mostra o botão "Montagem", abre a gaveta do lado e dá ao
 * painel o que ele precisa.
 *
 * Camada de vídeo: o painel pode pôr um elemento seu POR TRÁS da cena
 * ("behind": a cena fica por cima a 55 %, em modo ecrã na web) ou EM VEZ dela
 * ("instead": a cena pára e sai). `setVideoLayer(null)` devolve a cena.
 */
import type React from "react";
import { useSyncExternalStore } from "react";
import type { Song } from "@/domain/song";
import type { VizAnalysis } from "../../../viz/protocol";

export type VideoLayerMode = "behind" | "instead";

export interface MontagePanelProps {
  /** A música que está a tocar. */
  song: Song | null;
  /** A posição agora, em segundos (estimada a partir do último tique do motor). */
  getPosition: () => number;
  /** Se está a tocar. */
  playing: boolean;
  /** A análise da música (energia, faixas, batidas, BPM), ou null enquanto não há. */
  analysis: VizAnalysis | null;
  /** Pôr (ou tirar, com null) uma camada de vídeo por trás da cena ou em vez dela. */
  setVideoLayer: (layer: React.ReactNode | null, mode?: VideoLayerMode) => void;
  /** Fechar a gaveta. */
  onClose: () => void;
}

export interface MontagePanelSlot {
  /** O nome no botão da barra de cima (por omissão "Montagem"). */
  label?: string;
  Component: React.ComponentType<MontagePanelProps>;
}

let slot: MontagePanelSlot | null = null;
const listeners = new Set<() => void>();

export const registerMontagePanel = (next: MontagePanelSlot): (() => void) => {
  slot = next;
  listeners.forEach((l) => l());
  return () => {
    if (slot === next) {
      slot = null;
      listeners.forEach((l) => l());
    }
  };
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const useMontagePanel = (): MontagePanelSlot | null => useSyncExternalStore(subscribe, () => slot, () => slot);
