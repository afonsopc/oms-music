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
import { ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody, { PlayerChrome } from "@/features/player";
import { ImmersiveBackdrop } from "@/features/player/immersive";
import { usePlayerModeStore } from "@/features/player/mode";
import QueueBody from "@/features/player/queue";
import { PlayerSettingsBody } from "@/features/player/settingsSheet";
import JamScreen from "@/features/jam";
import LyricsBody from "@/features/lyrics";
import { usePlaybackView } from "@/remote/mirror";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";

export const NowPlayingScreen = () => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const song = usePlaybackView((v) => v.song);
  const mode = usePlayerModeStore((s) => s.mode);

  // Um carregamento directo de /now-playing nao tem historico para desfazer:
  // a Home e a porta nesse caso.
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  };

  // Arrastar para baixo fecha, nas DUAS plataformas. Passou a ser assim
  // quando o player virou ecra inteiro (app/_layout): ja nao ha folha do
  // sistema a tratar do gesto, portanto este e o unico, e por isso tambem
  // deixa de haver risco de dois gestos disputarem o mesmo dedo.
  const dragY = useSharedValue(0);
  const dismissGesture = (enabled: boolean) =>
    Gesture.Pan()
      .enabled(enabled)
      // So para BAIXO e so passados 12px: um toque num botao ou o inicio de
      // um scroll para cima nunca chegam a activar isto.
      .activeOffsetY([12, 10_000])
      .failOffsetY(-12)
      .onUpdate((event) => {
        dragY.value = Math.max(0, event.translationY);
      })
      .onEnd((event) => {
        if (event.translationY > 140 || event.velocityY > 900) runOnJS(close)();
        dragY.value = withSpring(0, { damping: 22, stiffness: 220 });
      });
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: tokens.background }, dragStyle]}>
      {/* A propria capa, desfocada e esticada, e o fundo - e o veu por cima
          dela e que garante o contraste das barras, em vez do accent
          extraido que dava fundos imprevisiveis (queixa do dono). */}
      <ImmersiveBackdrop song={song} dense={mode !== "artwork"} />
      <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 12) }}>
        {/* A PEGA. Diz "isto puxa-se para baixo" antes de o utilizador
            tentar, e como vive acima do palco vale em TODAS as vistas -
            letras, fila, definicoes ou capa. Encostada a barra de estado,
            como no Apple Music: com a folha do sistema ela caia 70pt abaixo
            porque a area segura ja vinha aplicada pela folha e nos
            somavamos-lhe a nossa (report do dono 2026-08-15). */}
        <GestureDetector gesture={dismissGesture(true)}>
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
        </GestureDetector>
        {/* O PALCO. Troca de conteudo, nunca de sitio: o chrome por baixo
            fica onde esta, que e o ponto todo do idioma Apple Music. O gesto
            de fechar so vale aqui no modo da capa - nas outras vistas o
            conteudo rola, e arrastar para baixo la dentro e para subir a
            lista, nao para sair. */}
        <GestureDetector gesture={dismissGesture(mode === "artwork")}>
          <View style={{ flex: 1, minHeight: 0 }}>
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
            ) : (
              <NowPlayingBody />
            )}
          </View>
        </GestureDetector>
        {/* O chrome NAO leva gesto de fechar. Levou durante meia hora e
            partiu as barras de scrub e de volume (report do dono): os
            sliders sao Gesture.Pan com failOffsetY apertado, e um arrasto
            humano numa barra nunca e perfeitamente horizontal - bastavam os
            12px verticais do gesto de cima para ele activar e cancelar o do
            slider. Os botoes escapavam porque um toque nao e arrasto, o que
            deu exactamente o sintoma descrito. Quem fecha e a pega, que
            existe em todas as vistas. */}
        <View style={{ paddingHorizontal: 24 }}>
          <PlayerChrome />
        </View>
      </View>
    </Animated.View>
  );
};
