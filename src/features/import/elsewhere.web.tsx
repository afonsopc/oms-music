/**
 * Web e desktop: uma linha abaixo dos ficheiros a apontar para a página de
 * importação, que é um serviço à parte (oms-music-import).
 *
 * SÓ neste ficheiro .web.tsx: o Metro não o leva para iOS nem Android, e os
 * textos ficam aqui de propósito, fora dos catálogos partilhados (que vão
 * para as apps nativas). Ver docs/app-store.md.
 */
import React from "react";
import { Text, View } from "react-native";
import { getTauriGlobals } from "@/desktop/tauri";
import { useLocale, type Locale } from "@/i18n";
import { useTheme } from "@/theme/provider";

const IMPORT_PAGE = "https://import.omelhorsite.pt";

const COPY: Record<Locale, { title: string; line: string; host: string }> = {
  pt: {
    title: "Importar de outros sítios",
    line: "Spotify, YouTube, links, letras e fotos dos artistas: em ",
    host: "import.omelhorsite.pt",
  },
  en: {
    title: "Import from elsewhere",
    line: "Spotify, YouTube, links, lyrics and artist photos: at ",
    host: "import.omelhorsite.pt",
  },
  lv: {
    title: "Importēt no citām vietām",
    line: "Spotify, YouTube, saites, dziesmu vārdi un mākslinieku foto: ",
    host: "import.omelhorsite.pt",
  },
};

/** No desktop o webview não abre separadores: vai pelo browser do sistema. */
const openImportPage = (): void => {
  const tauri = getTauriGlobals();
  if (tauri) {
    void tauri.core.invoke("open_import_page").catch(() => undefined);
    return;
  }
  window.open(IMPORT_PAGE, "_blank", "noopener");
};

export default function ImportElsewhere() {
  const { tokens } = useTheme();
  const copy = COPY[useLocale()] ?? COPY.pt;

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "600" }}>
        {copy.title}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 19 }}>
        {copy.line}
        <Text
          onPress={openImportPage}
          accessibilityRole="link"
          style={{ color: tokens.foreground, textDecorationLine: "underline" }}
        >
          {copy.host}
        </Text>
      </Text>
    </View>
  );
}
