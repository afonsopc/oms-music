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

/** rgb do veu por tema; as paragens de alpha sao as mesmas nos dois. */
const washRgb = (scheme: "light" | "dark"): string =>
  scheme === "dark" ? "0, 0, 0" : "255, 255, 255";

/**
 * Paragens do veu. `dense` e para as vistas cheias de texto (letras, fila,
 * definicoes, jam): uma capa CLARA por baixo deixava a tela quase branca e os
 * cinzentos da app - rotulos "A SEGUIR", duracoes, chips - desapareciam nela
 * (screenshots do dono, 2026-08-15). Os tokens de texto sao calibrados contra
 * o fundo quase preto da app, por isso a resposta certa e devolver a tela a
 * essa luminancia quando ha texto, em vez de recolorir cada componente.
 *
 * O modo da capa fica com o veu leve: e a pagina onde a artwork manda e onde
 * ha pouco texto para proteger.
 */
const washStops = (rgb: string, dense: boolean): string =>
  dense
    ? `linear-gradient(to bottom, rgba(${rgb}, 0.74) 0%, rgba(${rgb}, 0.82) 45%, rgba(${rgb}, 0.92) 80%, rgba(${rgb}, 0.96) 100%)`
    : `linear-gradient(to bottom, rgba(${rgb}, 0.34) 0%, rgba(${rgb}, 0.58) 40%, rgba(${rgb}, 0.88) 78%, rgba(${rgb}, 0.95) 100%)`;

/**
 * A copia desfocada, esticada a pagina inteira, mais o veu que garante o
 * contraste. `pointerEvents none`: e cenario, nunca apanha toques.
 */
export const ImmersiveBackdrop = ({
  song,
  dense = false,
}: {
  song: Song | null;
  dense?: boolean;
}) => {
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
          // width/height/borderRadius EXPLICITOS: o ArtworkImage assume um
          // quadrado de 40 com cantos redondos e junta o `style` a seguir, por
          // isso ancorar so com top/left/right/bottom deixava-o com 40x40 - um
          // quadradinho translucido encostado ao canto superior esquerdo, por
          // cima do conteudo e imune a cliques (era cenario com pointerEvents
          // none). Reportado pelo dono a 2026-08-15.
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            borderRadius: 0,
          }}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, gradientBackground(washStops(rgb, dense))]} />
    </View>
  );
};

/**
 * A capa: quadrado de cantos redondos com sombra funda, recuado das margens -
 * a forma dos screenshots do Apple Music que o dono mandou (2026-08-15). A
 * primeira versao era full-bleed com fade; ele viu o AM ao lado e preferiu
 * este, que e um objecto pousado sobre o ambiente em vez de fazer parte dele.
 */
export const ImmersiveArtwork = ({ song, size }: { song: Song; size: number }) => (
  <View
    style={{
      width: size,
      height: size,
      borderRadius: 18,
      // A sombra e o que separa a capa do fundo, ja que ambos saem da mesma
      // imagem; sem ela a capa parecia colada ao desfoque.
      shadowColor: "#000",
      shadowOpacity: 0.45,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 18,
    }}
  >
    <ArtworkImage
      source={songArtworkSource(song)}
      songId={song.id}
      contentFit="cover"
      borderRadius={18}
      style={{ width: size, height: size }}
    />
  </View>
);
