/**
 * The one track row everywhere (web SongRow parity). Fixed 56px height so
 * tables can window and drag-reorder with simple index math. Download
 * status is read SYNCHRONOUSLY through ui/downloadStatus (no per-row
 * subscription): the table passes the coarse `downloadVersion` prop so
 * memoized rows refresh when the counter bumps.
 */
import React, { memo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { ArtworkImage } from "./ArtworkImage";
import { getDownloadStatusReader } from "./downloadStatus";
import { Icon } from "./icons";
import { PlayingBars } from "./PlayingBars";
import { SongMenu } from "./SongMenu";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration } from "@/domain/format";
import type { Song } from "@/domain/song";
import type { SongMenuItem } from "@/contracts/songMenu";
import { useLocale, useT } from "@/i18n";
import { formatDate, formatElapsed } from "@/lib/dates";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { foregroundWash } from "./uiTheme";

export const SONG_ROW_HEIGHT = 56;

export type SongRowColumn = "index" | "title" | "album" | "addedAt" | "duration";

export const DEFAULT_SONG_COLUMNS: SongRowColumn[] = [
  "index",
  "title",
  "album",
  "addedAt",
  "duration",
];

/** Below this width the album and addedAt columns drop (web `md`). */
const NARROW_BREAKPOINT = 768;

export interface SongRowProps {
  song: Song;
  index: number;
  columns?: SongRowColumn[];
  /** ISO date for the addedAt column (liked_at / playlist created_at). */
  addedAt?: string;
  /** Per-row play count (Popular list); renders its own column when set. */
  playCount?: number;
  liked?: boolean;
  isCurrent?: boolean;
  isPlaying?: boolean;
  /** Deep-link highlight (ring + tint). */
  highlighted?: boolean;
  /** Menu context surface; defaults to "row". */
  surface?: string;
  /** Collection extras (e.g. Remove from playlist) for the menu. */
  extraActions?: SongMenuItem[];
  /** Sortable grip rendered by the table when reorder is enabled. */
  dragHandle?: React.ReactNode;
  onPlay: () => void;
  /** Coarse counter from useDownloadStatusVersion (table-level). */
  downloadVersion?: number;
}

const DownloadBadge = ({ songId }: { songId: number }) => {
  const { tokens } = useTheme();
  const reader = getDownloadStatusReader();
  const status = reader.getStatus(songId);
  if (status === "none") return null;
  if (status === "done") {
    return <Icon name="circle-check" size={14} color={tokens.success} />;
  }
  if (status === "error") {
    return <Icon name="download" size={14} color={tokens.destructive} />;
  }
  const progress = reader.getProgress(songId);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name="download" size={14} color={tokens.mutedForeground} />
      {status === "downloading" && progress > 0 ? (
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(progress * 100)}%
        </Text>
      ) : null}
    </View>
  );
};

const SongRowInner = ({
  song,
  index,
  columns = DEFAULT_SONG_COLUMNS,
  addedAt,
  playCount,
  liked = false,
  isCurrent = false,
  isPlaying = false,
  highlighted = false,
  surface = "row",
  extraActions,
  dragHandle,
  onPlay,
}: SongRowProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const locale = useLocale();
  const { width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);

  const isNarrow = width < NARROW_BREAKPOINT;
  const has = (c: SongRowColumn) =>
    columns.includes(c) && !(isNarrow && (c === "album" || c === "addedAt"));

  const artistsLine = formatArtists(song) || t("components.music.SongRow.unknownArtist");
  const proposerSuffix = song.jam_proposer ? ` · @${song.jam_proposer.handle}` : "";
  const separating = !!song.vocal_separation_started_at;

  return (
    <>
      <Pressable
        onPress={onPlay}
        onLongPress={() => setMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={song.title}
        style={({ pressed }) => ({
          height: SONG_ROW_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          borderRadius: RADIUS,
          backgroundColor: highlighted
            ? foregroundWash(scheme, 0.12)
            : pressed
              ? foregroundWash(scheme, 0.05)
              : "transparent",
          borderWidth: highlighted ? 1 : 0,
          borderColor: highlighted ? tokens.ring : "transparent",
        })}
      >
        {has("index") ? (
          <View style={{ width: 28, alignItems: "center" }}>
            {isCurrent ? (
              <PlayingBars animate={isPlaying} />
            ) : (
              <Text
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 13,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {index + 1}
              </Text>
            )}
          </View>
        ) : null}

        {has("title") ? (
          <View style={{ flex: 1.5, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ArtworkImage
              source={songArtworkSource(song)}
              songId={song.id}
              size={40}
              recyclingKey={String(song.id)}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  color: isCurrent ? tokens.primary : tokens.foreground,
                  fontSize: 14,
                  fontWeight: "500",
                }}
                numberOfLines={1}
              >
                {song.title}
              </Text>
              <Text
                style={{ color: tokens.mutedForeground, fontSize: 12 }}
                numberOfLines={1}
              >
                {artistsLine}
                {proposerSuffix}
              </Text>
            </View>
            {separating && !isNarrow && song.vocal_separation_started_at ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  backgroundColor: foregroundWash(scheme, 0.08),
                }}
              >
                <Icon name="audio-waveform" size={12} color={tokens.primary} />
                <Text
                  style={{
                    color: tokens.primary,
                    fontSize: 11,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatElapsed(song.vocal_separation_started_at)}
                </Text>
              </View>
            ) : null}
            {liked ? <Icon name="heart" size={13} color={tokens.primary} filled /> : null}
            <DownloadBadge songId={song.id} />
          </View>
        ) : null}

        {has("album") ? (
          <Text
            style={{ flex: 1, color: tokens.mutedForeground, fontSize: 13 }}
            numberOfLines={1}
          >
            {song.album ?? ""}
          </Text>
        ) : null}

        {has("addedAt") ? (
          <Text
            style={{ flex: 0.6, color: tokens.mutedForeground, fontSize: 13 }}
            numberOfLines={1}
          >
            {addedAt ? formatDate(addedAt, locale) : ""}
          </Text>
        ) : null}

        {playCount !== undefined ? (
          <Text
            style={{
              width: 48,
              textAlign: "right",
              color: tokens.mutedForeground,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {playCount}
          </Text>
        ) : null}

        {has("duration") ? (
          <Text
            style={{
              width: 44,
              textAlign: "right",
              color: tokens.mutedForeground,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatDuration(song.duration)}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {dragHandle}
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("components.music.ActionBar.more")}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="more-horizontal" size={18} color={tokens.mutedForeground} />
          </Pressable>
        </View>
      </Pressable>
      {menuOpen ? (
        <SongMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          context={{
            song,
            surface,
            surfaceExtras: extraActions,
            onPlay,
          }}
        />
      ) : null}
    </>
  );
};

export const SongRow = memo(SongRowInner);
