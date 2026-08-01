/**
 * Artists management (FR-97): the roster table with a client-side name
 * filter, per-row media status (image / banner / gallery), the edit dialog
 * (FLAT rename, `image` and `banner` upload fields) and delete, which the
 * server REFUSES while song_artists still reference the artist - the bare
 * string body is surfaced verbatim instead of a generic error.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listArtists } from "@/api/endpoints/artists";
import { useDeleteArtist } from "@/api/queries/artists";
import { guardedQueryFn } from "@/api/queries/common";
import { pageModifier } from "@/api/params";
import { keys } from "@/api/queryKeys";
import { useAuthReady } from "@/auth/guard";
import { artistImageSource } from "@/domain/artwork";
import type { Artist } from "@/domain/artist";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, ConfirmDialog, EmptyState, ErrorState, Icon } from "@/ui";
import { ArtistEditDialog } from "./ArtistEditDialog";
import { NoticeBanner, SearchField, useApiErrorMessage } from "./ui";

const TABLE_KEY = "components.music.Settings.ArtistsTable";
const DELETE_KEY = `${TABLE_KEY}.DeleteArtistDialog`;

const ARTISTS_PAGE = 500;

const useAllArtists = () => {
  const authReady = useAuthReady();
  const filters = { page: ARTISTS_PAGE, order: "name:asc" };
  const key = keys.artists.list(filters);
  return useQuery<Artist[]>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listArtists({ modifiers: { page: pageModifier(1, ARTISTS_PAGE), order: "name:asc" } }),
    ),
    enabled: authReady,
  });
};

const MediaDot = ({ present, label }: { present: boolean; label: string }) => {
  const { tokens } = useTheme();
  return (
    <Text
      style={{
        color: present ? tokens.foreground : tokens.mutedForeground,
        opacity: present ? 1 : 0.45,
        fontSize: 10,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {label}
    </Text>
  );
};

const ArtistManagementRow = React.memo(
  ({
    artist,
    onEdit,
    onDelete,
  }: {
    artist: Artist;
    onEdit: () => void;
    onDelete: () => void;
  }) => {
    const t = useT();
    const { tokens } = useTheme();
    const image = useMemo(() => artistImageSource(artist, "sm"), [artist]);
    const hasImage = !!(artist.compressed_image_fs_node_id || artist.image_fs_node_id);
    const hasBanner = !!(artist.compressed_banner_fs_node_id || artist.banner_fs_node_id);
    const hasGallery = (artist.gallery_image_urls?.length ?? 0) > 0;
    const deletable = artist.songs_count === 0;

    return (
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ArtworkImage source={image} size={44} shape="circle" />
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            numberOfLines={1}
            style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
          >
            {artist.name}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
              {t(`${TABLE_KEY}.columns.songs`)}: {artist.songs_count}
            </Text>
            <MediaDot present={hasImage} label={t("native.settings.artists.mediaImage")} />
            <MediaDot present={hasBanner} label={t("native.settings.artists.mediaBanner")} />
            <MediaDot present={hasGallery} label={t("native.settings.artists.mediaGallery")} />
          </View>
        </View>
        <Pressable
          onPress={onDelete}
          disabled={!deletable}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            deletable ? t(`${TABLE_KEY}.columns.delete`) : t(`${TABLE_KEY}.columns.deleteDisabled`)
          }
          style={{ padding: 6, opacity: deletable ? 1 : 0.35 }}
        >
          <Icon name="trash" size={17} color={tokens.destructive} />
        </Pressable>
      </Pressable>
    );
  },
);
ArtistManagementRow.displayName = "ArtistManagementRow";

export default function ArtistsManagementScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const errorMessage = useApiErrorMessage();

  const artistsQuery = useAllArtists();
  const deleteArtist = useDeleteArtist();

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Artist | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Artist | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const artists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return artists;
    return artists.filter((artist) => artist.name.toLowerCase().includes(term));
  }, [artists, filter]);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setNotice(null);
    try {
      await deleteArtist.mutateAsync(pendingDelete.id);
      setNotice({ kind: "success", text: t(`${DELETE_KEY}.deleted`) });
    } catch (error) {
      // The in-use refusal is a bare string body; show it as-is.
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  if (artistsQuery.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <ActivityIndicator color={tokens.mutedForeground} />
        <Text style={{ color: tokens.mutedForeground }}>{t(`${TABLE_KEY}.loading`)}</Text>
      </View>
    );
  }

  if (artistsQuery.error) {
    return (
      <ErrorState
        text={t(`${TABLE_KEY}.errorLoading`)}
        onRetry={() => void artistsQuery.refetch()}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(artist) => String(artist.id)}
        initialNumToRender={20}
        windowSize={11}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        renderItem={({ item }) => (
          <ArtistManagementRow
            artist={item}
            onEdit={() => setEditing(item)}
            onDelete={() => setPendingDelete(item)}
          />
        )}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}>
              {t("components.music.Settings.ArtistsPage.title")}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t(`${TABLE_KEY}.totalArtists`)}{" "}
              <Text style={{ color: tokens.foreground, fontWeight: "700" }}>{artists.length}</Text>
              {filter.trim() ? `  ${t(`${TABLE_KEY}.filtered`)} ${filtered.length}` : ""}
            </Text>
            {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}
            <SearchField
              value={filter}
              onChangeText={setFilter}
              placeholder={t(`${TABLE_KEY}.filterByName`)}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="user" text={t("native.settings.artists.emptyFiltered")} />
        }
      />

      {editing ? (
        <ArtistEditDialog artist={editing} visible onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t(`${DELETE_KEY}.title`)}
        message={t(`${DELETE_KEY}.description`)}
        confirmLabel={t(`${DELETE_KEY}.confirm`)}
        destructive
        pending={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}
