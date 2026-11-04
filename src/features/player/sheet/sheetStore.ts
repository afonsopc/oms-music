/**
 * O estado da folha do leitor no telemóvel (ronda 2): ABRIR já não é
 * navegar. A folha monta uma vez (pré-aquecida pouco depois de haver uma
 * música) e fica montada; abrir e fechar só a deslizam. Este módulo é a
 * porta para quem quer abrir/fechar (mini-leitor, karaoke, rotas antigas).
 *
 *  - `mounted`: o corpo já existe (nunca volta a false);
 *  - `open`: a folha está (ou vai ficar) aberta. Os ouvintes da posição
 *    (barra de progresso) só ouvem com ela aberta.
 */
import { create } from "zustand";

interface SheetState {
  mounted: boolean;
  open: boolean;
}

export const useSheetStore = create<SheetState>(() => ({ mounted: false, open: false }));

export interface SheetController {
  open: () => void;
  close: () => void;
}

let controller: SheetController | null = null;

export const registerSheetController = (next: SheetController): (() => void) => {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
};

/** Abre a folha. Devolve false quando não há folha (computador): quem chama navega. */
export const openPlayerSheet = (): boolean => {
  if (!controller) return false;
  controller.open();
  return true;
};

export const closePlayerSheet = (): boolean => {
  if (!controller) return false;
  controller.close();
  return true;
};

export const isPlayerSheetAvailable = (): boolean => controller !== null;

/** Marca o corpo como montado (pré-aquecimento ou primeira abertura). */
export const mountPlayerSheet = (): void => {
  if (!useSheetStore.getState().mounted) useSheetStore.setState({ mounted: true });
};

export const setPlayerSheetOpen = (open: boolean): void => {
  if (useSheetStore.getState().open !== open) useSheetStore.setState({ open, mounted: true });
};

/** O arrasto da folha pelo ponteiro (só a web o implementa). */
export interface WebSheetDrag {
  begin: () => void;
  /** Deslocamento do dedo desde o início, em px (positivo para baixo). */
  move: (dy: number) => void;
  /** Velocidade ao largar, px/s (positivo para baixo). */
  end: (velocityY: number) => void;
}
