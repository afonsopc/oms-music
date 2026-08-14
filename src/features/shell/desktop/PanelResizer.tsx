/**
 * Right-panel divider (plano-uma-so-app 4.1): the 8px bar with
 * `cursor: col-resize` that lives INSIDE the grid gap to the panel's left,
 * implemented over a real `<input type=range>` so it is operable by keyboard
 * - Tab reaches it, arrow keys resize, no pointer required. The pointer path
 * bypasses the input entirely (an 8px-wide native range would map a click
 * anywhere on it to a wild value jump), so the input keeps
 * `pointer-events: none` and the wrapper owns the drag.
 *
 * The bar paints a centre line while hovered, dragged or focused; the rest
 * of the time it is invisible gap, exactly like every other divider the plan
 * describes.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React, { useRef, useState } from "react";
import { useTheme } from "@/theme/provider";

export interface PanelResizerProps {
  /** Current panel width in px (the value the divider edits). */
  width: number;
  min: number;
  max: number;
  /** The grid gap the bar occupies (it sits at `left: -gap`). */
  gap: number;
  label: string;
  /** Live updates while dragging or on arrow keys. */
  onResize: (width: number) => void;
  /** The settled value - the one worth persisting. */
  onCommit: (width: number) => void;
}

export const PanelResizer = ({
  width,
  min,
  max,
  gap,
  label,
  onResize,
  onCommit,
}: PanelResizerProps) => {
  const { tokens } = useTheme();
  const [hot, setHot] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The drag math needs the width AT POINTER-DOWN; state alone would make
  // every move relative to the previous move and drift on coalesced events.
  // `lastSent` remembers what the moves reported so the commit on release
  // settles on exactly that value (both refs are touched in handlers only).
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastSentRef = useRef<number | null>(null);

  const clamp = (value: number): number => Math.max(min, Math.min(Math.round(value), max));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    // The panel is on the RIGHT: moving the pointer left grows it.
    const next = clamp(drag.startWidth + (drag.startX - event.clientX));
    lastSentRef.current = next;
    onResize(next);
  };

  const endDrag = (): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    onCommit(lastSentRef.current ?? width);
    lastSentRef.current = null;
  };

  return (
    <div
      style={{
        position: "absolute",
        left: -gap,
        top: 0,
        bottom: 0,
        width: gap,
        cursor: "col-resize",
        touchAction: "none",
        display: "flex",
        justifyContent: "center",
        // Above the panel card so the whole gap is grabbable.
        zIndex: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
    >
      <div
        style={{
          width: 2,
          borderRadius: 1,
          backgroundColor: hot || dragging ? tokens.mutedForeground : "transparent",
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={16}
        value={width}
        aria-label={label}
        onChange={(event) => {
          const next = clamp(Number(event.currentTarget.value));
          onResize(next);
          onCommit(next);
        }}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          margin: 0,
          opacity: 0,
          // Mouse goes to the wrapper; the input is the keyboard surface.
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
