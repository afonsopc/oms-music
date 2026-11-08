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
 *            volume and the fullscreen button, which opens the visualizer
 *            (features/viz, o único ecrã inteiro desde 2026-11-04) while
 *            this bar stays visible and keeps owning the transport. The
 *            mobile (player) modal is never opened from here.
 *
 * Everything goes through the transport contract and the playback
 * projection, exactly like the pill and the Now Playing sheet - the bar is a
 * third READ surface, never a second source of truth. The scrub and time
 * labels live in their own leaf component so the 4 Hz position ticks
 * re-render a slider, not the whole bar (same discipline as ScrubBar).
 *
 * Larguras (dono, 2026-11-08: "a bottom bar aqui ta demasiado cramped"):
 * o centro tem largura fixa por janela e os lados ficam iguais com o resto
 * (transportLayout.ts); o lado direito mostra tudo numa janela larga e, quando
 * não cabe, passa os menos usados para um menu "…" em vez de encolher os
 * botões até se tocarem.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React, { useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { djRoute, songArtistRoute, songHighlightRoute } from "@/lib/routes";
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
import { useCastStore } from "@/cast/store";
import { useRemoteStore } from "@/remote/store";
import { useTheme } from "@/theme/provider";
import {
  ArtworkImage,
  GhostIconButton,
  Icon,
  PlayFab,
  Popover,
  type IconName,
  type PopoverAnchor,
} from "@/ui";
import { openVisualizer } from "@/features/viz/openVisualizer";
import { DjButton } from "./DjButton";
import { Waveform } from "@/features/viz/Waveform";
import { PlayerSettingsPopover } from "@/features/player/settingsSheet";
import { Slider } from "@/features/player/Slider";
import type { RightPanelTenant } from "./rightPanelModel";
import {
  TRANSPORT_COLUMN_GAP,
  TRANSPORT_PAD_X,
  transportGeometry,
  VOLUME_WIDTH,
} from "./transportLayout";

const BB = "components.music.BottomBar";

/** Web parity (BottomBar.handleLoopModeClick): None -> All -> One -> None. */
const nextLoopMode = (mode: LoopMode): LoopMode =>
  mode === "none" ? "all" : mode === "all" ? "one" : "none";

/** Os botões da direita: 36 de largura (o toque continua com hitSlop). */
const SIDE_BUTTON = { width: 36, height: 40 } as const;

/**
 * Position/duration leaf: the one part of the bar the 4 Hz ticks re-render.
 * While dragging, the drag value wins over the store value so the thumb does
 * not fight the ticks (same contract as the player's ScrubBar).
 *
 * Uma faixa de 28 px: a onda (16) em cima, a barra (3) por baixo, e os
 * tempos ao meio da faixa, com folga para não colarem às pontas.
 */
const TransportScrub = () => {
  const t = useT();
  const { tokens } = useTheme();
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
  const songId = usePlaybackView((v) => (v.song ? String(v.song.id) : null));
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);

  const shownSeconds = dragSeconds ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSeconds / duration)) : 0;
  const timeStyle = {
    color: tokens.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ["tabular-nums" as const],
    width: 40,
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 28 }}>
      <Text style={[timeStyle, { textAlign: "right" }]}>{formatDuration(shownSeconds)}</Text>
      <View style={{ flex: 1, height: 28 }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 2 }}>
          <Waveform songId={songId} fraction={fraction} height={16} bars={110} />
        </View>
        {/* O Slider tem 44 de toque; fica por cima, centrado na linha da
            barra (y = 23), sem fazer crescer a faixa. */}
        <View style={{ position: "absolute", left: 0, right: 0, top: 1 }}>
          <Slider
            value={fraction}
            accessibilityLabel={t("native.player.progress")}
            disabled={duration <= 0}
            height={3}
            thumbSize={11}
            onSlide={(value) => setDragSeconds(value * duration)}
            onCommit={(value) => {
              setDragSeconds(null);
              getTransport().seek(value * duration);
            }}
          />
        </View>
      </View>
      <Text style={timeStyle}>{formatDuration(duration)}</Text>
    </View>
  );
};

