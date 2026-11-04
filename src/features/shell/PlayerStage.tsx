/**
 * O palco do player do telemovel (capa, letras, fila, definicoes, jam,
 * karaoke) e a pega, partilhados pelo PlayerPager nativo (gestos do
 * gesture-handler) e pelo da web (PlayerPager.web.tsx, sem gesture-handler
 * nem Reanimated no bundle).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody from "@/features/player";
import KaraokeBody from "@/features/player/karaoke";
import type { PlayerMode } from "@/features/player/mode";
import QueueBody from "@/features/player/queue";
import { PlayerSettingsBody } from "@/features/player/settingsSheet";
import JamScreen from "@/features/jam";
import LyricsBody from "@/features/lyrics";
import type { Song } from "@/domain/song";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";

/** A pega: diz "isto puxa-se para baixo" antes de o utilizador tentar. */
export const PlayerHandle = () => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, alignItems: "center" }}>
      <View
        style={{
          width: 38,
          height: 5,
          borderRadius: 3,
          backgroundColor: withAlpha(tokens.foreground, 0.4),
        }}
      />
    </View>
  );
};

export const PlayerStage = ({ mode, song }: { mode: PlayerMode; song: Song | null }) => (
  <>
    {mode === "lyrics" ? (
      <LyricsBody />
    ) : mode === "queue" ? (
      <QueueBody />
    ) : mode === "settings" ? (
      // Definicoes e jam entram pelo palco, nao por folhas: dentro
      // de um player sem scroll uma folha e uma segunda camada a
      // disputar o mesmo arrasto (pedido do dono 2026-08-15). Scroll
      // proprio porque ambas sao mais altas do que o palco.
      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
        <PlayerSettingsBody song={song} />
      </ScrollView>
    ) : mode === "jam" ? (
      <JamScreen embedded />
    ) : mode === "karaoke" ? (
      // Montar/desmontar É entrar/sair do karaoke: o corpo tira a
      // fotografia do modo de stem + velocidade ao montar e
      // restaura-os na limpeza (features/player/karaoke.tsx).
      <KaraokeBody />
    ) : (
      <NowPlayingBody />
    )}
  </>
);
