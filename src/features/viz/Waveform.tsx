/**
 * A forma de onda da música (a energia da análise em N barras), por cima da
 * barra de progresso. Duas cópias das barras: a cinzenta inteira e a branca
 * recortada até onde já tocou; com cada tique só muda a largura do recorte,
 * as barras não se redesenham.
 */
import React, { memo, useMemo } from "react";
import { View } from "react-native";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";
import { useSongAnalysis } from "./analysis";

const decodeEnv = (b64: string, n: number): number[] => {
  const bin = typeof atob === "function" ? atob(b64) : "";
  if (!bin) return [];
  const per = bin.length / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let max = 0;
    const a = Math.floor(i * per);
    const b = Math.max(a + 1, Math.floor((i + 1) * per));
    for (let j = a; j < b && j < bin.length; j++) {
      const v = bin.charCodeAt(j);
      sum += v;
      if (v > max) max = v;
    }
    out.push(((sum / Math.max(1, b - a)) * 0.6 + max * 0.4) / 255);
  }
  // Normalizada ao pico e com contraste: as partes calmas ficam baixas, os
  // refrões altos, e nunca uma linha chata.
  const top = Math.max(0.01, ...out);
  const low = Math.min(...out);
  return out.map((v) => Math.pow((v - low) / Math.max(0.01, top - low), 1.6));
};

const Bars = memo(function Bars({ levels, color, height, width }: { levels: number[]; color: string; height: number; width: number | `${number}%` }) {
  return (
    <View style={{ width, height, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {levels.map((v, i) => (
        <View key={i} style={{ width: 2, borderRadius: 1, height: Math.max(2, Math.round((0.12 + 0.88 * v) * height)), backgroundColor: color }} />
      ))}
    </View>
  );
});

export const Waveform = ({ songId, fraction, height = 22, bars = 72 }: { songId: string | number | null; fraction: number; height?: number; bars?: number }) => {
  const { tokens } = useTheme();
  const analysis = useSongAnalysis(songId);
  const env = analysis.data?.status === "ready" ? analysis.data.data.env : null;
  const levels = useMemo(() => (env ? decodeEnv(env, bars) : null), [env, bars]);
  const [width, setWidth] = React.useState(0);
  if (!levels) return <View style={{ height }} />;
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} pointerEvents="none">
      {/* Por tocar: o texto do tema a 30 %; já tocado: inteiro. Neutro e
          legível nos dois temas. */}
      <Bars levels={levels} color={withAlpha(tokens.foreground, 0.3)} height={height} width="100%" />
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(1, Math.max(0, fraction)) * 100}%`, overflow: "hidden" }}>
        {width > 0 ? <Bars levels={levels} color={withAlpha(tokens.foreground, 0.95)} height={height} width={width} /> : null}
      </View>
    </View>
  );
};
