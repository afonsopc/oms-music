/**
 * Android: "Procurar actualizações" no perfil (pedido do João, 2026-11-17).
 * O aviso do arranque (updateToast) só pergunta de 6 em 6 horas; aqui a
 * pessoa pergunta já. Versão nova: abre o APK no browser, como o aviso.
 * Já a mais recente: diz isso na própria linha. Fora do Android não aparece
 * (o iPhone actualiza pela loja e a web está sempre na última), nem no
 * build da Google Play (distribution.ts), que a loja actualiza.
 *
 * Textos aqui, como no updateToast: frases só desta peça.
 */
import React, { useState } from "react";
import { ActivityIndicator, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { SettingsRow } from "@/features/settings/ui";
import { haptics } from "@/lib/haptics";
import { useLocale, type Locale } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { isPlayBuild } from "./distribution";
import { APK_URL, fetchLatestVersionCode, myVersionCode } from "./updateToast";

type State = "idle" | "checking" | "latest" | "found" | "offline";

const COPY: Record<Locale, Record<Exclude<State, "idle">, string> & { label: string; version: string }> = {
  pt: {
    label: "Procurar actualizações",
    version: "Versão {v}",
    checking: "A procurar…",
    latest: "Tens a versão mais recente ({v})",
    found: "Há uma versão nova: a descarregar",
    offline: "Sem ligação. Tenta outra vez",
  },
  en: {
    label: "Check for updates",
    version: "Version {v}",
    checking: "Checking…",
    latest: "You're on the latest version ({v})",
    found: "New version found: downloading",
    offline: "No connection. Try again",
  },
  lv: {
    label: "Meklēt atjauninājumus",
    version: "Versija {v}",
    checking: "Meklē…",
    latest: "Jums ir jaunākā versija ({v})",
    found: "Ir jauna versija: lejupielādē",
    offline: "Nav savienojuma. Mēģiniet vēlreiz",
  },
};

export const AndroidUpdateRow = ({ first = false }: { first?: boolean }) => {
  const [state, setState] = useState<State>("idle");
  const { tokens } = useTheme();
  const copy = COPY[useLocale()] ?? COPY.pt;
  if (Platform.OS !== "android" || isPlayBuild()) return null;

  const version = Constants.expoConfig?.version ?? "";
  const detail = (state === "idle" ? copy.version : copy[state]).replace("{v}", version);

  const check = async (): Promise<void> => {
    if (state === "checking") return;
    haptics.tap();
    setState("checking");
    // Um mínimo à vista: uma resposta instantânea parece que nem procurou.
    const [latest] = await Promise.all([
      fetchLatestVersionCode(),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]);
    if (latest == null) {
      setState("offline");
      return;
    }
    if (latest > myVersionCode()) {
      setState("found");
      void Linking.openURL(APK_URL);
      return;
    }
    haptics.success();
    setState("latest");
  };

  return (
    <SettingsRow
      first={first}
      icon="refresh-cw"
      label={copy.label}
      detail={detail}
      onPress={() => void check()}
      trailing={state === "checking" ? <ActivityIndicator size="small" color={tokens.mutedForeground} /> : undefined}
    />
  );
};
