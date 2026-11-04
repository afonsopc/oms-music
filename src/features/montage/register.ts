/** A Montagem entra no visualizador pelo encaixe (features/viz/montageSlot.ts). */
import { registerMontagePanel } from "../viz/montageSlot";
import { MontageBackground } from "./MontageBackground";
import { MontagePanel } from "./MontagePanel";

let done = false;
export const registerMontage = (): void => {
  if (done) return;
  done = true;
  registerMontagePanel({ Component: MontagePanel, Background: MontageBackground });
};
