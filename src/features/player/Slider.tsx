/**
 * Draggable track used by the Now Playing scrub bar, the EQ rows and the
 * volume row (no slider package is installed).
 *
 * The value is a 0..1 fraction. While dragging, the parent must render the
 * DRAG value, not the store value, so the thumb does not fight the 4 Hz
 * position ticks: `onSlide` reports every move, `onCommit` fires once on
 * release (the seek/volume write).
 *
 * The gesture is directional, which PanResponder could not express: it claimed
 * either on touch-down or not at all. Claiming on touch-down meant a sheet full
 * of sliders could not be scrolled anywhere a slider sat, and a finger resting
 * near the left edge of an EQ row wrote the minimum (that is how all three
 * bands silently became -12 dB). Declining meant the parent scroll view won
 * every touch and the thumbs never moved. activeOffsetX/failOffsetY route each
 * gesture to whichever it actually is, and a tap keeps working because a tap is
 * never a scroll.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTheme } from "@/theme/provider";

export interface SliderProps {
  value: number;
  onSlide?: (value: number) => void;
  onCommit: (value: number) => void;
  /** Track thickness; the touch target is padded to 32 regardless. */
  height?: number;
  fillColor?: string;
  trackColor?: string;
  thumbSize?: number;
  disabled?: boolean;
  accessibilityLabel: string;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Horizontal travel before the track steals the gesture from a scroll view. */
const DRAG_SLOP = 6;

export const Slider = ({
  value,
  onSlide,
  onCommit,
  height = 4,
  fillColor,
  trackColor,
  thumbSize = 12,
  disabled = false,
  accessibilityLabel,
}: SliderProps) => {
  const { tokens } = useTheme();
  const widthRef = useRef(0);
  // Page-x of the track's left edge, captured on grant (pageX - locationX).
  const originRef = useRef(0);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  // The responder is created ONCE: rebuilding it mid-gesture (inline
  // callbacks change identity on every render) would renegotiate the touch,
  // so the live callbacks and the gesture geometry are read from refs.
  const handlersRef = useRef({ onSlide, onCommit, disabled });
  useEffect(() => {
    handlersRef.current = { onSlide, onCommit, disabled };
  }, [onSlide, onCommit, disabled]);

  // Gesture callbacks run on touch events, never during render, and every
  // value they read lives in a ref, so the compiler keeps this stable for
  // the whole gesture.
  //
  // gesture-handler rather than PanResponder because only it can express "this
  // is mine once the finger moves sideways, otherwise let the scroll view
  // have it". With PanResponder the choice was all or nothing: claim on
  // touch-down and the sheet could not be scrolled anywhere a slider sat, or
  // decline and the parent scroll view won the touch first and the thumb
  // never moved at all. activeOffsetX/failOffsetY hand each gesture to
  // whichever of the two it actually is.
  /* eslint-disable react-hooks/refs -- the builders below only CLOSE OVER the
     refs; every `.current` read happens later, inside a touch callback, never
     while rendering. */
  const pan = Gesture.Pan()
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-DRAG_SLOP * 2, DRAG_SLOP * 2])
    .enabled(!disabled)
    .onBegin((event) => {
      originRef.current = event.absoluteX - event.x;
    })
    .onUpdate((event) => {
      const next = clamp01((event.absoluteX - originRef.current) / Math.max(1, widthRef.current));
      dragRef.current = next;
      setDragValue(next);
      handlersRef.current.onSlide?.(next);
    })
    .onEnd(() => {
      const next = dragRef.current;
      dragRef.current = null;
      setDragValue(null);
      if (next != null) handlersRef.current.onCommit(next);
    })
    .onFinalize(() => {
      dragRef.current = null;
      setDragValue(null);
    })
    .runOnJS(true);

  // A plain tap still jumps the value: it cannot be confused with a scroll,
  // so there is no reason to make the user drag for it.
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onEnd((event) => {
      const next = clamp01(event.x / Math.max(1, widthRef.current));
      handlersRef.current.onSlide?.(next);
      handlersRef.current.onCommit(next);
    })
    .runOnJS(true);

  const gesture = Gesture.Exclusive(pan, tap);
  /* eslint-enable react-hooks/refs */

  const shown = clamp01(dragValue ?? value);
  const fill = fillColor ?? tokens.primary;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
        onLayout={(event: LayoutChangeEvent) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        style={{ height: 32, justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
      >
      <View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor ?? tokens.muted,
          overflow: "visible",
        }}
      >
        <View
          style={{
            width: `${shown * 100}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: fill,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${shown * 100}%`,
            top: height / 2 - thumbSize / 2,
            width: thumbSize,
            height: thumbSize,
            marginLeft: -thumbSize / 2,
            borderRadius: thumbSize / 2,
            backgroundColor: fill,
          }}
        />
        </View>
      </View>
    </GestureDetector>
  );
};
