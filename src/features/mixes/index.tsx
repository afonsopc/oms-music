/**
 * Mix detail (FR-121). Titles and descriptions come STRICTLY from
 * `title_key`/`description_key` through the catalog - the English strings in
 * the payload are server fallbacks and must never reach the screen, which is
 * also what makes the title follow a locale switch.
 *
 * Mixes rotate server-side (cached 24h per user): a 404 means this slug no
 * longer exists, so the list is refetched and the user goes back Home rather
 * than staring at an error for something that was correct an hour ago. There
 * is deliberately no manual refresh affordance.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMix } from "@/api/queries/mixes";
import { useCreatePlaylist } from "@/api/queries/playlists";
import { keys } from "@/api/queryKeys";
import { isApiError } from "@/domain/api";
import { artistImageSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { mixDescription, mixStampText, mixTitle } from "@/i18n/mixLabels";
import { playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { MIX_KIND_GRADIENTS, RADIUS } from "@/theme/tokens";
import { artworkSourceUri, Icon, MixTileArtwork } from "@/ui";
import { CollectionScreen } from "@/features/playlist/CollectionScreen";

export default function MixScreen() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  const mixQuery = useMix(slug || null);
  const mix = mixQuery.data ?? null;

  const rotatedAway =
    mixQuery.isError && isApiError(mixQuery.error) && mixQuery.error.status === 404;

  useEffect(() => {
    if (!rotatedAway) return;
    void queryClient.invalidateQueries({ queryKey: keys.mixes.list });
    router.replace("/home");
  }, [rotatedAway, queryClient, router]);

  const title = mix ? mixTitle(mix, t) : "";
  const stamp = mix ? mixStampText(mix, title) : "";
  const artistUri = mix?.artist ? artworkSourceUri(artistImageSource(mix.artist, "lg")) : null;

  const songs = useMemo(() => mix?.songs ?? [], [mix]);
  const meta = mix
    ? `${mixDescription(mix, t)} • ${songs.length} ${t("components.music.MixView.songs")}`
    : undefined;

  // Um mix roda a cada 24h; guardar como playlist congela-o na biblioteca
  // (pedido do dono, 2026-08-17). O mesmo caminho do save das rádios: o
  // create semeia song_ids por ordem, e navega-se para a cópia.
  const { tokens } = useTheme();
  const [saveError, setSaveError] = useState(false);
  const createPlaylist = useCreatePlaylist();
  const saveAsPlaylist = (): void => {
    if (!mix || songs.length === 0) return;
    setSaveError(false);
    createPlaylist.mutate(
      { name: title, songIds: songs.map((song) => song.id) },
      {
        onSuccess: (playlist) => router.push(playlistRoute(playlist.id)),
        onError: () => setSaveError(true),
      },
    );
  };

  return (
    <View style={{ flex: 1 }}>
    <CollectionScreen
      kind="mix"
      title={title}
      subtitle={t("components.music.MixView.mixLabel")}
      meta={meta}
      artworkSlot={
        mix
          ? (size) => (
              <MixTileArtwork kind={mix.kind} stamp={stamp} artworkUri={artistUri} size={size} />
            )
          : undefined
      }
      // With a real artist photo the hero samples it; the static-art mixes
      // fall back to the kind accent.
      accentColor={artistUri ? undefined : mix ? MIX_KIND_GRADIENTS[mix.kind].accent : undefined}
      accentKey={artistUri ? `mix:${slug}` : undefined}
      extractionUri={artistUri}
      recentEntry={
        mix
          ? { kind: "mix", key: slug, title, artworkNodeId: null, artworkUrl: artistUri }
          : undefined
      }
      songs={songs}
      isLoading={mixQuery.isLoading}
      isError={mixQuery.isError && !rotatedAway}
      errorText={t("components.music.MixView.errorLoadingMix")}
      onRetry={() => void mixQuery.refetch()}
      columns={["index", "title", "album", "duration"]}
      surface="mix"
      onAdd={songs.length > 0 && !createPlaylist.isPending ? saveAsPlaylist : undefined}
      addLabel={t("components.music.MixView.saveAsPlaylist")}
    />
    {saveError ? (
      // Mesmo aviso in-place da RadioView: nao ha host global de toasts.
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
          {t("components.music.MixView.saveAsPlaylistError")}
        </Text>
        <Icon name="x" size={16} color={tokens.destructiveForeground} />
      </Pressable>
    ) : null}
    </View>
  );
}
