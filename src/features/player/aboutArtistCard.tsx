/**
 * "About the artist" card at the end of the now-playing scroll (the Spotify
 * card the owner asked for by screenshot): photo, name, listeners, and the
 * whole card navigates to the artist page - dismissing the player modal
 * first, same as every other link that leaves the player.
 */
import React, { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useArtist } from "@/api/queries/artists";
import { artistImageSource } from "@/domain/artwork";
import { primaryArtistSegment } from "@/domain/format";
import { useT } from "@/i18n";
import { artistRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, artworkSourceUri, Icon } from "@/ui";

const PHOTO_HEIGHT = 180;

export const AboutArtistCard = () => {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();

  const song = usePlaybackView((v) => v.song);
  const segment = song ? primaryArtistSegment(song) : "";
  const hasArtist = !!segment && segment !== "null";
  const artistQuery = useArtist(hasArtist ? segment : null, hasArtist);
  const artist = artistQuery.data ?? null;

  const open = useCallback(() => {
    if (!hasArtist) return;
    if (router.canDismiss()) router.dismissAll();
    router.push(artistRoute(segment));
  }, [router, hasArtist, segment]);

  // An unresolved artist (404, offline, jam proposal) renders nothing: a card
  // with no photo and no data would just be a second, worse artist link.
  if (!artist) return null;

  const photoUri = artworkSourceUri(artistImageSource(artist, "lg"));
  const listeners = artist.lastfm_listeners;

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={artist.name}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: RADIUS * 2,
        backgroundColor: tokens.secondary,
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {photoUri ? (
        <View>
          <Image
            source={{ uri: photoUri }}
            style={{ width: "100%", height: PHOTO_HEIGHT }}
            contentFit="cover"
            transition={150}
          />
          <Text
            style={{
              position: "absolute",
              top: 12,
              left: 16,
              color: "#ffffff",
              fontSize: 13,
              fontWeight: "700",
              textShadowColor: "rgba(0,0,0,0.6)",
              textShadowRadius: 6,
            }}
          >
            {t("native.player.aboutArtist")}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16 }}>
        {!photoUri ? (
          <ArtworkImage
            source={{ kind: "initials", name: artist.name }}
            size={44}
            shape="circle"
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {!photoUri ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "700" }}>
              {t("native.player.aboutArtist")}
            </Text>
          ) : null}
          <Text
            style={{ color: tokens.foreground, fontSize: 16, fontWeight: "800" }}
            numberOfLines={1}
          >
            {artist.name}
          </Text>
          {listeners != null && listeners > 0 ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
              {t("native.player.listeners", { count: listeners.toLocaleString() })}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
      </View>
    </Pressable>
  );
};
