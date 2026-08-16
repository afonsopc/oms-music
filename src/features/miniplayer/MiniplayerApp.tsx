/**
 * A UI da janela do mini-player (plano 3.5, finalmente com layout: o shell ja
 * criava a janela ha muito, mas ela carregava a APP INTEIRA em 420x240 - o
 * que o dono viu como "todo broken", 2026-08-15).
 *
 * Esta arvore monta ACIMA do SessionGate e nao fala com a API: e um espelho
 * do que a janela principal publica por eventos do Tauri (desktop/miniplayer)
 * e um emissor de RemoteCommand de volta. Sem sessao, sem queries, sem motor
 * de audio - a janela abre instantanea e nunca tem estado proprio para ficar
 * dessincronizado.
 *
 * Tres formas, as do preset persistido no Rust: "bar" (so transporte),
 * "rect" (artwork pequena + transporte) e "square" (artwork grande). A altura
 * da janela ja vem certa do shell; aqui so se escolhe o arranjo que cabe.
 */
import React from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  emitMiniplayerCommand,
  EMPTY_MINIPLAYER_STATE,
  MINIPLAYER_STATE_EVENT,
  toMiniplayerState,
  type MiniplayerState,
} from "@/desktop/miniplayer";
import { getTauriGlobals } from "@/desktop/tauri";
import { formatDuration } from "@/domain/format";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { GhostIconButton, Icon, PlayFab } from "@/ui";

/** Alturas do preset (miniplayer.rs): bar 84, rect 240, square 440. */
const BAR_MAX_HEIGHT = 120;
const RECT_MAX_HEIGHT = 320;

const useMiniplayerState = (): MiniplayerState => {
  const [state, setState] = React.useState<MiniplayerState>(EMPTY_MINIPLAYER_STATE);

  React.useEffect(() => {
    const tauri = getTauriGlobals();
    if (!tauri) return;
    let unlisten: (() => void) | null = null;
    let alive = true;
    void tauri.event
      .listen(MINIPLAYER_STATE_EVENT, (event) => {
        const next = toMiniplayerState(event.payload);
        if (next) setState(next);
      })
      .then((off) => {
        if (alive) unlisten = off;
        else off();
      });
    // Aperto de mao: o player pode estar em pausa ha uma hora e nao ter nada
    // para publicar; sem o pedido a janela abria vazia.
    emitMiniplayerCommand({ kind: "sync" });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return state;
};

/** A altura da janela decide o arranjo - o preset ja a determinou no Rust. */
const useWindowHeight = (): number => {
  const [height, setHeight] = React.useState(() =>
    typeof window === "undefined" ? RECT_MAX_HEIGHT : window.innerHeight,
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = (): void => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
};

/** Barra de progresso clicavel: um clique salta, como no player grande. */
const MiniScrub = ({ state }: { state: MiniplayerState }) => {
  const { tokens } = useTheme();
  const [width, setWidth] = React.useState(0);
  const ratio =
    state.duration > 0 ? Math.min(1, Math.max(0, state.position / state.duration)) : 0;

  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="progressbar"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (width <= 0 || state.duration <= 0) return;
          const x = event.nativeEvent.locationX;
          emitMiniplayerCommand({
            kind: "seek",
            seconds: Math.min(state.duration, Math.max(0, (x / width) * state.duration)),
          });
        }}
        style={{ height: 12, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: tokens.secondary }}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              width: `${ratio * 100}%`,
              backgroundColor: tokens.primary,
            }}
          />
        </View>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: tokens.mutedForeground, fontSize: 10 }}>
          {formatDuration(state.position)}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 10 }}>
          {state.duration > 0 ? formatDuration(state.duration) : "--:--"}
        </Text>
      </View>
    </View>
  );
};

