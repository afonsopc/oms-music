/**
 * O player do telemovel na web: o mesmo palco do nativo (PlayerStage), sem
 * gesture-handler nem Reanimated (os dois pesavam ~1 MB de fonte no bundle
 * web). Fechar: arrastar a pega ou a capa para baixo (pointer events), ou
 * Esc.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, View, type GestureResponderEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerChrome } from "@/features/player";
import { ImmersiveBackdrop } from "@/features/player/immersive";
import { usePlayerModeStore } from "@/features/player/mode";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { dismissDecision } from "./dismissMath";
import { PlayerHandle, PlayerStage } from "./PlayerStage";

type PointerLike = { clientY: number; timeStamp: number; pointerId?: number; currentTarget?: unknown };

export const NowPlayingScreen = () => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const song = usePlaybackView((v) => v.song);
  const mode = usePlayerModeStore((s) => s.mode);
  const [dragY] = useState(() => new Animated.Value(0));
  const start = useRef<{ y: number; t: number } | null>(null);

  const close = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /* eslint-disable react-hooks/refs -- os handlers só FECHAM sobre o ref;
     cada `.current` é lido mais tarde, dentro de um evento do ponteiro. */
  const handlers = (enabled: boolean) =>
    enabled
      ? {
          onPointerDown: (e: GestureResponderEvent & PointerLike) => {
            start.current = { y: e.clientY, t: e.timeStamp };
            const el = e.currentTarget as unknown as { setPointerCapture?: (id: number) => void };
            if (e.pointerId != null) el?.setPointerCapture?.(e.pointerId);
          },
          onPointerMove: (e: GestureResponderEvent & PointerLike) => {
            if (!start.current) return;
            dragY.setValue(Math.max(0, e.clientY - start.current.y));
          },
          onPointerUp: (e: GestureResponderEvent & PointerLike) => {
            const s = start.current;
            start.current = null;
            if (!s) return;
            const dy = e.clientY - s.y;
            const ms = Math.max(1, e.timeStamp - s.t);
            if (dismissDecision(dy, (dy / ms) * 1000)) close();
            Animated.spring(dragY, { toValue: 0, damping: 22, stiffness: 220, useNativeDriver: false }).start();
          },
          onPointerCancel: () => {
            start.current = null;
            Animated.spring(dragY, { toValue: 0, damping: 22, stiffness: 220, useNativeDriver: false }).start();
          },
        }
      : {};
  /* eslint-enable react-hooks/refs */

  return (
    <Animated.View
      style={{ flex: 1, backgroundColor: tokens.background, transform: [{ translateY: dragY }] }}
    >
      <ImmersiveBackdrop song={song} dense={mode !== "artwork"} />
      {/* Num ecrã largo o leitor não se estica: coluna de 640 no meio. */}
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        <View {...(handlers(true) as object)} style={{ touchAction: "none" } as object}>
          <PlayerHandle />
        </View>
        <View
          {...(handlers(mode === "artwork") as object)}
          style={{ flex: 1, minHeight: 0, ...(mode === "artwork" ? { touchAction: "pan-x" } : {}) } as object}
        >
          <PlayerStage mode={mode} song={song} />
        </View>
        <View style={{ paddingHorizontal: 24 }}>
          <PlayerChrome />
        </View>
      </View>
    </Animated.View>
  );
};
