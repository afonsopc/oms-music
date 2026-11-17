/**
 * Hold the cover, then drag the row (SongTable reorder). A pan that only
 * activates after a still hold: move the finger sooner and it fails, so
 * the list scrolls as usual; a quick tap falls through to the row and
 * plays the song. Once active it cancels the row's press (no menu, no play).
 */
import React, { useRef } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { haptics } from "@/lib/haptics";

/** Shorter than the row's long-press menu (380 ms), so the drag wins. */
const HOLD_MS = 260;

export interface ArtworkDragProps {
  index: number;
  children: React.ReactElement;
  onStart: (index: number) => void;
  onMove: (dy: number) => void;
  onEnd: (index: number, dy: number) => void;
}

export const ArtworkDrag = ({ index, children, onStart, onMove, onEnd }: ArtworkDragProps) => {
  const active = useRef(false);
  /* eslint-disable react-hooks/refs -- the callbacks only CLOSE OVER the ref;
     every `.current` read happens inside a gesture callback, not in render. */
  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      active.current = true;
      haptics.press();
      onStart(index);
    })
    .onUpdate((event) => {
      if (active.current) onMove(event.translationY);
    })
    // Ended or cancelled, the row lands where the finger left it; a hold
    // that never activated never started anything.
    .onFinalize((event) => {
      if (!active.current) return;
      active.current = false;
      onEnd(index, event.translationY);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */
  return (
    <GestureDetector gesture={pan}>
      {children}
    </GestureDetector>
  );
};
