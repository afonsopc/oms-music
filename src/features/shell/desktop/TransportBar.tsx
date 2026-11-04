/**
 * Desktop transport bar (plano-uma-so-app 4.3, row "Mini-player"): the
 * full-width bottom ROW of the shell grid that replaces the floating pill at
 * >= 900px. Three parts, per the plan:
 *
 *  - left:   artwork, title, artists, like;
 *  - center: shuffle / previous / play-pause (bigger, centered) / next /
 *            repeat, with elapsed - slider - total underneath;
 *  - right:  the right-panel toggles (panel, lyrics, queue, devices) at
 *            >= 1200px or the cast slot + full-screen queue below it, then
 *            volume and cinema mode - the DESKTOP fullscreen overlay
 *            (features/player/cinema), which floats above the shell while
 *            this bar stays visible and keeps owning the transport. The
 *            mobile (player) modal is never opened from here.
 *
 * Everything goes through the transport contract and the playback
 * projection, exactly like the pill and the Now Playing sheet - the bar is a
 * third READ surface, never a second source of truth. The scrub and time
 * labels live in their own leaf component so the 4 Hz position ticks
 * re-render a slider, not the whole bar (same discipline as ScrubBar).
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React, { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { songArtistRoute, songHighlightRoute } from "@/lib/routes";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists, formatDuration } from "@/domain/format";
import { isDjClip } from "@/domain/song";
import { DjNowArtwork } from "@/features/dj/DjArtwork";
import type { LoopMode } from "@/domain/playback";
import { getShellSlots, useShellSlotsVersion } from "@/features/shell/slots";
import { useT } from "@/i18n";
import { usePlayerStore } from "@/player/store";
import { usePlaybackView } from "@/remote/mirror";
import { useRemoteStore } from "@/remote/store";
import { useTheme } from "@/theme/provider";
import { LIKED_INK } from "@/theme/tokens";
import { useArtworkTint } from "@/theme/useArtworkTint";
import { ArtworkImage, artworkSourceUri, GhostIconButton, PlayFab, type PopoverAnchor } from "@/ui";
import { CinemaOverlay, toggleCinema } from "@/features/player/cinema";
import { DjButton } from "./DjButton";
import { PlayerSettingsPopover } from "@/features/player/settingsSheet";
import { Slider } from "@/features/player/Slider";
import type { RightPanelTenant } from "./rightPanelModel";

const BB = "components.music.BottomBar";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/**
 * Position leaves: the only parts of the dock the 4 Hz ticks re-render. The
 * bar runs along the dock's top edge (a 32px hit area straddling the line);
 * while dragging, the drag value wins over the store value so the thumb does
 * not fight the ticks (same contract as the player's ScrubBar).
 */
let dragSecondsShared: number | null = null;
const dragListeners = new Set<() => void>();
const setDragShared = (value: number | null): void => {
  dragSecondsShared = value;
  dragListeners.forEach((listener) => listener());
};
const useDragSeconds = (): number | null => {
  const [, force] = useState(0);
  React.useEffect(() => {
    const listener = (): void => force((n) => n + 1);
    dragListeners.add(listener);
    return () => {
      dragListeners.delete(listener);
    };
  }, []);
  return dragSecondsShared;
};

const DockProgress = ({ color }: { color: string }) => {
  const t = useT();
  const { tokens } = useTheme();
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
  const dragSeconds = useDragSeconds();
  const shownSeconds = dragSeconds ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSeconds / duration)) : 0;
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: -16, zIndex: 5 }}>
      <Slider
        value={fraction}
        accessibilityLabel={t("native.player.progress")}
        disabled={duration <= 0}
        height={3}
        thumbSize={11}
        fillColor={color}
        trackColor={tokens.border}
        onSlide={(value) => setDragShared(value * duration)}
        onCommit={(value) => {
          setDragShared(null);
          getTransport().seek(value * duration);
        }}
      />
    </View>
  );
};

const DockTime = () => {
  const { tokens } = useTheme();
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
  const dragSeconds = useDragSeconds();
  return (
    <Text
      style={{
        color: tokens.mutedForeground,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
        marginLeft: 6,
      }}
      numberOfLines={1}
    >
      {formatDuration(dragSeconds ?? position)} / {formatDuration(duration)}
    </Text>
  );
};

/** Volume leaf: shared with the active device, like the player's VolumeRow. */
const TransportVolume = () => {
  const t = useT();
  const volume = usePlaybackView((v) => v.volume);
  const supported = usePlayerStore((s) => s.volumeSupported);
  // Same reason as the player's VolumeRow: on iOS Safari the write is
  // ignored, so the control is retired rather than left lying.
  if (!supported) return null;
  return (
    <View style={{ width: 110, marginHorizontal: 6 }}>
      <Slider
        value={volume}
        accessibilityLabel={t("native.player.volume")}
        height={3}
        thumbSize={10}
        onCommit={(value) => getTransport().setVolume(value)}
      />
    </View>
  );
};

