/**
 * A folha do leitor na web do telemóvel (ronda 2): o mesmo desenho do par
 * nativo, sem Reanimated nem gesture-handler no bundle. O dedo mexe no
 * `transform` do elemento DIRECTAMENTE (nada de estado React por movimento);
 * ao largar, uma transição CSS na GPU leva ao destino. Esc fecha.
 */
import React, { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerChrome } from "@/features/player";
import { ImmersiveBackdrop } from "@/features/player/immersive";
import { usePlayerModeStore } from "@/features/player/mode";
import { PlayerHandle, PlayerStage } from "@/features/shell/PlayerStage";
import { usePlaybackView } from "@/remote/mirror";
import { useTheme } from "@/theme/provider";
import { useDesktopShell } from "@/ui/shellLayout";
import { InSheetContext } from "./liveSurface";
import { clampProgress, sheetSnapTarget } from "./sheetMath";
import { mountPlayerSheet, registerSheetController, setPlayerSheetOpen, useSheetStore, type WebSheetDrag } from "./sheetStore";

const SheetDragContext = createContext<WebSheetDrag | null>(null);
export const useSheetDrag = (): WebSheetDrag | null => useContext(SheetDragContext);

/** O progresso para quem quer seguir a folha (o mini-leitor desvanece). */
const listeners = new Set<(p: number) => void>();
export const subscribeSheetProgress = (cb: (p: number) => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const EASE = "cubic-bezier(0.2, 0.85, 0.25, 1)";
const DURATION = 340;
const PREWARM_MS = 900;

type Pointer = { clientY: number; timeStamp: number; pointerId?: number; currentTarget?: unknown };

const SheetBody = memo(function SheetBody({ drag }: { drag: WebSheetDrag }) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const song = usePlaybackView((v) => v.song);
  const mode = usePlayerModeStore((s) => s.mode);
  const start = useRef<{ y: number; t: number; lastY: number; lastT: number } | null>(null);

  /* eslint-disable react-hooks/refs -- os handlers só fecham sobre o ref. */
  const handlers = (enabled: boolean) =>
    enabled
      ? {
          onPointerDown: (e: Pointer) => {
            start.current = { y: e.clientY, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp };
            const el = e.currentTarget as { setPointerCapture?: (id: number) => void } | undefined;
            if (e.pointerId != null) el?.setPointerCapture?.(e.pointerId);
            drag.begin();
          },
          onPointerMove: (e: Pointer) => {
            const s = start.current;
            if (!s) return;
            s.lastY = e.clientY;
            s.lastT = e.timeStamp;
            drag.move(Math.max(0, e.clientY - s.y));
          },
          onPointerUp: (e: Pointer) => {
            const s = start.current;
            start.current = null;
            if (!s) return;
            const ms = Math.max(1, e.timeStamp - s.t);
            drag.end(((e.clientY - s.y) / ms) * 1000);
          },
          onPointerCancel: () => {
            start.current = null;
            drag.end(0);
          },
        }
      : {};
  /* eslint-enable react-hooks/refs */

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ImmersiveBackdrop song={song} dense={mode !== "artwork"} />
      <View style={{ flex: 1, width: "100%", maxWidth: 640, alignSelf: "center", paddingBottom: Math.max(insets.bottom, 12) }}>
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
    </View>
  );
});

const SheetHost = ({ drag, register }: { drag: WebSheetDrag; register: (el: HTMLElement | null) => void }) => {
  const mounted = useSheetStore((s) => s.mounted);
  const open = useSheetStore((s) => s.open);
  return (
    <View
      ref={register as never}
      pointerEvents={open ? "auto" : "none"}
      style={[
        StyleSheet.absoluteFill,
        // Sempre "visível", só fora do ecrã: esconder com visibility obrigava o
        // browser a pintar a árvore toda no primeiro frame da abertura.
        { zIndex: 100, transform: [{ translateY: "100%" as unknown as number }], willChange: "transform", contain: "layout paint" } as object,
      ]}
    >
      {mounted ? (
        <InSheetContext.Provider value>
          <SheetBody drag={drag} />
        </InSheetContext.Provider>
      ) : null}
    </View>
  );
};

export const PlayerSheetProvider = ({ children }: { children: React.ReactNode }) => {
  const desktop = useDesktopShell();
  const el = useRef<HTMLElement | null>(null);
  const progress = useRef(0);
  const dragStart = useRef(0);
  const hasSong = usePlaybackView((v) => v.song != null);
  const mounted = useSheetStore((s) => s.mounted);
  const open = useSheetStore((s) => s.open);

  const apply = useCallback((p: number, animate: boolean) => {
    progress.current = p;
    const node = el.current;
    if (node) {
      node.style.transition = animate ? `transform ${DURATION}ms ${EASE}` : "none";
      node.style.transform = `translate3d(0, ${(1 - p) * 100}%, 0)`;
    }
    listeners.forEach((cb) => cb(p));
  }, []);

  const settle = useCallback(
    (target: 0 | 1) => {
      // Primeiro o movimento, depois o React (o corpo é memo: só a casca redesenha).
      apply(target, true);
      if (target === 1) setPlayerSheetOpen(true);
      if (target === 0) {
        window.setTimeout(() => {
          if (progress.current === 0) setPlayerSheetOpen(false);
        }, DURATION + 30);
      }
    },
    [apply],
  );

  const drag = useMemo<WebSheetDrag>(
    () => ({
      begin: () => {
        mountPlayerSheet();
        dragStart.current = progress.current;
      },
      move: (dy) => apply(clampProgress(dragStart.current - dy / Math.max(1, window.innerHeight)), false),
      end: (vy) => settle(sheetSnapTarget(progress.current, vy)),
    }),
    [apply, settle],
  );

  useEffect(() => {
    if (desktop) return;
    return registerSheetController({
      open: () => {
        if (useSheetStore.getState().mounted) {
          settle(1);
          return;
        }
        mountPlayerSheet();
        // Ainda sem corpo (abrir antes do pré-aquecimento): um frame para ele existir.
        requestAnimationFrame(() => settle(1));
      },
      close: () => settle(0),
    });
  }, [desktop, settle]);

  useEffect(() => {
    if (desktop || !hasSong || mounted) return;
    const id = window.setTimeout(mountPlayerSheet, PREWARM_MS);
    return () => window.clearTimeout(id);
  }, [desktop, hasSong, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settle]);

  return (
    <SheetDragContext.Provider value={desktop ? null : drag}>
      {children}
      {desktop ? null : <SheetHost drag={drag} register={(node) => (el.current = node)} />}
    </SheetDragContext.Provider>
  );
};

/** Na web não há valor partilhado do Reanimated: quem segue usa subscribeSheetProgress. */
export const useSheetProgress = (): null => null;
