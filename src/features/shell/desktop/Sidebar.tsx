/**
 * Desktop sidebar, first iteration (plano-uma-so-app 4.3, row 1): the
 * persistent left column that replaces the bottom tab bar. Top block is the
 * icon rail (Home / Search / Library, the exact three tabs); below it the
 * sidebar renders the LIBRARY itself - playlists, artists and albums with
 * filter chips and a local search box, reusing the Library tab's queries and
 * its pure row assembly (buildLibraryRows) so both surfaces filter and label
 * rows identically forever.
 *
 * The list is topped by the PINNED Liked Songs row (immune to the chips) and
 * the column ends in the account block: avatar + name (avatar alone on the
 * rail) opening the anchored profile menu - profile, friends, downloads,
 * settings, the four destinations the Library tab's quick links used to own.
 *
 * Collapsed, it narrows to the icon rail plus that avatar. Collapse state,
 * active chip and search text persist through layoutPrefs (4.5): a desktop
 * app REMEMBERS its layout, and the queries stay off while collapsed so a
 * closed sidebar costs no network.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, useSegments } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import { useLibraryAlbums, useLibraryArtists } from "@/features/library/queries";
import {
  buildLibraryRows,
  likedLibraryRow,
  rowMatchesSearch,
  type LibraryFilter,
  type LibraryRow,
} from "@/features/library/rows";
import { TabIcon, type TabIconName } from "@/features/shell/TabIcon";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import {
  ArtworkImage,
  EmptyState,
  FilterPills,
  GhostIconButton,
  Icon,
} from "@/ui";
import {
  readSidebarFilter,
  readSidebarSearch,
  writeSidebarFilter,
  writeSidebarSearch,
} from "./layoutPrefs";

export interface DesktopSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface NavItem {
  key: TabIconName;
  labelKey: string;
  // Rotas NUAS, sem prefixo de grupo: desde a migracao para native tabs cada
  // tab tem a sua stack e cada uma destas tres so existe no seu grupo, por
  // isso a forma nua e inequivoca. Prefixar com o grupo passaria a ser um
  // caminho invalido nos typed routes.
  route: "/home" | "/search" | "/library" | "/assistant";
}

// Sem "Pesquisar" de proposito (dono, 2026-08-17): no desktop a pesquisa
// vive na topbar (campo sempre visivel + Cmd+K), e uma linha de navegacao
// para uma pagina cujo unico papel la e "ver todos" nao ganhava o lugar.
// O ponto 18 tentou salva-la (navegar e focar); a resposta foi tirar de vez.
const NAV_ITEMS: NavItem[] = [
  { key: "home", labelKey: "native.shell.tabHome", route: "/home" },
  { key: "library", labelKey: "native.shell.tabLibrary", route: "/library" },
  { key: "assistant", labelKey: "native.shell.tabAssistant", route: "/assistant" },
];

const NavRow = ({
  item,
  active,
  collapsed,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  const tint = active ? tokens.primary : tokens.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(item.labelKey)}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 14,
        height: 44,
        paddingHorizontal: collapsed ? 0 : 12,
        borderRadius: RADIUS,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <TabIcon name={item.key} color={tint} />
      {collapsed ? null : (
        <Text
          style={{
            color: active ? tokens.foreground : tokens.mutedForeground,
            fontSize: 15,
            fontWeight: "600",
          }}
          numberOfLines={1}
        >
          {t(item.labelKey)}
        </Text>
      )}
    </Pressable>
  );
};

/** Compact library row: 36px artwork, one-line name + kind subtitle. */
const SidebarRow = ({ row, onPress }: { row: LibraryRow; onPress: () => void }) => {
  const { tokens, ink } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.name}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: RADIUS,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ArtworkImage
        source={row.artwork}
        size={36}
        shape={row.circular ? "circle" : "rounded"}
        recyclingKey={row.key}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              color: tokens.foreground,
              fontSize: 13,
              fontWeight: row.pinned ? "700" : "500",
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          {row.system ? (
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ink.sync }} />
          ) : null}
        </View>
        <Text style={{ color: tokens.mutedForeground, fontSize: 11 }} numberOfLines={1}>
          {row.subtitle}
        </Text>
      </View>
    </Pressable>
  );
};