/**
 * Volume leaf: shared with the active device, like the player's VolumeRow.
 * O altifalante à frente silencia e volta ao volume de antes.
 */
const TransportVolume = ({ width }: { width: number }) => {
  const t = useT();
  const volume = usePlaybackView((v) => v.volume);
  const supported = usePlayerStore((s) => s.volumeSupported);
  const beforeMute = useRef(1);
  // Same reason as the player's VolumeRow: on iOS Safari the write is
  // ignored, so the control is retired rather than left lying.
  if (!supported) return null;
  const muted = volume <= 0.001;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <GhostIconButton
        icon={muted ? "volume-x" : "volume"}
        size={17}
        style={SIDE_BUTTON}
        accessibilityLabel={muted ? t(`${BB}.unmute`) : t(`${BB}.mute`)}
        onPress={() => {
          if (muted) {
            getTransport().setVolume(beforeMute.current > 0.05 ? beforeMute.current : 0.7);
          } else {
            beforeMute.current = volume;
            getTransport().setVolume(0);
          }
        }}
      />
      <View style={{ width }}>
        <Slider
          value={volume}
          accessibilityLabel={t("native.player.volume")}
          height={3}
          thumbSize={10}
          onCommit={(value) => getTransport().setVolume(value)}
        />
      </View>
    </View>
  );
};

