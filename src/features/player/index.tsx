/**
 * Now Playing (FR-17), page 0 of the (player) pager.
 *
 *  - artwork on the song's dual-variant accent gradient (theme/accent LRU +
 *    theme/gradients recipe; a theme flip restyles without re-downloading);
 *  - title and artist are links: they dismiss the modal and navigate to the
 *    album / artist screens;
 *  - scrub bar with tabular time labels, drag shows the DRAG position and
 *    seeks once on release (a scrub never inflates play events, FR-62);
 *  - shuffle / previous / play / next / loop with the exact web cycle
 *    None -> All -> One (FR-58 semantics live in the engine);
 *  - volume row, like heart (optimistic `/liked_songs/ids` set, FR-46),
 *    overflow = the canonical song menu (FR-74), cast button slot (WP9's
 *    DevicePicker), jam entry point and the cog sheet (FR-64/68 UI).
 *
 * Every transport call goes through `contracts/transport` so a controller
 * device forwards them as validated cable commands (FR-63 remote half). The
 * position slice is isolated inside <ScrubBar/>: the 4 Hz ticks re-render
 * that leaf only, never the whole screen.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration, primaryArtistSlug } from "@/domain/format";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { getShellSlots, useShellSlotsVersion } from "@/features/shell/slots";
import { useT } from "@/i18n";
import { usePlayerStore } from "@/player/store";
import { getCachedAccent, resolveAccent } from "@/theme/accent";
import { playerGradient } from "@/theme/gradients";
import { useTheme } from "@/theme/provider";
import { ACCENT_FALLBACK } from "@/theme/tokens";
import {
  ArtworkImage,
  artworkSourceUri,
  EmptyState,
  GhostIconButton,
  Icon,
  PlayFab,
  SongMenu,
} from "@/ui";
import { PlayerSettingsSheet } from "./settingsSheet";
import { Slider } from "./Slider";

const NP = "components.music.NowPlayingSheet";
const BB = "components.music.BottomBar";
const K = "native.player";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/**
 * Position/duration leaf. Isolated so the 4 Hz position slice re-renders the
 * scrub bar alone instead of the whole screen.
 */
