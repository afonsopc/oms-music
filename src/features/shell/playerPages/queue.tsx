import React from "react";
import { setPlayerMode } from "@/features/player/mode";
import { NowPlayingScreen } from "../PlayerPager";

/** Como a rota das letras: escolhe o modo, o player faz o resto. */
export default function QueuePage() {
  setPlayerMode("queue");
  return <NowPlayingScreen />;
}
