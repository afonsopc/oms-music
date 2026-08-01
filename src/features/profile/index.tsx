/**
 * Music profile (screen 18, FR-120). `GET /users/:idOrHandle/music_profile`
 * accepts a user id OR a handle, and answers `{ visible: false }` with a 200
 * for strangers and for accounts that keep listening private.
 *
 * The contract for `visible: false` is "render nothing", so a private
 * profile must be INDISTINGUISHABLE from an empty one: both land on the same
 * neutral empty state, and no error, badge or hint says which it was.
 *
 * Every media URL here is presigned by the backend (the viewer does not own
 * a friend's fs nodes, so resolving them would 404): they are used AS-IS,
 * never through `imageUrl()`, and never cached beyond the query.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMusicProfile } from "@/api/queries/social";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { artistNamesLine, formatSnapshotDuration, musicProfileArtistImage } from "@/social/display";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, EmptyState, ErrorState, PlayingBars, SongRowSkeleton } from "@/ui";

const PROFILE = "native.profile";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "700" }}>
        {title}
      </Text>
      {children}
    </View>
  );
};

const SnapshotSongRow = ({
  index,
  title,
  artistNames,
  artworkUrl,
  duration,
  trailing,
}: {
  index?: number;
  title: string;
  artistNames: unknown;
  artworkUrl: string | null;
  duration: number;
  trailing?: string;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {index !== undefined ? (
        <Text
          style={{
            width: 16,
            textAlign: "right",
            color: tokens.mutedForeground,
            fontSize: 12,
            fontVariant: ["tabular-nums"],
          }}
        >
          {index + 1}
        </Text>
      ) : null}
      <ArtworkImage uri={artworkUrl} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {artistNamesLine(artistNames)}
        </Text>
      </View>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 12,
          fontVariant: ["tabular-nums"],
        }}
      >
        {trailing ?? formatSnapshotDuration(duration)}
      </Text>
    </View>
  );
};

export default function ProfileScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const params = useLocalSearchParams<{ idOrHandle?: string }>();
  // Handles arrive from friend rows with no "@" and are lowercased server
  // side; ids come from notification contexts. Both are legal path segments.
  const idOrHandle = (params.idOrHandle ?? "").replace(/^@/, "");
  const query = useMusicProfile(idOrHandle || null);

  const profile = query.data ?? null;
  const nowPlaying = profile?.now_playing ?? null;
  const live = !!nowPlaying?.song && nowPlaying.online && !nowPlaying.paused;
  const topArtists = profile?.top_artists ?? [];
  const topSongs = profile?.top_songs ?? [];
  const recent = profile?.recent ?? [];
  const hasAnything =
    !!profile?.visible && (live || topArtists.length > 0 || topSongs.length > 0 || recent.length > 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 20 }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t(`${PROFILE}.title`)}
      </Text>

      {query.isLoading ? (
        <View style={{ gap: 8 }}>
          <SongRowSkeleton />
          <SongRowSkeleton />
          <SongRowSkeleton />
        </View>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : !hasAnything ? (
        // Private and empty are deliberately the same screen (FR-120 AC).
        <EmptyState icon="music" text={t(`${PROFILE}.private`)} />
      ) : (
        <>
          {live && nowPlaying?.song ? (
            <Section title={t(`${PROFILE}.listeningNow`)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <ArtworkImage uri={nowPlaying.song.artwork_url} size={56} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <PlayingBars count={3} />
                  <Text
                    numberOfLines={1}
                    style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
                  >
                    {nowPlaying.song.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                    {artistNamesLine(nowPlaying.song.artist_names)}
                  </Text>
                </View>
              </View>
            </Section>
          ) : null}

          {topArtists.length > 0 ? (
            <Section title={t(`${PROFILE}.topArtists`)}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  {topArtists.map((artist) => (
                    <View key={artist.id} style={{ width: 76, alignItems: "center", gap: 6 }}>
                      <ArtworkImage
                        uri={musicProfileArtistImage(artist)}
                        size={72}
                        shape="circle"
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          color: tokens.foreground,
                          fontSize: 12,
                          fontWeight: "600",
                          width: "100%",
                          textAlign: "center",
                        }}
                      >
                        {artist.name}
                      </Text>
                      <Text style={{ color: tokens.mutedForeground, fontSize: 10 }}>
                        {t(`${PROFILE}.plays`, { count: artist.play_count })}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </Section>
          ) : null}

          {topSongs.length > 0 ? (
            <Section title={t(`${PROFILE}.topSongs`)}>
              <View style={{ gap: 10 }}>
                {topSongs.map((song, index) => (
                  <SnapshotSongRow
                    key={song.id}
                    index={index}
                    title={song.title}
                    artistNames={song.artist_names}
                    artworkUrl={song.artwork_url}
                    duration={song.duration}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {recent.length > 0 ? (
            <Section title={t(`${PROFILE}.recent`)}>
              <View style={{ gap: 10 }}>
                {recent.map((song, index) => (
                  <SnapshotSongRow
                    key={`${song.id}-${index}`}
                    title={song.title}
                    artistNames={song.artist_names}
                    artworkUrl={song.artwork_url}
                    duration={song.duration}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {typeof profile?.plays_30d === "number" && profile.plays_30d > 0 ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
              {t(`${PROFILE}.playsLastMonth`, { count: profile.plays_30d })}
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
