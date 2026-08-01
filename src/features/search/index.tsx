/**
 * Search (FR-30..34). On native the input and the results page are ONE
 * screen: while the field is being edited the screen shows recents (empty
 * query) or the ranked suggestions (top 3 per kind); submitting switches
 * to the full result page for that term. Both modes share the same four
 * `1:20` queries, so submitting never refetches.
 *
 * Activation semantics are the web's (FR-32): a song REPLACES the queue
 * with just that song and plays; artists, albums and playlists navigate.
 */
import React, { useMemo, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSearchArtists } from "@/api/queries/artists";
import { useLikedIds } from "@/api/queries/likedSongs";
import { useSearchPlaylists } from "@/api/queries/playlists";
import { useArtistPictures, useSearchAlbums, useSearchSongs } from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import {
  artistImageSource,
  playlistArtworkSource,
  songArtworkSource,
  type ArtworkSource,
} from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useContentBottomPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import {
  forgetSearch,
  readRecentSearches,
  rememberSearch,
} from "@/lib/recentSearches";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";
import {
  AlbumCard,
  ArtistCard,
  ArtworkImage,
  EmptyState,
  FilterPills,
  Icon,
  PlayFab,
  SongRow,
  Tile,
  useDownloadStatusVersion,
} from "@/ui";
import { ExternalResults } from "./ExternalResults";
import {
  albumHitRoute,
  buildSuggestions,
  deriveArtistEntries,
  pickTopResult,
  toAlbumHits,
  type SearchAlbumHit,
  type SearchArtistEntry,
  type SearchFilter,
  type SearchSuggestion,
  type TopResult,
} from "./results";
import { useDebounced } from "./useDebounced";

const FILTERS: SearchFilter[] = ["all", "songs", "playlists", "albums", "artists"];

const nodeArtwork = (nodeId: string | null | undefined): ArtworkSource =>
  nodeId ? { kind: "node", nodeId } : { kind: "placeholder" };

const artistRoute = (entry: SearchArtistEntry): string => `/(main)/artist/${entry.segment}`;

/**
 * Album page + song highlight (FR-44 param): the web's `#<title>` hash.
 */
const songAlbumRoute = (song: Song): string => {
  const artists = song.artists ?? [];
  const primary = artists.find((a) => a.role === "primary") ?? artists[0];
  const segment = primary?.slug || (primary ? encodeURIComponent(primary.name) : "null");
  const album = song.album ? encodeURIComponent(song.album) : "null";
  return `/(main)/album/${segment}/${album}?highlight=${encodeURIComponent(song.title)}`;
};

/** Deezer picture lookup for a name-only artist card (FR-33). */
const DerivedArtistCard = ({
  entry,
  onPress,
}: {
  entry: SearchArtistEntry;
  onPress: () => void;
}) => {
  const pictures = useArtistPictures(entry.name);
  const first = pictures.data?.pictures?.[0];
  return (
    <ArtistCard
      name={entry.name}
      imageUri={first?.picture_medium ?? first?.picture ?? null}
      loading={pictures.isLoading}
      size={96}
      onPress={onPress}
    />
  );
};

const SectionTitle = ({ children }: { children: string }) => {
  const { tokens } = useTheme();
  return (
    <Text style={[typeScale.sectionHeader, { color: tokens.foreground, fontSize: 20 }]}>
      {children}
    </Text>
  );
};

