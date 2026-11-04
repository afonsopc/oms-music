/**
 * Na web o mini-leitor arrasta para cima com o dedo (ronda 2): o ponteiro
 * mexe na folha do leitor directamente (useSheetDrag), sem gesture-handler
 * nem Reanimated no bundle. A pílula desvanece com a subida da folha, pelo
 * estilo do elemento e não por estado React. Rato e teclado continuam a
 * chegar aos botões.
 */
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { subscribeSheetProgress, useSheetDrag } from "@/features/player/sheet/PlayerSheet";
import type { MiniSwipe } from "./miniSwipeMath";

export interface MiniPlayerSwipeProps {
  onSwipe: (swipe: Exclude<MiniSwipe, null>) => void;
  children: React.ReactNode;
}

type Pointer = { clientX: number; clientY: number; timeStamp: number; pointerType?: string; pointerId?: number; currentTarget?: unknown };

/** Px na vertical antes de um toque passar a arrasto. */
const SLOP = 10;

export const MiniPlayerSwipe = ({ children }: MiniPlayerSwipeProps) => {
  const drag = useSheetDrag();
  const ref = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number; t: number; active: boolean } | null>(null);

  useEffect(
    () =>
      subscribeSheetProgress((p) => {
        const node = ref.current;
        if (!node) return;
        node.style.opacity = String(Math.max(0, 1 - p / 0.35));
        node.style.transform = `translate3d(0, ${-p * 40}px, 0)`;
      }),
    [],
  );

  if (!drag) return <>{children}</>;
  const handlers = {
    onPointerDown: (e: Pointer) => {
      if (e.pointerType === "mouse") return;
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, active: false };
    },
    onPointerMove: (e: Pointer) => {
      const s = start.current;
      if (!s) return;
      const dy = e.clientY - s.y;
      if (!s.active) {
        if (dy < -SLOP && Math.abs(dy) > Math.abs(e.clientX - s.x)) {
          s.active = true;
          const el = e.currentTarget as { setPointerCapture?: (id: number) => void } | undefined;
          if (e.pointerId != null) el?.setPointerCapture?.(e.pointerId);
          drag.begin();
        } else return;
      }
      drag.move(dy);
    },
    onPointerUp: (e: Pointer) => {
      const s = start.current;
      start.current = null;
      if (!s?.active) return;
      drag.end(((e.clientY - s.y) / Math.max(1, e.timeStamp - s.t)) * 1000);
    },
    onPointerCancel: () => {
      const s = start.current;
      start.current = null;
      if (s?.active) drag.end(0);
    },
  };
  return (
    <View ref={ref as never} {...(handlers as object)} style={{ touchAction: "pan-x" } as object}>
      {children}
    </View>
  );
};
