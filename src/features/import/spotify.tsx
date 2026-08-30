/**
 * Spotify tab (FR-103). The whole `/spotify_syncs/*` surface answers 403
 * unless the account carries `allowed_to_use_spotify`, so the tab is hidden
 * upstream AND every request here still handles the refusal.
 *
 * Linking reuses the WP2 OAuth module: a WebView renders
 * `/auth/link/spotify?token=<session token>` and intercepts the hardcoded
 * https callback (there is no custom-scheme redirect server-side); the sheet
 * closes on the callback and the status query refetches.
 *
 * Destructive settings are confirmed before the PATCH: deselecting a playlist
 * or turning liked-sync off DELETES the local copies immediately.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  triggerSpotifySync,
  updateSpotifySyncSettings,
  useSpotifySyncPreview,
  useSpotifySyncStatus,
} from "@/api/queries/spotifySync";
import { invalidationTargets, keys } from "@/api/queryKeys";
import { LinkSheet } from "./linkSheet";
import { formatDateTime } from "@/lib/dates";
import {
  GhostButton,
  NoticeBanner,
  PrimaryButton,
  ProgressBar,
  SettingsSection,
  SwitchRow,
  useApiErrorMessage,
} from "@/features/settings/ui";
import { useLocale, useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, ConfirmDialog, Icon } from "@/ui";

const SYNC_KEY = "components.music.Settings.SpotifySync";

const PlaylistProgressRow = ({
  playlist,
}: {
  playlist: {
    id: string;
    name: string;
    total: number | null;
    queued: number;
    skipped: number;
    state: "pending" | "running" | "complete" | "failed";
  };
}) => {
  const t = useT();
  const { tokens, ink } = useTheme();
  const done = playlist.queued + playlist.skipped;
  const ratio = playlist.total && playlist.total > 0 ? done / playlist.total : null;

  return (
    <View
      style={{
        gap: 6,
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: RADIUS,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {playlist.state === "running" ? (
          <ActivityIndicator size="small" color={tokens.mutedForeground} />
        ) : (
          <Icon
            name={playlist.state === "failed" ? "alert-circle" : "circle-check"}
            size={14}
            color={playlist.state === "failed" ? ink.destructive : tokens.mutedForeground}
          />
        )}
        <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 13 }}>
          {playlist.name}
        </Text>
        <Text
          style={{ color: tokens.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] }}
        >
          {playlist.total != null ? `${done} / ${playlist.total}` : `${done}`}
        </Text>
      </View>
      {playlist.state !== "pending" ? (
        <ProgressBar
          value={ratio ?? (playlist.state === "complete" ? 1 : 0.3)}
          kind={
            playlist.state === "failed"
              ? "failed"
              : playlist.state === "complete"
                ? "done"
                : "normal"
          }
        />
      ) : null}
      {playlist.queued > 0 || playlist.skipped > 0 ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>
          {t("native.import.spotify.trackTotals", {
            queued: playlist.queued,
            skipped: playlist.skipped,
          })}
        </Text>
      ) : null}
    </View>
  );
};

export default function SpotifyImportTab() {
  const t = useT();
  const locale = useLocale();
  const { tokens, ink } = useTheme();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const statusQuery = useSpotifySyncStatus();
  const connected = statusQuery.data?.connected ?? false;
  const previewQuery = useSpotifySyncPreview(connected);

  const [linking, setLinking] = useState(false);
  // Optimistic overrides; null means "still showing the server's answer".
  const [enabledEdit, setEnabledEdit] = useState<string[] | null>(null);
  const [likedEdit, setLikedEdit] = useState<boolean | null>(null);
  const [autoSyncEdit, setAutoSyncEdit] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDisable, setPendingDisable] = useState<
    { kind: "playlist"; id: string; name: string } | { kind: "liked" } | null
  >(null);

  const settingsMutation = useMutation({
    mutationFn: updateSpotifySyncSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.spotifySync.status });
      void queryClient.invalidateQueries({ queryKey: keys.spotifySync.preview });
      for (const key of invalidationTargets.libraryLists) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const triggerMutation = useMutation({
    mutationFn: () => triggerSpotifySync(enabledIds ?? undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.spotifySync.status });
    },
    // 409 while a sync is already running arrives as a bare string.
    onError: (e) => setError(errorMessage(e)),
  });

  const previewData = previewQuery.data;
  const serverEnabled = useMemo(
    () =>
      previewData ? previewData.playlists.filter((p) => p.enabled).map((p) => p.id) : null,
    [previewData],
  );
  const settingsAutoSync = statusQuery.data?.sync_settings?.auto_sync;

  const enabledIds = enabledEdit ?? serverEnabled;
  const syncLiked = likedEdit ?? previewData?.sync_liked ?? true;
  // `auto_sync` defaults server-side to "true if ever synced" when unset.
  const autoSync = autoSyncEdit ?? settingsAutoSync ?? false;

  const progress = statusQuery.data?.sync_progress;
  const running = progress?.state === "running";
  const playlistRows = useMemo(() => progress?.playlists ?? [], [progress]);

  const applyPlaylistToggle = (id: string, on: boolean): void => {
    const current = enabledIds ?? [];
    const next = on ? [...current, id] : current.filter((entry) => entry !== id);
    setEnabledEdit(next);
    setError(null);
    settingsMutation.mutate({ enabledPlaylists: next });
  };

  const applyLikedToggle = (on: boolean): void => {
    setLikedEdit(on);
    setError(null);
    settingsMutation.mutate({ syncLiked: on });
  };

  if (statusQuery.isLoading) {
    return (
      <View style={{ paddingVertical: 32, alignItems: "center" }}>
        <ActivityIndicator color={tokens.mutedForeground} />
      </View>
    );
  }

  if (statusQuery.error) {
    return <NoticeBanner kind="error" message={errorMessage(statusQuery.error)} />;
  }

  if (!connected) {
    return (
      <View style={{ gap: 16 }}>
        {/* The allowlist refusal lands here: linking is refused before the
            provider round trip, so the tab never reaches the connected view. */}
        {error ? <NoticeBanner kind="error" message={error} /> : null}
        <SettingsSection title={t(`${SYNC_KEY}.title`)}>
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t(`${SYNC_KEY}.notConnected`)}
            </Text>
            <PrimaryButton
              label={t(`${SYNC_KEY}.connect`)}
              onPress={() => setLinking(true)}
              compact
            />
          </View>
        </SettingsSection>
        <LinkSheet
          visible={linking}
          onDone={(errorKey) => {
            setLinking(false);
            setError(errorKey ? t(errorKey) : null);
            void statusQuery.refetch();
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t(`${SYNC_KEY}.title`)}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: tokens.foreground, fontSize: 14 }}>
            {t(`${SYNC_KEY}.connectedAs`, {
              name: statusQuery.data?.spotify_user_name ?? "Spotify",
            })}
          </Text>
          {statusQuery.data?.last_synced_at && !running ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
              {t(`${SYNC_KEY}.lastSync`, {
                when: formatDateTime(statusQuery.data.last_synced_at, locale),
              })}
            </Text>
          ) : null}
          <PrimaryButton
            label={running ? t(`${SYNC_KEY}.syncing`) : t(`${SYNC_KEY}.syncNow`)}
            onPress={() => triggerMutation.mutate()}
            busy={triggerMutation.isPending || running}
            disabled={running}
            compact
          />
        </View>
      </SettingsSection>

      {error ? <NoticeBanner kind="error" message={error} /> : null}

      {progress && progress.state !== "idle" && playlistRows.length > 0 ? (
        <SettingsSection title={t("native.import.spotify.progressTitle")}>
          <View style={{ padding: 12, gap: 8 }}>
            {progress.state === "failed" && progress.error ? (
              <NoticeBanner kind="error" message={progress.error} />
            ) : null}
            {playlistRows.map((playlist) => (
              <PlaylistProgressRow key={playlist.id} playlist={playlist} />
            ))}
          </View>
        </SettingsSection>
      ) : null}

      <SettingsSection>
        <SwitchRow
          first
          label={t(`${SYNC_KEY}.autoSync`)}
          detail={t(`${SYNC_KEY}.autoSyncHint`)}
          value={autoSync}
          onValueChange={(value) => {
            setAutoSyncEdit(value);
            setError(null);
            settingsMutation.mutate({ autoSync: value });
          }}
        />
        <SwitchRow
          label={t(`${SYNC_KEY}.syncLiked`)}
          detail={t(`${SYNC_KEY}.syncLikedHint`)}
          value={syncLiked}
          onValueChange={(value) => {
            if (!value) setPendingDisable({ kind: "liked" });
            else applyLikedToggle(true);
          }}
        />
      </SettingsSection>

      <SettingsSection title={t(`${SYNC_KEY}.playlistsHeader`)}>
        {previewQuery.isLoading ? (
          <View style={{ padding: 16 }}>
            <ActivityIndicator color={tokens.mutedForeground} />
          </View>
        ) : null}
        {previewQuery.error ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: ink.destructive, fontSize: 12 }}>
              {errorMessage(previewQuery.error)}
            </Text>
          </View>
        ) : null}
        {(previewData?.playlists ?? []).map((playlist, index) => {
          const on = enabledIds?.includes(playlist.id) ?? false;
          return (
            <View
              key={playlist.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: tokens.border,
              }}
            >
              <ArtworkImage uri={playlist.cover_url} size={40} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14 }}>
                  {playlist.name}
                </Text>
                <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                  {playlist.track_count != null
                    ? t(`${SYNC_KEY}.trackCount`, { count: playlist.track_count })
                    : ""}
                  {playlist.owner ? ` - ${playlist.owner}` : ""}
                </Text>
              </View>
              <GhostButton
                label={on ? t("native.import.spotify.enabled") : t("native.import.spotify.disabled")}
                compact
                onPress={() => {
                  if (on) {
                    setPendingDisable({
                      kind: "playlist",
                      id: playlist.id,
                      name: playlist.name,
                    });
                  } else {
                    applyPlaylistToggle(playlist.id, true);
                  }
                }}
              />
            </View>
          );
        })}
      </SettingsSection>

      <ConfirmDialog
        visible={pendingDisable !== null}
        title={t("native.import.spotify.destructiveTitle")}
        message={
          pendingDisable?.kind === "liked"
            ? t("native.import.spotify.destructiveLiked")
            : t("native.import.spotify.destructivePlaylist", {
                name: pendingDisable?.kind === "playlist" ? pendingDisable.name : "",
              })
        }
        confirmLabel={t("native.import.spotify.destructiveConfirm")}
        destructive
        onConfirm={() => {
          if (pendingDisable?.kind === "liked") applyLikedToggle(false);
          if (pendingDisable?.kind === "playlist") applyPlaylistToggle(pendingDisable.id, false);
          setPendingDisable(null);
        }}
        onCancel={() => setPendingDisable(null)}
      />
    </View>
  );
}
