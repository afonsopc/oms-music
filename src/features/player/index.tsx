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
 * device forwards them as validated cable commands (FR-63 remote half), and
 * every playback read goes through `remote/mirror` so a controller renders
 * the REMOTE song, position and duration instead of the silenced local ones
 * (FR-109). The position slice is isolated inside <ScrubBar/>: the 4 Hz
 * ticks re-render that leaf only, never the whole screen.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useRouter, type Href } from "expo-router";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration, primaryArtistSegment } from "@/domain/format";
import type { Song } from "@/domain/song";
import { getShellSlots, useShellSlotsVersion } from "@/features/shell/slots";
import { useT } from "@/i18n";
import { songAlbumRoute, songArtistRoute } from "@/lib/routes";
import { usePlaybackView } from "@/remote/mirror";
import { getCachedAccent, resolveAccent } from "@/theme/accent";
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
  useContainerWidth,
  useDesktopShell,
} from "@/ui";
import { PlayerSettingsSheet } from "./settingsSheet";
import { Slider } from "./Slider";

const NP = "components.music.NowPlayingSheet";
const BB = "components.music.BottomBar";
const K = "native.player";

/**
 * Artwork ceiling under the desktop shell (plano-uma-so-app 4.3, player
 * sheet row): the mobile formula `min(width - 64, height * 0.42)` composes a
 * phone, but on a 1440p monitor it inflates the cover to ~600px of flat
 * pixels. 400 keeps the cinema view an artwork, not a billboard. Mobile and
 * native never hit this branch.
 */
const DESKTOP_ARTWORK_MAX = 400;

/**
 * A artwork RESPIRA com o estado de reproducao (idioma Apple Music, pedido
 * do dono 2026-08-14): em pausa encolhe para ~86% com a sombra apertada; ao
 * tocar cresce para 100% com uma sombra larga e funda. Springs assimetricos
 * de proposito - o crescimento e vivo (overshoot visivel), o encolher e
 * calmo - porque e ESTA animacao que carrega quase todo o feedback de
 * play/pause do ecra. useAnimatedStyle puro, nada de layout animations (as
 * unicas que a web nao suporta).
 */
const BreathingArtwork = ({
  song,
  size,
  playing,
}: {
  song: Song;
  size: number;
  playing: boolean;
}) => {
  const p = useSharedValue(playing ? 1 : 0);
  useEffect(() => {
    p.value = playing
      ? withSpring(1, { damping: 12, stiffness: 180 })
      : withSpring(0, { damping: 24, stiffness: 220 });
  }, [playing, p]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.86 + 0.14 * p.value }],
    shadowOpacity: 0.18 + 0.22 * p.value,
    shadowRadius: 12 + 16 * p.value,
  }));
  return (
    <Animated.View
      style={[
        {
          borderRadius: 14,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 10 },
          // Android nao anima sombras nativas; a elevation fixa e o melhor
          // compromisso sem Skia.
          elevation: 16,
        },
        style,
      ]}
    >
      <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={size} borderRadius={14} />
    </Animated.View>
  );
};

/**
 * Position/duration leaf. Isolated so the 4 Hz position slice re-renders the
 * scrub bar alone instead of the whole screen.
 */
