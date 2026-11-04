/**
 * Web: "Descarregar para Android" (public/android/index.html tem os passos).
 * À vista no ecrã de entrada só para quem abre num Android; nas definições
 * fica sempre, discreto (`quiet`). Textos aqui, como em
 * import/elsewhere.web.tsx.
 */
import React from "react";
import { Pressable, Text } from "react-native";
import { useLocale, type Locale } from "@/i18n";
import { useTheme } from "@/theme/provider";

const COPY: Record<Locale, { title: string; line: string }> = {
  pt: { title: "Descarregar para Android", line: "A app para o telemóvel, sem loja." },
  en: { title: "Download for Android", line: "The phone app, no store needed." },
  lv: { title: "Lejupielādēt Android", line: "Lietotne telefonam, bez veikala." },
};

const isAndroid = (): boolean =>
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

export const AndroidDownload = ({ quiet = false }: { quiet?: boolean }) => {
  const { tokens } = useTheme();
  const copy = COPY[useLocale()] ?? COPY.pt;
  if (!quiet && !isAndroid()) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        window.location.href = "/android/";
      }}
      style={{ paddingVertical: quiet ? 14 : 10, gap: 2 }}
    >
      <Text
        style={{
          color: tokens.foreground,
          fontSize: quiet ? 15 : 16,
          fontWeight: quiet ? "500" : "600",
          textDecorationLine: quiet ? "none" : "underline",
        }}
      >
        {copy.title}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{copy.line}</Text>
    </Pressable>
  );
};
