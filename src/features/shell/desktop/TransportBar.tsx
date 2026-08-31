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
import React, { useState } from "react";
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
import { ArtworkImage, GhostIconButton, PlayFab } from "@/ui";
import { CinemaOverlay, toggleCinema } from "@/features/player/cinema";
import { DjButton } from "./DjButton";
import { PlayerSettingsSheet } from "@/features/player/settingsSheet";
import { Slider } from "@/features/player/Slider";
import type { RightPanelTenant } from "./rightPanelModel";

const BB = "components.music.BottomBar";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/**
 * Position/duration leaf: the one part of the bar the 4 Hz ticks re-render.
 * While dragging, the drag value wins over the store value so the thumb does
 * not fight the ticks (same contract as the player's ScrubBar).
 */
const TransportScrub = () => {
  const t = useT();
  const { tokens } = useTheme();
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);

  const shownSeconds = dragSeconds ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSeconds / duration)) : 0;
  const timeStyle = {
    color: tokens.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums" as const],
    width: 40,
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={[timeStyle, { textAlign: "right" }]}>{formatDuration(shownSeconds)}</Text>
      <View style={{ flex: 1 }}>
        <Slider
          value={fraction}
          accessibilityLabel={t("native.player.progress")}
          disabled={duration <= 0}
          height={3}
          thumbSize={10}
          onSlide={(value) => setDragSeconds(value * duration)}
          onCommit={(value) => {
            setDragSeconds(null);
            getTransport().seek(value * duration);
          }}
        />
      </View>
      <Text style={timeStyle}>{formatDuration(duration)}</Text>
    </View>
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
    <View style={{ width: 96 }}>
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
  const { tokens, ink } = useTheme();
  const t = useT();
  const router = useRouter();
  useShellSlotsVersion();

  const song = usePlaybackView((v) => v.song);
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);
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
        : ink.sync;

  const tenantActive = (tenant: RightPanelTenant): boolean =>
    panelOpen && activeTenant === tenant;

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingHorizontal: 12,
      }}
    >
      {/* Left: what is playing. Empty surface (never a collapsed bar) when
          nothing is loaded, so the grid row keeps its height. */}
      <View
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 }}
      >
        {song ? (
          <>
            {/* Artwork e titulo abrem o album JA COM a musica destacada
                (songHighlightRoute, o hash do FR-44); o artista abre o
                perfil dele - o idioma do Spotify, pedido do dono
                (2026-08-17). Sao Pressable/onPress e nao links para
                continuarem a viver dentro da linha da grelha. */}
            {/* Uma intervencao do DJ nao abre album nenhum: mostra a capa
                dele a falar e mais nada (features/dj). */}
            {isDjClip(song) ? (
              <DjNowArtwork size={48} />
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
                  size={48}
                  recyclingKey={String(song.id)}
                />
              </Pressable>
            )}
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text
                style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}
                numberOfLines={1}
                accessibilityRole="button"
                accessibilityLabel={t("components.music.SongCard.openAlbum")}
                onPress={() => router.push(songHighlightRoute(song))}
              >
                {song.title}
              </Text>
              {artistsLine ? (
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 1 }}
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
              size={16}
              accessibilityLabel={liked ? t(`${BB}.unlike`) : t(`${BB}.like`)}
              onPress={() => toggleLike.mutate({ songId: song.id, liked })}
            />
          </>
        ) : null}
      </View>

      {/* Center: transport + scrub, capped so it never sprawls edge to edge
          on an ultrawide (the audit's space-between complaint). gap 0: the
          buttons' own hit padding already separates them from the scrub. */}
      <View style={{ flex: 2, maxWidth: 640, gap: 0 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <GhostIconButton
            icon="shuffle"
            active={shuffle}
            size={16}
            disabled={!song}
            accessibilityLabel={t(`${BB}.shuffle`)}
            onPress={() => getTransport().setShuffle(!shuffle)}
          />
          <GhostIconButton
            icon="skip-back"
            size={18}
            disabled={!song}
            accessibilityLabel={t(`${BB}.previous`)}
            onPress={() => getTransport().previous()}
          />
          <PlayFab
            playing={playing}
            loading={buffering}
            size={36}
            accessibilityLabel={playing ? t(`${BB}.pause`) : t(`${BB}.play`)}
            onPress={() => getTransport().toggle()}
          />
          <GhostIconButton
            icon="skip-forward"
            size={18}
            disabled={!song}
            accessibilityLabel={t(`${BB}.next`)}
            onPress={() => getTransport().next()}
          />
          <GhostIconButton
            icon={loopMode === "one" ? "repeat-1" : "repeat"}
            active={loopMode !== "none"}
            size={16}
            disabled={!song}
            accessibilityLabel={t(`${BB}.loop`)}
            onPress={() => getTransport().setLoopMode(nextLoopMode(loopMode))}
          />
        </View>
        <TransportScrub />
      </View>

      {/* Right cluster, the plan's order: panel toggle, lyrics, queue,
          devices, volume, full player. At >= 1200px the tenant toggles drive
          the right panel; below that the panel cannot open, so queue keeps
          its full-screen route and the cast slot keeps its sheet - exactly
          the pre-panel behaviour. */}
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          minWidth: 0,
        }}
      >
        {panelAvailable ? (
          <>
            <GhostIconButton
              icon="list-start"
              active={panelOpen}
              size={18}
              accessibilityLabel={t("native.desktop.toggleRightPanel")}
              onPress={onTogglePanel}
            />
            <GhostIconButton
              icon="mic-vocal"
              active={tenantActive("lyrics")}
              size={16}
              accessibilityLabel={t("native.desktop.tenantLyrics")}
              onPress={() => onToggleTenant("lyrics")}
            />
            <GhostIconButton
              icon="list-music"
              active={tenantActive("queue")}
              size={18}
              accessibilityLabel={t("native.desktop.tenantQueue")}
              onPress={() => onToggleTenant("queue")}
            />
            {remoteRole !== "offline" ? (
              <GhostIconButton
                icon="cast"
                active={tenantActive("devices")}
                size={18}
                color={tenantActive("devices") ? undefined : castTint}
                accessibilityLabel={t("native.desktop.tenantDevices")}
                onPress={() => onToggleTenant("devices")}
              />
            ) : null}
          </>
        ) : (
          <>
            {CastButton ? <CastButton /> : null}
            <GhostIconButton
              icon="list-music"
              size={18}
              accessibilityLabel={t(`${BB}.queue`)}
              onPress={() => router.push("/(player)/queue")}
            />
          </>
        )}
        <TransportVolume />
        {/* Cinema mode: a fullscreen glyph, because that is what it does -
            the old disc icon pushed the MOBILE modal player over the
            desktop shell, which fit nothing. The overlay renders above the
            grid while this bar stays visible and in charge. */}
        {/* A porta das configs de playback (velocidade, vocal/instrumental,
            EQ, sleep timer): o cog do player mobile, aqui como botao da
            barra - sem ele o desktop nao tinha COMO chegar a estas opcoes
            (feedback do dono 2026-08-14). */}
        {/* Teste de O Melhor DJ (dono, 2026-08-16); integracao a serio na vaga 2. */}
        {/* Sem nada a tocar tambem se comeca uma estacao: e ela que ENCHE
            a fila (dono, 2026-08-31). */}
        <DjButton disabled={false} />
        <GhostIconButton
          icon="audio-waveform"
          size={17}
          disabled={!song}
          accessibilityLabel={t("components.music.Settings.PlaybackPage.title")}
          onPress={() => setPlaybackSettingsOpen(true)}
        />
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
      <PlayerSettingsSheet
        visible={playbackSettingsOpen}
        onClose={() => setPlaybackSettingsOpen(false)}
        song={song}
      />
    </View>
  );
};
