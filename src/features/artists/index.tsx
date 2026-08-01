/**
 * Artists hub (FR-36): the editorial overview from `GET /artists/overview` -
 * spotlight banner, four stat tiles whose window label follows
 * `heavy_rotation_window`, and the recommendation shelves. Shelves with zero
 * entries render nothing.
 *
 * The A-Z roster lives on its own screen on native (DESIGN 2, screen 12), so
 * the "All artists" row here links into it instead of embedding the grid.
 */
import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useArtistOverview } from "@/api/queries/artists";
import { useArtistSongs } from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import type { Artist } from "@/domain/artist";
import { useLocale, useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ErrorState, Icon, Skeleton, foregroundWash } from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { ArtistShelf, type ArtistShelfEntry } from "./ArtistShelf";
import { ArtistSpotlight } from "./ArtistSpotlight";
import { artistRadioRoute, artistRoute } from "./routes";

const StatTile = ({ value, label }: { value: string; label: string }) => {
  const { tokens, scheme } = useTheme();
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        gap: 2,
        borderRadius: RADIUS,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: foregroundWash(scheme, 0.05),
      }}
    >
      <Text
        style={{
          color: tokens.foreground,
          fontSize: 22,
          fontWeight: "700",
          fontVariant: ["tabular-nums"],
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

export default function ArtistsHubScreen() {
  const t = useT();
  const locale = useLocale();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();

  const overviewQuery = useArtistOverview();
  const overview = overviewQuery.data;

  // The overview payload carries no tracks; fetch them only once there is a
  // spotlight to play (FR-36 lazy songs query).
  const spotlightName = overview?.spotlight?.artist.name ?? null;
  const spotlightSongsQuery = useArtistSongs(spotlightName, "primary", !!spotlightName);
  const spotlightSongs = useMemo(
    () => spotlightSongsQuery.data ?? [],
    [spotlightSongsQuery.data],
  );

  const playSpotlight = useCallback(
    (shuffle: boolean) => {
      if (spotlightSongs.length === 0) return;
      // Shuffle without a start index reshuffles the whole order and starts
      // at 0 - the queueOps equivalent of the web's random start index.
      getTransport().setQueue(spotlightSongs, shuffle ? undefined : 0, { shuffle });
    },
    [spotlightSongs],
  );

  const openArtist = useCallback(
    (artist: Artist) => router.push(artistRoute(artist.slug || artist.name)),
    [router],
  );

  const heavyEntries = useMemo<ArtistShelfEntry[]>(
    () =>
      (overview?.heavy_rotation ?? []).map((row) => ({
        artist: row.artist,
        caption: t("components.music.Artists.playsCount", { count: row.play_count }),
      })),
    [overview?.heavy_rotation, t],
  );
  const similarEntries = useMemo<ArtistShelfEntry[]>(
    () => (overview?.similar?.artists ?? []).map((artist) => ({ artist })),
    [overview?.similar],
  );
  const neglectedEntries = useMemo<ArtistShelfEntry[]>(
    () =>
      (overview?.neglected ?? []).map((row) => ({
        artist: row.artist,
        caption: t("components.music.Artists.songsCount", { count: row.songs_count }),
      })),
    [overview?.neglected, t],
  );

  if (overviewQuery.isError) {
    return (
      <ErrorState
        text={t("components.music.Artists.errorLoadingArtists")}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const spotlight = overview?.spotlight ?? null;
  const minutes = Math.round((overview?.stats.seconds_played ?? 0) / 60);
  const windowLabel =
    overview?.heavy_rotation_window === "30d"
      ? t("components.music.Artists.windowMonth")
      : t("components.music.Artists.windowAllTime");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ gap: 24, paddingTop: 20, paddingBottom: bottomPadding }}
    >
      {overviewQuery.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Skeleton width="100%" height={240} borderRadius={RADIUS * 1.5} />
        </View>
      ) : spotlight ? (
        <View style={{ paddingHorizontal: 20 }}>
          <ArtistSpotlight
            spotlight={spotlight}
            isLoading={spotlightSongsQuery.isLoading}
            onPlay={() => playSpotlight(false)}
            onShuffle={() => playSpotlight(true)}
            onOpenArtist={() => openArtist(spotlight.artist)}
            onStartRadio={() =>
              router.push(artistRadioRoute(spotlight.artist.slug || spotlight.artist.name))
            }
          />
        </View>
      ) : null}

      {overview ? (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 20 }}
        >
          <StatTile
            value={overview.stats.artists.toLocaleString(locale)}
            label={t("components.music.Artists.statArtists")}
          />
          <StatTile
            value={overview.stats.songs.toLocaleString(locale)}
            label={t("components.music.Artists.statSongs")}
          />
          <StatTile
            value={overview.stats.new_artists.toLocaleString(locale)}
            label={t("components.music.Artists.statNewArtists")}
          />
          <StatTile
            value={t("components.music.Artists.statMinutesValue", { minutes })}
            label={windowLabel}
          />
        </View>
      ) : null}

      {overview ? (
        <>
          <ArtistShelf
            title={
              overview.heavy_rotation_window === "30d"
                ? t("components.music.Artists.shelfHeavyRotation")
                : t("components.music.Artists.shelfMostPlayed")
            }
            entries={heavyEntries}
            onSelect={openArtist}
          />
          {overview.similar ? (
            <ArtistShelf
              title={t("components.music.Artists.shelfSimilar", {
                artist: overview.similar.seed.name,
              })}
              entries={similarEntries}
              onSelect={openArtist}
            />
          ) : null}
          <ArtistShelf
            title={t("components.music.Artists.shelfNeglected")}
            entries={neglectedEntries}
            onSelect={openArtist}
          />
        </>
      ) : null}

      <Pressable
        onPress={() => router.push("/(main)/artists-roster")}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginHorizontal: 20,
          paddingHorizontal: 16,
          paddingVertical: 16,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: tokens.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
            {t("components.music.Artists.allArtists")}
          </Text>
          {overview ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t("components.music.Artists.count", { count: overview.stats.artists })}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
      </Pressable>
    </ScrollView>
  );
}
