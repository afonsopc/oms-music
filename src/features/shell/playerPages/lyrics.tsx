import React from "react";
import { setPlayerMode } from "@/features/player/mode";
import { NowPlayingScreen } from "../PlayerPager";

/**
 * A rota das letras existe para links directos e para a web. Ja nao e uma
 * pagina propria: pousa o modo no store e o player desenha as letras no
 * lugar da capa (decisao do dono 2026-08-15).
 */
export default function LyricsPage() {
  setPlayerMode("lyrics");
  return <NowPlayingScreen />;
}
