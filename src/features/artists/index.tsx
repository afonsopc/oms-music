/**
 * Artists hub (FR-36): the editorial overview from `GET /artists/overview` -
 * one big spotlight photo, the "All artists" row carrying the numbers as a
 * grey meta line (the minutes label follows `heavy_rotation_window`), and
 * the recommendation shelves. Shelves with zero entries render nothing.
 *
 * The A-Z roster lives on its own screen on native (DESIGN 2, screen 12), so
 * the "All artists" row here links into it instead of embedding the grid.
 */
import React, { useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useArtistOverview } from "@/api/queries/artists";
import { useArtistSongs } from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import type { Artist } from "@/domain/artist";
import { useLocale, useT } from "@/i18n";
import { artistRadioRoute, artistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { CircleSkeleton, ErrorState } from "@/ui";
import { Reveal } from "@/ui/motion";
import { ListRow, ListSkeleton, PageHeader, useGutter, WaitHint } from "@/ui/page";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { ArtistShelf, type ArtistShelfEntry } from "./ArtistShelf";
import { ArtistSpotlight, ArtistSpotlightSkeleton } from "./ArtistSpotlight";

export default function ArtistsHubScreen() {
  const t = useT();
  const locale = useLocale();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(20);

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

  const spotlight = overview?.spotlight ?? null;
  const minutes = Math.round((overview?.stats.seconds_played ?? 0) / 60);
  const windowLabel =
    overview?.heavy_rotation_window === "30d"
      ? t("components.music.Artists.windowMonth")
      : t("components.music.Artists.windowAllTime");
  // The numbers are one quiet grey line on the roster row, not boxes.
  const statsLine = overview
    ? [
        t("components.music.Artists.count", { count: overview.stats.artists }),
        `${overview.stats.songs.toLocaleString(locale)} ${t("components.music.Artists.statSongs")}`,
        overview.stats.new_artists > 0
          ? `${overview.stats.new_artists.toLocaleString(locale)} ${t("components.music.Artists.statNewArtists")}`
          : null,
        minutes > 0
          ? `${t("components.music.Artists.statMinutesValue", { minutes })} ${windowLabel}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const header = (
    <PageHeader title={t("components.music.Artists.title")} style={{ paddingBottom: 16 }} />
  );

  if (overviewQuery.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: topPadding }}>
        {header}
        <ErrorState onRetry={() => void overviewQuery.refetch()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding + 16 }}
    >
      {header}
      {overviewQuery.isLoading ? (
        <View>
          <ArtistSpotlightSkeleton />
          <View style={{ height: 16 }} />
          <ListSkeleton rows={1} artwork={false} />
          <View style={{ paddingHorizontal: gutter, paddingTop: 28, flexDirection: "row", gap: 16 }}>
            {[0, 1, 2].map((i) => (
              <CircleSkeleton key={i} size={120} />
            ))}
          </View>
          <WaitHint active onRetry={() => void overviewQuery.refetch()} />
        </View>
      ) : (
        <>
          {spotlight ? (
            <Reveal>
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
            </Reveal>
          ) : null}

          <View style={{ paddingTop: spotlight ? 8 : 0 }}>
            <ListRow
              order={1}
              title={t("components.music.Artists.allArtists")}
              meta={statsLine}
              chevron
              last
              onPress={() => router.push("/artists-roster")}
            />
          </View>

          {overview ? (
            <Reveal order={2} style={{ gap: 8, paddingTop: 8 }}>
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
            </Reveal>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
