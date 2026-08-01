/**
 * URL-import confirm sheet (FR-101/102). Per-track title/artist/album edits,
 * artwork picker (search or upload), target selector (new playlist / existing
 * playlist / library only), then SEQUENTIAL `POST /song_imports` with
 * incrementing positions - order matters, so the requests are not parallel.
 *
 * Progress: each created import polls `GET /song_imports/:id` every 1.5 s
 * while pending/processing (the query hook stops on terminal states and never
 * polls a `deduped: true` create, which is already complete).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSongImport, searchArtwork } from "@/api/endpoints/imports";
import { useSongImportPoll } from "@/api/queries/imports";
import { useCreatePlaylist, usePlaylists } from "@/api/queries/playlists";
import { invalidationTargets } from "@/api/queryKeys";
import type { PlaylistId } from "@/domain/ids";
import type { ArtworkSearchItem } from "@/domain/imports";
import { pickImage, readBase64 } from "@/features/settings/pickers";
import {
  GhostButton,
  LabeledField,
  NoticeBanner,
  PrimaryButton,
  ProgressBar,
  SearchField,
  ToggleChip,
  useApiErrorMessage,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, BottomSheet, Icon } from "@/ui";
import {
  importPercent,
  songImportBody,
  type ArtworkSelection,
  type ImportableTrack,
} from "./urlImport";
import { setImportBusy } from "./importBusy";

const MODAL_KEY = "components.music.Settings.PlaylistImport.modal";

type TargetMode = "new" | "existing" | "library";

const artworkUri = (track: ImportableTrack): string | null => {
  if (track.artwork?.kind === "url") return track.artwork.url;
  if (track.artwork?.kind === "data") return track.artwork.previewUri ?? null;
  return track.thumbnailUrl ?? null;
};

/** A finished import means new library rows: refresh the lists once. */
const useLibraryRefreshOnComplete = (songId: number | null): void => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (songId == null) return;
    for (const key of invalidationTargets.libraryLists) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [songId, queryClient]);
};

const TrackProgressRow = ({ importId }: { importId: number }) => {
  const t = useT();
  const { tokens } = useTheme();
  const query = useSongImportPoll(importId);
  const data = query.data;
  useLibraryRefreshOnComplete(data?.state === "complete" ? data.song_id : null);

  if (!data) return null;
  const percent = importPercent(data.progress_pct);
  const failed = data.state === "failed";

  return (
    <View style={{ gap: 4, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: tokens.mutedForeground, fontSize: 11, flex: 1 }} numberOfLines={1}>
          {data.deduped
            ? t("native.import.url.deduped")
            : (data.progress_message ?? data.state)}
        </Text>
        <Text
          style={{ color: tokens.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] }}
        >
          {percent}%
        </Text>
      </View>
      <ProgressBar
        value={percent / 100}
        kind={failed ? "failed" : data.state === "complete" ? "done" : "normal"}
      />
      {failed && data.error_message ? (
        <Text style={{ color: tokens.destructive, fontSize: 11 }}>{data.error_message}</Text>
      ) : null}
    </View>
  );
};

const TrackStateIcon = ({ importId }: { importId: number | undefined }) => {
  const { tokens } = useTheme();
  const query = useSongImportPoll(importId ?? null, importId != null);
  const data = query.data;
  useLibraryRefreshOnComplete(data?.state === "complete" ? data.song_id : null);
  if (importId == null) return null;
  const state = data?.state;
  if (state === "complete") return <Icon name="circle-check" size={15} color={tokens.primary} />;
  if (state === "failed") return <Icon name="x" size={15} color={tokens.destructive} />;
  return <ActivityIndicator size="small" color={tokens.mutedForeground} />;
};

