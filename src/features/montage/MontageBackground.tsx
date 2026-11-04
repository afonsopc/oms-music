/**
 * Sempre montado no visualizador (montageSlot, `Background`): com a Montagem
 * ligada e uma montagem para esta música, põe o vídeo em vez da cena; sem
 * ela, devolve a cena. É isto que faz uma montagem guardada voltar a tocar.
 */
import React, { useEffect } from "react";
import type { MontageBackgroundProps } from "../viz/montageSlot";
import { MontageLayer } from "./MontageLayer";
import { useCurrentMontage } from "./useCurrentMontage";

const layer = <MontageLayer />;

export const MontageBackground = ({ setVideoLayer }: MontageBackgroundProps) => {
  const { spec, on } = useCurrentMontage();
  const active = on && !!spec;
  useEffect(() => {
    setVideoLayer(active ? layer : null, "instead");
  }, [active, setVideoLayer]);
  useEffect(() => () => setVideoLayer(null), [setVideoLayer]);
  return null;
};
