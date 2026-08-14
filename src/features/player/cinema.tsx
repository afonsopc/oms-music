/**
 * Cinema mode, the DESKTOP full-screen player (plano-uma-so-app 4.3
 * amendment): a full-window overlay that floats above the shell's topbar /
 * sidebar / main / right panel while the transport bar's grid row stays
 * visible and interactive underneath - the transport lives THERE, so the
 * overlay carries none. Content is deliberately spare: artwork, title,
 * artists, and the synced-lyrics active region when the song has one.
 * Nothing else.
 *
 * The mobile (player) modal routes are untouched: below 900px the shell
 * never mounts the transport bar, so this overlay is unreachable there and
 * the sheet remains the phone's full player.
 *
 * State is a module-level zustand store because the two doors - the
 * transport bar's fullscreen button and the right panel's maximize button -
 * are grid siblings whose only shared ancestor is the shell, which this
 * feature must not touch.
 */
import React, { useEffect, useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { create } from "zustand";
import { useLyrics } from "@/api/queries/lyrics";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { SongId } from "@/domain/ids";
import { useT } from "@/i18n";
import { activeLineIndex, parseLrc } from "@/lyrics/lrc";
import { usePlaybackView } from "@/remote/mirror";
import { playerGradient } from "@/theme/gradients";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, EmptyState, GhostIconButton, gradientBackground } from "@/ui";
import { useSongAccent } from "./index";

/**
 * The shell's frozen bottom-row geometry (DesktopShell.web.tsx): 88px of
 * transport bar plus the 8px grid padding under it. The overlay's bottom
 * edge sits exactly on the player card's top edge so the bar stays a
 * clickable citizen of the page, not something the cinema covers.
 */
const TRANSPORT_ROW_HEIGHT = 88;
const GRID_GAP = 8;

interface CinemaStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCinemaStore = create<CinemaStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const openCinema = (): void => useCinemaStore.getState().setOpen(true);
export const closeCinema = (): void => useCinemaStore.getState().setOpen(false);

/** Lines shown in the lyrics region: the active one plus the next few. */
const CINEMA_LINES = 3;

/** One synced line whose emphasis fades instead of snapping (card idiom). */
const CinemaLine = ({ text, active, color }: { text: string; active: boolean; color: string }) => {
  const p = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(active ? 1 : 0, { duration: 240 });
  }, [active, p]);
  const dim = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * p.value }));
  return (
    <Animated.Text
      style={[
        dim,
        { color, fontSize: 24, lineHeight: 32, fontWeight: "800", textAlign: "center" },
      ]}
    >
      {text}
    </Animated.Text>
  );
};

/**
 * The synced-lyrics active region: the current line and the next couple,
 * sliding as playback advances - the LyricsCard's window discipline reused
 * over the lrc utilities, minus the card's navigation (cinema has no
 * "elsewhere" to go). Plain-only lyrics render nothing: an unsynced wall of
 * text has no active region to show.
 */
const CinemaLyrics = ({ songId }: { songId: SongId }) => {
  const { tokens } = useTheme();
  const lyricsQuery = useLyrics(songId);
  const synced = lyricsQuery.data?.synced ?? null;
  const lines = useMemo(() => (synced ? parseLrc(synced) : []), [synced]);

  // Selector returns a primitive, so the region re-renders on line change,
  // never at the 4 Hz position tick.
  const active = usePlaybackView((v) =>
    lines.length > 0 ? activeLineIndex(lines, v.position) : -1,
  );

  const shown = useMemo(() => {
    if (lines.length === 0) return [];
    const start = Math.max(0, active);
    return lines
      .slice(start, start + CINEMA_LINES)
      .map((line, offset) => ({ key: start + offset, text: line.text || "♪" }));
  }, [lines, active]);

  if (shown.length === 0) return null;

  // Plain Views on purpose: Reanimated entering/exiting/layout animations do
  // NOT work on react-native-web (plano-uma-so-app, riscos assumidos) - the
  // first build shipped them here and the exiting ghosts stacked every old
  // line on top of the new one AND wedged the whole page (owner screenshot
  // 2026-08-14). The per-line opacity tween in CinemaLine is the animation
  // budget; the window slide is instant.
  return (
    <View style={{ alignItems: "center", gap: 6, maxWidth: 720, minHeight: 32 * CINEMA_LINES }}>
      {shown.map((line, index) => (
        <CinemaLine
          key={line.key}
          text={line.text}
          active={index === 0}
          color={tokens.foreground}
        />
      ))}
    </View>
  );
};

