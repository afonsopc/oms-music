/**
 * A PAGINA de perfil - a quarta tab.
 *
 * Isto era uma gaveta (features/home/ProfileDrawer, um Modal que entrava pela
 * esquerda) aberta por um item nao-navegavel da barra. O dono pediu pagina a
 * serio (2026-08-15), e com isso o "Perfil" deixa de ser um caso especial:
 * passa a ser uma tab como as outras, com a sua propria stack, e a barra da
 * web ganha o item que nunca teve (nao havia rota para lhe dar).
 *
 * O conteudo e o mesmo da gaveta: quem sou eu, e as tres portas que dali
 * saiam.
 *
 * Redesenho 2026-11-04: a mesma moldura das definições, linhas sem caixa e,
 * no fim, "Terminar sessão" (não existia em lado nenhum da app), sempre com
 * confirmação.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { avatarUrl } from "@/api/mediaUrl";
import { logout, useSessionStore } from "@/auth/session";
import { ACCOUNT_DELETE_URL, sitePage } from "@/features/moderation/api";
import { SettingsPage, SettingsRow, SettingsSection } from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, ConfirmDialog, Skeleton } from "@/ui";
import { PressableScale } from "@/ui/motion";

export default function AccountScreen() {
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // As páginas do site e do id abrem dentro da app (folha do Safari no iOS).
  const open = (url: string): void => {
    void WebBrowser.openBrowserAsync(url).catch(() => {});
  };

  const go = (route: Href): void => router.push(route);

  const signOut = (): void => {
    setSigningOut(true);
    // O logout limpa sempre (mesmo sem rede); os guardas da raiz levam ao
    // ecrã de entrada quando a sessão passa a anónima.
    void logout().finally(() => {
      setSigningOut(false);
      setConfirmOut(false);
    });
  };

  return (
    <>
      <SettingsPage title={t("native.shell.tabProfile")}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("native.home.viewProfile")}
          disabled={!user}
          onPress={() => {
            if (user) go({ pathname: "/profile/[idOrHandle]", params: { idOrHandle: user.handle } });
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 16 }}
        >
          {user ? (
            <ArtworkImage uri={avatarUrl(user.id)} size={64} shape="circle" />
          ) : (
            <Skeleton width={64} height={64} circle />
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ color: tokens.foreground, fontSize: 20, fontWeight: "700" }}
            >
              {user?.name ?? ""}
            </Text>
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
              {user?.handle ? `@${user.handle} · ` : ""}
              {t("native.home.viewProfile")}
            </Text>
          </View>
        </PressableScale>

        <SettingsSection>
          <SettingsRow
            first
            icon="users"
            label={t("native.friends.title")}
            onPress={() => go("/friends")}
          />
          <SettingsRow
            icon="download"
            label={t("native.shell.tabDownloads")}
            onPress={() => go("/settings/downloads-overview")}
          />
          <SettingsRow
            icon="settings"
            label={t("native.library.settings")}
            onPress={() => go("/settings")}
          />
        </SettingsSection>

        {/* Termos, privacidade e contacto (App Store 5.1.1 e 1.2): as
            páginas do site, que valem para as apps também. */}
        <SettingsSection>
          <SettingsRow
            first
            label={t("native.account.terms")}
            onPress={() => open(sitePage("terms-of-service"))}
          />
          <SettingsRow
            label={t("native.account.privacy")}
            onPress={() => open(sitePage("privacy-policy"))}
          />
          <SettingsRow
            label={t("native.account.support")}
            onPress={() => open(sitePage("about-us"))}
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            first
            label={t("native.account.signOut")}
            onPress={() => setConfirmOut(true)}
            trailing={<View />}
          />
          {/* Apagar a conta dentro da app (App Store 5.1.1(v)): a conta é a
              do O Melhor Site; a confirmação é a do id.omelhorsite.pt (pede a
              palavra-passe ou passkey), já no passo de apagar. Fecha logo e
              apaga tudo, a música incluída, 48 h depois. */}
          <SettingsRow
            destructive
            label={t("native.account.delete")}
            onPress={() => setConfirmDelete(true)}
            trailing={<View />}
          />
        </SettingsSection>
      </SettingsPage>

      <ConfirmDialog
        visible={confirmDelete}
        title={t("native.account.deleteTitle")}
        message={t("native.account.deleteMessage")}
        confirmLabel={t("native.account.deleteContinue")}
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          open(ACCOUNT_DELETE_URL);
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        visible={confirmOut}
        title={t("native.account.signOutTitle")}
        message={t("native.account.signOutMessage")}
        confirmLabel={t("native.account.signOut")}
        destructive
        pending={signingOut}
        onConfirm={signOut}
        onCancel={() => setConfirmOut(false)}
      />
    </>
  );
}
