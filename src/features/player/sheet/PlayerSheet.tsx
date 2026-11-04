/**
 * A folha do leitor no telemóvel, nativo (ronda 2, 2026-11-04). Antes abrir
 * era navegar para um ecrã modal: cada abertura montava o leitor inteiro na
 * thread de JS antes de o primeiro frame mexer, e fechar arrastava e só
 * depois navegava para trás (o salto que o dono sentia).
 *
 * Agora a folha monta UMA vez (pouco depois de haver música) e fica: abrir e
 * fechar só mudam `progress` (0 fechada, 1 aberta), um valor partilhado do
 * Reanimated. O dedo mexe-lhe directamente na thread da UI, no mini-leitor
 * (para cima) e na pega/capa da folha (para baixo); ao largar, uma mola leva
 * ao destino com a velocidade do dedo. Nenhum render de React durante o
 * gesto; o React só sabe do fim (`open`), para os toques e para os ouvintes
 * da posição.
 */
import React, { createContext, memo, useContext, useEffect, useMemo } from "react";
import { BackHandler, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, type PanGesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerChrome } from "@/features/player";
import { ImmersiveBackdrop } from "@/features/player/immersive";
import { usePlayerModeStore } from "@/features/player/mode";
import { PlayerHandle, PlayerStage } from "@/features/shell/PlayerStage";
import { haptics } from "@/lib/haptics";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { useDesktopShell } from "@/ui/shellLayout";
import { InSheetContext } from "./liveSurface";
import { clampProgress, SHEET_SPRING, sheetSnapTarget } from "./sheetMath";
import {
  mountPlayerSheet,
  registerSheetController,
  setPlayerSheetOpen,
  useSheetStore,
  type WebSheetDrag,
} from "./sheetStore";

/** O progresso da folha, para o mini-leitor o arrastar e desvanecer. */
export const SheetProgressContext = createContext<SharedValue<number> | null>(null);

export const useSheetProgress = (): SharedValue<number> | null => useContext(SheetProgressContext);

/** Pré-aquecimento: monta o corpo pouco depois de haver uma música. */
const PREWARM_MS = 900;

const SheetBody = memo(function SheetBody({ handlePan, stagePan }: { handlePan: PanGesture; stagePan: PanGesture }) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const song = usePlaybackView((v) => v.song);
  const mode = usePlayerModeStore((s) => s.mode);
  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ImmersiveBackdrop song={song} dense={mode !== "artwork"} />
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        <GestureDetector gesture={handlePan}>
          <View>
            <PlayerHandle />
          </View>
        </GestureDetector>
        {/* Na capa, arrastar para baixo fecha; nas letras e na fila o
            conteúdo rola e só a pega fecha (sem disputas pelo dedo). */}
        <GestureDetector gesture={stagePan}>
          <View style={{ flex: 1, minHeight: 0 }}>
            <PlayerStage mode={mode} song={song} />
          </View>
        </GestureDetector>
        {/* O chrome não leva gesto de fechar: os sliders precisam do dedo. */}
        <View style={{ paddingHorizontal: 24 }}>
          <PlayerChrome />
        </View>
      </View>
    </View>
  );
});

const SheetHost = ({ progress }: { progress: SharedValue<number> }) => {
  const { height } = useWindowDimensions();
  const mounted = useSheetStore((s) => s.mounted);
  const open = useSheetStore((s) => s.open);
  const mode = usePlayerModeStore((s) => s.mode);
  const hasSong = usePlaybackView((v) => v.song != null);

  useEffect(() => {
    if (!hasSong || mounted) return;
    const id = setTimeout(mountPlayerSheet, PREWARM_MS);
    return () => clearTimeout(id);
  }, [hasSong, mounted]);

  useEffect(() => {
    const dispose = registerSheetController({
      open: () => {
        setPlayerSheetOpen(true);
        progress.set(withSpring(1, SHEET_SPRING));
      },
      close: () => {
        progress.set(withSpring(0, SHEET_SPRING, (finished) => {
          if (finished) runOnJS(setPlayerSheetOpen)(false);
        }));
      },
    });
    return dispose;
  }, [progress]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      progress.set(withSpring(0, SHEET_SPRING, (finished) => {
        if (finished) runOnJS(setPlayerSheetOpen)(false);
      }));
      return true;
    });
    return () => sub.remove();
  }, [open, progress]);

  const start = useSharedValue(1);
  const makePan = (enabled: boolean): PanGesture =>
    Gesture.Pan()
      .enabled(enabled)
      // Só para baixo e passados 10 px: um toque nunca é arrasto.
      .activeOffsetY([10, 10_000])
      .failOffsetX([-24, 24])
      .onBegin(() => {
        start.value = progress.get();
      })
      .onUpdate((event) => {
        progress.set(clampProgress(start.value - event.translationY / height));
      })
      .onEnd((event) => {
        const target = sheetSnapTarget(progress.get(), event.velocityY);
        progress.set(withSpring(target, { ...SHEET_SPRING, velocity: -event.velocityY / height }, (finished) => {
          if (finished && target === 0) runOnJS(setPlayerSheetOpen)(false);
        }));
        if (target === 0) runOnJS(haptics.select)();
      });

  const handlePan = useMemo(() => makePan(true), [height]); // eslint-disable-line react-hooks/exhaustive-deps
  const stagePan = useMemo(() => makePan(mode === "artwork"), [height, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * height }],
    // Escondida de vez quando fechada: nada a compor fora do ecrã.
    opacity: progress.get() > 0.001 ? 1 : 0,
  }));

  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      style={[StyleSheet.absoluteFill, { zIndex: 100 }, style]}
    >
      {mounted ? (
        <InSheetContext.Provider value>
          <SheetBody handlePan={handlePan} stagePan={stagePan} />
        </InSheetContext.Provider>
      ) : null}
    </Animated.View>
  );
};

/**
 * Envolve o (main): dá o progresso ao mini-leitor e põe a folha por cima de
 * tudo. No computador (shell >= 900 na web) não há folha nenhuma.
 */
export const PlayerSheetProvider = ({ children }: { children: React.ReactNode }) => {
  const progress = useSharedValue(0);
  const desktop = useDesktopShell();
  return (
    <SheetProgressContext.Provider value={desktop ? null : progress}>
      {children}
      {desktop ? null : <SheetHost progress={progress} />}
    </SheetProgressContext.Provider>
  );
};

/** Só a web arrasta pela API de ponteiros; no nativo o arrasto é o valor partilhado. */
export const useSheetDrag = (): WebSheetDrag | null => null;
export const subscribeSheetProgress = (_cb: (p: number) => void): (() => void) => () => {};
