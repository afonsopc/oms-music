/**
 * Android: o APK não vem de uma loja (docs/android.md). Ao arrancar, e no
 * máximo de 6 em 6 horas ao voltar ao primeiro plano, a app lê
 * https://music.omelhorsite.pt/app/android.json (scripts/android-apk.sh
 * PUBLISH=1). Se há um versionCode maior que o desta build, aparece em cima
 * "Há uma versão nova" com "Actualizar", que abre o APK no browser.
 *
 * Os textos ficam aqui (como em import/elsewhere.web.tsx): três frases só
 * desta peça, fora dos catálogos partilhados.
 */
import React, { useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale, type Locale } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

const SITE = "https://music.omelhorsite.pt";
const EVERY_MS = 6 * 3_600_000;

const COPY: Record<Locale, { title: string; update: string; later: string }> = {
  pt: { title: "Há uma versão nova.", update: "Actualizar", later: "Agora não" },
  en: { title: "A new version is ready.", update: "Update", later: "Not now" },
  lv: { title: "Ir jauna versija.", update: "Atjaunināt", later: "Ne tagad" },
};

const myVersionCode = (): number => Number(Constants.expoConfig?.android?.versionCode ?? 0);

export const AndroidUpdateToast = () => {
  const [open, setOpen] = useState(false);
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const copy = COPY[useLocale()] ?? COPY.pt;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let last = 0;
    const check = async (): Promise<void> => {
      if (Date.now() - last < EVERY_MS) return;
      last = Date.now();
      try {
        const res = await fetch(`${SITE}/app/android.json`, { cache: "no-store" });
        if (!res.ok) return;
        const latest = (await res.json()) as { versionCode?: number };
        if (typeof latest.versionCode === "number" && latest.versionCode > myVersionCode()) setOpen(true);
      } catch {
        // Sem net: fica para a próxima.
      }
    };
    const timer = setTimeout(() => void check(), 5000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  if (!open) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12 }}
    >
      <View
        style={{
          backgroundColor: tokens.popover,
          borderColor: tokens.border,
          borderWidth: 1,
          borderRadius: RADIUS + 4,
          paddingLeft: 14,
          paddingRight: 6,
          paddingVertical: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text style={{ flex: 1, color: tokens.popoverForeground, fontSize: 14 }}>{copy.title}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={{ paddingHorizontal: 10, paddingVertical: 10 }}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{copy.later}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setOpen(false);
            void Linking.openURL(`${SITE}/app/oms-music.apk`);
          }}
          style={{
            backgroundColor: tokens.foreground,
            borderRadius: RADIUS + 2,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: tokens.background, fontSize: 14, fontWeight: "600" }}>{copy.update}</Text>
        </Pressable>
      </View>
    </View>
  );
};
