/**
 * The one track row everywhere (web SongRow parity). Fixed 56px height so
 * tables can window and drag-reorder with simple index math. Download
 * status lives in a LEAF subscription inside DownloadBadge (freeze report
 * 2026-08-14): the old table-level version prop re-rendered every mounted
 * row 4x per second for the whole duration of any transfer, which is what
 * made the app hang exactly while a song loaded.
 */
import React, { memo, useState } from "react";
import { Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { cardContextMenuProps, cardFocusProps, cardKeyProps, cardPressRole } from "./a11y";
import { ArtworkImage } from "./ArtworkImage";
import type { PopoverAnchor } from "./popoverPosition";
import { songTableColumnGate, songTableDurationWidth } from "./breakpoints";
import { useContainerWidth, useDesktopShell } from "./shellLayout";
import { getDownloadStatusReader, useDownloadBadgeVersion } from "./downloadStatus";
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
/** Compact view mode (plan 4.3): denser rows, no artwork, one text line. */
export const SONG_ROW_HEIGHT_COMPACT = 40;

/** The fixed row height for a view mode - drag math and scroll offsets. */
export const songRowHeight = (compact: boolean): number =>
  compact ? SONG_ROW_HEIGHT_COMPACT : SONG_ROW_HEIGHT;

export type SongRowColumn = "index" | "title" | "album" | "addedAt" | "duration";

export const DEFAULT_SONG_COLUMNS: SongRowColumn[] = [
  "index",
  "title",
  "album",
  "addedAt",
  "duration",
];

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
  /** Compact view mode (desktop shell): 40px, no artwork, one line. */
  compact?: boolean;
  onPlay: () => void;
  /**
   * Like toggle for the hover-revealed heart (desktop shell only, plan
   * 4.3): the static liked indicator moves into a real button next to the
   * `...`. Omitted (or below 900px) the row renders exactly as shipped.
   */
  onToggleLike?: () => void;
}

