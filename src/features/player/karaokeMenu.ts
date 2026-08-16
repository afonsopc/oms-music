/**
 * Slot `karaoke` do menu canónico da música (contracts/songMenu), no molde
 * do `startRadio` de features/radios/register.ts: o contrato fixa a ordem,
 * este ficheiro só enche o slot que o modo karaoke possui.
 *
 * O item toca a música (se ainda não for a actual), abre o ecrã do player e
 * pousa o modo "karaoke" no store do palco - a mesma mecânica das rotas
 * /lyrics e /queue. Sem stems o item fica DESACTIVADO com a dica no próprio
 * rótulo (o menu não tem subtítulos), porque um karaoke com a voz colada ao
 * instrumental não é karaoke. Músicas de jam nem aparecem: os stems delas
 * nunca existem (fonte única presigned, DESIGN 10.3).
 */
import { router } from "expo-router";
import { registerSongMenuSlot, type SongMenuSlotHook } from "@/contracts/songMenu";
import { getTransport } from "@/contracts/transport";
import { setPlayerMode } from "@/features/player/mode";
import { usePlaybackView } from "@/remote/mirror";

const useKaraokeSlot: SongMenuSlotHook = (ctx) => {
  const isCurrent = usePlaybackView((v) => v.song != null && v.song.id === ctx.song.id);
  if (ctx.song.jam_song) return [];
  const stemsReady = !!ctx.song.vocals_media_id && !!ctx.song.instrumental_media_id;
  // Dentro do player o palco troca no lugar; de fora (linha, mini player,
  // pesquisa) ainda é preciso abrir o ecrã do player primeiro.
  const inPlayer = ctx.surface === "nowPlaying" || ctx.surface === "queue";
  return [
    {
      id: "karaoke",
      labelKey: stemsReady ? "native.player.karaoke" : "native.player.karaokeNeedsStems",
      icon: "mic",
      disabled: !stemsReady,
      onPress: () => {
        if (!isCurrent) {
          if (ctx.onPlay) ctx.onPlay();
          else getTransport().setQueue([ctx.song], 0);
        }
        setPlayerMode("karaoke");
        if (!inPlayer) router.push("/(player)/now-playing");
      },
    },
  ];
};

let registered = false;

/** Idempotente; boot/wireup.ts chama isto uma vez. */
export const registerKaraokeSongMenuSlot = (): void => {
  if (registered) return;
  registered = true;
  registerSongMenuSlot("karaoke", useKaraokeSlot);
};
