/**
 * Artists management (FR-97): the roster table with a client-side name
 * filter, per-row media status (image / banner / gallery), the edit dialog
 * (FLAT rename, `image` and `banner` upload fields) and delete, which the
 * server REFUSES while song_artists still reference the artist - the bare
 * string body is surfaced verbatim instead of a generic error.
 *
 * Redesenho 2026-11-04: linhas na margem comum, esqueleto em vez do
 * spinner, e apagar é optimista (a linha sai logo e volta se o servidor
 * recusar).
 */
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useAllArtists, useDeleteArtist } from "@/api/queries/artists";
import { artistImageSource } from "@/domain/artwork";
import type { Artist } from "@/domain/artist";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, ConfirmDialog, Icon } from "@/ui";
import { cardKeyProps, cardPressRole } from "@/ui/a11y";
import { ListSkeleton, PageState, PageTitle, useGutter } from "@/ui/page";
import { ArtistEditDialog } from "./ArtistEditDialog";
import { NoticeBanner, SearchField, useApiErrorMessage } from "./ui";

const TABLE_KEY = "components.music.Settings.ArtistsTable";
const DELETE_KEY = `${TABLE_KEY}.DeleteArtistDialog`;

const ROW_HEIGHT = 64;

const ArtistManagementRow = React.memo(
  ({
    artist,
    gutter,
    onEdit,
    onDelete,
  }: {
    artist: Artist;
    gutter: number;
    onEdit: (artist: Artist) => void;
    onDelete: (artist: Artist) => void;
  }) => {
    const t = useT();
    const { tokens } = useTheme();
    const image = useMemo(() => artistImageSource(artist, "sm"), [artist]);
    // "sem foto" só quando não há mesmo nada para mostrar (só as iniciais).
    const hasImage = image.kind !== "initials";
    const deletable = artist.songs_count === 0;
    const meta = [
      t("native.downloads.songCount", { count: artist.songs_count }),
      hasImage ? null : t("native.settings.artists.noPhoto"),
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      // The row hosts a REAL button (the trash can), so on web the outer
      // pressable must degrade to a div (cardPressRole) - role="button" here
      // renders a <button> and HTML forbids nesting those (React hydration
      // errors, browsers re-parent the DOM). cardKeyProps keeps the row
      // reachable and Space-activatable for keyboard users. Same pattern as
      // SongRow / ui/a11y.ts.
      <Pressable
        onPress={() => onEdit(artist)}
        accessibilityRole={cardPressRole}
        accessibilityLabel={artist.name}
        {...cardKeyProps(() => onEdit(artist))}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
          height: ROW_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: gutter,
          backgroundColor: pressed ? tokens.secondary : hovered ? tokens.accent : "transparent",
        })}
      >
        <ArtworkImage source={image} size={44} shape="circle" />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 16, fontWeight: "500" }}>
            {artist.name}
          </Text>
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            {meta}
          </Text>
        </View>
        {/* Só quem não tem músicas se pode apagar (o servidor recusa os
            outros): o caixote só aparece onde funciona. */}
        {deletable ? (
          <Pressable
            onPress={() => onDelete(artist)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t(`${TABLE_KEY}.columns.delete`)}
            style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="trash" size={18} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  },
);
ArtistManagementRow.displayName = "ArtistManagementRow";

export default function ArtistsManagementScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const errorMessage = useApiErrorMessage();

  const artistsQuery = useAllArtists();
  const deleteArtist = useDeleteArtist();

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Artist | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Artist | null>(null);
  // Apagados no toque, antes da resposta; voltam se o servidor recusar.
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const artists = useMemo(
    () => (artistsQuery.data ?? []).filter((artist) => !hidden.has(artist.id)),
    [artistsQuery.data, hidden],
  );
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return artists;
    return artists.filter((artist) => artist.name.toLowerCase().includes(term));
  }, [artists, filter]);

  const confirmDelete = (): void => {
    const artist = pendingDelete;
    if (!artist) return;
    setPendingDelete(null);
    setNotice(null);
    setHidden((prev) => new Set(prev).add(artist.id));
    deleteArtist.mutate(artist.id, {
      onSuccess: () => {
        haptics.success();
        setNotice({ kind: "success", text: t(`${DELETE_KEY}.deleted`, { name: artist.name }) });
      },
      onError: (error: unknown) => {
        haptics.error();
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(artist.id);
          return next;
        });
        // The in-use refusal is a bare string body; show it as-is.
        setNotice({ kind: "error", text: errorMessage(error) });
      },
    });
  };

  const onEdit = useCallback((artist: Artist) => setEditing(artist), []);
  const onDelete = useCallback((artist: Artist) => setPendingDelete(artist), []);

  const title = (
    <PageTitle style={{ paddingHorizontal: gutter }}>
      {t("components.music.Settings.ArtistsPage.title")}
    </PageTitle>
  );

  if (artistsQuery.isLoading || artistsQuery.error) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: topPadding, gap: 20 }}>
        {title}
        <PageState
          loading={artistsQuery.isLoading}
          error={artistsQuery.error}
          onRetry={() => void artistsQuery.refetch()}
          skeleton={<ListSkeleton rows={10} round />}
        />
      </View>
    );
  }

  const count = filter.trim() ? filtered.length : artists.length;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(artist) => String(artist.id)}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={16}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
        renderItem={({ item }) => (
          <ArtistManagementRow artist={item} gutter={gutter} onEdit={onEdit} onDelete={onDelete} />
        )}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 12 }}>
            {title}
            <View style={{ paddingHorizontal: gutter, gap: 14 }}>
              <SearchField
                value={filter}
                onChangeText={setFilter}
                placeholder={t(`${TABLE_KEY}.filterByName`)}
              />
              <Text style={{ color: tokens.mutedForeground, fontSize: 14, fontVariant: ["tabular-nums"] }}>
                {t("native.settings.artists.count", { count })}
              </Text>
              {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <PageState
            loading={false}
            empty
            emptyIcon="user"
            emptyText={t("native.settings.artists.emptyFiltered")}
          />
        }
      />

      {editing ? (
        <ArtistEditDialog artist={editing} visible onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t(`${DELETE_KEY}.title`, { name: pendingDelete?.name ?? "" })}
        message={t(`${DELETE_KEY}.description`)}
        confirmLabel={t(`${DELETE_KEY}.confirm`)}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}
