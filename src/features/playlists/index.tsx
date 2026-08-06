/**
 * Playlists list (FR-47): every playlist as a full-width outline row with
 * 96pt artwork, a Create action in the header, and the empty state that
 * offers to create the first one. The create dialog invalidates the list,
 * so a new playlist appears without a manual refresh.
 *
 * System (Spotify-synced) playlists carry the "Synced from Spotify"
 * subtitle here too; the read-only rules themselves live on the detail
 * screen (FR-53).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { usePlaylists } from "@/api/queries/playlists";
import { playlistArtworkSource } from "@/domain/artwork";
import { isSystemPlaylist, type Playlist } from "@/domain/playlist";
import { useT } from "@/i18n";
import { playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, EmptyState, ErrorState, Icon } from "@/ui";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { CreatePlaylistDialog } from "./CreatePlaylistDialog";

const ROW_ARTWORK = 96;

const PlaylistRow = ({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) => {
  const { tokens } = useTheme();
  const t = useT();
  const system = isSystemPlaylist(playlist);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playlist.name}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: RADIUS,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ArtworkImage
        source={playlistArtworkSource(playlist)}
        size={ROW_ARTWORK}
        recyclingKey={String(playlist.id)}
      />
      {/* minWidth 0 lets a long name truncate instead of stretching the row. */}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}
          numberOfLines={2}
        >
          {playlist.name}
        </Text>
        {system ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
            {t("components.music.PlaylistView.syncedFromSpotify")}
          </Text>
        ) : null}
      </View>
      <Icon name="play" size={16} color={tokens.mutedForeground} />
    </Pressable>
  );
};

export default function PlaylistsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(20);
  const [createOpen, setCreateOpen] = useState(false);

  const playlistsQuery = usePlaylists();
  const playlists = playlistsQuery.data ?? [];

  const renderItem = useCallback(
    ({ item }: { item: Playlist }) => (
      <PlaylistRow playlist={item} onPress={() => router.push(playlistRoute(item.id))} />
    ),
    [router],
  );

  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 16,
      }}
    >
      <Text
        style={{ color: tokens.foreground, fontSize: 24, fontWeight: "800", flex: 1 }}
        numberOfLines={1}
      >
        {t("components.music.Playlists.title")}
      </Text>
      <Pressable
        onPress={() => setCreateOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: tokens.primary,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Icon name="plus" size={16} color={tokens.primaryForeground} />
        <Text style={{ color: tokens.primaryForeground, fontWeight: "700", fontSize: 14 }}>
          {t("components.music.Playlists.create")}
        </Text>
      </Pressable>
    </View>
  );

  const empty = playlistsQuery.isLoading ? (
    <View style={{ paddingVertical: 40 }}>
      <ActivityIndicator />
    </View>
  ) : playlistsQuery.isError ? (
    <ErrorState
      text={t("components.music.Playlists.error")}
      onRetry={() => void playlistsQuery.refetch()}
    />
  ) : (
    <EmptyState
      icon="library"
      text={t("components.music.Playlists.emptyHint")}
      actionLabel={t("components.music.Playlists.createFirst")}
      onAction={() => setCreateOpen(true)}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={playlists}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: topPadding,
          paddingBottom: bottomPadding,
        }}
      />
      <CreatePlaylistDialog visible={createOpen} onClose={() => setCreateOpen(false)} />
    </View>
  );
}