const ScrubBar = () => {
  const t = useT();
  const { tokens } = useTheme();
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
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
      {/* Capsula sem thumb (idioma Apple Music, pedido do dono 2026-08-14):
          o dedo define a posicao em qualquer ponto da barra; nada de botao
          a arrastar. A direita mostra o RESTANTE com sinal, nao o total. */}
      <Slider
        value={fraction}
        accessibilityLabel={t(`${K}.progress`)}
        disabled={duration <= 0}
        height={7}
        thumbSize={0}
        onSlide={(value) => setDragSeconds(value * duration)}
        onCommit={(value) => {
          setDragSeconds(null);
          getTransport().seek(value * duration);
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Text style={timeStyle}>{formatDuration(shownSeconds)}</Text>
        <Text style={timeStyle}>
          {duration > 0 ? `-${formatDuration(Math.max(0, duration - shownSeconds))}` : "0:00"}
        </Text>
      </View>
    </View>
  );
};

const VolumeRow = () => {
  const t = useT();
  const { tokens } = useTheme();
  // Volume is the ACTIVE device's output: shared, unlike the other listener
  // settings, so a controller drag shows and moves the remote value.
  const volume = usePlaybackView((v) => v.volume);
  return (
    // Altifalante pequeno a esquerda, alto a direita, capsula sem thumb: a
    // linha de volume do Apple Music.
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Icon name="volume" size={13} color={tokens.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Slider
          value={volume}
          accessibilityLabel={t(`${K}.volume`)}
          height={6}
          thumbSize={0}
          onCommit={(value) => getTransport().setVolume(value)}
        />
      </View>
      <Icon name="volume" size={18} color={tokens.mutedForeground} />
    </View>
  );
};

/**
 * Song accent, both theme variants, cached per song id (FR-66). The resolved
 * pair carries its key so a late extraction never paints the next song, and
 * the synchronous cache read covers songs already seen (theme flips restyle
 * without re-downloading bytes).
 */
export const useSongAccent = (song: Song | null): string => {
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
  const { tokens } = useTheme();
  const router = useRouter();
  const { height } = useWindowDimensions();
  // Container, not window: outside any provider (the mobile modal, all of
  // native) this falls back to the window width - numerically the shipped
  // mobile behaviour.
  const containerWidth = useContainerWidth();
  const desktopShell = useDesktopShell();
  useShellSlotsVersion();

  const song = usePlaybackView((v) => v.song);
  const playing = usePlaybackView((v) => v.playing);
  const buffering = usePlaybackView((v) => v.buffering);

  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Links leave the player entirely: an album or a radio opened from here
  // belongs on the (main) stack, not stacked as a second sheet over the one
  // the user is already in. `back()` only pops one entry and races the push,
  // which is how the destination ended up presented as another sheet;
  // dismissAll() unwinds every modal first, and canDismiss() keeps it safe
  // when the player is somehow not presented modally. (This body is the
  // mobile modal's alone now - the desktop panel has its own lean tenant.)
  const openInMain = useCallback(
    (route: Href) => {
      if (router.canDismiss()) router.dismissAll();
      router.push(route);
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
  const artistSegment = primaryArtistSegment(song);
  const liked = (likedIds.data ?? []).includes(song.id);
  const CastButton = getShellSlots().castButton;
  const artworkSize = Math.min(
    containerWidth - 64,
    Math.round(height * 0.42),
    desktopShell ? DESKTOP_ARTWORK_MAX : Number.POSITIVE_INFINITY,
  );

  return (
    // Transparent on purpose: the (player) scroll paints ONE continuous
    // accent gradient across body + lyrics card + queue, so there is no seam
    // where the viewport ends (the old per-body gradient cut to black there).
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingBottom: 8 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <BreathingArtwork song={song} size={artworkSize} playing={playing} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("components.music.Song.album")}
              disabled={!song.album || !artistSegment}
              onPress={() => openInMain(songAlbumRoute(song))}
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
              onPress={() => openInMain(songArtistRoute(song))}
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

        <PlayerChrome />
      </View>

      <SongMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        context={{ song, surface: "nowPlaying" }}
      />
    </View>
  );
}

/**
 * O CHROME do player - scrub, transporte de tres glifos, volume e a fila de
 * toggles - extraido para persistir NAS TRES vistas do player (now playing,
 * letras, fila), o idioma Apple Music dos screenshots do dono (2026-08-14):
 * mudar de vista nunca leva o transporte consigo. O now playing monta-o no
 * fundo do body; as subpaginas (PlayerSubpage) montam-no por baixo do
 * conteudo. Shuffle/repeat NAO vivem aqui - sao as pills da fila.
 */
export const PlayerChrome = () => {
  const t = useT();
  useShellSlotsVersion();
  const song = usePlaybackView((v) => v.song);
  const playing = usePlaybackView((v) => v.playing);
  const buffering = usePlaybackView((v) => v.buffering);
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const CastButton = getShellSlots().castButton;

  const openInMain = useCallback(
    (route: Href) => {
      if (router.canDismiss()) router.dismissAll();
      router.push(route);
    },
    [router],
  );

  return (
    <View>
      <View style={{ marginTop: 10 }}>
        <ScrubBar />
      </View>

      {/* Transporte a Apple Music: TRES glifos grandes, centrados, mais
          nada. Shuffle e repeat mudaram-se para as pills no topo da fila
          (pagina da fila), onde o AM as tem; a fila desta linha era o que
          fazia o transporte parecer um tabuleiro de botoes. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 44,
          marginTop: 10,
        }}
      >
        <GhostIconButton
          icon="skip-back"
          size={30}
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
          size={30}
          accessibilityLabel={t(`${NP}.next`)}
          onPress={() => getTransport().next()}
        />
      </View>

      <View style={{ marginTop: 12 }}>
        <VolumeRow />
      </View>

      {/* A fila de toggles do fundo, espacada como a do AM. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-evenly",
          marginTop: 8,
        }}
      >
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

      <PlayerSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        song={song}
      />
    </View>
  );
};
