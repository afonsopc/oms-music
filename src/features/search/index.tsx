/**
 * Pesquisa (FR-30..34). No telemóvel o campo e os resultados são UM ecrã:
 * enquanto se escreve aparecem as recentes (campo vazio) ou as sugestões
 * (3 por tipo); ao submeter passa à página completa desse termo. Os dois
 * modos partilham os mesmos quatro pedidos `1:20`: submeter nunca volta a
 * pedir.
 *
 * No computador a barra de cima tem o único campo, por isso esta página não
 * desenha campo nenhum: é o destino "ver todos os resultados", guiado só
 * pelo parâmetro `query` do URL.
 *
 * Tocar numa música SUBSTITUI a fila por essa música e toca; artistas,
 * álbuns e playlists abrem (FR-32).
 *
 * Redesenho 2026-11-04: um campo limpo, secções com `SectionLabel`, músicas
 * em linhas, artistas/álbuns/playlists com capas grandes, esqueleto enquanto
 * pesquisa, estados de vazio, sem resultados e erro.
 */
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSearchArtists } from "@/api/queries/artists";
import { useLikedIds } from "@/api/queries/likedSongs";
import { useSearchPlaylists } from "@/api/queries/playlists";
import {
  useArtistPictures,
  useSearchAlbums,
  useSearchSongs,
} from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import {
  artistImageSource,
  playlistArtworkSource,
  songArtworkSource,
  type ArtworkSource,
} from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Playlist } from "@/domain/playlist";
import type { Song } from "@/domain/song";
import {
  ArtCard,
  ArtCardSkeleton,
  ArtGrid,
  ArtRail,
  useCardWidth,
} from "@/features/home/artRail";
import {
  useContentBottomPadding,
  useContentTopPadding,
} from "@/features/shell/metrics";
import { TabHeader } from "@/features/shell/TabHeader";
import { useTabScrollToTop } from "@/features/shell/useTabScrollToTop";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import {
  forgetSearch,
  readRecentSearches,
  rememberSearch,
} from "@/lib/recentSearches";
import { artistRoute, playlistRoute, songHighlightRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import {
  ArtworkImage,
  FilterPills,
  Icon,
  PlayFab,
  SongRow,
  useDesktopShell,
} from "@/ui";
import { PressableScale, Reveal } from "@/ui/motion";
import {
  ListRow,
  ListSkeleton,
  PageState,
  SectionLabel,
  pageType,
  useGutter,
} from "@/ui/page";
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

const FILTERS: SearchFilter[] = [
  "all",
  "songs",
  "playlists",
  "albums",
  "artists",
];

/** Músicas na vista "Tudo"; o resto está no filtro Músicas. */
const SONGS_IN_ALL = 4;
/**
 * Artistas só com nome (sem ficha) pedem a foto um a um. Só os primeiros
 * pedem; os outros ficam com as iniciais (um pedido por linha era demais).
 */
const DERIVED_PICTURE_LIMIT = 4;

const nodeArtwork = (nodeId: string | null | undefined): ArtworkSource =>
  nodeId ? { kind: "node", nodeId } : { kind: "placeholder" };

const entryRoute = (entry: SearchArtistEntry): Href =>
  artistRoute(entry.segment);

/** Cartão de um artista: com ficha usa a imagem dela, só com nome pede a foto (se `fetchPicture`). */
const ArtistResult = memo(function ArtistResult({
  entry,
  width,
  fetchPicture,
  onOpen,
}: {
  entry: SearchArtistEntry;
  width: number;
  fetchPicture: boolean;
  onOpen: (entry: SearchArtistEntry) => void;
}) {
  const pictures = useArtistPictures(entry.name, !entry.artist && fetchPicture);
  const first = pictures.data?.[0];
  const uri = first?.picture_medium ?? first?.picture ?? null;
  if (!entry.artist && pictures.isLoading && fetchPicture)
    return <ArtCardSkeleton width={width} circle />;
  const artwork: ArtworkSource = entry.artist
    ? artistImageSource(entry.artist, "sm")
    : uri
      ? { kind: "external", url: uri }
      : { kind: "initials", name: entry.name };
  return (
    <ArtCard
      title={entry.name}
      circle
      width={width}
      artwork={artwork}
      onPress={() => onOpen(entry)}
    />
  );
});

/**
 * Uma sugestão com o tipo. Exportada para a barra de cima do computador
 * (TopBarSearch): as duas listas têm de rotular e ordenar igual, por isso há
 * uma só linha. `highlighted` é o cursor do teclado lá; `inset` a margem.
 */
export const SuggestionRow = ({
  suggestion,
  onSelect,
  highlighted = false,
  inset = 24,
}: {
  suggestion: SearchSuggestion;
  onSelect: () => void;
  highlighted?: boolean;
  inset?: number;
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
      subtitle = `${t("components.music.MusicSearchInput.kindSong")} · ${
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
      subtitle = `${t("components.music.MusicSearchInput.kindAlbum")} · ${
        suggestion.album.artist ??
        t("components.music.MusicSearchInput.unknownArtist")
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
        gap: 14,
        minHeight: 56,
        paddingHorizontal: inset,
        paddingVertical: 6,
        backgroundColor:
          pressed || highlighted ? tokens.secondary : "transparent",
      })}
    >
      <ArtworkImage
        source={artwork}
        size={44}
        shape={circle ? "circle" : "rounded"}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            pageType.body,
            { color: tokens.foreground, fontWeight: "500" },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[pageType.meta, { color: tokens.mutedForeground }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
};

/** O melhor resultado: capa grande, título grande, o tipo por baixo. Sem caixa. */
const TopResultBlock = ({
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
  const gutter = useGutter();
  const desktop = useDesktopShell();
  const size = desktop ? 160 : 120;

  const artistName =
    top.kind === "artist"
      ? top.entry.name
      : top.kind === "song"
        ? formatArtists(top.song)
        : top.kind === "album"
          ? (top.album.artist ?? "")
          : "";
  const hasResource = top.kind === "artist" && !!top.entry.artist;
  const pictures = useArtistPictures(
    artistName || null,
    !hasResource && top.kind !== "song" && top.kind !== "playlist",
  );
  const picture = pictures.data?.[0];
  const pictureUri =
    picture?.picture_big ?? picture?.picture_medium ?? picture?.picture ?? null;

  let artwork: ArtworkSource = { kind: "placeholder" };
  let title = "";
  let meta = "";
  let circle = false;

  switch (top.kind) {
    case "song":
      artwork = songArtworkSource(top.song);
      title = top.song.title;
      meta = [t("components.music.Search.kindSong"), formatArtists(top.song)]
        .filter(Boolean)
        .join(" · ");
      break;
    case "artist":
      artwork = top.entry.artist
        ? artistImageSource(top.entry.artist, "sm")
        : pictureUri
          ? { kind: "external", url: pictureUri }
          : { kind: "initials", name: top.entry.name };
      title = top.entry.name;
      meta = t("components.music.Search.kindArtist");
      circle = true;
      break;
    case "album":
      artwork = top.album.artworkFsNodeId
        ? { kind: "node", nodeId: top.album.artworkFsNodeId }
        : pictureUri
          ? { kind: "external", url: pictureUri }
          : { kind: "placeholder" };
      title = top.album.name;
      meta = [t("components.music.Search.kindAlbum"), top.album.artist]
        .filter(Boolean)
        .join(" · ");
      break;
    case "playlist":
      artwork = playlistArtworkSource(top.playlist);
      title = top.playlist.name;
      meta = t("components.music.Search.kindPlaylist");
      break;
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingHorizontal: gutter,
      }}
    >
      <PressableScale
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <ArtworkImage
          source={artwork}
          size={size}
          shape={circle ? "circle" : "rounded"}
        />
      </PressableScale>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={2}
          onPress={onOpen}
          style={{
            color: tokens.foreground,
            fontSize: 22,
            lineHeight: 26,
            fontWeight: "800",
            letterSpacing: -0.4,
          }}
        >
          {title}
        </Text>
        {meta ? (
          <Text
            numberOfLines={1}
            style={[pageType.meta, { color: tokens.mutedForeground }]}
          >
            {meta}
          </Text>
        ) : null}
        {onPlay ? (
          <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <PlayFab
              onPress={() => {
                haptics.tap();
                onPlay();
              }}
              size={44}
              accessibilityLabel={t("components.music.Search.play")}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
};

/** Linha de música com memo: só a actual recebe "a tocar", e as funções são estáveis. */
const ResultSongRow = memo(function ResultSongRow({
  song,
  index,
  liked,
  isCurrent,
  isPlaying,
  wide,
  onPlayAt,
}: {
  song: Song;
  index: number;
  liked: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  wide: boolean;
  onPlayAt: (index: number) => void;
}) {
  const onPlay = useCallback(() => onPlayAt(index), [onPlayAt, index]);
  return (
    <SongRow
      song={song}
      index={index}
      columns={
        wide ? ["index", "title", "album", "duration"] : ["title", "duration"]
      }
      surface="search"
      liked={liked}
      isCurrent={isCurrent}
      isPlaying={isCurrent && isPlaying}
      onPlay={onPlay}
    />
  );
});

const ResultsSkeleton = () => {
  const width = useCardWidth();
  const gutter = useGutter();
  return (
    <View style={{ gap: 24, paddingTop: 16 }}>
      <ListSkeleton rows={4} />
      <View
        style={{
          flexDirection: "row",
          gap: 14,
          paddingHorizontal: gutter,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <ArtCardSkeleton key={i} width={width} circle />
        ))}
      </View>
    </View>
  );
};

export default function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const cardWidth = useCardWidth();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(12);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const params = useLocalSearchParams<{ query?: string }>();
  /**
   * Computador: a barra de cima já tem o campo com sugestões, por isso esta
   * página é só "ver todos os resultados" - o termo vem do URL.
   */
  const desktopShell = useDesktopShell();

  const [input, setInput] = useState(params.query ?? "");
  const [submitted, setSubmitted] = useState<string | null>(
    params.query ?? null,
  );
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [recents, setRecents] = useState<string[]>(() => readRecentSearches());
  const debounced = useDebounced(input);

  // Uma ligação pode chegar com o ecrã já montado (FR-20): ajustar o estado
  // durante o render é o padrão para "uma prop mudou" (sem render extra).
  const routeQuery = params.query ?? null;
  const [seenRouteQuery, setSeenRouteQuery] = useState<string | null>(
    routeQuery,
  );
  if (routeQuery !== seenRouteQuery) {
    setSeenRouteQuery(routeQuery);
    if (routeQuery) {
      setInput(routeQuery);
      setSubmitted(routeQuery);
    }
  }

  const term = (
    desktopShell ? (routeQuery ?? "") : (submitted ?? debounced)
  ).trim();
  const enabled = term.length > 0;
  /** Página completa vs sugestões; no computador é sempre a completa. */
  const fullResults = desktopShell || submitted !== null;
  /** Ainda a escrever (o termo ainda não assentou): conta como "a pesquisar". */
  const typing =
    !desktopShell && submitted === null && input.trim() !== debounced.trim();

  const songsQuery = useSearchSongs(term, enabled);
  const artistsQuery = useSearchArtists(term, enabled);
  const albumsQuery = useSearchAlbums(term, enabled);
  const playlistsQuery = useSearchPlaylists(term, enabled);
  const likedIdsQuery = useLikedIds();

  const currentSongId = usePlaybackView((v) => v.song?.id ?? null);
  const isPlaying = usePlaybackView((v) => v.playing);

  const songs = useMemo(() => songsQuery.data ?? [], [songsQuery.data]);
  const directArtists = useMemo(
    () => artistsQuery.data ?? [],
    [artistsQuery.data],
  );
  const playlists = useMemo(
    () => playlistsQuery.data ?? [],
    [playlistsQuery.data],
  );
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

  const queries = [songsQuery, artistsQuery, albumsQuery, playlistsQuery];
  const isLoading = enabled && queries.some((q) => q.isLoading);
  const allFailed = enabled && queries.every((q) => q.isError);
  const retryAll = (): void => {
    for (const q of queries) void q.refetch();
  };
  const localHits =
    songs.length + artists.length + albums.length + playlists.length;

  const top = useMemo(
    () =>
      enabled
        ? pickTopResult(filter, {
            songs,
            directArtists,
            artists,
            albums,
            playlists,
          })
        : null,
    [enabled, filter, songs, directArtists, artists, albums, playlists],
  );

  const suggestions = useMemo(
    () =>
      enabled
        ? buildSuggestions({ songs, directArtists, albums, playlists })
        : [],
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
    if (desktopShell) {
      // No computador o URL é o campo: escrever o parâmetro volta a pesquisar
      // e chega ao campo da barra de cima.
      setRecents(rememberSearch(value));
      router.setParams({ query: value });
      return;
    }
    setInput(value);
    submit(value);
  };

  const playSongList = useCallback((list: Song[], index: number): void => {
    haptics.tap();
    getTransport().setQueue(list, index, { shuffle: false });
  }, []);
  const playSongAt = useCallback(
    (index: number) => playSongList(songs, index),
    [playSongList, songs],
  );

  const openArtist = useCallback(
    (entry: SearchArtistEntry) => router.push(entryRoute(entry)),
    [router],
  );

  const activate = (suggestion: SearchSuggestion): void => {
    if (term) setRecents(rememberSearch(term));
    Keyboard.dismiss();
    switch (suggestion.kind) {
      // FR-32: uma música passa a ser uma fila só com ela e toca.
      case "song":
        playSongList([suggestion.song], 0);
        return;
      case "artist":
        router.push(entryRoute(suggestion.entry));
        return;
      case "album":
        router.push(albumHitRoute(suggestion.album));
        return;
      case "playlist":
        router.push(playlistRoute(suggestion.playlist.id));
        return;
    }
  };

  const openTop = (): void => {
    if (!top) return;
    switch (top.kind) {
      case "song":
        router.push(songHighlightRoute(top.song));
        return;
      case "artist":
        router.push(entryRoute(top.entry));
        return;
      case "album":
        router.push(albumHitRoute(top.album));
        return;
      case "playlist":
        router.push(playlistRoute(top.playlist.id));
        return;
    }
  };

  const pickFilter = (key: SearchFilter): void => {
    // As FilterPills já dão o haptics.select() ao tocar; isto é para os
    // "Mostrar tudo" das secções, que também mudam de filtro.
    setFilter(key);
  };
  const showAllIn = (key: SearchFilter) => () => {
    haptics.select();
    pickFilter(key);
  };

  const showAllLabel = t("components.music.Home.showAll");
  const noResultsText = t("components.music.Search.noResultsFor", {
    query: term,
  });

  const searchField = desktopShell ? null : (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginHorizontal: gutter,
        marginTop: 12,
        paddingHorizontal: 14,
        height: 48,
        borderRadius: 10,
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
        style={{ flex: 1, color: tokens.foreground, fontSize: 16, height: 48 }}
      />
      {input.length > 0 ? (
        <Pressable
          onPress={() => {
            setInput("");
            setSubmitted(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("components.music.MusicSearchInput.clear")}
          hitSlop={10}
        >
          <Icon name="x" size={18} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (!enabled) {
    body =
      recents.length > 0 ? (
        <View>
          <SectionLabel title={t("components.music.MusicSearchInput.recent")} />
          {recents.map((value, i) => (
            <ListRow
              key={value}
              order={i}
              icon="clock"
              title={value}
              last={i === recents.length - 1}
              onPress={() => openTerm(value)}
              trailing={
                <Pressable
                  onPress={() => setRecents(forgetSearch(value))}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    "components.music.MusicSearchInput.removeRecent",
                  )}
                  hitSlop={10}
                  style={({ pressed }) => ({
                    padding: 6,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Icon name="x" size={16} color={tokens.mutedForeground} />
                </Pressable>
              }
            />
          ))}
        </View>
      ) : (
        <PageState
          loading={false}
          empty
          emptyIcon="search"
          emptyText={t("components.music.Search.emptyQuery")}
        />
      );
  } else if (allFailed) {
    body = <PageState loading={false} error onRetry={retryAll} />;
  } else if (!fullResults) {
    body =
      (isLoading || typing) && suggestions.length === 0 ? (
        <View style={{ paddingTop: 12 }}>
          <PageState loading skeleton={<ListSkeleton rows={6} />} />
        </View>
      ) : !isLoading && suggestions.length === 0 ? (
        <PageState
          loading={false}
          empty
          emptyIcon="search"
          emptyText={noResultsText}
        />
      ) : (
        <View style={{ paddingTop: 12 }}>
          {suggestions.map((suggestion, i) => (
            <Reveal
              key={`${suggestion.kind}-${i}`}
              order={i}
              step={25}
              distance={6}
            >
              <SuggestionRow
                suggestion={suggestion}
                inset={gutter}
                onSelect={() => activate(suggestion)}
              />
            </Reveal>
          ))}
          <ListRow
            icon="search"
            title={t("components.music.MusicSearchInput.seeAllResults", {
              query: term,
            })}
            chevron
            last
            onPress={() => submit(input)}
          />
        </View>
      );
  } else {
    const all = filter === "all";
    const wideRows = filter === "songs";
    const visibleSongs = all ? songs.slice(0, SONGS_IN_ALL) : songs;
    const showSongs = (all || filter === "songs") && songs.length > 0;
    const showArtists = (all || filter === "artists") && artists.length > 0;
    const showAlbums = (all || filter === "albums") && albums.length > 0;
    const showPlaylists =
      (all || filter === "playlists") && playlists.length > 0;
    let derivedSeen = 0;
    const fetchFor = artists.map((entry) =>
      entry.artist ? false : derivedSeen++ < DERIVED_PICTURE_LIMIT,
    );

    const albumCard = (album: SearchAlbumHit, width: number, i: number) => (
      <ArtCard
        key={`album-${i}-${album.name}`}
        title={album.name}
        subtitle={album.artist}
        artwork={nodeArtwork(album.artworkFsNodeId)}
        width={width}
        onPress={() => router.push(albumHitRoute(album))}
      />
    );
    const playlistCard = (playlist: Playlist, width: number) => (
      <ArtCard
        key={playlist.id}
        title={playlist.name}
        subtitle={t("components.music.Search.kindPlaylist")}
        artwork={playlistArtworkSource(playlist)}
        width={width}
        onPress={() => router.push(playlistRoute(playlist.id))}
      />
    );

    body = (
      <>
        <FilterPills
          pills={FILTERS.map((key) => ({
            key,
            label: t(
              `components.music.Search.filter${key[0].toUpperCase()}${key.slice(1)}`,
            ),
          }))}
          activeKey={filter}
          onChange={(key) => pickFilter(key as SearchFilter)}
          contentPaddingHorizontal={gutter}
          style={{ flexGrow: 0, marginTop: 8 }}
        />

        {isLoading && localHits === 0 ? (
          <PageState
            loading
            onRetry={retryAll}
            skeleton={<ResultsSkeleton />}
          />
        ) : !isLoading && !top ? (
          <PageState
            loading={false}
            empty
            emptyIcon="search"
            emptyText={noResultsText}
          />
        ) : null}

        {top && all ? (
          <Reveal order={0}>
            <SectionLabel title={t("components.music.Search.topResult")} />
            <TopResultBlock
              top={top}
              onOpen={openTop}
              onPlay={
                top.kind === "song"
                  ? () =>
                      getTransport().setQueue([top.song], 0, { shuffle: false })
                  : undefined
              }
            />
          </Reveal>
        ) : null}

        {showSongs ? (
          <Reveal order={1}>
            <SectionLabel
              title={t("components.music.Search.songs")}
              actionLabel={
                all && songs.length > SONGS_IN_ALL ? showAllLabel : undefined
              }
              onAction={all ? showAllIn("songs") : undefined}
            />
            <View style={{ paddingHorizontal: gutter - 12 }}>
              {visibleSongs.map((song, i) => (
                <ResultSongRow
                  key={song.id}
                  song={song}
                  index={i}
                  liked={likedIds.has(song.id)}
                  isCurrent={currentSongId === song.id}
                  isPlaying={isPlaying}
                  wide={wideRows}
                  onPlayAt={playSongAt}
                />
              ))}
            </View>
          </Reveal>
        ) : null}

        {showArtists ? (
          <Reveal order={2}>
            {all ? (
              <ArtRail
                title={t("components.music.Search.artists")}
                actionLabel={artists.length > 4 ? showAllLabel : undefined}
                onAction={showAllIn("artists")}
              >
                {artists.map((entry, i) => (
                  <ArtistResult
                    key={`artist-${i}-${entry.name}`}
                    entry={entry}
                    width={cardWidth}
                    fetchPicture={fetchFor[i]}
                    onOpen={openArtist}
                  />
                ))}
              </ArtRail>
            ) : (
              <View style={{ paddingTop: 20 }}>
                <ArtGrid
                  items={artists}
                  keyOf={(entry, i) => `artist-${i}-${entry.name}`}
                  render={(entry, width, i) => (
                    <ArtistResult
                      entry={entry}
                      width={width}
                      fetchPicture={fetchFor[i]}
                      onOpen={openArtist}
                    />
                  )}
                />
              </View>
            )}
          </Reveal>
        ) : null}

        {showAlbums ? (
          <Reveal order={3}>
            {all ? (
              <ArtRail
                title={t("components.music.Search.albums")}
                actionLabel={albums.length > 4 ? showAllLabel : undefined}
                onAction={showAllIn("albums")}
              >
                {albums.map((album, i) => albumCard(album, cardWidth, i))}
              </ArtRail>
            ) : (
              <View style={{ paddingTop: 20 }}>
                <ArtGrid
                  items={albums}
                  keyOf={(album, i) => `album-${i}-${album.name}`}
                  render={albumCard}
                />
              </View>
            )}
          </Reveal>
        ) : null}

        {showPlaylists ? (
          <Reveal order={4}>
            {all ? (
              <ArtRail
                title={t("components.music.Search.playlists")}
                actionLabel={playlists.length > 4 ? showAllLabel : undefined}
                onAction={showAllIn("playlists")}
              >
                {playlists.map((playlist) => playlistCard(playlist, cardWidth))}
              </ArtRail>
            ) : (
              <View style={{ paddingTop: 20 }}>
                <ArtGrid
                  items={playlists}
                  keyOf={(playlist) => String(playlist.id)}
                  render={playlistCard}
                />
              </View>
            )}
          </Reveal>
        ) : null}
      </>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{
        paddingTop: topPadding,
        paddingBottom: bottomPadding + 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <TabHeader title={t("native.shell.tabSearch")} />
      {/* No computador o campo é o da barra de cima; um segundo aqui era duplicado. */}
      {searchField}
      {body}
    </ScrollView>
  );
}
