/**
 * Artist tab (FR-104): import a whole artist. Requires a linked Spotify
 * IDENTITY (not the allowlist flag), so the tab is always visible and the
 * backend's bare-string refusals are classified into connect / relink /
 * upstream banners instead of a generic error (spotifyErrors.ts).
 *
 * Flow: debounced `GET /artist_imports/search` (roster + spotify columns);
 * picking a roster artist re-runs the Spotify search by name and takes the
 * exact case-insensitive match, else the first hit; albums multiselect from
 * `GET /artist_imports/albums`; `POST /artist_imports`; the recents list
 * polls at 1.5 s while anything is queued/running.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createArtistImport,
  searchArtistImports,
} from "@/api/endpoints/artistImports";
import {
  useArtistImportAlbums,
  useArtistImportSearch,
  useArtistImportsRecents,
} from "@/api/queries/artistImports";
import { invalidationTargets, keys } from "@/api/queryKeys";
import type { ArtistImport } from "@/domain/imports";
import {
  GhostButton,
  NoticeBanner,
  PrimaryButton,
  ProgressBar,
  SearchField,
  SettingsSection,
  useApiErrorMessage,
  useDebounced,
} from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon } from "@/ui";
import { classifySpotifyError, SPOTIFY_ISSUE_KEYS, type SpotifyIssue } from "./spotifyErrors";

const IMPORT_KEY = "components.music.Settings.ArtistImport";

interface SpotifyArtist {
  id: string;
  name: string;
  followers: number | null;
  genres: string[];
  image_url: string | null;
}

const RecentRow = ({ record }: { record: ArtistImport }) => {
  const t = useT();
  const { tokens, ink } = useTheme();
  const totalAlbums = record.total_albums ?? record.album_ids.length;
  const processed = record.processed_albums ?? 0;
  const ratio = totalAlbums > 0 ? Math.min(1, processed / totalAlbums) : null;
  const active = record.state === "queued" || record.state === "running";

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
        {active ? (
          <ActivityIndicator size="small" color={tokens.mutedForeground} />
        ) : (
          <Icon
            name={record.state === "failed" ? "alert-circle" : "circle-check"}
            size={14}
            color={record.state === "failed" ? ink.destructive : tokens.mutedForeground}
          />
        )}
        <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 13 }}>
          {record.spotify_artist_name || record.spotify_artist_id}
        </Text>
        <Text
          style={{ color: tokens.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] }}
        >
          {t(`${IMPORT_KEY}.albumsProgress`, { processed, total: totalAlbums })}
        </Text>
      </View>
      {record.state !== "queued" ? (
        <ProgressBar
          value={ratio ?? (record.state === "complete" ? 1 : 0.3)}
          kind={
            record.state === "failed" ? "failed" : record.state === "complete" ? "done" : "normal"
          }
        />
      ) : null}
      {(record.queued_count ?? 0) > 0 || (record.skipped_count ?? 0) > 0 ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>
          {t(`${IMPORT_KEY}.trackTotals`, {
            queued: record.queued_count ?? 0,
            skipped: record.skipped_count ?? 0,
          })}
        </Text>
      ) : null}
      {record.last_message && record.state !== "failed" ? (
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 11 }}>
          {record.last_message}
        </Text>
      ) : null}
      {record.state === "failed" && record.error_message ? (
        <Text numberOfLines={2} style={{ color: ink.destructive, fontSize: 11 }}>
          {record.error_message}
        </Text>
      ) : null}
    </View>
  );
};

const ArtistRow = ({
  name,
  imageUrl,
  subtitle,
  onPress,
}: {
  name: string;
  imageUrl: string | null;
  subtitle: string;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
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
      <ArtworkImage uri={imageUrl} size={40} shape="circle" />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14 }}>
          {name}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
};

export default function ArtistImportTab() {
  const t = useT();
  const { tokens } = useTheme();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [selected, setSelected] = useState<SpotifyArtist | null>(null);
  // null = the default "everything selected"; a set = the user's picks.
  const [chosenEdit, setChosenEdit] = useState<Set<string> | null>(null);
  const [handlerIssue, setHandlerIssue] = useState<SpotifyIssue | null>(null);
  const [issueDismissed, setIssueDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingRoster, setResolvingRoster] = useState(false);

  const searchQuery = useArtistImportSearch(debounced, selected === null);
  const albumsQuery = useArtistImportAlbums(selected?.id ?? null, selected !== null);
  const recentsQuery = useArtistImportsRecents();

  const createImport = useMutation({
    mutationFn: createArtistImport,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.artistImports.recents });
      for (const key of invalidationTargets.libraryLists) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  // Classify the Spotify-shaped failures of every step into one banner,
  // derived from the queries instead of mirrored into state.
  const stepError = searchQuery.error ?? albumsQuery.error ?? null;
  const queryIssue = useMemo(() => classifySpotifyError(stepError), [stepError]);
  const issue = handlerIssue ?? (issueDismissed ? null : queryIssue);
  const genericError =
    error ?? (stepError && !queryIssue ? errorMessage(stepError) : null);

  const albums = useMemo(() => albumsQuery.data?.items ?? [], [albumsQuery.data]);

  // Every album starts selected (web parity) until the user narrows it.
  const chosen = useMemo(
    () => chosenEdit ?? new Set(albums.map((album) => album.id)),
    [chosenEdit, albums],
  );

  const totalTracks = albums
    .filter((album) => chosen.has(album.id))
    .reduce((sum, album) => sum + (album.total_tracks ?? 0), 0);

  const pickRoster = async (name: string): Promise<void> => {
    setResolvingRoster(true);
    setError(null);
    setIssueDismissed(false);
    try {
      const response = await searchArtistImports(name);
      const exact =
        response.spotify.find(
          (candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
        ) ?? response.spotify[0];
      if (!exact) {
        setError(t(`${IMPORT_KEY}.notFoundOnSpotify`));
        return;
      }
      setSelected(exact);
    } catch (e) {
      const classified = classifySpotifyError(e);
      if (classified) setHandlerIssue(classified);
      else setError(errorMessage(e));
    } finally {
      setResolvingRoster(false);
    }
  };

  const startImport = async (): Promise<void> => {
    if (!selected || chosen.size === 0) return;
    setError(null);
    try {
      await createImport.mutateAsync({
        spotify_artist_id: selected.id,
        spotify_artist_name: selected.name,
        album_ids: Array.from(chosen),
      });
      setSelected(null);
      setChosenEdit(null);
      setQuery("");
      setHandlerIssue(null);
      setIssueDismissed(true);
    } catch (e) {
      const classified = classifySpotifyError(e);
      if (classified) setHandlerIssue(classified);
      else setError(errorMessage(e));
    }
  };

  const results = searchQuery.data;
  const recents = recentsQuery.data?.items ?? [];

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t(`${IMPORT_KEY}.title`)}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {t(`${IMPORT_KEY}.description`)}
          </Text>
          {!selected ? (
            <SearchField
              value={query}
              onChangeText={(value) => {
                setQuery(value);
                setHandlerIssue(null);
                setIssueDismissed(false);
              }}
              placeholder={t(`${IMPORT_KEY}.searchPlaceholder`)}
            />
          ) : null}
          {(searchQuery.isFetching || resolvingRoster) && !selected ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={tokens.mutedForeground} />
              <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                {t(`${IMPORT_KEY}.searching`)}
              </Text>
            </View>
          ) : null}
        </View>
      </SettingsSection>

      {issue ? (
        <View
          style={{
            gap: 10,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: RADIUS,
            padding: 14,
            backgroundColor: tokens.card,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700" }}>
            {t(SPOTIFY_ISSUE_KEYS[issue.kind].title)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 18 }}>
            {t(SPOTIFY_ISSUE_KEYS[issue.kind].description)}
          </Text>
          {issue.kind === "upstream" && issue.raw ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 11 }}>{issue.raw}</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <GhostButton
              label={t(`${IMPORT_KEY}.spotifyIssueDismiss`)}
              compact
              onPress={() => {
                setHandlerIssue(null);
                setIssueDismissed(true);
              }}
            />
            {issue.kind === "upstream" ? (
              <GhostButton
                label={t(`${IMPORT_KEY}.spotifyIssueRetry`)}
                compact
                onPress={() => {
                  setHandlerIssue(null);
                  setIssueDismissed(true);
                  if (selected) void albumsQuery.refetch();
                  else void searchQuery.refetch();
                }}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {genericError ? <NoticeBanner kind="error" message={genericError} /> : null}

      {!selected && results ? (
        <View style={{ gap: 12 }}>
          {results.roster.length > 0 ? (
            <SettingsSection title={t(`${IMPORT_KEY}.inYourLibrary`)}>
              {results.roster.map((artist) => (
                <ArtistRow
                  key={`roster-${artist.id}`}
                  name={artist.name}
                  imageUrl={artist.image_url}
                  subtitle={t(`${IMPORT_KEY}.rosterSubtitle`)}
                  onPress={() => void pickRoster(artist.name)}
                />
              ))}
            </SettingsSection>
          ) : null}
          {results.spotify.length > 0 ? (
            <SettingsSection title={t(`${IMPORT_KEY}.onSpotify`)}>
              {results.spotify.map((artist) => (
                <ArtistRow
                  key={`spotify-${artist.id}`}
                  name={artist.name}
                  imageUrl={artist.image_url}
                  subtitle={
                    artist.followers != null
                      ? t(`${IMPORT_KEY}.followers`, { count: artist.followers })
                      : (artist.genres[0] ?? "")
                  }
                  onPress={() => {
                    setSelected(artist);
                    setChosenEdit(null);
                    setHandlerIssue(null);
                    setIssueDismissed(false);
                  }}
                />
              ))}
            </SettingsSection>
          ) : null}
          {results.roster.length === 0 && results.spotify.length === 0 ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, paddingHorizontal: 4 }}>
              {t(`${IMPORT_KEY}.noMatches`)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {selected ? (
        <View style={{ gap: 12 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderWidth: 1,
              borderColor: tokens.border,
              borderRadius: RADIUS,
              padding: 12,
            }}
          >
            <ArtworkImage uri={selected.image_url} size={44} shape="circle" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
                {selected.name}
              </Text>
              <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                {selected.followers != null
                  ? t(`${IMPORT_KEY}.followers`, { count: selected.followers })
                  : (selected.genres[0] ?? "")}
              </Text>
            </View>
            <GhostButton
              label={t(`${IMPORT_KEY}.changeArtist`)}
              compact
              onPress={() => {
                setSelected(null);
                setChosenEdit(null);
              }}
            />
          </View>

          {albumsQuery.isLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={tokens.mutedForeground} />
              <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                {t(`${IMPORT_KEY}.loadingAlbums`)}
              </Text>
            </View>
          ) : null}

          {albums.length > 0 ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, color: tokens.mutedForeground, fontSize: 12 }}>
                  {t(`${IMPORT_KEY}.selectedSummary`, {
                    selected: chosen.size,
                    total: albums.length,
                    tracks: totalTracks,
                  })}
                </Text>
                <GhostButton
                  label={t(`${IMPORT_KEY}.selectAll`)}
                  compact
                  onPress={() => setChosenEdit(new Set(albums.map((album) => album.id)))}
                />
                <GhostButton
                  label={t(`${IMPORT_KEY}.clear`)}
                  compact
                  onPress={() => setChosenEdit(new Set())}
                />
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {albums.map((album) => {
                  const checked = chosen.has(album.id);
                  return (
                    <Pressable
                      key={album.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: checked }}
                      onPress={() =>
                        setChosenEdit((previous) => {
                          const next = new Set(previous ?? chosen);
                          if (next.has(album.id)) next.delete(album.id);
                          else next.add(album.id);
                          return next;
                        })
                      }
                      style={{
                        width: 108,
                        gap: 6,
                        padding: 6,
                        borderWidth: 1,
                        borderRadius: RADIUS,
                        borderColor: checked ? tokens.primary : tokens.border,
                      }}
                    >
                      <ArtworkImage uri={album.image_url} size={94} />
                      <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 12 }}>
                        {album.name}
                      </Text>
                      <Text style={{ color: tokens.mutedForeground, fontSize: 10 }}>
                        {album.release_date?.slice(0, 4) ?? ""}
                        {album.total_tracks
                          ? ` - ${t(`${IMPORT_KEY}.tracks`, { count: album.total_tracks })}`
                          : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <PrimaryButton
                label={t(`${IMPORT_KEY}.import`, { count: chosen.size })}
                onPress={() => void startImport()}
                busy={createImport.isPending}
                disabled={chosen.size === 0}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {recents.length > 0 ? (
        <SettingsSection title={t(`${IMPORT_KEY}.recentTitle`)}>
          <View style={{ padding: 12, gap: 8 }}>
            {recents.map((record) => (
              <RecentRow key={record.id} record={record} />
            ))}
          </View>
        </SettingsSection>
      ) : null}
    </View>
  );
}
