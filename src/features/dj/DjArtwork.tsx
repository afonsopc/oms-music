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
  color,
}: {
  index: number;
  speaking: boolean;
  height: number;
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

  return <Animated.View style={[{ width: 8, borderRadius: 4, backgroundColor: color }, style]} />;
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
    <Icon name="radio" size={Math.round(size * 0.2)} color="#ffffff" />
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: size * 0.22 }}>
      {BARS.map((_, index) => (
        <Bar key={index} index={index} speaking={speaking} height={size * 0.22} color="#ffffff" />
      ))}
    </View>
  </View>
);