const ScrubBar = () => {
  const t = useT();
  const { tokens } = useTheme();
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);

  const shownSeconds = dragSeconds ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSeconds / duration)) : 0;
  const timeStyle = {
    color: tokens.mutedForeground,
    fontSize: 12,
    fontVariant: ["tabular-nums" as const],
  };

  return (
    <View>
      <Slider
        value={fraction}
        accessibilityLabel={t(`${K}.progress`)}
        disabled={duration <= 0}
        onSlide={(value) => setDragSeconds(value * duration)}
        onCommit={(value) => {
          setDragSeconds(null);
          getTransport().seek(value * duration);
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Text style={timeStyle}>{formatDuration(shownSeconds)}</Text>
        <Text style={timeStyle}>{formatDuration(duration)}</Text>
      </View>
    </View>
  );
};

const VolumeRow = () => {
  const t = useT();
  const { tokens } = useTheme();
  const volume = usePlayerStore((s) => s.volume);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon name="volume" size={16} color={tokens.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Slider
          value={volume}
          accessibilityLabel={t(`${K}.volume`)}
          height={3}
          thumbSize={10}
          onCommit={(value) => getTransport().setVolume(value)}
        />
      </View>
    </View>
  );
};

/**
 * Song accent, both theme variants, cached per song id (FR-66). The resolved
 * pair carries its key so a late extraction never paints the next song, and
 * the synchronous cache read covers songs already seen (theme flips restyle
 * without re-downloading bytes).
 */
const useSongAccent = (song: Song | null): string => {
  const { scheme } = useTheme();
  const artworkUri = song ? artworkSourceUri(songArtworkSource(song)) : null;
  const accentKey = song ? String(song.id) : "";
  const [resolved, setResolved] = useState<{
    key: string;
    variants: { light: string; dark: string };
  } | null>(null);

  useEffect(() => {
    if (!accentKey) return;
    let cancelled = false;
    void resolveAccent("song", accentKey, artworkUri).then((variants) => {
      if (!cancelled) setResolved({ key: accentKey, variants });
    });
    return () => {
      cancelled = true;
    };
  }, [accentKey, artworkUri]);

  const variants =
    resolved && resolved.key === accentKey
      ? resolved.variants
      : accentKey
        ? getCachedAccent("song", accentKey)
        : null;
  return variants ? variants[scheme] : ACCENT_FALLBACK;
};

export default function NowPlayingBody() {
  const t = useT();
  const { tokens, scheme } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  useShellSlotsVersion();

  const song = usePlayerStore((s) => s.currentSong);
  const playing = usePlayerStore((s) => s.playing);
  const buffering = usePlayerStore((s) => s.buffering);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const loopMode = usePlayerStore((s) => s.loopMode);

  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const accent = useSongAccent(song);
  const [gradientTop, gradientBottom] = playerGradient(accent, scheme);

  // Links leave the player: dismiss the modal first so the destination lands
  // on the (main) stack rather than under it.
  const openInMain = useCallback(
    (route: string) => {
      router.back();
      router.push(route as Parameters<typeof router.push>[0]);
    },
    [router],
  );

  if (!song) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <EmptyState icon="music" text={t("components.music.QueuePanel.empty")} />
      </View>
    );
  }

  const artistsLine = formatArtists(song) || t(`${NP}.unknownArtist`);
  const artistSegment = primaryArtistSlug(song);
  const liked = (likedIds.data ?? []).includes(song.id);
  const CastButton = getShellSlots().castButton;
  const artworkSize = Math.min(width - 64, Math.round(height * 0.42));

  return (
    <View
      style={{
        flex: 1,
        experimental_backgroundImage: `linear-gradient(to bottom, ${gradientTop}, ${gradientBottom})`,
      }}
    >
      <View style={{ flex: 1, paddingHorizontal: 24, paddingBottom: 8 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ArtworkImage
            source={songArtworkSource(song)}
            songId={song.id}
            size={artworkSize}
            borderRadius={12}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("components.music.Song.album")}
              disabled={!song.album || !artistSegment}
              onPress={() =>
                openInMain(
                  `/(main)/album/${encodeURIComponent(artistSegment)}/${encodeURIComponent(
                    song.album ?? "null",
                  )}`,
                )
              }
            >
              <Text
                numberOfLines={2}
                style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}
              >
                {song.title}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("components.music.Song.artist")}
              disabled={!artistSegment}
              onPress={() => openInMain(`/(main)/artist/${encodeURIComponent(artistSegment)}`)}
            >
              <Text
                numberOfLines={1}
                style={{ color: tokens.mutedForeground, fontSize: 14, marginTop: 4 }}
              >
                {artistsLine}
              </Text>
            </Pressable>
          </View>
          <GhostIconButton
            icon="heart"
            active={liked}
            filled={liked}
            accessibilityLabel={liked ? t(`${BB}.unlike`) : t(`${BB}.like`)}
            onPress={() => toggleLike.mutate({ songId: song.id, liked })}
          />
          <GhostIconButton
            icon="more-horizontal"
            accessibilityLabel={t(`${NP}.moreActions`)}
            onPress={() => setMenuOpen(true)}
          />
        </View>

        <View style={{ marginTop: 10 }}>
          <ScrubBar />
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <GhostIconButton
            icon="shuffle"
            active={shuffle}
            accessibilityLabel={t(`${NP}.shuffle`)}
            onPress={() => getTransport().setShuffle(!shuffle)}
          />
          <GhostIconButton
            icon="skip-back"
            size={24}
            accessibilityLabel={t(`${NP}.previous`)}
            onPress={() => getTransport().previous()}
          />
          <PlayFab
            playing={playing}
            loading={buffering}
            accessibilityLabel={playing ? t(`${NP}.pause`) : t(`${NP}.play`)}
            onPress={() => getTransport().toggle()}
          />
          <GhostIconButton
            icon="skip-forward"
            size={24}
            accessibilityLabel={t(`${NP}.next`)}
            onPress={() => getTransport().next()}
          />
          <GhostIconButton
            icon={loopMode === "one" ? "repeat-1" : "repeat"}
            active={loopMode !== "none"}
            accessibilityLabel={t(`${NP}.loop`)}
            onPress={() => getTransport().setLoopMode(nextLoopMode(loopMode))}
          />
        </View>

        <View style={{ marginTop: 4 }}>
          <VolumeRow />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
          {CastButton ? <CastButton /> : null}
          <GhostIconButton
            icon="users"
            accessibilityLabel={t(`${BB}.jam`)}
            onPress={() => openInMain("/jam")}
          />
          <GhostIconButton
            icon="audio-waveform"
            accessibilityLabel={t(`${K}.audioSettings`)}
            onPress={() => setSettingsOpen(true)}
          />
        </View>
      </View>

      <SongMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        context={{ song, surface: "nowPlaying" }}
      />
      <PlayerSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        song={song}
      />
    </View>
  );
}