const ArtworkPickerSheet = ({
  visible,
  onClose,
  seed,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  seed: { artist: string; title: string; album: string };
  onSelect: (selection: ArtworkSelection) => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();
  // Mounted only while open (the parent gates it), so the seed query is an
  // initial value rather than an effect.
  const [query, setQuery] = useState(() => `${seed.artist} ${seed.title}`.trim());
  const [items, setItems] = useState<ArtworkSearchItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await searchArtwork({
        artist: seed.artist || undefined,
        title: seed.title || undefined,
        album: seed.album || undefined,
        query: query.trim() || undefined,
      });
      setItems(response.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await pickImage();
      if (!picked) return;
      const base64 = await readBase64(picked.uri);
      onSelect({ kind: "data", base64, previewUri: picked.uri });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 12 }}>
        <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "700" }}>
          {t(`${MODAL_KEY}.artworkSection`)}
        </Text>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("native.import.url.artworkSearchPlaceholder")}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t("native.import.url.artworkSearch")}
              onPress={() => void runSearch()}
              busy={busy}
              compact
            />
          </View>
          <View style={{ flex: 1 }}>
            <GhostButton
              label={t("native.import.url.artworkUpload")}
              onPress={() => void upload()}
              compact
            />
          </View>
        </View>
        {error ? <NoticeBanner kind="error" message={error} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {items.map((item) => (
            <Pressable
              key={item.url}
              accessibilityRole="button"
              onPress={() => {
                onSelect({ kind: "url", url: item.url });
                onClose();
              }}
            >
              <ArtworkImage uri={item.thumb_url ?? item.url} size={78} />
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
};

export const UrlImportConfirm = ({
  visible,
  onClose,
  tracks,
  onTracksChange,
  playlistTitle,
}: {
  visible: boolean;
  onClose: () => void;
  tracks: ImportableTrack[];
  onTracksChange: (next: ImportableTrack[]) => void;
  playlistTitle?: string;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();

  const playlistsQuery = usePlaylists({ enabled: visible });
  const createPlaylist = useCreatePlaylist();
  const createImport = useMutation({ mutationFn: createSongImport });

  // The sheet is mounted only while open (the tab gates it), so closing it
  // resets this state; nothing needs an effect to clean up.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [targetMode, setTargetMode] = useState<TargetMode>("new");
  // null = still following the preview's playlist title.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [existingPlaylistId, setExistingPlaylistId] = useState<PlaylistId | null>(null);
  const [importIds, setImportIds] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newPlaylistName = nameEdit ?? playlistTitle ?? "";
  const safeIndex = tracks.length === 0 ? 0 : Math.min(selectedIndex, tracks.length - 1);
  const current = tracks[safeIndex];
  const started = Object.keys(importIds).length > 0;

  const targetValid =
    targetMode === "library" ||
    (targetMode === "new" && newPlaylistName.trim().length > 0) ||
    (targetMode === "existing" && existingPlaylistId != null);

  const updateCurrent = (patch: Partial<ImportableTrack>): void => {
    onTracksChange(
      tracks.map((track, index) => (index === safeIndex ? { ...track, ...patch } : track)),
    );
  };

  const playlists = useMemo(
    () => (playlistsQuery.data ?? []).filter((playlist) => !playlist.source_kind || playlist.source_kind === "manual"),
    [playlistsQuery.data],
  );

  const start = async (): Promise<void> => {
    if (!targetValid || tracks.length === 0) return;
    setRunning(true);
    setImportBusy(true);
    setError(null);
    try {
      let playlistId: PlaylistId | null = null;
      if (targetMode === "existing") {
        playlistId = existingPlaylistId;
      } else if (targetMode === "new") {
        const created = await createPlaylist.mutateAsync({ name: newPlaylistName.trim() });
        playlistId = created.id;
      }

      const next: Record<string, number> = {};
      let position = 1;
      for (const track of tracks) {
        try {
          const record = await createImport.mutateAsync(
            songImportBody(track, playlistId, position),
          );
          next[track.key] = record.id;
          position += 1;
          setImportIds({ ...next });
        } catch (e) {
          // One bad track never aborts the batch; its row simply has no id.
          setError(errorMessage(e));
        }
      }
      setImportIds(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
      setImportBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}>
            {t(`${MODAL_KEY}.title`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {tracks.length === 1
              ? t(`${MODAL_KEY}.subtitleSingle`)
              : t(`${MODAL_KEY}.subtitleMulti`, { count: tracks.length })}
          </Text>

          {error ? <NoticeBanner kind="error" message={error} /> : null}

          <View
            style={{
              gap: 10,
              borderWidth: 1,
              borderColor: tokens.border,
              borderRadius: RADIUS,
              padding: 12,
            }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "700" }}>
              {t(`${MODAL_KEY}.targetLabel`)}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ToggleChip
                label={t(`${MODAL_KEY}.targetNew`)}
                active={targetMode === "new"}
                onPress={() => setTargetMode("new")}
                disabled={started}
              />
              <ToggleChip
                label={t(`${MODAL_KEY}.targetExisting`)}
                active={targetMode === "existing"}
                onPress={() => setTargetMode("existing")}
                disabled={started}
              />
              <ToggleChip
                label={t(`${MODAL_KEY}.targetLibrary`)}
                active={targetMode === "library"}
                onPress={() => setTargetMode("library")}
                disabled={started}
              />
            </View>
            {targetMode === "new" ? (
              <LabeledField
                label={t(`${MODAL_KEY}.targetNewPlaceholder`)}
                value={newPlaylistName}
                onChangeText={setNameEdit}
              />
            ) : null}
            {targetMode === "existing" ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                  {t(`${MODAL_KEY}.targetExistingPlaceholder`)}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {playlists.map((playlist) => (
                    <ToggleChip
                      key={playlist.id}
                      label={playlist.name}
                      active={existingPlaylistId === playlist.id}
                      onPress={() => setExistingPlaylistId(playlist.id)}
                      disabled={started}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          {tracks.length > 1 ? (
            <View style={{ gap: 6 }}>
              {tracks.map((track, index) => (
                <Pressable
                  key={track.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === safeIndex }}
                  onPress={() => setSelectedIndex(index)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 8,
                    borderRadius: RADIUS,
                    backgroundColor:
                      index === safeIndex ? tokens.secondary : "transparent",
                  }}
                >
                  <ArtworkImage uri={artworkUri(track)} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}
                    >
                      {track.title || track.webpageUrl}
                    </Text>
                    <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 11 }}>
                      {track.artist}
                    </Text>
                  </View>
                  <TrackStateIcon importId={importIds[track.key]} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {current ? (
            <View style={{ gap: 12 }}>
              <LabeledField
                label={t(`${MODAL_KEY}.metaTitle`)}
                value={current.title}
                onChangeText={(value) => updateCurrent({ title: value })}
              />
              <LabeledField
                label={t(`${MODAL_KEY}.metaArtist`)}
                value={current.artist}
                onChangeText={(value) => updateCurrent({ artist: value })}
                autoCapitalize="words"
              />
              <LabeledField
                label={t(`${MODAL_KEY}.metaAlbum`)}
                value={current.album}
                onChangeText={(value) => updateCurrent({ album: value })}
              />

              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <ArtworkImage uri={artworkUri(current)} size={64} />
                <View style={{ flex: 1 }}>
                  <GhostButton
                    label={t(`${MODAL_KEY}.artworkSection`)}
                    compact
                    onPress={() => setArtworkOpen(true)}
                  />
                </View>
              </View>

              {importIds[current.key] != null ? (
                <TrackProgressRow importId={importIds[current.key] as number} />
              ) : null}
            </View>
          ) : (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t(`${MODAL_KEY}.noTrackSelected`)}
            </Text>
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: 12,
            padding: 20,
            borderTopWidth: 1,
            borderTopColor: tokens.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <GhostButton label={t(`${MODAL_KEY}.close`)} onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={
                tracks.length > 1
                  ? t(`${MODAL_KEY}.importAll`, { count: tracks.length })
                  : t(`${MODAL_KEY}.importOne`)
              }
              onPress={() => void start()}
              busy={running}
              disabled={!targetValid || started || tracks.length === 0}
            />
          </View>
        </View>
      </View>

      {current && artworkOpen ? (
        <ArtworkPickerSheet
          visible
          onClose={() => setArtworkOpen(false)}
          seed={{ artist: current.artist, title: current.title, album: current.album }}
          onSelect={(selection) => updateCurrent({ artwork: selection })}
        />
      ) : null}
    </Modal>
  );
};
