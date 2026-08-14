/**
 * Music profile (screen 18, FR-120). `GET /users/:idOrHandle/music_profile`
 * accepts a user id OR a handle, and answers `{ visible: false }` with a 200
 * for strangers and for accounts that keep listening private.
 *
 * The contract for `visible: false` is "render nothing", so a private
 * profile must be INDISTINGUISHABLE from an empty one: both land on the same
 * neutral empty state, and no error, badge or hint says which it was. The
 * person header above the sections is exempt: it renders identity (avatar,
 * name, handle) from rosters the viewer already holds, never listening
 * data, and resolves to the same values in both cases.
 *
 * Every media URL here is presigned by the backend (the viewer does not own
 * a friend's fs nodes, so resolving them would 404): they are used AS-IS,
 * never through `imageUrl()`, and never cached beyond the query.
 */
import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import { acceptedFriends } from "@/api/endpoints/relationships";
import { useRelationships } from "@/api/queries/relationships";
import { useMusicProfile } from "@/api/queries/social";
import { useSessionStore } from "@/auth/session";
import type { UserId } from "@/domain/ids";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { artistNamesLine, formatSnapshotDuration, musicProfileArtistImage } from "@/social/display";
import { useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import {
  ArtworkImage,
  EmptyState,
  ErrorState,
  Icon,
  InitialsAvatar,
  PlayingBars,
  SongRowSkeleton,
} from "@/ui";

const PROFILE = "native.profile";

/** Whoever the route points at, resolved to a renderable identity. */
interface ProfilePerson {
  id: UserId | null;
  handle: string | null;
  name: string;
}

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

/**
 * The person header that makes this page read as a PROFILE and not as a
 * generic music screen: big round avatar, display name, handle, and the
 * relationship note the read API can vouch for ("your profile" / the
 * friends badge). The client API has no friend-request mutations yet, so
 * there is deliberately no add/remove button to promise here.
 */
const ProfileHeader = ({
  person,
  isSelf,
  isFriend,
}: {
  person: ProfilePerson;
  isSelf: boolean;
  isFriend: boolean;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      {person.id ? (
        <ArtworkImage uri={avatarUrl(person.id)} size={96} shape="circle" />
      ) : (
        <InitialsAvatar name={person.name} size={96} />
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{ color: tokens.foreground, fontSize: 26, fontWeight: "800" }}
        >
          {person.name}
        </Text>
        {person.handle ? (
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            @{person.handle}
          </Text>
        ) : null}
        {isSelf ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t(`${PROFILE}.yourProfile`)}
          </Text>
        ) : isFriend ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              alignSelf: "flex-start",
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: tokens.secondary,
            }}
          >
            <Icon name="users" size={12} color={tokens.secondaryForeground} />
            <Text
              style={{ color: tokens.secondaryForeground, fontSize: 11, fontWeight: "700" }}
            >
              {t(`${PROFILE}.friendBadge`)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default function ProfileScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const params = useLocalSearchParams<{ idOrHandle?: string }>();
  // Handles arrive from friend rows with no "@" and are lowercased server
  // side; ids come from notification contexts. Both are legal path segments.
  const idOrHandle = (params.idOrHandle ?? "").replace(/^@/, "");
  const query = useMusicProfile(idOrHandle || null);

  const profile = query.data ?? null;

  // ---- Identity resolution ----
  // The music_profile payload carries the user block only inside
  // now_playing, and only when the profile is visible; a private profile
  // still deserves a proper header, so the header falls back through every
  // roster the app already holds: self (session), accepted friends
  // (relationships), the listening store, and finally the raw route param.
  const selfUser = useSessionStore((s) => s.user);
  const listeningFriends = useListeningStore((s) => s.friends);
  const isSelf =
    !!selfUser &&
    (selfUser.id === idOrHandle || selfUser.handle.toLowerCase() === idOrHandle.toLowerCase());
  const relationshipsQuery = useRelationships(!isSelf);

  const person = useMemo<ProfilePerson>(() => {
    const needle = idOrHandle.toLowerCase();
    const matches = (u: { id: UserId; handle: string }): boolean =>
      u.id === idOrHandle || u.handle.toLowerCase() === needle;
    if (isSelf && selfUser) {
      return { id: selfUser.id, handle: selfUser.handle, name: selfUser.name || selfUser.handle };
    }
    const snapshotUser = profile?.now_playing?.user;
    const friend = selfUser
      ? acceptedFriends(relationshipsQuery.data ?? [], selfUser.id).find(matches)
      : undefined;
    const listening = listeningFriends.find((row) => matches(row.user))?.user;
    const resolved = (snapshotUser && matches(snapshotUser) ? snapshotUser : null) ?? friend ?? listening;
    if (resolved) {
      return { id: resolved.id, handle: resolved.handle, name: resolved.name || resolved.handle };
    }
    // Nothing resolved: a numeric segment is an id (never worth rendering
    // as a handle); anything else came from a handle link.
    const looksLikeId = /^\d+$/.test(idOrHandle);
    return { id: null, handle: looksLikeId ? null : idOrHandle, name: idOrHandle };
  }, [idOrHandle, isSelf, selfUser, profile, relationshipsQuery.data, listeningFriends]);

  const isFriend = useMemo(() => {
    if (isSelf || !selfUser) return false;
    return acceptedFriends(relationshipsQuery.data ?? [], selfUser.id).some(
      (u) => u.id === person.id || (!!person.handle && u.handle === person.handle.toLowerCase()),
    );
  }, [isSelf, selfUser, relationshipsQuery.data, person]);

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
      contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 20 }}
    >
      {/* The page opens as a PROFILE - the old bare "Música" heading made
          this look like a generic music page (owner report 2026-08-14). */}
      <ProfileHeader person={person} isSelf={isSelf} isFriend={isFriend} />

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