export const DesktopSidebar = ({ collapsed, onToggleCollapsed }: DesktopSidebarProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();
  const segments = useSegments() as string[];

  // Chip + search text hydrate from kv so a reload keeps the shape (4.5).
  const [filter, setFilterState] = useState<LibraryFilter>(readSidebarFilter);
  const [search, setSearchState] = useState<string>(readSidebarSearch);

  const setFilter = (next: LibraryFilter): void => {
    setFilterState(next);
    writeSidebarFilter(next);
  };
  const setSearch = (next: string): void => {
    setSearchState(next);
    writeSidebarSearch(next);
  };

  // Same gating discipline as the Library tab: the active chip decides which
  // lists load, and a collapsed sidebar loads nothing at all.
  const wantsPlaylists = !collapsed && (filter === "all" || filter === "playlists");
  const wantsArtists = !collapsed && (filter === "all" || filter === "artists");
  const wantsAlbums = !collapsed && (filter === "all" || filter === "albums");

  const playlistsQuery = usePlaylists({ enabled: wantsPlaylists });
  const artistsQuery = useLibraryArtists(wantsArtists);
  const albumsQuery = useLibraryAlbums(wantsAlbums);

  const labels = useMemo(
    () => ({
      playlistKind: t("components.music.Sidebar.playlistKind"),
      artistKind: t("components.music.Sidebar.artistKind"),
      albumKind: t("components.music.Sidebar.albumKind"),
      spotify: t("components.music.Sidebar.syncedFromSpotify"),
    }),
    [t],
  );

  const rows = useMemo(
    () =>
      buildLibraryRows(
        filter,
        {
          playlists: playlistsQuery.data ?? [],
          artists: artistsQuery.data ?? [],
          albums: albumsQuery.data ?? [],
        },
        search,
        labels,
      ),
    [filter, playlistsQuery.data, artistsQuery.data, albumsQuery.data, search, labels],
  );

  // Pinned above the list, but ONLY where a playlist belongs: Tudo and
  // Playlists. A "playlist Gostadas" no meio dos artistas ou dos albuns e
  // ruido, nao ancora (feedback do dono 2026-08-14).
  const likedRow = useMemo(
    () => likedLibraryRow(t("components.music.Sidebar.liked"), labels.playlistKind),
    [t, labels],
  );
  const wantsLiked = filter === "all" || filter === "playlists";
  const data = useMemo(
    () => (wantsLiked && rowMatchesSearch(likedRow, search) ? [likedRow, ...rows] : rows),
    [wantsLiked, likedRow, rows, search],
  );

  const isLoading =
    (wantsPlaylists && playlistsQuery.isLoading) ||
    (wantsArtists && artistsQuery.isLoading) ||
    (wantsAlbums && albumsQuery.isLoading);

  const activeTab = segments.includes("(tabs)") ? segments[segments.length - 1] : null;

  const pills = [
    { key: "all", label: t("components.music.Sidebar.filterAll") },
    { key: "playlists", label: t("components.music.Sidebar.filterPlaylists") },
    { key: "artists", label: t("components.music.Sidebar.filterArtists") },
    { key: "albums", label: t("components.music.Sidebar.filterAlbums") },
  ];

  // The pinned row keeps the list technically non-empty, so the loading /
  // empty message drops to the FOOTER whenever only Liked Songs rendered.
  const statusFallback = isLoading ? (
    <Text style={{ color: tokens.mutedForeground, fontSize: 12, paddingHorizontal: 12 }}>
      {t("components.music.Sidebar.loading")}
    </Text>
  ) : (
    <EmptyState
      icon="library"
      text={
        search.trim()
          ? t("native.library.noFilterMatches")
          : t("components.music.Sidebar.emptyLibrary")
      }
    />
  );

  return (
    // paddingBottom 0: a lista rola ate BATER no limite do cartao (feedback
    // do dono); so o topo respira.
    <View style={{ flex: 1, paddingHorizontal: collapsed ? 6 : 10, paddingTop: 10, gap: 4 }}>
      <View style={{ gap: 2 }}>
        {NAV_ITEMS.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            active={activeTab === item.key}
            collapsed={collapsed}
            onPress={() => router.push(item.route)}
          />
        ))}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          paddingLeft: collapsed ? 0 : 12,
          marginTop: 8,
        }}
      >
        {collapsed ? null : (
          <Text
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700", flexShrink: 1 }}
            numberOfLines={1}
          >
            {t("components.music.Sidebar.libraryTitle")}
          </Text>
        )}
        <GhostIconButton
          icon={collapsed ? "chevron-right" : "chevron-left"}
          size={16}
          accessibilityLabel={
            collapsed
              ? t("components.music.Sidebar.expandSidebar")
              : t("components.music.Sidebar.collapseSidebar")
          }
          onPress={onToggleCollapsed}
        />
      </View>

      {collapsed ? null : (
        <>
          {/* Full-bleed strip: the negative margin lets overflowing pills
              scroll across the card's whole width, the inset re-aligns pill
              one with the search capsule below. */}
          <FilterPills
            pills={pills}
            activeKey={filter}
            onChange={(key) => setFilter(key as LibraryFilter)}
            contentPaddingHorizontal={10}
            style={{ flexGrow: 0, marginHorizontal: -10 }}
          />

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 10,
              height: 34,
              borderRadius: 999,
              backgroundColor: tokens.secondary,
              marginTop: 4,
            }}
          >
            <Icon name="search" size={14} color={tokens.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t("components.music.Sidebar.searchPlaceholder")}
              placeholderTextColor={tokens.mutedForeground}
              autoCorrect={false}
              accessibilityLabel={t("components.music.Sidebar.searchPlaceholder")}
              style={{ flex: 1, color: tokens.foreground, fontSize: 13 }}
            />
            {search.length > 0 ? (
              <Pressable
                onPress={() => setSearch("")}
                accessibilityRole="button"
                accessibilityLabel={t("components.music.MusicSearchInput.clear")}
                hitSlop={8}
              >
                <Icon name="x" size={13} color={tokens.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <FlatList
            style={{ flex: 1, marginTop: 4 }}
            data={data}
            keyExtractor={(row) => row.key}
            renderItem={({ item }) => (
              <SidebarRow row={item} onPress={() => router.push(item.route)} />
            )}
            ListEmptyComponent={statusFallback}
            ListFooterComponent={data.length > 0 && rows.length === 0 ? statusFallback : null}
            initialNumToRender={30}
            maxToRenderPerBatch={30}
            windowSize={11}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
          />
        </>
      )}

      {/* A conta mudou-se para o canto direito da topbar (AccountMenu.tsx,
          o sitio do Spotify) - a sidebar acaba na lista. */}
    </View>
  );
};
