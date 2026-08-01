/**
 * Editable playlist artwork (FR-51): the hero artwork square for a MANUAL
 * playlist, tappable to replace the cover. Rendered only for manual
 * playlists - system playlists never get an artwork control (FR-53).
 *
 * Multipart field is `artwork` (POST /playlists/:id/upload_artwork); the
 * mutation writes the returned playlist back into the cache, so the new
 * cover shows without a refresh. Failures and refusals surface in place -
 * there is no global toast host yet (WP12).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useUploadPlaylistArtwork } from "@/api/queries/playlists";
import type { ArtworkSource } from "@/domain/artwork";
import type { PlaylistId } from "@/domain/ids";
import { useT } from "@/i18n";
import { ArtworkImage, Icon } from "@/ui";
import { RADIUS } from "@/theme/tokens";
import { MAX_ARTWORK_MB, pickPlaylistArtwork } from "./artworkPicker";

export interface ChangePlaylistArtworkProps {
  playlistId: PlaylistId;
  source: ArtworkSource | null;
  /** Hero artwork edge (136 today); the overlay scales with it. */
  size?: number;
}

export const ChangePlaylistArtwork = ({
  playlistId,
  source,
  size = 136,
}: ChangePlaylistArtworkProps) => {
  const t = useT();
  const [notice, setNotice] = useState<string | null>(null);
  const upload = useUploadPlaylistArtwork();

  const onPress = async () => {
    if (upload.isPending) return;
    setNotice(null);
    let outcome;
    try {
      outcome = await pickPlaylistArtwork();
    } catch {
      setNotice(t("components.music.ChangePlaylistArtwork.errorLoadingFile"));
      return;
    }
    if (outcome.kind === "canceled") return;
    if (outcome.kind === "notAnImage") {
      setNotice(t("components.music.ChangePlaylistArtwork.notAnImage"));
      return;
    }
    if (outcome.kind === "tooLarge") {
      setNotice(t("native.playlistArtwork.tooLarge", { max: MAX_ARTWORK_MB }));
      return;
    }
    upload.mutate(
      { id: playlistId, artwork: outcome.artwork },
      {
        onError: () =>
          setNotice(t("components.music.ChangePlaylistArtwork.errorOccurred")),
      },
    );
  };

  return (
    // Exactly `size` square: the hero gives the slot a fixed box, so the
    // refusal notice is overlaid rather than stacked underneath.
    <Pressable
      onPress={() => void onPress()}
      disabled={upload.isPending}
      accessibilityRole="button"
      accessibilityLabel={t("components.music.ChangePlaylistArtwork.changeArtwork")}
      // No crop step ships in v1, so the hint says the picture is used as is.
      accessibilityHint={t("native.playlistArtwork.squareHint")}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: RADIUS + 4,
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <ArtworkImage source={source} size={size} borderRadius={RADIUS + 4} />
      {notice ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            paddingHorizontal: 8,
            paddingVertical: 6,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 10 }} numberOfLines={3}>
            {notice}
          </Text>
        </View>
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 6,
          backgroundColor: "rgba(0, 0, 0, 0.55)",
        }}
      >
        {upload.isPending ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Icon name="plus" size={13} color="#ffffff" />
        )}
        <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
          {upload.isPending
            ? t("components.music.ChangePlaylistArtwork.uploadingArtwork")
            : t("components.music.ChangePlaylistArtwork.changeArtwork")}
        </Text>
      </View>
    </Pressable>
  );
};
