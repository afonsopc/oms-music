/**
 * Playlists list (FR-47): every playlist as a plain row, big artwork, the
 * name and a grey meta line, no boxes. ONE action, in the header: the "+"
 * that opens the create dialog (also offered by the empty state). The
 * dialog invalidates the list, so a new playlist appears without a manual
 * refresh.
 *
 * Synced playlists (kept up to date from outside) say "Sincronizada" in the
 * meta line and nothing else: never the name of where they come from. The
 * read-only rules themselves live on the detail screen (FR-53).
 */
import React, { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import { playlistArtworkSource } from "@/domain/artwork";
import { isSystemPlaylist, type Playlist } from "@/domain/playlist";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, GhostIconButton, Skeleton } from "@/ui";
import { Reveal } from "@/ui/motion";
import { PageHeader, PageState, pageType, useGutter } from "@/ui/page";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { CreatePlaylistDialog } from "./CreatePlaylistDialog";

const ROW_ARTWORK = 64;
/** Fixed: artwork + 8 above and below. Lets the list skip measuring. */
const ROW_HEIGHT = ROW_ARTWORK + 16;
const REVEAL_ROWS = 10;

const PlaylistRow = React.memo(function PlaylistRow({
  playlist,
  index,
  onOpen,
}: {
  playlist: Playlist;
  index: number;
  onOpen: (playlist: Playlist) => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const gutter = useGutter();
  const system = isSystemPlaylist(playlist);
  const row = (
    <Pressable
      onPress={() => onOpen(playlist)}
      accessibilityRole="button"
      accessibilityLabel={playlist.name}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        height: ROW_HEIGHT,
        paddingHorizontal: gutter,
        backgroundColor: pressed ? tokens.secondary : hovered ? tokens.accent : "transparent",
      })}
    >
      <ArtworkImage
        source={playlistArtworkSource(playlist)}
        size={ROW_ARTWORK}
        recyclingKey={String(playlist.id)}
      />
      {/* minWidth 0 lets a long name truncate instead of stretching the row. */}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={[pageType.body, { color: tokens.foreground, fontSize: 17, fontWeight: "600" }]}
          numberOfLines={1}
        >
          {playlist.name}
        </Text>
        {system ? (
          <Text style={[pageType.meta, { color: tokens.mutedForeground }]} numberOfLines={1}>
            {t("components.music.PlaylistView.synced")}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
  return index < REVEAL_ROWS ? (
    <Reveal order={index} distance={8}>
      {row}
    </Reveal>
  ) : (
    row
  );
});

const PlaylistsSkeleton = () => {
  const gutter = useGutter();
  return (
    <View style={{ paddingHorizontal: gutter }}>
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 16, height: ROW_HEIGHT }}>
          <Skeleton width={ROW_ARTWORK} height={ROW_ARTWORK} borderRadius={6} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={`${62 - ((i * 13) % 26)}%`} height={14} />
            {i % 3 === 1 ? <Skeleton width="28%" height={11} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
};

const keyExtractor = (item: Playlist): string => String(item.id);

export default function PlaylistsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(20);
  const [createOpen, setCreateOpen] = useState(false);

  const playlistsQuery = usePlaylists();
  const playlists = playlistsQuery.data ?? [];

  const openCreate = useCallback(() => {
    haptics.select();
    setCreateOpen(true);
  }, []);
  const openPlaylist = useCallback(
    (playlist: Playlist) => router.push(playlistRoute(playlist.id)),
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Playlist; index: number }) => (
      <PlaylistRow playlist={item} index={index} onOpen={openPlaylist} />
    ),
    [openPlaylist],
  );

  const headerHeight = useRef(0);
  const getItemLayout = useCallback(
    (_data: ArrayLike<Playlist> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: headerHeight.current + ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const header = (
    <View
      onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}
      style={{ paddingBottom: 12 }}
    >
      <PageHeader
        title={t("components.music.Playlists.title")}
        trailing={
          <GhostIconButton
            icon="plus"
            size={24}
            onPress={openCreate}
            accessibilityLabel={t("components.music.Playlists.create")}
          />
        }
      />
    </View>
  );

  const retry = () => void playlistsQuery.refetch();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={playlists}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <PageState
            loading={playlistsQuery.isLoading}
            error={playlistsQuery.isError}
            empty
            onRetry={retry}
            skeleton={<PlaylistsSkeleton />}
            emptyIcon="library"
            emptyText={t("components.music.Playlists.emptyHint")}
            emptyActionLabel={t("components.music.Playlists.createFirst")}
            onEmptyAction={openCreate}
          />
        }
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{
          paddingTop: topPadding,
          paddingBottom: bottomPadding,
        }}
      />
      <CreatePlaylistDialog visible={createOpen} onClose={() => setCreateOpen(false)} />
    </View>
  );
}