const Transport = ({ state, size }: { state: MiniplayerState; size: number }) => {
  const t = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <GhostIconButton
        icon="skip-back"
        size={size - 4}
        disabled={!state.hasSong}
        accessibilityLabel={t("components.music.Player.previous")}
        onPress={() => emitMiniplayerCommand({ kind: "previous" })}
      />
      <PlayFab
        playing={state.playing}
        loading={state.buffering === true}
        size={size + 10}
        accessibilityLabel={
          state.playing ? t("components.music.Player.pause") : t("components.music.Player.play")
        }
        onPress={() => emitMiniplayerCommand({ kind: "toggle" })}
      />
      <GhostIconButton
        icon="skip-forward"
        size={size - 4}
        disabled={!state.hasSong}
        accessibilityLabel={t("components.music.Player.next")}
        onPress={() => emitMiniplayerCommand({ kind: "next" })}
      />
    </View>
  );
};

const Artwork = ({ uri, size }: { uri: string | null; size: number }) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        overflow: "hidden",
        backgroundColor: tokens.secondary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        // <img> directo (a janela e sempre web): o ArtworkImage arrasta o
        // pipeline de cache da app, que esta janela nao tem nem quer.
        React.createElement("img", {
          src: uri,
          width: size,
          height: size,
          style: { width: size, height: size, objectFit: "cover" },
          alt: "",
        })
      ) : (
        <Icon name="music" size={Math.round(size / 3)} color={tokens.mutedForeground} />
      )}
    </View>
  );
};

const Identity = ({ state, big }: { state: MiniplayerState; big: boolean }) => {
  const t = useT();
  const { tokens } = useTheme();
  return (
    <View style={{ minWidth: 0, flexShrink: 1, gap: 2 }}>
      <Text
        numberOfLines={1}
        style={{ color: tokens.foreground, fontSize: big ? 15 : 13, fontWeight: "700" }}
      >
        {state.hasSong ? state.title : t("native.desktop.miniplayerEmpty")}
      </Text>
      {state.hasSong ? (
        <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: big ? 13 : 11 }}>
          {state.artist}
        </Text>
      ) : null}
    </View>
  );
};

export const MiniplayerApp = () => {
  const { tokens } = useTheme();
  const t = useT();
  const state = useMiniplayerState();
  const height = useWindowHeight();
  const layout = height <= BAR_MAX_HEIGHT ? "bar" : height <= RECT_MAX_HEIGHT ? "rect" : "square";

  // A janela nao tem decoracoes (miniplayer.rs): o fundo INTEIRO arrasta, e
  // os controlos, sendo filhos, continuam clicaveis - a mesma regra da
  // topbar do shell.
  const drag = Platform.OS === "web" ? { dataSet: { "tauri-drag-region": "true" } } : null;

  return (
    <View
      {...drag}
      style={{
        flex: 1,
        backgroundColor: tokens.background,
        paddingHorizontal: 14,
        paddingVertical: layout === "bar" ? 8 : 14,
        gap: layout === "bar" ? 0 : 12,
        justifyContent: "center",
      }}
    >
      {/* A saida da janela. Ela nao tem decoracoes (miniplayer.rs) e ja
          esteve presa por nao ter porta nenhuma (dono, 2026-08-17): o X
          esconde-a pelo mesmo comando do menu Vista/Cmd+Shift+M, e fica em
          TODOS os layouts de proposito - mesmo que o resto do espelho parta,
          este botao nao depende de estado nenhum. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("native.desktop.miniplayerClose")}
        hitSlop={8}
        onPress={() => void getTauriGlobals()?.core.invoke("miniplayer_toggle")}
        style={{ position: "absolute", top: 6, right: 8, zIndex: 1, padding: 2 }}
      >
        <Icon name="x" size={14} color={tokens.mutedForeground} />
      </Pressable>
      {layout === "bar" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Artwork uri={state.artworkUrl} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Identity state={state} big={false} />
          </View>
          <Transport state={state} size={18} />
        </View>
      ) : layout === "rect" ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Artwork uri={state.artworkUrl} size={72} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Identity state={state} big />
            </View>
          </View>
          <MiniScrub state={state} />
          <Transport state={state} size={20} />
        </>
      ) : (
        <>
          <View style={{ alignItems: "center" }}>
            <Artwork uri={state.artworkUrl} size={260} />
          </View>
          <View style={{ alignItems: "center" }}>
            <Identity state={state} big />
          </View>
          <MiniScrub state={state} />
          <Transport state={state} size={22} />
        </>
      )}
    </View>
  );
};
