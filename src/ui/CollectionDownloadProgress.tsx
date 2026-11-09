/**
 * "12 de 40" next to a collection's download toggle while its songs are
 * still arriving (owner report 2026-11-09: the toggle changed icon and
 * nothing else said a download was running). LEAF subscription on the
 * coarse channel only - transitions, throttled to ~4 Hz - so a running
 * download re-renders this one label, never the collection screen (freeze
 * report 2026-08-14). Renders nothing once every song is done.
 */
import React from "react";
import { Text } from "react-native";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { summarizeDownloads, useDownloadStatusVersion } from "./downloadStatus";

export const CollectionDownloadProgress = ({ songs }: { songs: readonly Song[] }) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  useDownloadStatusVersion();
  const ids = songs.filter((song) => !song.jam_song).map((song) => song.id);
  const summary = summarizeDownloads(ids);
  if (summary.total === 0 || summary.done === summary.total) return null;
  const failedOnly = summary.pending === 0 && summary.error > 0;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        color: failedOnly ? ink.destructive : tokens.mutedForeground,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
        marginLeft: -4,
      }}
      numberOfLines={1}
    >
      {failedOnly
        ? t("components.music.ActionBar.offlineFailed", { count: summary.error })
        : t("components.music.ActionBar.offlineProgress", {
            done: summary.done,
            total: summary.total,
          })}
    </Text>
  );
};
