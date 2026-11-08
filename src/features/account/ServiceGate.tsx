/**
 * A Música é um serviço da conta O Melhor Site que vem desligado nas contas
 * novas (ServicesCatalog no backend: music default_enabled false). Sem ele
 * todos os pedidos respondem 403 `service_disabled`; em vez de uma app cheia
 * de erros, um ecrã a dizer o que se passa, com o contacto e o sair.
 */
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { oms } from "@/api/oms";
import { useAuthReady } from "@/auth/guard";
import { logout } from "@/auth/session";
import { sitePage } from "@/features/moderation/api";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

const isServiceDisabled = (error: unknown): boolean => {
  const e = error as { status?: number; body?: unknown; message?: string } | null;
  if (!e || e.status !== 403) return false;
  return JSON.stringify(e.body ?? e.message ?? "").includes("service_disabled");
};

export const ServiceGate = () => {
  const t = useT();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const authReady = useAuthReady();
  const probe = useQuery({
    queryKey: ["musicServiceProbe"],
    queryFn: async () => {
      try {
        await oms().http.get("/music/storage", { retry: false });
        return false;
      } catch (error) {
        if (isServiceDisabled(error)) return true;
        return false;
      }
    },
    enabled: authReady,
    staleTime: 10 * 60 * 1000,
  });

  if (probe.data !== true) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.background,
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 24,
          gap: 14,
        }}
      >
        <Text accessibilityRole="header" style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}>
          {t("native.account.serviceOff.title")}
        </Text>
        <Text style={{ color: tokens.foreground, fontSize: 16, lineHeight: 23 }}>
          {t("native.account.serviceOff.body")}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          onPress={() => void probe.refetch()}
          style={{ minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: tokens.primary }}
        >
          <Text style={{ color: tokens.primaryForeground, fontWeight: "700", fontSize: 16 }}>
            {t("native.common.tryAgain")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void WebBrowser.openBrowserAsync(sitePage("about-us")).catch(() => {})}
          style={{ minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tokens.muted }}
        >
          <Text style={{ color: tokens.foreground, fontWeight: "700", fontSize: 16 }}>{t("native.account.support")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void logout()} style={{ alignItems: "center", paddingVertical: 10 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>{t("native.account.signOut")}</Text>
        </Pressable>
      </View>
    </Modal>
  );
};
