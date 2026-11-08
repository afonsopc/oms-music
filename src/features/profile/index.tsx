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
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import { acceptedFriends, useRelationships } from "@/api/queries/relationships";
import { useMusicProfile } from "@/api/queries/social";
import { useSessionStore } from "@/auth/session";
import type { UserId } from "@/domain/ids";
import { ModerationSheet } from "@/features/moderation/ModerationSheet";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { artistNamesLine, formatSnapshotDuration, musicProfileArtistImage } from "@/social/display";
import { useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, EmptyState, ErrorState, InitialsAvatar, PlayingBars } from "@/ui";
import { Reveal } from "@/ui/motion";
import {
  ListSkeleton,
  PageState,
  pageType,
  SectionLabel,
  TextButton,
  useGutter,
} from "@/ui/page";

const PROFILE = "native.profile";

/** Whoever the route points at, resolved to a renderable identity. */
interface ProfilePerson {
  id: UserId | null;
  handle: string | null;
  name: string;
}

const Section = ({
  title,
  order,
  children,
}: {
  title: string;
  order: number;
  children: React.ReactNode;
}) => (
  <Reveal order={order}>
    <SectionLabel title={title} />
    {children}
  </Reveal>
);

/** A song from a profile snapshot: 56 px, cover 48, grey meta, no box. */
const SnapshotSongRow = ({
  index,
  title,
  artistNames,
  artworkUrl,
  duration,
}: {
  index?: number;
  title: string;
  artistNames: unknown;
  artworkUrl: string | null;
  duration: number;
}) => {
  const { tokens } = useTheme();
  const gutter = useGutter();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        height: 64,
        paddingHorizontal: gutter,
      }}
    >
      {index !== undefined ? (
        <Text
          style={[
            pageType.meta,
            {
              width: 18,
              textAlign: "right",
              color: tokens.mutedForeground,
              fontVariant: ["tabular-nums"],
            },
          ]}
        >
          {index + 1}
        </Text>
      ) : null}
      <ArtworkImage uri={artworkUrl} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[pageType.body, { color: tokens.foreground, fontWeight: "500" }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
          {artistNamesLine(artistNames)}
        </Text>
      </View>
      <Text style={[pageType.meta, { color: tokens.mutedForeground, fontVariant: ["tabular-nums"] }]}>
        {formatSnapshotDuration(duration)}
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
  friendsCount,
  plays30d,
  onModerate,
}: {
  onModerate?: () => void;
  person: ProfilePerson;
  isSelf: boolean;
  isFriend: boolean;
  /** null = desconhecido (perfis alheios); nunca inventar zeros. */
  friendsCount: number | null;
  plays30d: number | null;
}) => {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const gutter = useGutter();
  // Uma linha cinzenta com os números que a API consegue jurar (amigos e
  // plays de 30 dias) e, num amigo, a palavra "Amigos": sem pílula.
  const stats = [
    !isSelf && isFriend ? t(`${PROFILE}.friendBadge`) : null,
    friendsCount !== null ? t(`${PROFILE}.friendsCount`, { count: friendsCount }) : null,
    plays30d !== null ? t(`${PROFILE}.playsLastMonth`, { count: plays30d }) : null,
  ].filter(Boolean);
  return (
    <Reveal>
      <View style={{ paddingHorizontal: gutter, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          {person.id ? (
            <ArtworkImage uri={avatarUrl(person.id)} size={96} shape="circle" />
          ) : (
            <InitialsAvatar name={person.name} size={96} />
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[pageType.title, { color: tokens.foreground }]}
            >
              {person.name}
            </Text>
            {person.handle ? (
              <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
                @{person.handle}
              </Text>
            ) : null}
            {stats.length > 0 ? (
              <Text numberOfLines={2} style={[pageType.meta, { color: tokens.mutedForeground }]}>
                {stats.join(" · ")}
              </Text>
            ) : null}
          </View>
        </View>
        {/* A linha de acções SOB o hero, como no screenshot do dono
            (2026-08-18). Só no próprio perfil: para os outros a API ainda não
            tem mutações de amizade para prometer botões. */}
        {isSelf ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextButton
              label={t(`${PROFILE}.editProfile`)}
              onPress={() => {
                haptics.select();
                router.push("/account");
              }}
            />
            <TextButton
              label={t(`${PROFILE}.settingsAction`)}
              onPress={() => {
                haptics.select();
                router.push("/settings");
              }}
            />
          </View>
        ) : onModerate ? (
          // Num perfil alheio: denunciar e bloquear (App Store 1.2).
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextButton
              label={t("native.moderation.reportOrBlock")}
              onPress={() => {
                haptics.select();
                onModerate();
              }}
            />
          </View>
        ) : null}
      </View>
    </Reveal>
  );
};

export default function ProfileScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  const params = useLocalSearchParams<{ idOrHandle?: string }>();
  // Handles arrive from friend rows with no "@" and are lowercased server
  // side; ids come from notification contexts. Both are legal path segments.
  const idOrHandle = (params.idOrHandle ?? "").replace(/^@/, "");
  const query = useMusicProfile(idOrHandle || null);
  const router = useRouter();
  const [moderating, setModerating] = useState(false);

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
  // Sempre ligada: no próprio perfil conta os amigos da linha de números;
  // nos alheios resolve identidades como antes.
  const relationshipsQuery = useRelationships(true);

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
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding + 16 }}
    >
      {/* The page opens as a PROFILE - the old bare "Música" heading made
          this look like a generic music page (owner report 2026-08-14). */}
      <ProfileHeader
        person={person}
        isSelf={isSelf}
        isFriend={isFriend}
        friendsCount={
          isSelf && selfUser
            ? acceptedFriends(relationshipsQuery.data ?? [], selfUser.id).length
            : null
        }
        plays30d={profile?.visible ? (profile.plays_30d ?? null) : null}
        onModerate={!isSelf && person.id ? () => setModerating(true) : undefined}
      />
      {person.id && !isSelf ? (
        <ModerationSheet
          visible={moderating}
          onClose={() => setModerating(false)}
          person={{ id: person.id, handle: person.handle, name: person.name }}
          onBlocked={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      ) : null}

      {query.isLoading ? (
        <View style={{ paddingTop: 28 }}>
          <PageState loading onRetry={() => void query.refetch()} skeleton={<ListSkeleton rows={6} />} />
        </View>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : !hasAnything ? (
        // Private and empty are deliberately the same screen (FR-120 AC).
        <EmptyState icon="music" text={t(`${PROFILE}.private`)} />
      ) : (
        <>
          {live && nowPlaying?.song ? (
            <Section order={1} title={t(`${PROFILE}.listeningNow`)}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingHorizontal: gutter,
                }}
              >
                <ArtworkImage uri={nowPlaying.song.artwork_url} size={64} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <PlayingBars count={3} />
                  <Text
                    numberOfLines={1}
                    style={[pageType.body, { color: tokens.foreground, fontWeight: "600" }]}
                  >
                    {nowPlaying.song.title}
                  </Text>
                  <Text numberOfLines={1} style={[pageType.meta, { color: tokens.mutedForeground }]}>
                    {artistNamesLine(nowPlaying.song.artist_names)}
                  </Text>
                </View>
              </View>
            </Section>
          ) : null}

          {topArtists.length > 0 ? (
            <Section order={2} title={t(`${PROFILE}.topArtists`)}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: gutter, gap: 16 }}
              >
                {topArtists.map((artist) => (
                  <View key={artist.id} style={{ width: 104, gap: 6 }}>
                    <ArtworkImage uri={musicProfileArtistImage(artist)} size={104} shape="circle" />
                    <Text
                      numberOfLines={1}
                      style={[pageType.meta, { color: tokens.foreground, fontWeight: "600", textAlign: "center" }]}
                    >
                      {artist.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ color: tokens.mutedForeground, fontSize: 12, textAlign: "center" }}
                    >
                      {t(`${PROFILE}.plays`, { count: artist.play_count })}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </Section>
          ) : null}

          {topSongs.length > 0 ? (
            <Section order={3} title={t(`${PROFILE}.topSongs`)}>
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
            </Section>
          ) : null}

          {recent.length > 0 ? (
            <Section order={4} title={t(`${PROFILE}.recent`)}>
              {recent.map((song, index) => (
                <SnapshotSongRow
                  key={`${song.id}-${index}`}
                  title={song.title}
                  artistNames={song.artist_names}
                  artworkUrl={song.artwork_url}
                  duration={song.duration}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
