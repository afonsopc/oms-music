/**
 * O visualizador em ecrã inteiro (ronda 2): as cenas "de computador" do
 * motor /viz/. Deslizar para o lado (ou as setas) muda de cena; sem mexer, a
 * cena muda a cada 16 compassos. "Modo caos" troca de cena a cada 4 e
 * baralha os efeitos. Os comandos aparecem ao tocar e somem-se em 3 s.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatArtists } from "@/domain/format";
import { togglePlaybackOptimistic, useShownPlaying } from "@/features/player/optimisticPlay";
import { getTransport } from "@/contracts/transport";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { usePlaybackView } from "@/remote/mirror";
import { GhostIconButton, PlayFab } from "@/ui";
import type { SceneName, VizFx } from "../../../viz/protocol";
import { VizFrame } from "./VizFrame";

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
      <VizFrame
        mode="full"
        chaos={chaos}
        fx={fx}
        stepToken={step}
        autoCycleBars={16}
        onMessage={(m) => {
          if (m.type === "scene") setScene(m.name);
        }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
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
    </View>
  );
}
