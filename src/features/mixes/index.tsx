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
import React, { useEffect, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMix } from "@/api/queries/mixes";
import { keys } from "@/api/queryKeys";
import { isApiError } from "@/domain/api";
import { artistImageSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { mixDescription, mixStampText, mixTitle } from "@/i18n/mixLabels";
import { MIX_KIND_GRADIENTS } from "@/theme/tokens";
import { artworkSourceUri, MixTileArtwork } from "@/ui";
import { CollectionScreen } from "@/features/playlist/CollectionScreen";

const HERO_ARTWORK_SIZE = 136;

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

  return (
    <CollectionScreen
      kind="mix"
      title={title}
      subtitle={t("components.music.MixView.mixLabel")}
      meta={meta}
      artworkSlot={
        mix ? (
          <MixTileArtwork
            kind={mix.kind}
            stamp={stamp}
            artworkUri={artistUri}
            size={HERO_ARTWORK_SIZE}
          />
        ) : undefined
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
    />
  );
}
