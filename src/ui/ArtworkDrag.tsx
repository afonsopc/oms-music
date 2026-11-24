/**
 * Hold the cover, then drag the row (SongTable reorder). A pan that only
 * activates after a still hold: move the finger sooner and it fails, so
 * the list scrolls as usual; a quick tap falls through to the row and
 * plays the song. Once active it cancels the row's press (no menu, no play).
 */
import React from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import type { RowDragDriver } from "./rowDrag";

/** Shorter than the row's long-press menu (380 ms), so the drag wins. */
const HOLD_MS = 260;

export interface ArtworkDragProps {
  index: number;
  children: React.ReactElement;
  onStart: (index: number) => void;
  onMove: (dy: number) => void;
  onEnd: (index: number, dy: number) => void;
  /** Where the finger is, written on the UI thread (rowDrag.tsx). */
  driver: RowDragDriver;
  /** A grip: no hold, the first move already drags. */
  immediate?: boolean;
}

export const ArtworkDrag = ({ index, children, onStart, onMove, onEnd, driver, immediate = false }: ArtworkDragProps) => {
  const active = useSharedValue(false);
  const { dy } = driver;
  const begin = (at: number): void => {
    haptics.press();
    onStart(at);
  };
  const base = immediate ? Gesture.Pan().minDistance(1) : Gesture.Pan().activateAfterLongPress(HOLD_MS);
  const pan = base
    .onStart(() => {
      active.value = true;
      runOnJS(begin)(index);
    })
    .onUpdate((event) => {
      if (!active.value) return;
      dy.set(event.translationY);
      // Only the auto-scroll at the edges needs it there.
      runOnJS(onMove)(event.translationY);
    })
    // Ended or cancelled, the row lands where the finger left it; a hold
    // that never activated never started anything.
    .onFinalize((event) => {
      if (!active.value) return;
      active.value = false;
      runOnJS(onEnd)(index, event.translationY);
    });
  return (
    <GestureDetector gesture={pan}>
      {children}
    </GestureDetector>
  );
};