const SuggestionRow = ({
  suggestion,
  onSelect,
}: {
  suggestion: SearchSuggestion;
  onSelect: () => void;
}) => {
  const { tokens } = useTheme();
  const t = useT();

  let artwork: ArtworkSource = { kind: "placeholder" };
  let title = "";
  let subtitle = "";
  let circle = false;

  switch (suggestion.kind) {
    case "song":
      artwork = songArtworkSource(suggestion.song);
      title = suggestion.song.title;
      subtitle = `${t("components.music.MusicSearchInput.kindSong")} • ${
        formatArtists(suggestion.song) ||
        t("components.music.MusicSearchInput.unknownArtist")
      }`;
      break;
    case "artist":
      artwork = suggestion.entry.artist
        ? artistImageSource(suggestion.entry.artist, "sm")
        : { kind: "initials", name: suggestion.entry.name };
      title = suggestion.entry.name;
      subtitle = t("components.music.MusicSearchInput.kindArtist");
      circle = true;
      break;
    case "album":
      artwork = nodeArtwork(suggestion.album.artworkFsNodeId);
      title = suggestion.album.name;
      subtitle = `${t("components.music.MusicSearchInput.kindAlbum")} • ${
        suggestion.album.artist ?? t("components.music.MusicSearchInput.unknownArtist")
      }`;
      break;
    case "playlist":
      artwork = playlistArtworkSource(suggestion.playlist);
      title = suggestion.playlist.name;
      subtitle = t("components.music.MusicSearchInput.kindPlaylist");
      break;
  }

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 24,
        paddingVertical: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ArtworkImage source={artwork} size={40} shape={circle ? "circle" : "rounded"} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: tokens.foreground, fontSize: 14, fontWeight: "500" }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
};

const TopResultCard = ({
  top,
  onOpen,
  onPlay,
}: {
  top: TopResult;
  onOpen: () => void;
  onPlay?: () => void;
}) => {
  const { tokens } = useTheme();
  const t = useT();

  const artistName =
    top.kind === "artist"
      ? top.entry.name
      : top.kind === "song"
        ? formatArtists(top.song)
        : top.kind === "album"
          ? (top.album.artist ?? "")
          : "";
  const hasResource = top.kind === "artist" && !!top.entry.artist;
  const pictures = useArtistPictures(artistName || null, !hasResource);
  const deezer = pictures.data?.pictures?.[0];
  const deezerUri = deezer?.picture_big ?? deezer?.picture_medium ?? deezer?.picture ?? null;

  let artwork: ArtworkSource | null = null;
  let title = "";
  let badge = "";
  let subtitle = "";
  let circle = false;

  switch (top.kind) {
    case "song":
      artwork = songArtworkSource(top.song);
      title = top.song.title;
      badge = t("components.music.Search.kindSong");
      subtitle = formatArtists(top.song);
      break;
    case "artist":
      artwork = top.entry.artist
        ? artistImageSource(top.entry.artist, "sm")
        : deezerUri
          ? { kind: "external", url: deezerUri }
          : { kind: "initials", name: top.entry.name };
      title = top.entry.name;
      badge = t("components.music.Search.kindArtist");
      circle = true;
      break;
    case "album":
      artwork = top.album.artworkFsNodeId
        ? { kind: "node", nodeId: top.album.artworkFsNodeId }
        : deezerUri
          ? { kind: "external", url: deezerUri }
          : { kind: "placeholder" };
      title = top.album.name;
      badge = t("components.music.Search.kindAlbum");
      subtitle = top.album.artist ?? "";
      break;
    case "playlist":
      artwork = playlistArtworkSource(top.playlist);
      title = top.playlist.name;
      badge = t("components.music.Search.kindPlaylist");
      break;
  }

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        minHeight: 200,
        borderRadius: RADIUS + 4,
        padding: 20,
        gap: 16,
        backgroundColor: tokens.card,
        borderWidth: 1,
        borderColor: tokens.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <ArtworkImage source={artwork} size={96} shape={circle ? "circle" : "rounded"} />
      <View style={{ gap: 6, minWidth: 0 }}>
        <Text
          style={{
            color: tokens.foreground,
            fontSize: 24,
            fontWeight: "800",
            lineHeight: 28,
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              color: tokens.foreground,
              fontSize: 11,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              backgroundColor: tokens.secondary,
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 2,
              overflow: "hidden",
            }}
          >
            {badge}
          </Text>
          {subtitle ? (
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 13, flex: 1 }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {onPlay ? (
        <PlayFab
          onPress={onPlay}
          size={48}
          accessibilityLabel={t("components.music.Search.play")}
          style={{ position: "absolute", right: 20, bottom: 20 }}
        />
      ) : null}
    </Pressable>
  );
};

