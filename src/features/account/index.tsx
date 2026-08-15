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
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon, type IconName } from "@/ui";

const Row = ({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 16,
        paddingHorizontal: 20,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={20} color={tokens.mutedForeground} />
      <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
      <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
    </Pressable>
  );
};

export default function AccountScreen() {
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const topPadding = useContentTopPadding();
  const bottomPadding = useContentBottomPadding();

  const go = (route: Href): void => router.push(route);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
    >
      <Text
        style={{
          color: tokens.foreground,
          fontSize: 28,
          fontWeight: "800",
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        {t("native.shell.tabProfile")}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("native.home.viewProfile")}
        disabled={!user}
        onPress={() => {
          if (user) go({ pathname: "/profile/[idOrHandle]", params: { idOrHandle: user.handle } });
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          paddingHorizontal: 20,
          paddingBottom: 20,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {user ? <ArtworkImage uri={avatarUrl(user.id)} size={72} shape="circle" /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ color: tokens.foreground, fontSize: 20, fontWeight: "800" }}
          >
            {user?.name ?? ""}
          </Text>
          {user?.handle ? (
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              @{user.handle}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 }}>
            <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}>
              {t("native.home.viewProfile")}
            </Text>
            <Icon name="chevron-right" size={14} color={tokens.mutedForeground} />
          </View>
        </View>
      </Pressable>

      <View style={{ height: 1, backgroundColor: tokens.border, marginBottom: 8 }} />

      <Row icon="users" label={t("native.friends.title")} onPress={() => go("/friends")} />
      <Row
        icon="download"
        label={t("native.shell.tabDownloads")}
        onPress={() => go("/settings/downloads-overview")}
      />
      <Row
        icon="settings"
        label={t("native.library.settings")}
        onPress={() => go("/settings")}
      />
    </ScrollView>
  );
}
