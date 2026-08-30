/**
 * External results + per-row import (FR-34), ported from the web
 * `ExternalResults`. Two import shapes, decided by source:
 *
 *  - youtube / soundcloud: URL mode, `{ source_url }` (direct download);
 *  - spotify / itunes / bandcamp: search mode, `{ search_artist,
 *    search_title, search_album?, isrc? }` (server-side search cascade).
 *
 * Both always carry the source/override/artwork metadata. A DEDUPED
 * response comes back already terminal and is never polled; live imports
 * poll at 1.5 s (WP1's useSongImportPoll) and stop themselves on a
 * terminal state. Completing invalidates the library lists so the track
 * shows up everywhere without a manual refresh.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateSongImportInput } from "@omelhorsite/sdk";
import { createSongImport, useExternalSearch, useSongImportPoll } from "@/api/queries/imports";
import { invalidationTargets } from "@/api/queryKeys";
import type { ExternalSearchResult } from "@/domain/imports";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon } from "@/ui";
import { buildImportBody } from "./importBody";

/** Web parity: give up on the poll after 5 minutes and restore the button. */
const IMPORT_TIMEOUT_MS = 5 * 60_000;

type RowState = "idle" | "importing" | "done" | "failed";

const ExternalTrackRow = ({
  track,
  first,
}: {
  track: ExternalSearchResult;
  first: boolean;
}) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  /** Terminal states reached WITHOUT a poll (deduped / immediate failure). */
  const [local, setLocal] = useState<{ state: RowState; error: string | null }>({
    state: "idle",
    error: null,
  });
  const [importId, setImportId] = useState<number | null>(null);

  const poll = useSongImportPoll(importId, importId != null);
  const mutation = useMutation({
    mutationFn: (body: CreateSongImportInput) => createSongImport(body),
  });

  // Row state is DERIVED from the poll record; nothing is copied into
  // state by an effect. The poll stops itself on a terminal record.
  const record = importId != null ? poll.data : undefined;
  const recordState = record?.state;
  const state: RowState =
    local.state === "done" || recordState === "complete"
      ? "done"
      : local.state === "failed" || recordState === "failed"
        ? "failed"
        : local.state === "importing" || importId != null
          ? "importing"
          : "idle";
  const errorMessage = local.error ?? record?.error_message ?? null;

  const invalidateLibrary = (): void => {
    for (const key of invalidationTargets.libraryLists) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  // The only effect: a completed import must show up in the library lists.
  useEffect(() => {
    if (recordState !== "complete") return;
    for (const key of invalidationTargets.libraryLists) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [recordState, queryClient]);

  // The poll never gives up on its own; the row does, and hands the button
  // back so the user can retry. Re-armed on every state change, so the
  // window is "5 minutes with no progress at all".
  useEffect(() => {
    if (importId == null || recordState === "complete" || recordState === "failed") return;
    const handle = setTimeout(() => {
      setImportId(null);
      setLocal({ state: "idle", error: null });
    }, IMPORT_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [importId, recordState]);

  const startImport = async (): Promise<void> => {
    if (state === "importing") return;
    setLocal({ state: "importing", error: null });
    try {
      const created = await mutation.mutateAsync(buildImportBody(track));
      // A deduped import comes back ALREADY terminal: never poll it.
      if (created.deduped || created.state === "complete") {
        setLocal({ state: "done", error: null });
        invalidateLibrary();
        return;
      }
      if (created.state === "failed") {
        setLocal({ state: "failed", error: created.error_message });
        return;
      }
      setLocal({ state: "idle", error: null });
      setImportId(created.id);
    } catch {
      setLocal({ state: "failed", error: null });
    }
  };

  const progress = state === "importing" ? (record?.progress_pct ?? 0) : 0;
  const subtitle = track.album ? `${track.artist} · ${track.album}` : track.artist;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      <ArtworkImage uri={track.artwork_url} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: tokens.foreground, fontSize: 14, fontWeight: "500" }}
          numberOfLines={1}
        >
          {track.title}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
        {state === "failed" && errorMessage ? (
          <Text style={{ color: ink.destructive, fontSize: 11 }} numberOfLines={2}>
            {errorMessage}
          </Text>
        ) : null}
      </View>

      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {track.source}
      </Text>

      {track.source_url ? (
        <Pressable
          onPress={() => {
            void Linking.openURL(track.source_url as string);
          }}
          accessibilityRole="link"
          accessibilityLabel={t("components.music.ExternalResults.openSource")}
          hitSlop={8}
        >
          <Icon name="chevron-right" size={16} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}

      {state === "importing" ? (
        <View style={{ width: 72, alignItems: "flex-end", gap: 4 }}>
          <View
            style={{
              width: "100%",
              height: 4,
              borderRadius: 2,
              overflow: "hidden",
              backgroundColor: tokens.muted,
            }}
          >
            <View
              style={{
                width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
                height: 4,
                backgroundColor: tokens.primary,
              }}
            />
          </View>
          <Text
            style={{
              color: tokens.mutedForeground,
              fontSize: 10,
              fontVariant: ["tabular-nums"],
            }}
          >
            {Math.round(Math.min(1, Math.max(0, progress)) * 100)}%
          </Text>
        </View>
      ) : state === "done" ? (
        <Icon name="circle-check" size={18} color={ink.success} />
      ) : (
        <Pressable
          onPress={() => {
            void startImport();
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: tokens.secondary,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="download" size={14} color={tokens.foreground} />
          <Text style={{ color: tokens.foreground, fontSize: 12, fontWeight: "600" }}>
            {t("components.music.ExternalResults.import")}
          </Text>
        </Pressable>
      )}
    </View>
  );
};

export const ExternalResults = ({ query }: { query: string }) => {
  const { tokens } = useTheme();
  const t = useT();
  const trimmed = query.trim();
  const externalQuery = useExternalSearch(trimmed, "track");

  if (trimmed.length < 2) return null;

  const tracks = externalQuery.data?.tracks ?? [];

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 24,
        }}
      >
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {t("components.music.ExternalResults.title")}
        </Text>
        {externalQuery.isFetching ? (
          <ActivityIndicator size="small" color={tokens.mutedForeground} />
        ) : null}
      </View>

      {!externalQuery.isLoading && tracks.length === 0 ? (
        <Text
          style={{ color: tokens.mutedForeground, fontSize: 13, paddingHorizontal: 24 }}
        >
          {t("components.music.ExternalResults.empty")}
        </Text>
      ) : null}

      {tracks.length > 0 ? (
        <View
          style={{
            marginHorizontal: 16,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: RADIUS,
            overflow: "hidden",
          }}
        >
          {tracks.map((track, i) => (
            <ExternalTrackRow
              key={`${track.source}:${track.source_id}`}
              track={track}
              first={i === 0}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};
