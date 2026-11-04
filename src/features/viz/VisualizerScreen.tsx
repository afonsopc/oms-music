/**
 * O visualizador em ecrã inteiro (ronda 2): as cenas "de computador" do
 * motor /viz/. Deslizar para o lado (ou as setas) muda de cena; sem mexer, a
 * cena muda a cada 16 compassos. "Modo caos" troca de cena a cada 4 e
 * baralha os efeitos. Os comandos aparecem ao tocar e somem-se em 3 s.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View, type GestureResponderEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatArtists } from "@/domain/format";
import { togglePlaybackOptimistic, useShownPlaying } from "@/features/player/optimisticPlay";
import { getTransport } from "@/contracts/transport";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { usePlaybackView } from "@/remote/mirror";
import { GhostIconButton, PlayFab } from "@/ui";
import { FULL_SCENES, type SceneName, type VizFx } from "../../../viz/protocol";
import { useSongAnalysis } from "./analysis";
import { useMontagePanel, type VideoLayerMode } from "./montageSlot";
import { cycleScenePref, setVizSelection, useVizPrefs } from "./prefs";
import { VizFrame } from "./VizFrame";
import { estimatedPosition } from "./vizMessages";

const HIDE_MS = 3000;

const Toggle = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable
    accessibilityRole="switch"
    accessibilityState={{ checked: on }}
    onPress={onPress}
    style={({ pressed }) => ({
      paddingHorizontal: 12,
      height: 34,
      justifyContent: "center",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: on ? "#ffffff" : "rgba(255,255,255,0.25)",
      backgroundColor: on ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.35)",
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <Text style={{ color: "#fff", fontSize: 13, fontWeight: on ? "600" : "500" }}>{label}</Text>
  </Pressable>
);

/** A folha das definições: aleatório ou pelo estilo, e as favoritas/banidas. */
const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const t = useT();
  const prefs = useVizPrefs();
  const { width } = useWindowDimensions();
  const wide = width >= 720;
  return (
    <View
      style={[
        { position: "absolute", bottom: 0, maxHeight: "72%", backgroundColor: "rgba(12,12,12,0.96)", borderColor: "#262626", paddingTop: 10 },
        wide
          ? { right: 16, bottom: 16, width: 420, borderRadius: 14, borderWidth: 1 }
          : { left: 0, right: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16 }}>
        <Text style={{ flex: 1, color: "#fff", fontSize: 17, fontWeight: "700" }}>{t("native.viz.settings")}</Text>
        <GhostIconButton icon="x" color="#fff" accessibilityLabel={t("native.viz.close")} onPress={onClose} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        <Toggle label={t("native.viz.selStyle")} on={prefs.selection === "style"} onPress={() => setVizSelection("style")} />
        <Toggle label={t("native.viz.selRandom")} on={prefs.selection === "random"} onPress={() => setVizSelection("random")} />
      </View>
      <Text style={{ color: "#a3a3a3", fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 }}>{t("native.viz.prefsHint")}</Text>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}>
        {FULL_SCENES.map((scene) => {
          const fav = prefs.favorites.includes(scene);
          const ban = prefs.banned.includes(scene);
          return (
            <Pressable
              key={scene}
              accessibilityRole="button"
              onPress={() => {
                haptics.select();
                cycleScenePref(scene);
              }}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 8, borderRadius: 8, backgroundColor: pressed ? "#1c1c1c" : "transparent" })}
            >
              <Text style={{ flex: 1, color: ban ? "#6b6b6b" : "#ebebeb", fontSize: 15, textDecorationLine: ban ? "line-through" : "none" }}>
                {t(`native.viz.scene.${scene}`)}
              </Text>
              <Text style={{ color: fav ? "#fff" : "#a3a3a3", fontSize: 13, fontWeight: fav ? "600" : "400" }}>
                {fav ? `♥ ${t("native.viz.fav")}` : ban ? t("native.viz.banned") : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default function VisualizerScreen() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const song = usePlaybackView((v) => v.song);
  const playing = useShownPlaying();
  const [scene, setScene] = useState<SceneName | null>(null);
  const [chaos, setChaos] = useState(false);
  const [fx, setFx] = useState<VizFx>({ crt: false, chroma: false, pixel: false, dither: false });
  const [step, setStep] = useState({ n: 0, dir: 1 as 1 | -1 });
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefs = useVizPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const montage = useMontagePanel();
  const [montageOpen, setMontageOpen] = useState(false);
  const [videoLayer, setVideoLayerState] = useState<{ node: React.ReactNode; mode: VideoLayerMode } | null>(null);
  const setVideoLayer = useCallback((node: React.ReactNode | null, mode: VideoLayerMode = "behind") => {
    setVideoLayerState(node ? { node, mode } : null);
  }, []);
  const analysisQuery = useSongAnalysis(song ? String(song.id) : null);
  const analysis = analysisQuery.data?.status === "ready" ? analysisQuery.data.data : null;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), HIDE_MS);
  }, []);
  useEffect(() => {
    hideTimer.current = setTimeout(() => setChrome(false), HIDE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [poke]);

  const go = useCallback(
    (dir: 1 | -1) => {
      haptics.select();
      setStep((s) => ({ n: s.n + 1, dir }));
      poke();
    },
    [poke],
  );
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") close();
      else if (e.key === " ") {
        e.preventDefault();
        togglePlaybackOptimistic();
      } else return;
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, close, poke]);

  const onTouchStart = (e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.nativeEvent.pageX - s.x;
    const dy = e.nativeEvent.pageY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 120) close();
    else poke();
  };

  const sceneLabel = scene ? t(`native.viz.scene.${scene}`) : "";
  const fade = { opacity: chrome ? 1 : 0, ...(Platform.OS === "web" ? ({ transition: "opacity .35s ease" } as object) : null) };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* A camada de vídeo da Montagem (montageSlot): por trás da cena ou em vez dela. */}
      {videoLayer ? <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>{videoLayer.node}</View> : null}
      <VizFrame
        mode="full"
        chaos={chaos}
        fx={fx}
        stepToken={step}
        autoCycleBars={16}
        selection={prefs.selection}
        favorites={prefs.favorites}
        banned={prefs.banned}
        cycleOnTrack
        paused={videoLayer?.mode === "instead"}
        onMessage={(m) => {
          if (m.type === "scene") setScene(m.name);
        }}
        style={[
          { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
          videoLayer?.mode === "instead" ? { opacity: 0 } : null,
          videoLayer?.mode === "behind" ? ({ opacity: 0.55, ...(Platform.OS === "web" ? { mixBlendMode: "screen" } : null) } as object) : null,
        ]}
      />
      {/* A camada de toque por cima da cena: deslizar muda, tocar mostra os comandos. */}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        {...(Platform.OS === "web" ? ({ onMouseMove: poke } as object) : null)}
      />
      <View pointerEvents={chrome ? "box-none" : "none"} style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" }, fade]}>
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <GhostIconButton icon="x" color="#fff" accessibilityLabel={t("native.viz.close")} onPress={close} />
            <Text style={{ flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
              {sceneLabel}
            </Text>
            {montage ? (
              <Toggle label={montage.label ?? t("native.viz.montage")} on={montageOpen} onPress={() => { setMontageOpen((o) => !o); poke(); }} />
            ) : null}
            <GhostIconButton icon="settings" color="#fff" accessibilityLabel={t("native.viz.settings")} onPress={() => { setSettingsOpen(true); poke(); }} />
            <GhostIconButton icon="chevron-left" color="#fff" accessibilityLabel={t("native.viz.prev")} onPress={() => go(-1)} />
            <GhostIconButton icon="chevron-right" color="#fff" accessibilityLabel={t("native.viz.next")} onPress={() => go(1)} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Toggle label={t("native.viz.chaos")} on={chaos} onPress={() => { haptics.select(); setChaos((c) => !c); poke(); }} />
            <Toggle label={t("native.viz.fxCrt")} on={fx.crt} onPress={() => { setFx((f) => ({ ...f, crt: !f.crt })); poke(); }} />
            <Toggle label={t("native.viz.fxChroma")} on={fx.chroma} onPress={() => { setFx((f) => ({ ...f, chroma: !f.chroma })); poke(); }} />
            <Toggle label={t("native.viz.fxPixel")} on={fx.pixel} onPress={() => { setFx((f) => ({ ...f, pixel: !f.pixel })); poke(); }} />
            <Toggle label={t("native.viz.fxDither")} on={fx.dither} onPress={() => { setFx((f) => ({ ...f, dither: !f.dither })); poke(); }} />
          </View>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20, paddingHorizontal: 20, gap: 14 }}>
          <View>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }} numberOfLines={1}>
              {song?.title ?? ""}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 15, marginTop: 2 }} numberOfLines={1}>
              {song ? formatArtists(song) : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28 }}>
            <GhostIconButton icon="skip-back" size={28} color="#fff" accessibilityLabel={t("components.music.BottomBar.previous")} onPress={() => { haptics.tap(); getTransport().previous(); poke(); }} />
            <PlayFab
              playing={playing}
              size={60}
              accessibilityLabel={playing ? t("components.music.BottomBar.pause") : t("components.music.BottomBar.play")}
              onPress={() => { haptics.tap(); togglePlaybackOptimistic(); poke(); }}
            />
            <GhostIconButton icon="skip-forward" size={28} color="#fff" accessibilityLabel={t("components.music.BottomBar.next")} onPress={() => { haptics.tap(); getTransport().next(); poke(); }} />
          </View>
        </View>
      </View>
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
      {montage?.Background ? (
        <montage.Background song={song} getPosition={estimatedPosition} playing={playing} analysis={analysis} setVideoLayer={setVideoLayer} />
      ) : null}
      {/* A gaveta da Montagem: o painel é de outro trabalho (montageSlot.ts). */}
      {montage && montageOpen ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: Platform.OS === "web" ? ("min(440px, 92%)" as unknown as number) : "92%",
            maxWidth: 440,
            backgroundColor: "rgba(10,10,10,0.94)",
            borderLeftWidth: 1,
            borderColor: "#262626",
            paddingTop: insets.top,
          }}
        >
          <montage.Component
            song={song}
            getPosition={estimatedPosition}
            playing={playing}
            analysis={analysis}
            setVideoLayer={setVideoLayer}
            onClose={() => setMontageOpen(false)}
          />
        </View>
      ) : null}
    </View>
  );
}
