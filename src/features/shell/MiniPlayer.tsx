/**
 * MiniPlayer pill (FR-16): 40px artwork, title/artists, cast button slot,
 * play/pause, 2px progress line along the bottom edge; tapping opens the
 * (player) modal. Reads ONLY the player store (through the pill state slot)
 * and the transport contract; hidden until a song is loaded.
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { imageUrl } from "@/api/mediaUrl";
import { PLACEHOLDER_ARTWORK } from "@/theme/placeholder";
import { useTheme } from "@/theme/provider";
import { SCRIM_BASE } from "@/theme/tokens";
import { useT } from "@/i18n";
import { getShellSlots, useShellSlotsVersion } from "./slots";
import { usePillPlayerState } from "./usePillPlayerState";
import { OVERLAY_PILL_HEIGHT } from "./metrics";
import { PauseGlyph, PlayGlyph } from "./glyphs";

export const MiniPlayer = () => {
  const { song, playing, buffering, position, duration } = usePillPlayerState();
  useShellSlotsVersion();
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();

  if (!song) return null;

  const artwork = songArtworkSource(song);
  const artworkSource =
    artwork.kind === "node"
      ? { uri: imageUrl(artwork.nodeId) }
      : artwork.kind === "external"
        ? { uri: artwork.url }
        : PLACEHOLDER_ARTWORK;

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const CastButton = getShellSlots().castButton;
  const artistsLine = formatArtists(song);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("components.music.BottomBar.openPlayer")}
      onPress={() => router.push("/(player)/now-playing")}
      style={{
        height: OVERLAY_PILL_HEIGHT,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: tokens.card,
        borderWidth: 1,
        borderColor: tokens.border,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        shadowColor: SCRIM_BASE,
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }}
    >
      <Image
        source={artworkSource}
        placeholder={PLACEHOLDER_ARTWORK}
        style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: tokens.muted }}
        contentFit="cover"
      />
      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text
          numberOfLines={1}
          style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
        >
          {song.title}
        </Text>
        {artistsLine ? (
          <Text
            numberOfLines={1}
            style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 1 }}
          >
            {artistsLine}
          </Text>
        ) : null}
      </View>
      {CastButton ? <CastButton /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          playing ? t("components.music.BottomBar.pause") : t("components.music.BottomBar.play")
        }
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          getTransport().toggle();
        }}
        style={{
          width: 40,
          height: 40,
          marginLeft: 4,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {buffering ? (
          <ActivityIndicator size="small" color={tokens.foreground} />
        ) : playing ? (
          <PauseGlyph color={tokens.foreground} size={15} />
        ) : (
          <PlayGlyph color={tokens.foreground} size={15} />
        )}
      </Pressable>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          backgroundColor: tokens.muted,
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: 2,
            backgroundColor: tokens.primary,
          }}
        />
      </View>
    </Pressable>
  );
};
