/**
 * Radio screen body shared by the artist and song radio routes (FR-122).
 *
 * Radio titles and descriptions are PRE-BAKED European Portuguese from the
 * backend and are rendered as-is - they never go through the catalog.
 * The payload is ephemeral (regenerated per visit, server-cached 7 days per
 * seed), so "Save as playlist" freezes this exact batch into a real playlist
 * via `POST /playlists { name, song_ids }` and jumps straight to the copy.
 *
 * 404 means the radio is unbuildable (not empty) and shows the error state.
 */
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useCreatePlaylist } from "@/api/queries/playlists";
import { useArtistRadio, useSongRadio } from "@/api/queries/radios";
import { useArtistPictures } from "@/api/queries/songs";
import { songArtworkSource } from "@/domain/artwork";
import type { SongId } from "@/domain/ids";
import type { MixKind } from "@/domain/mixes";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS, RADIO_KIND_GRADIENTS } from "@/theme/tokens";
import { artworkSourceUri, Icon, MixTileArtwork } from "@/ui";
import { CollectionScreen } from "@/features/playlist/CollectionScreen";
import { playlistRoute } from "@/features/artists/routes";

const HERO_ARTWORK_SIZE = 136;

/** Radio gradients reuse the mix families (theme/tokens keeps them in sync). */
const MIX_KIND_FOR_RADIO: Record<"artist" | "song", MixKind> = {
  artist: "top_artist",
  song: "repeat_rewind",
};

export type RadioScreenProps =
  | { kind: "artist"; artist: string }
  | { kind: "song"; songId: SongId };

export const RadioScreen = (props: RadioScreenProps) => {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const [saveError, setSaveError] = useState(false);

  const isArtist = props.kind === "artist";
  const artistQuery = useArtistRadio(isArtist ? props.artist : null, isArtist);
  const songQuery = useSongRadio(isArtist ? null : props.songId, !isArtist);
  const query = isArtist ? artistQuery : songQuery;
  const radio = query.data ?? null;

  const songs = useMemo(() => radio?.songs ?? [], [radio]);
  const seed = songs[0];

  // Artist radio: the artist's Deezer photo. Song radio: the seed artwork
  // (the generator unshifts the seed track as songs[0]).
  const picturesQuery = useArtistPictures(isArtist ? props.artist : null, isArtist);
  const picture = picturesQuery.data?.pictures?.[0];
  const backdropUri = isArtist
    ? (picture?.picture_xl ?? picture?.picture_big ?? picture?.picture_medium ?? null)
    : seed
      ? artworkSourceUri(songArtworkSource(seed))
      : null;

  const createPlaylist = useCreatePlaylist();
  const saveAsPlaylist = () => {
    if (!radio || songs.length === 0) return;
    setSaveError(false);
    createPlaylist.mutate(
      { name: radio.title, song_ids: songs.map((song) => song.id) },
      {
        onSuccess: (playlist) => router.push(playlistRoute(playlist.id)),
        onError: () => setSaveError(true),
      },
    );
  };

  const meta = radio
    ? [
        radio.description,
        `${songs.length} ${t("components.music.RadioView.songs")}`,
        t("components.music.RadioView.attribution"),
      ].join(" • ")
    : undefined;

  return (
    <View style={{ flex: 1 }}>
      <CollectionScreen
        kind="radio"
        title={radio?.title ?? ""}
        subtitle={t("components.music.RadioView.radioLabel")}
        meta={meta}
        artworkSlot={
          <MixTileArtwork
            kind={MIX_KIND_FOR_RADIO[props.kind]}
            stamp=""
            artworkUri={backdropUri}
            size={HERO_ARTWORK_SIZE}
            icon="radio"
          />
        }
        accentColor={backdropUri ? undefined : RADIO_KIND_GRADIENTS[props.kind].accent}
        // Keyed by the SEED, not the ephemeral slug: the payload is
        // regenerated per visit but the backdrop photo is not.
        accentKey={
          backdropUri
            ? `radio:${props.kind}:${isArtist ? props.artist : props.songId}`
            : undefined
        }
        extractionUri={backdropUri}
        songs={songs}
        isLoading={query.isLoading}
        isError={query.isError}
        errorText={t("components.music.RadioView.errorLoadingRadio")}
        onRetry={() => void query.refetch()}
        columns={["index", "title", "album", "duration"]}
        surface="radio"
        onAdd={songs.length > 0 && !createPlaylist.isPending ? saveAsPlaylist : undefined}
        addLabel={t("components.music.RadioView.saveAsPlaylist")}
      />
      {saveError ? (
        // No global toast host exists yet (WP12); the failure is shown in
        // place, dismissible, exactly like the Downloads screen notice.
        <Pressable
          onPress={() => setSaveError(false)}
          accessibilityRole="button"
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            bottom: 24,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: RADIUS,
            backgroundColor: tokens.destructive,
          }}
        >
          <Icon name="alert-circle" size={16} color={tokens.destructiveForeground} />
          <Text style={{ flex: 1, color: tokens.destructiveForeground, fontSize: 13 }}>
            {t("components.music.RadioView.saveAsPlaylistError")}
          </Text>
          <Icon name="x" size={16} color={tokens.destructiveForeground} />
        </Pressable>
      ) : null}
    </View>
  );
};
