/**
 * A camada de vídeo que o visualizador mostra em vez da cena (montageSlot):
 * o motor da Montagem com a montagem da música que está a tocar.
 */
import React from "react";
import { MontageFrame } from "./MontageFrame";
import { useCurrentMontage } from "./useCurrentMontage";

export const MontageLayer = () => {
  const { spec } = useCurrentMontage();
  return <MontageFrame spec={spec} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />;
};