/** Uma linha do menu "…": o look das linhas do AccountMenu/SongMenu. */
const MoreMenuRow = ({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 18,
        paddingVertical: 11,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={18} color={active ? tokens.foreground : tokens.mutedForeground} />
      <Text
        style={{ color: tokens.foreground, fontSize: 14, flex: 1 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
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
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();
  useShellSlotsVersion();
  const { width: windowWidth } = useWindowDimensions();
  // A barra mede-se a si própria; até ao primeiro onLayout vale a janela
  // (é a mesma largura: a linha do leitor vai de ponta a ponta).
  const [barWidth, setBarWidth] = useState(0);
  const { center, tier } = transportGeometry(barWidth > 0 ? barWidth : windowWidth);

  const song = usePlaybackView((v) => v.song);
  // Os popovers (definicoes, menu "…") ancoram ao canto superior direito do
  // botao, medido na hora do clique (o botao vive numa barra fixa ao fundo;
  // a janela pode ter mudado de tamanho desde a ultima medida).
  const [playbackSettingsAnchor, setPlaybackSettingsAnchor] = useState<PopoverAnchor | null>(
    null,
  );
  const [moreAnchor, setMoreAnchor] = useState<PopoverAnchor | null>(null);
  const playbackSettingsButton = useRef<View>(null);
  const moreButton = useRef<View>(null);
  const anchorAbove = (
    node: View | null,
    set: (anchor: PopoverAnchor) => void,
  ): void => {
    if (!node) return;
    node.measureInWindow((x, y, width) => set({ x: x + width, y: y - 8 }));
  };
  const openPlaybackSettings = (): void =>
    anchorAbove(playbackSettingsButton.current, setPlaybackSettingsAnchor);
  const openMore = (): void => anchorAbove(moreButton.current, setMoreAnchor);
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
  // Uma TV (Chromecast/DLNA) ou o AirPlay com o som contam como "noutro sítio".
  const castingElsewhere = useCastStore((s) => s.phase !== "idle" || s.airplayRoute !== null);
  const castTint = castingElsewhere
    ? tokens.foreground
    : activeDeviceId === null
      ? tokens.mutedForeground
      : remoteRole === "active"
        ? tokens.primary
        : tokens.foreground;

  const tenantActive = (tenant: RightPanelTenant): boolean =>
    panelOpen && activeTenant === tenant;

  // O que fica à vista por andar; o resto vai para o "…".
  const full = tier === "full";
  const showPanelToggle = panelAvailable && full;
  const showLyrics = panelAvailable && tier !== "tight";
  const showDjAndSettings = full;
  const showFullscreen = tier !== "tight";

  /** Fecha o menu e corre a acção (o menu nunca fica aberto por cima dela). */
  const fromMenu = (action: () => void) => (): void => {
    setMoreAnchor(null);
    action();
  };

  const separator = (
    <View
      style={{ width: 1, height: 18, backgroundColor: tokens.border, marginHorizontal: 6 }}
    />
  );

  return (
    <View
      onLayout={(event) => setBarWidth(Math.round(event.nativeEvent.layout.width))}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: TRANSPORT_COLUMN_GAP,
        paddingHorizontal: TRANSPORT_PAD_X,
      }}
    >
      {/* Left: what is playing. Empty surface (never a collapsed bar) when
          nothing is loaded, so the grid row keeps its height. */}
      <View
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 14, minWidth: 0 }}
      >
        {song ? (
          <>
            {/* Artwork e titulo abrem o album JA COM a musica destacada
                (songHighlightRoute, o hash do FR-44); o artista abre o
                perfil dele - o idioma das apps de referencia, pedido do dono
                (2026-08-17). Sao Pressable/onPress e nao links para
                continuarem a viver dentro da linha da grelha. */}
            {/* Uma intervencao do DJ nao abre album nenhum: mostra a capa
                dele a falar e mais nada (features/dj). */}
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
                style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
                numberOfLines={1}
                accessibilityRole="button"
                accessibilityLabel={t("components.music.SongCard.openAlbum")}
                onPress={() => router.push(songHighlightRoute(song))}
              >
                {song.title}
              </Text>
              {artistsLine ? (
                <Text
                  style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 3 }}
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
              style={SIDE_BUTTON}
              accessibilityLabel={liked ? t(`${BB}.unlike`) : t(`${BB}.like`)}
              onPress={() => toggleLike.mutate({ songId: song.id, liked })}
            />
          </>
        ) : null}
      </View>

      {/* Center: transport + scrub, a largura fixa por janela
          (transportLayout), por isso os botões e a barra de progresso ficam
          sempre ao centro da janela e alinhados um com o outro. */}
      <View style={{ width: center, flexShrink: 0, gap: 4 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            height: 40,
          }}
        >
          <GhostIconButton
            icon="shuffle"
            active={shuffle}
            size={16}
            style={SIDE_BUTTON}
            disabled={!song}
            accessibilityLabel={t(`${BB}.shuffle`)}
            onPress={() => getTransport().setShuffle(!shuffle)}
          />
          <GhostIconButton
            icon="skip-back"
            size={18}
            style={SIDE_BUTTON}
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
            style={SIDE_BUTTON}
            disabled={!song}
            accessibilityLabel={t(`${BB}.next`)}
            onPress={() => getTransport().next()}
          />
          <GhostIconButton
            icon={loopMode === "one" ? "repeat-1" : "repeat"}
            active={loopMode !== "none"}
            size={16}
            style={SIDE_BUTTON}
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
          the pre-panel behaviour. Quando não cabe tudo, o "…" leva o resto
          (transportLayout). */}
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
          minWidth: 0,
        }}
      >
        {panelAvailable ? (
          <>
            {showPanelToggle ? (
              <GhostIconButton
                icon="list-start"
                active={panelOpen}
                size={18}
                style={SIDE_BUTTON}
                accessibilityLabel={t("native.desktop.toggleRightPanel")}
                onPress={onTogglePanel}
              />
            ) : null}
            {showLyrics ? (
              <GhostIconButton
                icon="mic-vocal"
                active={tenantActive("lyrics")}
                size={16}
                style={SIDE_BUTTON}
                accessibilityLabel={t("native.desktop.tenantLyrics")}
                onPress={() => onToggleTenant("lyrics")}
              />
            ) : null}
            <GhostIconButton
              icon="list-music"
              active={tenantActive("queue")}
              size={18}
              style={SIDE_BUTTON}
              accessibilityLabel={t("native.desktop.tenantQueue")}
              onPress={() => onToggleTenant("queue")}
            />
            {remoteRole !== "offline" ? (
              <GhostIconButton
                icon="cast"
                active={tenantActive("devices")}
                size={18}
                style={SIDE_BUTTON}
                color={tenantActive("devices") ? undefined : castTint}
                accessibilityLabel={t("native.desktop.tenantDevices")}
                onPress={() => onToggleTenant("devices")}
              />
            ) : null}
          </>
        ) : (
          <>
            <GhostIconButton
              icon="list-music"
              size={18}
              style={SIDE_BUTTON}
              accessibilityLabel={t(`${BB}.queue`)}
              onPress={() => router.push("/(player)/queue")}
            />
            {CastButton ? <CastButton /> : null}
          </>
        )}
        {separator}
        <TransportVolume width={VOLUME_WIDTH[tier]} />
        {showDjAndSettings || showFullscreen ? separator : null}
        {/* Teste de O Melhor DJ (dono, 2026-08-16); integracao a serio na vaga 2.
            Sem nada a tocar tambem se comeca uma estacao: e ela que ENCHE
            a fila (dono, 2026-08-31). */}
        {showDjAndSettings ? <DjButton disabled={false} /> : null}
        {/* A porta das configs de playback (velocidade, vocal/instrumental,
            EQ, sleep timer): o cog do player mobile, aqui como botao da
            barra - sem ele o desktop nao tinha COMO chegar a estas opcoes
            (feedback do dono 2026-08-14). Sem espaço vive no "…". */}
        {showDjAndSettings ? (
          <View ref={playbackSettingsButton} collapsable={false}>
            <GhostIconButton
              icon="audio-waveform"
              size={17}
              style={SIDE_BUTTON}
              disabled={!song}
              accessibilityLabel={t("components.music.Settings.PlaybackPage.title")}
              onPress={openPlaybackSettings}
            />
          </View>
        ) : null}
        {/* Cinema mode: a fullscreen glyph, because that is what it does.
            The overlay renders above the grid while this bar stays visible
            and in charge. */}
        {showFullscreen ? (
          <GhostIconButton
            icon="maximize"
            size={17}
            style={SIDE_BUTTON}
            disabled={!song}
            accessibilityLabel={t("native.viz.title")}
            onPress={openVisualizer}
          />
        ) : null}
        {full ? null : (
          <View ref={moreButton} collapsable={false}>
            <GhostIconButton
              icon="more-horizontal"
              size={18}
              style={SIDE_BUTTON}
              active={moreAnchor != null}
              accessibilityLabel={t(`${BB}.moreActions`)}
              onPress={openMore}
            />
          </View>
        )}
      </View>
      {/* Mounted here because the bar exists at every desktop width; the
          overlay positions itself against the window, not this row. */}
      <Popover
        visible={moreAnchor != null}
        anchor={moreAnchor ?? { x: 0, y: 0 }}
        onClose={() => setMoreAnchor(null)}
        width={340}
        side={{ vertical: "above", horizontal: "end" }}
      >
        {panelAvailable && !showLyrics ? (
          <MoreMenuRow
            icon="mic-vocal"
            label={t("native.desktop.tenantLyrics")}
            active={tenantActive("lyrics")}
            onPress={fromMenu(() => onToggleTenant("lyrics"))}
          />
        ) : null}
        {panelAvailable && !showPanelToggle ? (
          <MoreMenuRow
            icon="list-start"
            label={t("native.desktop.toggleRightPanel")}
            active={panelOpen}
            onPress={fromMenu(onTogglePanel)}
          />
        ) : null}
        <MoreMenuRow
          icon="radio"
          label={t("native.dj.open")}
          onPress={fromMenu(() => router.push(djRoute))}
        />
        <MoreMenuRow
          icon="audio-waveform"
          label={t("components.music.Settings.PlaybackPage.title")}
          disabled={!song}
          onPress={() => {
            // O popover das definições abre no sítio do "…" (o botão próprio
            // não está à vista neste andar).
            const anchor = moreAnchor;
            setMoreAnchor(null);
            if (anchor) setPlaybackSettingsAnchor(anchor);
          }}
        />
        {showFullscreen ? null : (
          <MoreMenuRow
            icon="maximize"
            label={t("native.viz.title")}
            disabled={!song}
            onPress={fromMenu(openVisualizer)}
          />
        )}
      </Popover>
      <PlayerSettingsPopover
        anchor={playbackSettingsAnchor}
        onClose={() => setPlaybackSettingsAnchor(null)}
        song={song}
      />
    </View>
  );
};
