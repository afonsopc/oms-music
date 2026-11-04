/**
 * A "capa" do DJ: e o que ocupa o lugar da artwork quando quem esta a tocar
 * e ele (dono, 2026-08-31: "aparecendo a artwork dele a falar", e depois
 * "deve ter cores a voar... luzes a girar a volta dependendo do estilo").
 *
 * Nao ha imagem nenhuma para carregar - o quadrado e desenhado, como o
 * coracao das Gostadas (ui/LikedArtwork). Tem duas camadas:
 *
 *  - a LUZ: um brilho cinzento maior do que o quadrado, a girar por tras do
 *    carvao (./palette.ts; desde o redesenho de 2026-11-04 sem cores). Roda
 *    devagar enquanto a musica toca e acelera enquanto ele fala.
 *  - a VOZ: cinco barras. Enquanto ele fala andam com uma envolvente
 *    irregular, ao ritmo da fala (5-9 Hz, alturas sorteadas); quando ele
 *    cala-se descem e ficam quietas. Uma capa que continua a dancar em
 *    silencio e a mesma mentira do botao antigo, que prometia uma musica e
 *    tocava outra.
 *
 * A envolvente e SIMULADA, nao medida: nem o expo-audio nativo nem o
 * elemento de audio da web nos dao o nivel do clip sem montar um grafo de
 * analise por cima do motor. O que se ve e fala com ritmo de fala, e para
 * distinguir "esta a falar" de "esta calado" - que e para o que serve - dá.
 */
import React, { useEffect } from "react";
import { Animated, Easing, View } from "react-native";
import { Icon } from "@/ui";
import { RADIUS } from "@/theme/tokens";
import { gradientBackground, linearGradient } from "@/ui/uiTheme";
import { usePlaybackView } from "@/remote/mirror";
import { DJ_PALETTE, type DjPalette } from "./palette";
import { useDjStation } from "./station";

/** Alturas de repouso, em fraccao da altura maxima da barra. */
const BARS = [ 0.5, 0.8, 1, 0.75, 0.55 ];
/** Silabas por segundo, mais ou menos: e a cadencia de quem fala. */
const SYLLABLE_MS = [ 150, 190, 130, 210, 170 ];
/** Quieto, a barra fica neste tanto da sua altura. */
const RESTING = 0.18;

const Bar = ({
  index,
  speaking,
  height,
  width,
  color,
}: {
  index: number;
  speaking: boolean;
  height: number;
  width: number;
  color: string;
}) => {
  const [level] = React.useState(() => new Animated.Value(RESTING));

  useEffect(() => {
    const to = (v: number, duration: number, easing: (t: number) => number) =>
      Animated.timing(level, { toValue: v, duration, easing, useNativeDriver: true });
    if (!speaking) {
      const rest = to(RESTING, 260, Easing.out(Easing.quad));
      rest.start();
      return () => rest.stop();
    }
    const beat = SYLLABLE_MS[index] ?? 170;
    // Duas alturas diferentes por ciclo: com uma so, as cinco barras batiam
    // como um metronomo e aquilo lia-se como uma animacao, nao como voz.
    const loop = Animated.loop(
      Animated.sequence([
        to(0.55 + Math.random() * 0.45, beat, Easing.out(Easing.quad)),
        to(0.25 + Math.random() * 0.35, beat * 1.4, Easing.inOut(Easing.quad)),
        to(0.75 + Math.random() * 0.25, beat * 0.8, Easing.out(Easing.quad)),
        to(0.35 + Math.random() * 0.3, beat, Easing.inOut(Easing.quad)),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ index, level, speaking ]);

  // Escala em vez de altura: corre no driver nativo, sem re-render.
  const full = height * (BARS[index] ?? 0.6) + width;

  return (
    <Animated.View
      style={{
        width,
        height: full,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [ { scaleY: level } ],
      }}
    />
  );
};

export const DjArtwork = ({
  size,
  speaking,
  palette = DJ_PALETTE,
}: {
  size: number;
  speaking: boolean;
  palette?: DjPalette;
}) => {
  const [spin] = React.useState(() => new Animated.Value(0));
  const small = size < 80;
  const barHeight = size * (small ? 0.5 : 0.24);
  const barWidth = small ? 3 : 8;

  useEffect(() => {
    // Reinicia a volta com a velocidade nova: a falar anda mais depressa.
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: speaking ? 6000 : 16000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [ speaking, spin ]);

  const lights = {
    transform: [ { rotate: spin.interpolate({ inputRange: [ 0, 1 ], outputRange: [ "0deg", "360deg" ] }) } ],
  };

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS * 2,
        alignItems: "center",
        justifyContent: "center",
        gap: size * 0.06,
        overflow: "hidden",
        backgroundColor: palette.lights[0],
      }}
    >
      {/* Maior do que o quadrado e centrado: a girar, as pontas do gradiente
          varrem os cantos em vez de deixarem buracos. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size * 1.7,
            height: size * 1.7,
            ...gradientBackground(
              linearGradient("120deg", palette.lights[0], palette.lights[1], palette.lights[2]),
            ),
          },
          lights,
        ]}
      />
      {small ? null : (
        <Icon name="radio" size={Math.round(size * 0.18)} color={palette.voice} />
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: small ? 3 : 6,
          height: barHeight,
        }}
      >
        {BARS.map((_, index) => (
          <Bar
            key={index}
            index={index}
            speaking={speaking}
            height={barHeight}
            width={barWidth}
            color={palette.voice}
          />
        ))}
      </View>
    </View>
  );
};

/**
 * A capa do DJ ja ligada a estacao: as barras andam quando ele esta mesmo a
 * falar (a tocar, nao em pausa). E
 * o que as tres superficies do leitor - ecra, pilula e barra do desktop -
 * montam, para nao repetirem a mesma ligacao tres vezes.
 */
export const DjNowArtwork = ({ size }: { size: number }) => {
  const speaking = useDjStation((s) => s.speaking);
  const playing = usePlaybackView((v) => v.playing);
  return <DjArtwork size={size} speaking={speaking && playing} />;
};
