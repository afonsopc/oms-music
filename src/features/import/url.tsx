/**
 * URL tab (FR-101). Step 1 is the preview: `POST /playlist_imports/preview`
 * with the pasted URL. The error taxonomy is inline and never auto-retried
 * (previews are capped at 60/h and each one runs yt-dlp):
 *
 *  - 400 with the Spotify message: Spotify URLs cannot be imported by URL;
 *  - 400 "url is not allowed": the SSRF guard;
 *  - 502: the upstream yt-dlp text, shown verbatim;
 *  - 429: the shared rate-limit copy with retry_after.
 *
 * All of those arrive as bare-string bodies, so `useApiErrorMessage` prints
 * them as-is. Step 2 (edits, artwork, target, sequential imports) lives in
 * urlConfirm.tsx.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { previewPlaylistImport } from "@/api/queries/imports";
import {
  GhostButton,
  NoticeBanner,
  PrimaryButton,
  SearchField,
  SettingsSection,
  useApiErrorMessage,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { useImportBusy } from "./importBusy";
import { UrlImportConfirm } from "./urlConfirm";
import { previewTitle, tracksFromPreview, type ImportableTrack } from "./urlImport";

const IMPORT_KEY = "components.music.Settings.PlaylistImport";

export default function UrlImportTab() {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();
  const busy = useImportBusy();

  const [url, setUrl] = useState("");
  const [tracks, setTracks] = useState<ImportableTrack[]>([]);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: (target: string) => previewPlaylistImport(target),
    onSuccess: (data) => {
      const next = tracksFromPreview(data);
      setTitle(previewTitle(data));
      setTracks(next);
      if (next.length > 0) setConfirmOpen(true);
      else setError(t("native.import.url.noTracks"));
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const runPreview = (): void => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setTracks([]);
    preview.mutate(trimmed);
  };

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t(`${IMPORT_KEY}.title`)}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {t(`${IMPORT_KEY}.subtitle`)}
          </Text>
          <SearchField
            value={url}
            onChangeText={setUrl}
            placeholder={t(`${IMPORT_KEY}.urlPlaceholder`)}
          />
          <PrimaryButton
            label={t(`${IMPORT_KEY}.preview`)}
            onPress={runPreview}
            busy={preview.isPending}
            disabled={!url.trim() || busy}
            compact
          />
          {busy ? (
            <NoticeBanner
              kind="info"
              message={t("components.music.Settings.importInProgressDescription")}
            />
          ) : null}
        </View>
      </SettingsSection>

      {error ? <NoticeBanner kind="error" message={error} /> : null}

      {tracks.length > 0 && !confirmOpen ? (
        <SettingsSection>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 16,
            }}
          >
            <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 13 }}>
              {title ? `${title} - ` : ""}
              {tracks.length} {t(`${IMPORT_KEY}.tracks`)}
            </Text>
            <GhostButton
              label={t(`${IMPORT_KEY}.openConfirm`)}
              compact
              onPress={() => setConfirmOpen(true)}
            />
          </View>
        </SettingsSection>
      ) : null}

      {/* Mounted only while open so closing it discards the run state. */}
      {confirmOpen ? (
        <UrlImportConfirm
          visible
          onClose={() => setConfirmOpen(false)}
          tracks={tracks}
          onTracksChange={setTracks}
          playlistTitle={title}
        />
      ) : null}
    </View>
  );
}
