/**
 * O avatar da conta no canto direito da topbar (feedback do dono
 * 2026-08-14, "olha onde eles tem o avatar"): o mesmo sitio do Spotify
 * desktop. Clique abre o menu ancorado com os quatro destinos que os quick
 * links da Biblioteca tinham (perfil, amigos, transferencias, definicoes).
 * Viveu primeiro no fundo da sidebar; a topbar ganhou-o porque e o unico
 * sitio SEMPRE visivel independentemente do estado da sidebar.
 *
 * Web-only por construcao: so a topbar do shell desktop o importa.
 */
import React, { useState } from "react";
import { Pressable, Text, type GestureResponderEvent } from "react-native";
import { useRouter, type Href } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import {
  ArtworkImage,
  Icon,
  Popover,
  type IconName,
  type PopoverAnchor,
} from "@/ui";

/** Uma linha do menu: o look dos menu-items do SongMenu. */
const AccountMenuRow = ({
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
      onPress={onPress}
      accessibilityRole="menuitem"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 13,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={19} color={tokens.foreground} />
      <Text style={{ color: tokens.foreground, fontSize: 15 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

export const AccountMenu = () => {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const user = useSessionStore((s) => s.user);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);

  if (!user) return null;

  const open = (event: GestureResponderEvent): void => {
    const { pageX, pageY } = event.nativeEvent;
    setAnchor({ x: pageX ?? 0, y: pageY ?? 0 });
  };
  const go = (route: Href): void => {
    setAnchor(null);
    router.push(route);
  };

  return (
    <>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t("native.desktop.profileMenu")}
        style={({ pressed }) => ({
          // O anel subtil da pressao imita o hover-plate do Spotify sem
          // pintar nada em repouso.
          padding: 3,
          borderRadius: 999,
          backgroundColor: pressed ? tokens.secondary : "transparent",
        })}
      >
        <ArtworkImage uri={avatarUrl(user.id)} size={30} shape="circle" />
      </Pressable>
      <Popover
        visible={anchor != null}
        anchor={anchor ?? { x: 0, y: 0 }}
        onClose={() => setAnchor(null)}
      >
        <AccountMenuRow
          icon="user"
          label={t("native.home.viewProfile")}
          onPress={() =>
            go({ pathname: "/(main)/profile/[idOrHandle]", params: { idOrHandle: user.handle } })
          }
        />
        <AccountMenuRow
          icon="users"
          label={t("native.friends.title")}
          onPress={() => go("/(main)/friends")}
        />
        <AccountMenuRow
          icon="download"
          label={t("native.shell.tabDownloads")}
          onPress={() => go("/(main)/settings/downloads-overview")}
        />
        <AccountMenuRow
          icon="settings"
          label={t("native.library.settings")}
          onPress={() => go("/(main)/settings")}
        />
      </Popover>
    </>
  );
};