export interface DesktopTransportBarProps {
  /** Whether the window is wide enough for the right panel at all. */
  panelAvailable: boolean;
  panelOpen: boolean;
  /** Which tenant the panel is showing (drives the toggles' active state). */
  activeTenant: RightPanelTenant;
  /** Open the panel on a tenant / switch to it / close when already shown. */
  onToggleTenant: (tenant: RightPanelTenant) => void;
  onTogglePanel: () => void;
}

export const DesktopTransportBar = ({
  panelAvailable,
  panelOpen,
  activeTenant,
  onToggleTenant,
  onTogglePanel,
}: DesktopTransportBarProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const router = useRouter();
  useShellSlotsVersion();

  const song = usePlaybackView((v) => v.song);
  // O popover das definicoes ancora ao canto superior direito do botao,
  // medido na hora do clique (o botao vive numa barra fixa ao fundo; a
  // janela pode ter mudado de tamanho desde a ultima medida).
  const [playbackSettingsAnchor, setPlaybackSettingsAnchor] = useState<PopoverAnchor | null>(
    null,
  );
  const playbackSettingsButton = useRef<View>(null);
  const openPlaybackSettings = (): void => {
    const node = playbackSettingsButton.current;
    if (!node) return;
    node.measureInWindow((x, y, width) => {
      setPlaybackSettingsAnchor({ x: x + width, y: y - 8 });
    });
  };
  const playing = usePlaybackView((v) => v.playing);
  const buffering = usePlaybackView((v) => v.buffering);
  const shuffle = usePlaybackView((v) => v.shuffle);
  const loopMode = usePlaybackView((v) => v.loopMode);

  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  const liked = song ? (likedIds.data ?? []).includes(song.id) : false;
  const CastButton = getShellSlots().castButton;
  const artistsLine = song ? formatArtists(song) : "";

  // Devices toggle status tint, mirroring the CastButton it replaces at
  // >= 1200px: muted when nobody is active, primary when WE are the active
  // device, emerald while another device plays. Hidden entirely while
  // offline - there is nothing to cast to (same rule as the CastButton).
  const remoteRole = useRemoteStore((s) => s.role);
  const activeDeviceId = useRemoteStore((s) => s.activeDeviceId);
  const castTint =
    activeDeviceId === null
      ? tokens.mutedForeground
      : remoteRole === "active"
        ? tokens.primary
        : tokens.foreground;

  const artworkUri = song ? artworkSourceUri(songArtworkSource(song)) : null;
  const tint = useArtworkTint(song ? String(song.id) : null, artworkUri);
  const likedInk = LIKED_INK[scheme];

  const tenantActive = (tenant: RightPanelTenant): boolean =>
    panelOpen && activeTenant === tenant;

  const iconTint = tint.ink;

  return (
    <View
      style={
        {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 20,
          paddingHorizontal: 20,
          backgroundColor: song ? tint.wash : tokens.background,
          transitionProperty: "background-color",
          transitionDuration: "600ms",
          transitionTimingFunction: "ease",
        } as object
      }
    >
      {/* O progresso é a aresta de cima da doca, de ponta a ponta. */}
      {song ? <DockProgress color={iconTint} /> : null}

      {/* Esquerda: o transporte (a forma própria da doca: comandos primeiro,
          depois o que está a tocar, o tempo à direita). */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <GhostIconButton
          icon="skip-back"
          size={20}
          disabled={!song}
          accessibilityLabel={t(`${BB}.previous`)}
          onPress={() => getTransport().previous()}
        />
        <PlayFab
          playing={playing}
          loading={buffering}
          size={46}
          accessibilityLabel={playing ? t(`${BB}.pause`) : t(`${BB}.play`)}
          onPress={() => getTransport().toggle()}
        />
        <GhostIconButton
          icon="skip-forward"
          size={20}
          disabled={!song}
          accessibilityLabel={t(`${BB}.next`)}
          onPress={() => getTransport().next()}
        />
      </View>

      {/* Meio: o que está a tocar. Vazio (nunca uma barra encolhida) quando
          não há nada, para a linha da grelha manter a altura. */}
      <View
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 14, minWidth: 0 }}
      >
        {song ? (
          <>
            {/* Capa e título abrem o álbum JÁ COM a música destacada
                (songHighlightRoute, o hash do FR-44); o artista abre o
                perfil dele. Uma intervenção do DJ não abre álbum nenhum. */}
            {isDjClip(song) ? (
              <DjNowArtwork size={56} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("components.music.SongCard.openAlbum")}
                onPress={() => router.push(songHighlightRoute(song))}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <ArtworkImage
                  source={songArtworkSource(song)}
                  songId={song.id}
                  size={56}
                  recyclingKey={String(song.id)}
                />
              </Pressable>
            )}
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text
                style={{ color: tokens.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" }}
                numberOfLines={1}
                accessibilityRole="button"
                accessibilityLabel={t("components.music.SongCard.openAlbum")}
                onPress={() => router.push(songHighlightRoute(song))}
              >
                {song.title}
              </Text>
              {artistsLine ? (
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 18, marginTop: 1 }}
                  numberOfLines={1}
                  accessibilityRole="button"
                  accessibilityLabel={t("components.music.SongCard.openArtist")}
                  onPress={() => router.push(songArtistRoute(song))}
                >
                  {artistsLine}
                </Text>
              ) : null}
            </View>
            <GhostIconButton
              icon="heart"
              active={liked}
              filled={liked}
              size={18}
              color={liked ? likedInk : undefined}
              accessibilityLabel={liked ? t(`${BB}.unlike`) : t(`${BB}.like`)}
              onPress={() => toggleLike.mutate({ songId: song.id, liked })}
            />
            {song ? <DockTime /> : null}
          </>
        ) : null}
      </View>

      {/* Direita: modos, painel, aparelhos, volume e o resto. At >= 1200px
          the tenant toggles drive the right panel; below that the panel
          cannot open, so queue keeps its full-screen route and the cast slot
          keeps its sheet. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          minWidth: 0,
        }}
      >
        <GhostIconButton
          icon="shuffle"
          active={shuffle}
          size={17}
          disabled={!song}
          accessibilityLabel={t(`${BB}.shuffle`)}
          onPress={() => getTransport().setShuffle(!shuffle)}
        />
        <GhostIconButton
          icon={loopMode === "one" ? "repeat-1" : "repeat"}
          active={loopMode !== "none"}
          size={17}
          disabled={!song}
          accessibilityLabel={t(`${BB}.loop`)}
          onPress={() => getTransport().setLoopMode(nextLoopMode(loopMode))}
        />
        <View style={{ width: 1, height: 22, backgroundColor: tokens.border, marginHorizontal: 8 }} />
        {panelAvailable ? (
          <>
            <GhostIconButton
              icon="mic-vocal"
              active={tenantActive("lyrics")}
              size={18}
              accessibilityLabel={t("native.desktop.tenantLyrics")}
              onPress={() => onToggleTenant("lyrics")}
            />
            <GhostIconButton
              icon="list-music"
              active={tenantActive("queue")}
              size={19}
              accessibilityLabel={t("native.desktop.tenantQueue")}
              onPress={() => onToggleTenant("queue")}
            />
            {remoteRole !== "offline" ? (
              <GhostIconButton
                icon="cast"
                active={tenantActive("devices")}
                size={19}
                color={tenantActive("devices") ? undefined : castTint}
                accessibilityLabel={t("native.desktop.tenantDevices")}
                onPress={() => onToggleTenant("devices")}
              />
            ) : null}
            <GhostIconButton
              icon="list-start"
              active={panelOpen}
              size={19}
              accessibilityLabel={t("native.desktop.toggleRightPanel")}
              onPress={onTogglePanel}
            />
          </>
        ) : (
          <>
            {CastButton ? <CastButton /> : null}
            <GhostIconButton
              icon="list-music"
              size={19}
              accessibilityLabel={t(`${BB}.queue`)}
              onPress={() => router.push("/(player)/queue")}
            />
          </>
        )}
        <TransportVolume />
        {/* Sem nada a tocar também se começa uma estação: é ela que ENCHE a
            fila (dono, 2026-08-31). */}
        <DjButton disabled={false} />
        {/* A porta das definições do som (velocidade, voz, EQ, temporizador). */}
        <View ref={playbackSettingsButton} collapsable={false}>
          <GhostIconButton
            icon="audio-waveform"
            size={18}
            disabled={!song}
            accessibilityLabel={t("components.music.Settings.PlaybackPage.title")}
            onPress={openPlaybackSettings}
          />
        </View>
        {/* Modo cinema: o leitor em ecrã inteiro por cima do shell. */}
        <GhostIconButton
          icon="maximize"
          size={18}
          disabled={!song}
          accessibilityLabel={t("native.desktop.cinemaMode")}
          onPress={toggleCinema}
        />
      </View>
      {/* Mounted here because the bar exists at every desktop width; the
          overlay positions itself against the window, not this row. */}
      <CinemaOverlay />
      <PlayerSettingsPopover
        anchor={playbackSettingsAnchor}
        onClose={() => setPlaybackSettingsAnchor(null)}
        song={song}
      />
    </View>
  );
};
