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
import {
  ActivityIndicator,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { useLikedIds, useToggleLike } from "@/api/queries/likedSongs";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { isDjClip } from "@/domain/song";
import { formatArtists, formatDuration, primaryArtistSegment } from "@/domain/format";
import type { Song } from "@/domain/song";
import { getShellSlots, useShellSlotsVersion } from "@/features/shell/slots";
import { useT } from "@/i18n";
import { songAlbumRoute, songArtistRoute } from "@/lib/routes";
import { usePlayerStore } from "@/player/store";
import { usePlaybackView } from "@/remote/mirror";
import { getCachedAccent, resolveAccent } from "@/theme/accent";
import { useTheme } from "@/theme/provider";
import { ACCENT_FALLBACK } from "@/theme/tokens";
import {
  artworkSourceUri,
  EmptyState,
  GhostIconButton,
  Icon,
  SongMenu,
  useContainerWidth,
  useDesktopShell,
} from "@/ui";
import { foregroundWash } from "@/ui/uiTheme";
import { ImmersiveArtwork } from "./immersive";
import { DjArtwork } from "@/features/dj/DjArtwork";
import { togglePlayerMode, usePlayerModeStore } from "./mode";
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
 * A vista ACTIVA da fila de baixo ganha um disco por tras, como o botao da
 * fila no Apple Music (screenshots do dono 2026-08-15). A cor sozinha nao
 * chegava para dizer "estas aqui".
 */
const modePill = (scheme: "light" | "dark", active: boolean): ViewStyle | undefined =>
  active ? { backgroundColor: foregroundWash(scheme, 0.22), borderRadius: 22 } : undefined;

/**
 * Position/duration leaf. Isolated so the 4 Hz position slice re-renders the
 * scrub bar alone instead of the whole screen.
 */
const ScrubBar = () => {
  const t = useT();
  const { tokens } = useTheme();
  // Uma intervencao do DJ nao se arrasta (dono, 2026-08-31: "sem dar pra dar
  // scrub"): a barra sai do ecra em vez de ficar la a dizer que da.
  const djClip = usePlaybackView((v) => isDjClip(v.song));
  const position = usePlaybackView((v) => v.position);
  const duration = usePlaybackView((v) => v.duration);
  const passive = usePlaybackView((v) => v.passive);
  // Loop de secção A-B: marcas locais (o loop nunca viaja pelo cabo), por
  // isso em modo controlador nao se desenham - a barra mostra a musica
  // REMOTA e estes segundos pertencem ao player local silenciado.
  const abLoopA = usePlayerStore((s) => s.abLoopA);
  const abLoopB = usePlayerStore((s) => s.abLoopB);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);

  if (djClip) return null;

  const shownSeconds = dragSeconds ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSeconds / duration)) : 0;
  const timeStyle = {
    color: tokens.mutedForeground,
    fontSize: 12,
    fontVariant: ["tabular-nums" as const],
  };
  const abMarks =
    !passive && duration > 0
      ? [abLoopA, abLoopB].filter((mark): mark is number => mark !== null)
      : [];

  return (
    <View>
      {/* Capsula sem thumb (idioma Apple Music, pedido do dono 2026-08-14):
          o dedo define a posicao em qualquer ponto da barra; nada de botao
          a arrastar. A direita mostra o RESTANTE com sinal, nao o total. */}
      <View>
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
        {/* Traços verticais de A e B por cima da capsula (o Slider tem 32 de
            altura com a faixa de 7 centrada; 16 centrado = top 8). Decorativos
            e transparentes ao toque - o dedo continua a mandar na barra. */}
        {abMarks.map((mark, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: `${Math.min(1, Math.max(0, mark / duration)) * 100}%`,
              top: 8,
              width: 2,
              height: 16,
              marginLeft: -1,
              borderRadius: 1,
              backgroundColor: tokens.foreground,
            }}
          />
        ))}
      </View>
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
  const supported = usePlayerStore((s) => s.volumeSupported);
  // iOS Safari owns output volume itself (HTMLMediaElement.volume is
  // read-only there): a slider that slides and changes nothing is worse than
  // no slider, so the row goes away rather than lying (owner report
  // 2026-08-16, point 7).
  if (!supported) return null;
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
  // So para o DJ: as barras da capa dele so dancam enquanto ele fala mesmo.
  const nowPlaying = usePlaybackView((v) => v.playing);
  const likedIds = useLikedIds();
  const toggleLike = useToggleLike();
  const [menuOpen, setMenuOpen] = useState(false);

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
  // Quadrado recuado das margens (screenshots do Apple Music, 2026-08-15),
  // limitado tambem pela altura disponivel para nao empurrar a identidade
  // para fora do ecra num telefone baixo.
  const artworkSize = Math.min(
    containerWidth - 48,
    Math.round(height * 0.44),
    desktopShell ? DESKTOP_ARTWORK_MAX : Number.POSITIVE_INFINITY,
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          {isDjClip(song) ? (
            <DjArtwork size={artworkSize} speaking={nowPlaying} />
          ) : (
            <ImmersiveArtwork song={song} size={artworkSize} />
          )}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 28,
            paddingHorizontal: 24,
          }}
        >
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
          {/* Um clip do DJ nao se gosta nem tem menu: nao e uma musica da
              biblioteca, e nao ha nada la dentro que lhe sirva. */}
          {isDjClip(song) ? null : (
            <>
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
            </>
          )}
        </View>
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
  const { scheme, tokens } = useTheme();
  useShellSlotsVersion();
  const playing = usePlaybackView((v) => v.playing);
  const buffering = usePlaybackView((v) => v.buffering);
  const mode = usePlayerModeStore((s) => s.mode);
  const CastButton = getShellSlots().castButton;
  // O karaoke precisa dos dois stems da música ACTUAL: sem eles o botão
  // fica visível mas apagado (a dica completa vive no item do SongMenu).
  const karaokeReady = usePlaybackView(
    (v) =>
      v.song != null &&
      !v.song.jam_song &&
      !!v.song.vocals_media_id &&
      !!v.song.instrumental_media_id,
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
          size={34}
          accessibilityLabel={t(`${NP}.previous`)}
          onPress={() => getTransport().previous()}
        />
        {/* Glifo nu, sem o disco branco por tras: no Apple Music o play e o
            proprio simbolo (screenshots do dono 2026-08-15), e era o disco
            que fazia esta linha parecer um botao entre dois icones em vez de
            tres irmaos. */}
        {/* A carregar mostra-se, nao se disfarca (relato do dono
            2026-08-16, ponto 2): sem este ramo o glifo vinha de `playing`
            sozinho e a espera pelo primeiro byte lia-se como PAUSA. Continua
            a ser um botao - toggle() corre por INTENCAO, portanto carregar
            aqui cancela um arranque que esta a demorar de mais, que e
            precisamente o que quem carrega quer dizer. */}
        {buffering ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${NP}.loading`)}
            hitSlop={8}
            onPress={() => getTransport().toggle()}
            style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center" }}
          >
            <ActivityIndicator color={tokens.foreground} />
          </Pressable>
        ) : (
          <GhostIconButton
            icon={playing ? "pause" : "play"}
            size={40}
            filled
            style={{ width: 64, height: 64 }}
            accessibilityLabel={playing ? t(`${NP}.pause`) : t(`${NP}.play`)}
            onPress={() => getTransport().toggle()}
          />
        )}
        <GhostIconButton
          icon="skip-forward"
          size={34}
          accessibilityLabel={t(`${NP}.next`)}
          onPress={() => getTransport().next()}
        />
      </View>

      <View style={{ marginTop: 12 }}>
        <VolumeRow />
      </View>

      {/* A fila de toggles do fundo, espacada como a do AM. Letra e Fila sao
          MODOS, nao paginas: acendem-se e trocam o palco por cima (ver
          ./mode.ts); carregar no que ja esta aceso volta a capa. */}
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
          icon="mic-vocal"
          active={mode === "lyrics"}
          style={modePill(scheme, mode === "lyrics")}
          accessibilityLabel={t(`${NP}.lyrics`)}
          onPress={() => togglePlayerMode("lyrics")}
        />
        <GhostIconButton
          icon="list-music"
          active={mode === "queue"}
          style={modePill(scheme, mode === "queue")}
          accessibilityLabel={t(`${NP}.queue`)}
          onPress={() => togglePlayerMode("queue")}
        />
        <GhostIconButton
          icon="mic"
          active={mode === "karaoke"}
          // Desactivado sem stems, EXCEPTO quando o modo já está aceso: o
          // botão é também a saída (toggle volta à capa) e uma troca de
          // música sem stems não pode trancar o utilizador lá dentro.
          disabled={!karaokeReady && mode !== "karaoke"}
          style={modePill(scheme, mode === "karaoke")}
          accessibilityLabel={t(`${K}.karaoke`)}
          onPress={() => togglePlayerMode("karaoke")}
        />
        <GhostIconButton
          icon="users"
          active={mode === "jam"}
          style={modePill(scheme, mode === "jam")}
          accessibilityLabel={t(`${BB}.jam`)}
          onPress={() => togglePlayerMode("jam")}
        />
        <GhostIconButton
          icon="audio-waveform"
          active={mode === "settings"}
          style={modePill(scheme, mode === "settings")}
          accessibilityLabel={t(`${K}.audioSettings`)}
          onPress={() => togglePlayerMode("settings")}
        />
      </View>
    </View>
  );
};
