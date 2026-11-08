/**
 * Os Termos de Utilização antes de usar a app (App Store 1.2): tolerância
 * zero para conteúdo ofensivo e para quem abusa. São os mesmos Termos da
 * conta O Melhor Site; quem já os aceitou no site (na versão em vigor) não
 * vê nada. Sem rede, ou com o servidor a falhar, não bloqueia: pergunta-se
 * outra vez no próximo arranque.
 */
import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logout } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { acceptTerms, sitePage, termsKey, useTerms } from "./api";

const M = "native.moderation.terms";

export const TermsGate = () => {
  const t = useT();
  const { tokens, ink } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const terms = useTerms();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!terms.data || terms.data.accepted) return null;

  const accept = (): void => {
    setPending(true);
    setFailed(false);
    acceptTerms()
      .then(() => client.setQueryData(termsKey, { ...terms.data, accepted: true }))
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={pending}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary ? tokens.primary : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: tokens.muted,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {primary && pending ? (
        <ActivityIndicator color={tokens.primaryForeground} />
      ) : (
        <Text style={{ color: primary ? tokens.primaryForeground : tokens.foreground, fontWeight: "700", fontSize: 16 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: insets.top + 24 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, gap: 14, paddingBottom: 24 }}>
          <Text accessibilityRole="header" style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
            {t(`${M}.title`)}
          </Text>
          <Text style={{ color: tokens.foreground, fontSize: 16, lineHeight: 23 }}>{t(`${M}.body`)}</Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, lineHeight: 22 }}>{t(`${M}.rules`)}</Text>
        </ScrollView>
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 16, gap: 10 }}>
          {failed ? <Text style={{ color: ink.destructive, fontSize: 14 }}>{t("native.moderation.failed")}</Text> : null}
          {button(t(`${M}.accept`), accept, true)}
          {button(t(`${M}.read`), () => void WebBrowser.openBrowserAsync(terms.data?.url || sitePage("terms-of-service")).catch(() => {}))}
          <Pressable accessibilityRole="button" onPress={() => void logout()} style={{ alignItems: "center", paddingVertical: 10 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>{t("native.account.signOut")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
