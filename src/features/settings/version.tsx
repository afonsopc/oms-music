/**
 * "Versão 2.0.0 (202611041504)" no fim das definições. A versão vem do
 * "version" do package.json (app.config.js); o número entre parênteses é o
 * build: CFBundleVersion no iOS, versionCode no Android. No computador é a
 * versão da janela (Tauri); na web só a versão.
 */
import React, { useEffect, useState } from "react";
import { Platform, Text } from "react-native";
import Constants from "expo-constants";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

const nativeLabel = (): string => {
  const version = Constants.expoConfig?.version ?? "";
  const build =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode
        : undefined;
  return build ? `${version} (${build})` : version;
};

type TauriApp = { app?: { getVersion?: () => Promise<string> } };

export const AppVersion = () => {
  const t = useT();
  const { tokens } = useTheme();
  const [label, setLabel] = useState(nativeLabel);

  useEffect(() => {
    const tauri = (globalThis as { __TAURI__?: TauriApp }).__TAURI__;
    tauri?.app
      ?.getVersion?.()
      .then((version) => version && setLabel(version))
      .catch(() => {});
  }, []);

  if (!label) return null;
  return (
    <Text
      selectable
      style={{ color: tokens.mutedForeground, fontSize: 13, paddingVertical: 14, fontVariant: ["tabular-nums"] }}
    >
      {t("native.settings.hub.version", { version: label })}
    </Text>
  );
};
