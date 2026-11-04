/**
 * Se a superfície do leitor está à vista. Dentro da folha do telemóvel só
 * está com ela aberta; noutro sítio qualquer (rota, painel do computador),
 * sempre. Os ouvintes da posição usam isto para não redesenharem às
 * escondidas.
 */
import { createContext, useContext } from "react";
import { useSheetStore } from "./sheetStore";

export const InSheetContext = createContext(false);

export const usePlayerSurfaceLive = (): boolean => {
  const inSheet = useContext(InSheetContext);
  const open = useSheetStore((s) => s.open);
  return !inSheet || open;
};
