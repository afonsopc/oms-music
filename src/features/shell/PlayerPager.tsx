/**
 * A superficie (player) do telemovel: UM ecra, sem scroll vertical nenhum
 * (decisao do dono 2026-08-15).
 *
 * O que aqui estava - um scroll livre com o now playing, depois o cartao das
 * letras, depois a fila, depois o cartao do artista - disputava o gesto de
 * fechar a folha: arrastar para baixo ora fechava ora nao, conforme o scroll
 * ainda estivesse a correr. Agora o palco TROCA no lugar (mode.ts): capa,
 * letras ou fila, com o chrome do player (scrub, transporte, volume, fila de
 * botoes) sempre no mesmo sitio, como no Apple Music. Sem navegacao, sem
 * cabecalho de subpagina e sem o chevron de dispensar que o dono nao queria.
 *
 * O cartao "Sobre o artista" saiu daqui com o scroll: o nome do artista na
 * identidade ja e o link para a pagina dele, e o cartao continua vivo no
 * painel direito do desktop.
 */
import React from "react";
import { Platform, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody, { PlayerChrome } from "@/features/player";
import { ImmersiveBackdrop } from "@/features/player/immersive";
import { usePlayerModeStore } from "@/features/player/mode";
import QueueBody from "@/features/player/queue";
import LyricsBody from "@/features/lyrics";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { ChevronDownGlyph } from "./glyphs";

export const NowPlayingScreen = () => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();

  const song = usePlaybackView((v) => v.song);
  const mode = usePlayerModeStore((s) => s.mode);

  // On native the sheet dismisses with a drag; a browser has no such gesture,
  // so without this chevron the page was a room with no door. A direct load
  // of /now-playing has no history to pop - Home is the door then.
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(main)/(tabs)/home");
  };
  const webClose =
    Platform.OS === "web" ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("native.common.close")}
        hitSlop={12}
        onPress={close}
        style={{ position: "absolute", top: 10, left: 12, zIndex: 10, padding: 6 }}
      >
        <ChevronDownGlyph color={tokens.foreground} size={26} />
      </Pressable>
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      {/* A propria capa, desfocada e esticada, e o fundo - e o veu por cima
          dela e que garante o contraste das barras, em vez do accent
          extraido que dava fundos imprevisiveis (queixa do dono). */}
      <ImmersiveBackdrop song={song} />
      {webClose}
      <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 12) }}>
        {/* O PALCO. Troca de conteudo, nunca de sitio: o chrome por baixo
            fica onde esta, que e o ponto todo do idioma Apple Music. */}
        <View style={{ flex: 1, minHeight: 0 }}>
          {mode === "lyrics" ? (
            <LyricsBody />
          ) : mode === "queue" ? (
            <QueueBody />
          ) : (
            <NowPlayingBody />
          )}
        </View>
        <View style={{ paddingHorizontal: 24 }}>
          <PlayerChrome />
        </View>
      </View>
    </View>
  );
};
