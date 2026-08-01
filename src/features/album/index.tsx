/**
 * Album screen (FR-43, FR-44) over the shared CollectionScreen.
 *
 * Songs come from `exact_search[album]` - or the `"\b"` null sentinel when
 * the album segment is the literal "null" (unknown album), which lists ONLY
 * album-less songs instead of the whole library. The query is deliberately
 * NOT artist-filtered server-side; the context artist (resolved from the
 * `[artist]` segment, which may be a slug or a raw name) only narrows the
 * result client-side, and falls back to every match.
 *
 * The header artist is the album's majority-vote PRIMARY artist, which can
 * differ from the context artist when the album was opened from a featured
 * artist's page.
 */
import React, { useCallback, useMemo } from "react";
import { Pressable, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useArtist } from "@/api/queries/artists";
import { useAlbumSongs } from "@/api/queries/songs";
import { albumKey } from "@/domain/albumKey";
import { songArtworkSource } from "@/domain/artwork";
import { totalDuration } from "@/domain/format";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { artistRoute } from "@/features/artists/routes";
import { CollectionScreen } from "@/features/playlist/CollectionScreen";
import {
  albumYear,
  formatAlbumDuration,
  majorityPrimaryArtist,
  narrowToContextArtist,
} from "./albumDerive";

/** The literal "null" segment means "not set", never the string "null". */
const decodeSegment = (segment: string | undefined): string | null =>
  !segment || segment === "null" ? null : segment;

export default function AlbumScreen() {
  const params = useLocalSearchParams<{ artist: string; album: string; highlight: string }>();
  const artistSegment = decodeSegment(params.artist);
  const album = decodeSegment(params.album);
  const highlight = decodeSegment(params.highlight);

  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();

  // One request resolves slug OR canonical name; a 404 simply means no
  // context artist and the full album listing is shown.
  const contextArtistQuery = useArtist(artistSegment, !!artistSegment);
  const contextArtist = contextArtistQuery.data ?? null;

  const songsQuery = useAlbumSongs(album);

  const songs = useMemo(
    () => narrowToContextArtist(songsQuery.data ?? [], contextArtist?.id ?? null),
    [songsQuery.data, contextArtist?.id],
  );
  const albumPrimary = useMemo(() => majorityPrimaryArtist(songs), [songs]);

  const collectionKey = albumKey(albumPrimary?.slug ?? artistSegment, album);

  const openPrimaryArtist = useCallback(() => {
    if (!albumPrimary) return;
    router.push(artistRoute(albumPrimary.slug || albumPrimary.name));
  }, [albumPrimary, router]);

  const year = albumYear(songs);
  const seconds = totalDuration(songs);
  const countLabel = `${songs.length} ${t("components.music.AlbumView.songs")}${
    seconds > 0 ? `, ${formatAlbumDuration(seconds)}` : ""
  }`;

  const meta = (
    <>
      {albumPrimary ? (
        <Pressable onPress={openPrimaryArtist} accessibilityRole="link" hitSlop={6}>
          <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "700" }}>
            {albumPrimary.name}
          </Text>
        </Pressable>
      ) : (
        <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "700" }}>
          {t("components.music.AlbumView.unknownArtist")}
        </Text>
      )}
      {year != null ? (
        <>
          <Text style={{ color: tokens.foreground, opacity: 0.5, fontSize: 13 }}>•</Text>
          <Text style={{ color: tokens.foreground, opacity: 0.85, fontSize: 13 }}>{year}</Text>
        </>
      ) : null}
      <Text style={{ color: tokens.foreground, opacity: 0.5, fontSize: 13 }}>•</Text>
      <Text style={{ color: tokens.foreground, opacity: 0.85, fontSize: 13 }}>{countLabel}</Text>
    </>
  );

  const firstSong = songs[0];

  return (
    <CollectionScreen
      kind="album"
      title={album ?? t("components.music.AlbumView.unknownAlbum")}
      subtitle={t("components.music.AlbumView.albumLabel")}
      meta={meta}
      image={firstSong ? songArtworkSource(firstSong) : undefined}
      accentKey={collectionKey}
      songs={songs}
      isLoading={songsQuery.isLoading}
      isError={songsQuery.isError}
      errorText={t("components.music.AlbumView.errorLoadingSongs")}
      onRetry={() => void songsQuery.refetch()}
      columns={["index", "title", "duration"]}
      surface="album"
      collectionKey={collectionKey}
      highlightTitle={highlight}
    />
  );
}