export const CinemaOverlay = () => {
  const open = useCinemaStore((s) => s.open);
  const { tokens, scheme } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const song = usePlaybackView((v) => v.song);
  const accent = useSongAccent(song);

  // Escape is the keyboard door out, same as any desktop overlay. Listener
  // only exists while the overlay does.
  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeCinema();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Web-only by use (only the desktop transport bar mounts this), but the
  // guard keeps the invariant true even if an import strays.
  if (!open || Platform.OS !== "web") return null;

  const [accentDark, accentBright] = playerGradient(accent, scheme);
  const gradientCss = `linear-gradient(to bottom, ${accentBright} 0%, ${accentDark} 80%)`;
  const artistsLine = song ? formatArtists(song) : "";
  const artworkSize = Math.min(Math.round(height * 0.45), 480);

  return (
    <View
      style={[
        // position:fixed is a web-only CSS value RN's style type does not
        // know (same cast as SongTable's grab cursor); it lets the overlay
        // escape the transport bar's card without touching the shell.
        { position: "fixed" } as unknown as ViewStyle,
        {
          top: GRID_GAP,
          left: GRID_GAP,
          right: GRID_GAP,
          bottom: GRID_GAP + TRANSPORT_ROW_HEIGHT,
          zIndex: 40,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: tokens.background,
        },
      ]}
    >
      {/* Plain View, no entering/exiting crossfade: web layout animations
          are the bug this file just recovered from. A song change snaps the
          accent, which nobody notices behind the artwork swap. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, gradientBackground(gradientCss)]}
      />
      {/* Backdrop click closes: with the X and Escape this makes THREE doors
          out, because a cinema the user cannot leave reads as a frozen app. */}
      <Pressable
        accessibilityLabel={t("native.common.close")}
        onPress={closeCinema}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ position: "absolute", top: 10, right: 10, zIndex: 10 }}>
        <GhostIconButton
          icon="x"
          size={20}
          accessibilityLabel={t("native.common.close")}
          onPress={closeCinema}
        />
      </View>
      {song ? (
        // box-none: the wrapper spans the whole overlay, and without it every
        // "empty" click would land here instead of on the closing backdrop.
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 48,
            paddingVertical: 32,
            gap: 24,
          }}
        >
          <ArtworkImage
            source={songArtworkSource(song)}
            songId={song.id}
            size={artworkSize}
            borderRadius={16}
          />
          <View style={{ alignItems: "center", gap: 4, maxWidth: 720 }}>
            <Text
              numberOfLines={2}
              style={{
                color: tokens.foreground,
                fontSize: 30,
                fontWeight: "800",
                textAlign: "center",
              }}
            >
              {song.title}
            </Text>
            {artistsLine ? (
              <Text
                numberOfLines={1}
                style={{ color: tokens.mutedForeground, fontSize: 16, textAlign: "center" }}
              >
                {artistsLine}
              </Text>
            ) : null}
          </View>
          <CinemaLyrics songId={song.id} />
        </View>
      ) : (
        // Songless cinema (the queue emptied under it): the player's own
        // empty state, not a black room.
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState icon="music" text={t("components.music.QueuePanel.empty")} />
        </View>
      )}
    </View>
  );
};
