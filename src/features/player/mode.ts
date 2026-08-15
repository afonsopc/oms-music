/**
 * Qual das TRES vistas do player esta no palco (decisao do dono 2026-08-15:
 * "como no Apple Music, ao clicar no icone de lyrics ele ainda no player,
 * substitui o artwork pelas lyrics; a scrub bar mantem-se").
 *
 * E um store de modulo e nao estado de rota: trocar de vista deixou de ser
 * navegacao. O scroll vertical do player - que empurrava para paginas
 * separadas e disputava o gesto de fechar a folha, ora fechando ora nao
 * (queixa do dono) - morreu com isto.
 *
 * As rotas /(player)/lyrics e /(player)/queue continuam a existir para links
 * directos e para a web; hoje so pousam o modo inicial neste store.
 */
import { create } from "zustand";

export type PlayerMode = "artwork" | "lyrics" | "queue";

interface PlayerModeStore {
  mode: PlayerMode;
  setMode: (mode: PlayerMode) => void;
}

export const usePlayerModeStore = create<PlayerModeStore>((set) => ({
  mode: "artwork",
  setMode: (mode) => set({ mode }),
}));

export const setPlayerMode = (mode: PlayerMode): void =>
  usePlayerModeStore.getState().setMode(mode);

/** Carregar no icone da vista ACTIVA volta a capa, como no Apple Music. */
export const togglePlayerMode = (mode: Exclude<PlayerMode, "artwork">): void => {
  const current = usePlayerModeStore.getState().mode;
  usePlayerModeStore.getState().setMode(current === mode ? "artwork" : mode);
};