const DownloadBadge = ({ songId }: { songId: number }) => {
  // Status glyphs are ink on the page, not fills, so they take the ink
  // variants: raw `destructive` is ~2:1 on the dark background.
  const { tokens, ink } = useTheme();
  // Leaf subscription: transitions + ~1 Hz progress re-render THIS badge
  // only, never the memoized row around it.
  useDownloadBadgeVersion();
  const reader = getDownloadStatusReader();
  const status = reader.getStatus(songId);
  if (status === "none") return null;
  if (status === "done") {
    return <Icon name="circle-check" size={14} color={ink.success} />;
  }
  if (status === "error") {
    return <Icon name="download" size={14} color={ink.destructive} />;
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
  compact = false,
  onPlay,
  onToggleLike,
}: SongRowProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const locale = useLocale();
  // Container width (breakpoints.ts): the pane the row lives in decides
  // which columns fit. On mobile that is the window, exactly as before; in
  // the desktop shell the mainMd/mainLg staircase applies instead of the
  // single mobile collapse point. SongTable's header uses the same gate.
  const width = useContainerWidth();
  const desktopShell = useDesktopShell();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<PopoverAnchor | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  // Hover-reveal gate (plan 4.3): desktop only - on touch there is no hover
  // and everything stays always-visible, exactly the shipped row. Focus
  // counts as hover so a keyboard user can SEE the control they tabbed to,
  // and an open menu keeps its `...` lit while the popover is up.
  const revealed = desktopShell && (hovered || focusWithin || menuOpen);

  /** Touch path: no anchor, SongMenu keeps the bottom sheet. */
  const openMenuSheet = (): void => {
    setMenuAnchor(null);
    setMenuOpen(true);
  };
  /** Pointer path: anchored popover at desktop widths (SongMenu decides). */
  const openMenuAt = (x: number, y: number): void => {
    setMenuAnchor({ x, y });
    setMenuOpen(true);
  };
  const openMenuFromPress = (event: GestureResponderEvent): void => {
    const { pageX, pageY } = event.nativeEvent;
    if (desktopShell && typeof pageX === "number" && typeof pageY === "number") {
      openMenuAt(pageX, pageY);
    } else {
      openMenuSheet();
    }
  };

  const gate = songTableColumnGate(width, desktopShell);
  const isNarrow = !gate.album;
  // Duration cell per the plan's grid spec: mobile keeps the shipped 44px,
  // desktop rides 120px until mainXl frees it to flex. `null` means flex.
  const durationWidth = songTableDurationWidth(width, desktopShell);
  const durationStyle =
    durationWidth == null
      ? ({ flex: 0.5, minWidth: 44 } as const)
      : ({ width: durationWidth } as const);
  const has = (c: SongRowColumn) =>
    columns.includes(c) &&
    !(c === "album" && !gate.album) &&
    !(c === "addedAt" && !gate.addedAt);

  const artistsLine = formatArtists(song) || t("components.music.SongRow.unknownArtist");
  const proposerSuffix = song.jam_proposer ? ` · @${song.jam_proposer.handle}` : "";
  const separating = !!song.vocal_separation_started_at;

  return (
    <>
      <Pressable
        onPress={onPlay}
        onLongPress={openMenuSheet}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole={cardPressRole}
        accessibilityLabel={song.title}
        {...cardKeyProps(onPlay)}
        {...cardFocusProps(
          () => setFocusWithin(true),
          () => setFocusWithin(false),
        )}
        {...(desktopShell
          ? // Right-click opens the anchored popover, but ONLY on the desktop
            // shell: below 900px the frozen mobile web shell keeps the
            // browser's native context menu (the sheet stays reachable via
            // long-press and the ... button), so we must not preventDefault.
            cardContextMenuProps((event) => {
              event.preventDefault();
              openMenuAt(event.clientX, event.clientY);
            })
          : {})}
        style={({ pressed }) => ({
          height: songRowHeight(compact),
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          borderRadius: RADIUS,
          ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
          backgroundColor: highlighted
            ? foregroundWash(scheme, 0.12)
            : pressed
              ? foregroundWash(scheme, 0.05)
              : revealed && !menuOpen
                ? foregroundWash(scheme, 0.04)
                : "transparent",
          borderWidth: highlighted ? 1 : 0,
          borderColor: highlighted ? tokens.ring : "transparent",
        })}
      >
        {has("index") ? (
          <View style={{ width: 28, alignItems: "center" }}>
            {isCurrent ? (
              <PlayingBars animate={isPlaying} />
            ) : revealed ? (
              // Hover swaps the number for a play glyph WITHOUT reflow: the
              // 28px cell keeps its width, only the child changes (plan
              // 4.3, song-table row). The whole row is the press target,
              // so the glyph is a picture of what the click does - a
              // nested button here would just re-state the row.
              <Icon name="play" size={12} color={tokens.foreground} filled />
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
            {compact ? null : (
              <ArtworkImage
                source={songArtworkSource(song)}
                songId={song.id}
                size={40}
                recyclingKey={String(song.id)}
              />
            )}
            {/*
              Emphasis order is load bearing: the TITLE carries `foreground`
              (or `primary` on the current row, which is the same monochrome
              extreme) at the heavier weight, the artists line drops to
              `mutedForeground` a size down. Never the other way round.
              Compact keeps the same order on ONE baseline - density is the
              point of the mode, so the artwork and the second line go.
            */}
            {compact ? (
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    color: isCurrent ? tokens.primary : tokens.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {song.title}
                </Text>
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 12, flexShrink: 3 }}
                  numberOfLines={1}
                >
                  {artistsLine}
                  {proposerSuffix}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    color: isCurrent ? tokens.primary : tokens.foreground,
                    fontSize: 14,
                    fontWeight: "600",
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
            )}
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
            {/* With the hover heart BUTTON active (desktop + onToggleLike)
                the static indicator would be a second heart on the same
                row; everywhere else it renders exactly as shipped. */}
            {liked && !(desktopShell && onToggleLike) ? (
              <Icon name="heart" size={13} color={tokens.primary} filled />
            ) : null}
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
              ...durationStyle,
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
          {/* Hover-revealed controls keep their slot even while invisible
              (opacity, not unmount): columns must never shift as the
              pointer sweeps rows, and the buttons stay tabbable - focus
              reveals them through the row's focus-within tracking. */}
          {desktopShell && onToggleLike ? (
            <Pressable
              onPress={onToggleLike}
              accessibilityRole="button"
              accessibilityLabel={
                liked
                  ? t("components.music.BottomBar.unlike")
                  : t("components.music.BottomBar.like")
              }
              hitSlop={8}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                opacity: liked || revealed ? (pressed ? 0.6 : 1) : 0,
              })}
            >
              <Icon
                name="heart"
                size={16}
                color={liked ? tokens.primary : tokens.mutedForeground}
                filled={liked}
              />
            </Pressable>
          ) : null}
          {dragHandle}
          <Pressable
            onPress={openMenuFromPress}
            accessibilityRole="button"
            accessibilityLabel={t("components.music.ActionBar.more")}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: !desktopShell || revealed ? (pressed ? 0.6 : 1) : 0,
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
          anchor={menuAnchor}
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
