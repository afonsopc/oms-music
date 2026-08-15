/**
 * O fundo e a artwork IMERSIVOS do player (pedido do dono 2026-08-15, com a
 * descricao dele: "o artwork full width com fade out pra baixo e uma copia
 * dele blurred esticada ate ao fim da pagina").
 *
 * Substitui o gradiente de accent extraido: o accent dava cores lindas mas
 * imprevisiveis, e as barras de scrub e volume ficavam a nadar em cima de
 * um verde-limao qualquer (queixa de contraste do dono). Aqui o fundo e a
 * PROPRIA artwork desfocada por baixo de um veu determinista - preto no tema
 * escuro, branco no claro - por isso o contraste do texto e das barras nao
 * depende da capa que calhou.
 *
 * A capa nitida e full-bleed e desvanece para o mesmo veu, o que a costura ao
 * fundo em vez de a pousar la em cima como um cartao.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { Song } from "@/domain/song";
import { songArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, gradientBackground } from "@/ui";

/** Quanto do fundo da capa se dissolve no veu. */
const FADE_FRACTION = 0.42;

/** rgb do veu por tema; as paragens de alpha sao as mesmas nos dois. */
const washRgb = (scheme: "light" | "dark"): string =>
  scheme === "dark" ? "0, 0, 0" : "255, 255, 255";

/**
 * A copia desfocada, esticada a pagina inteira, mais o veu que garante o
 * contraste. `pointerEvents none`: e cenario, nunca apanha toques.
 */
export const ImmersiveBackdrop = ({ song }: { song: Song | null }) => {
  const { scheme } = useTheme();
  const rgb = washRgb(scheme);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {song ? (
        <ArtworkImage
          source={songArtworkSource(song)}
          songId={song.id}
          // A mesma resolucao do resto da app (ficheiro local primeiro, rede
          // depois), so que desfocada - offline continua a haver fundo.
          blurRadius={40}
          contentFit="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          gradientBackground(
            `linear-gradient(to bottom, rgba(${rgb}, 0.30) 0%, rgba(${rgb}, 0.55) 40%, rgba(${rgb}, 0.86) 78%, rgba(${rgb}, 0.94) 100%)`,
          ),
        ]}
      />
    </View>
  );
};

/**
 * A capa nitida: quadrada, a largura toda, encostada ao topo, com o fundo a
 * desvanecer. Sem cantos redondos nem sombra - nao e um cartao, e o topo da
 * pagina.
 */
export const ImmersiveArtwork = ({
  song,
  width,
  height,
}: {
  song: Song;
  width: number;
  height: number;
}) => {
  const { scheme } = useTheme();
  const rgb = washRgb(scheme);
  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <ArtworkImage
        source={songArtworkSource(song)}
        songId={song.id}
        contentFit="cover"
        borderRadius={0}
        style={{ width, height }}
      />
      <View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.round(height * FADE_FRACTION),
          },
          gradientBackground(
            `linear-gradient(to bottom, rgba(${rgb}, 0) 0%, rgba(${rgb}, 0.45) 55%, rgba(${rgb}, 0.9) 100%)`,
          ),
        ]}
      />
    </View>
  );
};