export default function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = useContentBottomPadding();
  const params = useLocalSearchParams<{ query?: string }>();
  const downloadVersion = useDownloadStatusVersion();

  const [input, setInput] = useState(params.query ?? "");
  const [submitted, setSubmitted] = useState<string | null>(params.query ?? null);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [recents, setRecents] = useState<string[]>(() => readRecentSearches());
  const debounced = useDebounced(input);

  // A deep link can land on an already-mounted screen (FR-20). Adjusting
  // state while rendering is the documented pattern for "a prop changed";
  // an effect here would cost an extra render pass.
  const routeQuery = params.query ?? null;
  const [seenRouteQuery, setSeenRouteQuery] = useState<string | null>(routeQuery);
  if (routeQuery !== seenRouteQuery) {
    setSeenRouteQuery(routeQuery);
    if (routeQuery) {
      setInput(routeQuery);
      setSubmitted(routeQuery);
    }
  }

  const term = (submitted ?? debounced).trim();
  const enabled = term.length > 0;

  const songsQuery = useSearchSongs(term, enabled);
  const artistsQuery = useSearchArtists(term, enabled);
  const albumsQuery = useSearchAlbums(term, enabled);
  const playlistsQuery = useSearchPlaylists(term, enabled);
  const likedIdsQuery = useLikedIds();

  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const isPlaying = usePlaybackView((v) => v.playing);

  const songs = useMemo(() => songsQuery.data ?? [], [songsQuery.data]);
  const directArtists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);
  const playlists = useMemo(() => playlistsQuery.data ?? [], [playlistsQuery.data]);
  const albums: SearchAlbumHit[] = useMemo(
    () => toAlbumHits(albumsQuery.data ?? [], term),
    [albumsQuery.data, term],
  );
  const artists = useMemo(
    () => deriveArtistEntries(directArtists, songs, albums, term),
    [directArtists, songs, albums, term],
  );
  const likedIds = useMemo(
    () => new Set(likedIdsQuery.data ?? []),
    [likedIdsQuery.data],
  );

  const isLoading =
    enabled &&
    (songsQuery.isLoading ||
      artistsQuery.isLoading ||
      albumsQuery.isLoading ||
      playlistsQuery.isLoading);
  const localHits = songs.length + artists.length + albums.length + playlists.length;

  const top = useMemo(
    () =>
      enabled
        ? pickTopResult(filter, { songs, directArtists, artists, albums, playlists })
        : null,
    [enabled, filter, songs, directArtists, artists, albums, playlists],
  );

  const suggestions = useMemo(
    () => (enabled ? buildSuggestions({ songs, directArtists, albums, playlists }) : []),
    [enabled, songs, directArtists, albums, playlists],
  );

  const submit = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecents(rememberSearch(trimmed));
    setInput(trimmed);
    setSubmitted(trimmed);
    Keyboard.dismiss();
  };

  const openTerm = (value: string): void => {
    setInput(value);
    submit(value);
  };

  const playSongList = (list: Song[], index: number): void => {
    getTransport().setQueue(list, index, { shuffle: false });
  };

  const activate = (suggestion: SearchSuggestion): void => {
    if (term) setRecents(rememberSearch(term));
    Keyboard.dismiss();
    switch (suggestion.kind) {
      // FR-32: a song becomes a queue of exactly one and plays.
      case "song":
        playSongList([suggestion.song], 0);
        return;
      case "artist":
        router.push(artistRoute(suggestion.entry));
        return;
      case "album":
        router.push(albumHitRoute(suggestion.album));
        return;
      case "playlist":
        router.push(`/(main)/playlist/${suggestion.playlist.id}`);
        return;
    }
  };

  const openTop = (): void => {
    if (!top) return;
    switch (top.kind) {
      case "song":
        router.push(songAlbumRoute(top.song));
        return;
      case "artist":
        router.push(artistRoute(top.entry));
        return;
      case "album":
        router.push(albumHitRoute(top.album));
        return;
      case "playlist":
        router.push(`/(main)/playlist/${top.playlist.id}`);
        return;
    }
  };

  const showSongs = filter === "all" || filter === "songs";
  const showArtists = filter === "all" || filter === "artists";
  const showAlbums = filter === "all" || filter === "albums";
  const showPlaylists = filter === "all" || filter === "playlists";

  const searchField = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 24,
        paddingHorizontal: 12,
        height: 44,
        borderRadius: 999,
        backgroundColor: tokens.secondary,
      }}
    >
      <Icon name="search" size={18} color={tokens.mutedForeground} />
      <TextInput
        value={input}
        onChangeText={(value) => {
          setInput(value);
          if (submitted !== null) setSubmitted(null);
        }}
        onSubmitEditing={() => submit(input)}
        placeholder={t("components.music.TopBar.searchMusic")}
        placeholderTextColor={tokens.mutedForeground}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={t("components.music.MusicSearchInput.ariaSearch")}
        style={{ flex: 1, color: tokens.foreground, fontSize: 15 }}
      />
      {input.length > 0 ? (
        <Pressable
          onPress={() => {
            setInput("");
            setSubmitted(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("components.music.MusicSearchInput.clear")}
          hitSlop={8}
        >
          <Icon name="x" size={16} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: bottomPadding + 24,
        gap: 20,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={[typeScale.sectionHeader, { color: tokens.foreground, paddingHorizontal: 24 }]}
      >
        {t("native.shell.tabSearch")}
      </Text>
      {searchField}

      {!enabled ? (
        recents.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 12,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
                paddingHorizontal: 24,
                paddingBottom: 4,
              }}
            >
              {t("components.music.MusicSearchInput.recent")}
            </Text>
            {recents.map((value) => (
              <View
                key={value}
                style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 24 }}
              >
                <Pressable
                  onPress={() => openTerm(value)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon name="clock" size={16} color={tokens.mutedForeground} />
                  <Text style={{ color: tokens.foreground, fontSize: 14 }} numberOfLines={1}>
                    {value}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setRecents(forgetSearch(value))}
                  accessibilityRole="button"
                  accessibilityLabel={t("components.music.MusicSearchInput.removeRecent")}
                  hitSlop={8}
                  style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
                >
                  <Icon name="x" size={14} color={tokens.mutedForeground} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="search" text={t("components.music.Search.emptyQuery")} />
        )
      ) : submitted === null ? (
        <View style={{ gap: 2 }}>
          {isLoading && suggestions.length === 0 ? (
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 14,
                paddingHorizontal: 24,
                paddingVertical: 8,
              }}
            >
              {t("components.music.MusicSearchInput.loading")}
            </Text>
          ) : null}
          {!isLoading && suggestions.length === 0 ? (
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 14,
                paddingHorizontal: 24,
                paddingVertical: 8,
              }}
            >
              {t("components.music.MusicSearchInput.noResults")}
            </Text>
          ) : null}
          {suggestions.map((suggestion, i) => (
            <SuggestionRow
              key={`${suggestion.kind}-${i}`}
              suggestion={suggestion}
              onSelect={() => activate(suggestion)}
            />
          ))}
          <Pressable
            onPress={() => submit(input)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: 24,
              paddingVertical: 14,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: tokens.primary, fontSize: 14, fontWeight: "600" }}>
              {t("components.music.MusicSearchInput.seeAllResults", { query: term })}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FilterPills
            pills={FILTERS.map((key) => ({
              key,
              label: t(
                `components.music.Search.filter${key[0].toUpperCase()}${key.slice(1)}`,
              ),
            }))}
            activeKey={filter}
            onChange={(key) => setFilter(key as SearchFilter)}
          />

          {isLoading && localHits === 0 ? (
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 14, paddingHorizontal: 24 }}
            >
              {t("components.music.Search.loading")}
            </Text>
          ) : null}

          {!isLoading && !top ? (
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 14, paddingHorizontal: 24 }}
            >
              {t("components.music.Search.noResultsFor", { query: term })}
            </Text>
          ) : null}

          {top && filter === "all" ? (
            <View style={{ gap: 12, paddingHorizontal: 24 }}>
              <SectionTitle>{t("components.music.Search.topResult")}</SectionTitle>
              <TopResultCard
                top={top}
                onOpen={openTop}
                onPlay={
                  top.kind === "song"
                    ? () => playSongList([top.song], 0)
                    : undefined
                }
              />
            </View>
          ) : null}

          {filter === "all" && songs.length > 0 ? (
            <View style={{ gap: 8 }}>
              <View style={{ paddingHorizontal: 24 }}>
                <SectionTitle>{t("components.music.Search.songs")}</SectionTitle>
              </View>
              {songs.slice(0, 4).map((song, i) => (
                <SongRow
                  key={song.id}
                  song={song}
                  index={i}
                  columns={["title", "duration"]}
                  surface="search"
                  liked={likedIds.has(song.id)}
                  isCurrent={currentSongId === song.id}
                  isPlaying={isPlaying}
                  downloadVersion={downloadVersion}
                  onPlay={() => playSongList(songs, i)}
                />
              ))}
            </View>
          ) : null}

          {showSongs && filter !== "all" && songs.length > 0 ? (
            <View style={{ gap: 8 }}>
              <View style={{ paddingHorizontal: 24 }}>
                <SectionTitle>{t("components.music.Search.songs")}</SectionTitle>
              </View>
              {songs.map((song, i) => (
                <SongRow
                  key={song.id}
                  song={song}
                  index={i}
                  columns={["index", "title", "album", "duration"]}
                  surface="search"
                  liked={likedIds.has(song.id)}
                  isCurrent={currentSongId === song.id}
                  isPlaying={isPlaying}
                  downloadVersion={downloadVersion}
                  onPlay={() => playSongList(songs, i)}
                />
              ))}
            </View>
          ) : null}

          {showArtists && artists.length > 0 ? (
            <View style={{ gap: 12, paddingHorizontal: 24 }}>
              <SectionTitle>{t("components.music.Search.artists")}</SectionTitle>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {artists.map((entry, i) =>
                  entry.artist ? (
                    <ArtistCard
                      key={`artist-${i}-${entry.name}`}
                      name={entry.name}
                      image={artistImageSource(entry.artist, "sm")}
                      size={96}
                      onPress={() => router.push(artistRoute(entry))}
                    />
                  ) : (
                    <DerivedArtistCard
                      key={`derived-${i}-${entry.name}`}
                      entry={entry}
                      onPress={() => router.push(artistRoute(entry))}
                    />
                  ),
                )}
              </View>
            </View>
          ) : null}

          {showAlbums && albums.length > 0 ? (
            <View style={{ gap: 12, paddingHorizontal: 24 }}>
              <SectionTitle>{t("components.music.Search.albums")}</SectionTitle>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {albums.map((album, i) => (
                  <AlbumCard
                    key={`album-${i}-${album.name}`}
                    name={album.name}
                    artwork={nodeArtwork(album.artworkFsNodeId)}
                    onPress={() => router.push(albumHitRoute(album))}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {showPlaylists && playlists.length > 0 ? (
            <View style={{ gap: 12, paddingHorizontal: 24 }}>
              <SectionTitle>{t("components.music.Search.playlists")}</SectionTitle>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {playlists.map((playlist) => (
                  <Tile
                    key={playlist.id}
                    title={playlist.name}
                    subtitle={t("components.music.Search.kindPlaylist")}
                    artwork={playlistArtworkSource(playlist)}
                    width={152}
                    onPress={() => router.push(`/(main)/playlist/${playlist.id}`)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <ExternalResults query={term} />
        </>
      )}
    </ScrollView>
  );
}
