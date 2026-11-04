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
import React, { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { useArtworkTint } from "@/theme/useArtworkTint";
import type { Song } from "@/domain/song";
import { songArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, artworkSourceUri, gradientBackground } from "@/ui";
import { useReducedMotion } from "@/ui/motion";

/** A capa em pausa: um pouco mais pequena, como quem respira fundo. */
const PAUSED_SCALE = 0.82;

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
    : // Ronda 2 (idioma Apple Music): a cor da capa É o fundo; o véu só
      // escurece o fundo do ecrã, onde vivem os comandos.
      `linear-gradient(to bottom, rgba(${rgb}, 0.18) 0%, rgba(${rgb}, 0.28) 45%, rgba(${rgb}, 0.5) 80%, rgba(${rgb}, 0.62) 100%)`;

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
  const artworkUri = song ? artworkSourceUri(songArtworkSource(song)) : null;
  const tint = useArtworkTint(song ? String(song.id) : null, artworkUri);
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: tint.wash },
        Platform.OS === "web" ? ({ transitionProperty: "background-color", transitionDuration: "700ms" } as object) : null,
      ]}
    >
      {song ? (
        <ArtworkImage
          source={songArtworkSource(song)}
          songId={song.id}
          // A mesma resolucao do resto da app (ficheiro local primeiro, rede
          // depois), so que desfocada - offline continua a haver fundo.
          blurRadius={60}
          contentFit="cover"
          // width/height/borderRadius EXPLICITOS: o ArtworkImage assume um
          // quadrado de 40 com cantos redondos e junta o `style` a seguir, por
          // isso ancorar so com top/left/right/bottom deixava-o com 40x40 - um
          // quadradinho translucido encostado ao canto superior esquerdo, por
          // cima do conteudo e imune a cliques (era cenario com pointerEvents
          // none). Reportado pelo dono a 2026-08-15.
          style={{
            position: "absolute",
            top: "-15%",
            left: "-15%",
            width: "130%",
            height: "130%",
            borderRadius: 0,
            opacity: 0.85,
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
/**
 * A capa grande do leitor. Encolhe um pouco quando está em pausa e volta ao
 * tamanho com uma mola quando toca (o gesto do Apple Music), no driver
 * nativo: nada disto passa pela thread de JS depois de arrancar.
 */
export const ImmersiveArtwork = ({ song, size, playing = true }: { song: Song; size: number; playing?: boolean }) => {
  const reduceMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(playing ? 1 : PAUSED_SCALE));
  useEffect(() => {
    const to = playing ? 1 : PAUSED_SCALE;
    if (reduceMotion) {
      scale.setValue(to);
      return;
    }
    Animated.spring(scale, { toValue: to, damping: 16, stiffness: 180, mass: 0.8, useNativeDriver: Platform.OS !== "web" }).start();
  }, [playing, reduceMotion, scale]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        transform: [{ scale }],
        // A sombra e o que separa a capa do fundo, ja que ambos saem da mesma
        // imagem; sem ela a capa parecia colada ao desfoque.
        shadowColor: "#000",
        shadowOpacity: playing ? 0.45 : 0.25,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
        elevation: 18,
      }}
    >
      <ArtworkImage
        source={songArtworkSource(song)}
        songId={song.id}
        contentFit="cover"
        borderRadius={12}
        style={{ width: size, height: size }}
      />
    </Animated.View>
  );
};
