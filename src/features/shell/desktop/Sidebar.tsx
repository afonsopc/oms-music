/**
 * Barra lateral do computador (ronda 2, 2026-11-04, idioma do Apple Music
 * escolhido pelo dono): a pesquisa no topo, depois a navegação (Início,
 * Explorar, Rádio, Assistente), a Biblioteca (Gostadas, Playlists,
 * Artistas, Álbuns) e por fim a lista das playlists. Uma linha activa tem o
 * fundo cinzento arredondado e o ícone no destaque.
 *
 * Recolhida, fica só o carril de ícones. O estado recolhido persiste
 * (layoutPrefs); a lista das playlists não é pedida enquanto está recolhida.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import { playlistArtworkSource } from "@/domain/artwork";
import { playlistRoute } from "@/lib/routes";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ACCENT } from "@/theme/tokens";
import { ArtworkImage, GhostIconButton, Icon, type IconName } from "@/ui";
import { TopBarSearch } from "./TopBarSearch";

export interface DesktopSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Dentro do Tauri: os semáforos do macOS flutuam no canto, a faixa de cima fica livre e arrasta a janela. */
  tauri?: boolean;
}

/** Altura da faixa dos semáforos no Tauri. */
const TAURI_TOP_INSET = 40;

interface NavItem {
  key: string;
  icon: IconName;
  labelKey: string;
  route: string;
  /** Também activo nestes caminhos (a pesquisa vive em /search). */
  match?: (path: string) => boolean;
}

const NAV: NavItem[] = [
  { key: "home", icon: "music", labelKey: "native.shell.tabHome", route: "/home" },
  { key: "explore", icon: "compass", labelKey: "native.desktop.navExplore", route: "/search" },
  { key: "radio", icon: "radio", labelKey: "native.desktop.navRadio", route: "/dj" },
  { key: "assistant", icon: "sparkles", labelKey: "native.shell.tabAssistant", route: "/assistant", match: (p) => p.startsWith("/assistant") },
];

const LIBRARY: NavItem[] = [
  { key: "liked", icon: "heart", labelKey: "components.music.Sidebar.liked", route: "/liked" },
  { key: "playlists", icon: "list-music", labelKey: "components.music.Sidebar.playlists", route: "/playlists" },
  { key: "artists", icon: "users", labelKey: "components.music.Sidebar.artists", route: "/artists" },
  { key: "albums", icon: "disc", labelKey: "native.desktop.navAlbums", route: "/library" },
];

const Row = ({
  label,
  active,
  collapsed,
  onPress,
  leading,
}: {
  label: string;
  active: boolean;
  collapsed: boolean;
  onPress: () => void;
  leading: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 12,
        minHeight: 36,
        paddingVertical: 4,
        paddingHorizontal: collapsed ? 0 : 10,
        borderRadius: 8,
        backgroundColor: active ? tokens.muted : hovered ? tokens.secondary : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {leading}
      {collapsed ? null : (
        <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: active ? "600" : "500" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};

const Heading = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "600", paddingHorizontal: 10, marginTop: 20, marginBottom: 4 }}>
      {text}
    </Text>
  );
};

export const DesktopSidebar = ({ collapsed, onToggleCollapsed, tauri = false }: DesktopSidebarProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const accent = ACCENT[scheme].ink;
  const playlistsQuery = usePlaylists({ enabled: !collapsed });
  const playlists = playlistsQuery.data ?? [];

  const isActive = (item: NavItem): boolean => (item.match ? item.match(path) : path === item.route);
  const navRow = (item: NavItem) => {
    const active = isActive(item);
    return (
      <Row
        key={item.key}
        label={t(item.labelKey)}
        active={active}
        collapsed={collapsed}
        onPress={() => router.push(item.route as Href)}
        leading={<Icon name={item.icon} size={18} color={accent} filled={item.icon === "heart"} />}
      />
    );
  };

  const header = (
    <View>
      {collapsed ? null : (
        <View style={{ marginBottom: 8, zIndex: 50 }}>
          <TopBarSearch />
        </View>
      )}
      <View style={{ gap: 2 }}>{NAV.map(navRow)}</View>
      {collapsed ? <View style={{ height: 16 }} /> : <Heading text={t("native.desktop.sectionLibrary")} />}
      <View style={{ gap: 2 }}>{LIBRARY.map(navRow)}</View>
      {collapsed || playlists.length === 0 ? null : <Heading text={t("native.desktop.sectionPlaylists")} />}
    </View>
  );

  return (
    <View style={{ flex: 1, paddingTop: tauri ? TAURI_TOP_INSET : 16 }}>
      {tauri ? (
        <View
          {...{ dataSet: { "tauri-drag-region": "true" } }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: TAURI_TOP_INSET }}
        />
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: collapsed ? 8 : 12, paddingBottom: 12, gap: 2 }}
        data={collapsed ? [] : playlists}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ zIndex: 50 }}
        renderItem={({ item }) => {
          const route = playlistRoute(item.id);
          return (
            <Row
              label={item.name}
              active={path === route}
              collapsed={false}
              onPress={() => router.push(route)}
              leading={
                <ArtworkImage
                  source={playlistArtworkSource(item)}
                  size={28}
                  borderRadius={5}
                  recyclingKey={`pl:${item.id}`}
                />
              }
            />
          );
        }}
        initialNumToRender={30}
        keyboardShouldPersistTaps="handled"
      />
      <View style={{ flexDirection: "row", justifyContent: collapsed ? "center" : "flex-end", paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: tokens.border, paddingTop: 6 }}>
        <GhostIconButton
          icon={collapsed ? "chevron-right" : "chevron-left"}
          size={16}
          accessibilityLabel={collapsed ? t("components.music.Sidebar.expandSidebar") : t("components.music.Sidebar.collapseSidebar")}
          onPress={onToggleCollapsed}
        />
      </View>
    </View>
  );
};
