/**
 * A jam como FOLHA, ao lado das definicoes de reproducao (pedido do dono
 * 2026-08-15). Antes o botao da jam fazia dismissAll + push: saia do player
 * inteiro para abrir um ecra, e voltar era um gesto extra - para uma coisa
 * que so faz sentido enquanto se ouve.
 *
 * A rota /jam continua a existir (links, web, notificacoes); esta folha
 * monta o MESMO ecra em modo embebido, sem os espacamentos do shell.
 */
import React from "react";
import { BottomSheet } from "@/ui";
import JamScreen from "./index";

export const JamSheet = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => (
  // scroll={false}: o JamScreen ja e um ScrollView proprio e dois encaixados
  // roubam o gesto um ao outro.
  <BottomSheet visible={visible} onClose={onClose} scroll={false} maxHeightRatio={0.85}>
    <JamScreen embedded />
  </BottomSheet>
);
