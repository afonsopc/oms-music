/**
 * A "capa" do DJ: e o que ocupa o lugar da artwork quando quem esta a tocar
 * e ele (dono, 2026-08-31: "aparecendo a artwork dele a falar"). Nao ha
 * imagem nenhuma para carregar - o quadrado e desenhado, como o coracao das
 * Gostadas (ui/LikedArtwork), e as barras dancam enquanto ele fala.
 *
 * As barras param quando ele acaba: uma capa que continua a dancar em
 * silencio e a mesma mentira do botao antigo, que prometia uma musica e
 * tocava outra.
 */
import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Icon } from "@/ui";
import { RADIUS } from "@/theme/tokens";
import { gradientBackground, linearGradient } from "@/ui/uiTheme";

/** Alturas de repouso, em fraccao da altura maxima da barra. */
const BARS = [0.35, 0.6, 1, 0.75, 0.45];
/** Duracoes primas entre si: com a mesma, as cinco batem ao mesmo tempo. */
const PERIODS = [420, 560, 340, 640, 480];

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
  const scale = useSharedValue(0.3);

  useEffect(() => {
    if (speaking) {
      scale.value = withRepeat(
        withTiming(1, { duration: PERIODS[index] ?? 500 }),
        -1,
        true,
      );
    } else {
      scale.value = withTiming(0.3, { duration: 240 });
    }
  }, [index, scale, speaking]);

  const style = useAnimatedStyle(() => ({
    height: height * (BARS[index] ?? 0.5) * scale.value + 4,
  }));

  return (
    <Animated.View
      style={[{ width, borderRadius: width / 2, backgroundColor: color }, style]}
    />
  );
};

export const DjArtwork = ({
  size,
  speaking,
}: {
  size: number;
  speaking: boolean;
}) => (
  <View
    style={{
      width: size,
      height: size,
      borderRadius: RADIUS * 2,
      alignItems: "center",
      justifyContent: "center",
      gap: size * 0.06,
      overflow: "hidden",
      ...gradientBackground(linearGradient("140deg", "#0f172a", "#4338ca", "#c026d3")),
    }}
  >
    {/* Na pilula (40px) so cabem as barras: o icone a essa escala e uma
        mancha. */}
    {size >= 80 ? <Icon name="radio" size={Math.round(size * 0.2)} color="#ffffff" /> : null}
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: size >= 80 ? 6 : 3,
        height: size * (size >= 80 ? 0.22 : 0.5),
      }}
    >
      {BARS.map((_, index) => (
        <Bar
          key={index}
          index={index}
          speaking={speaking}
          height={size * (size >= 80 ? 0.22 : 0.5)}
          width={size >= 80 ? 8 : 3}
          color="#ffffff"
        />
      ))}
    </View>
  </View>
);
