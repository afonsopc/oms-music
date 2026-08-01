/**
 * Draggable track used by the Now Playing scrub bar and the volume row (no
 * slider package is installed; PanResponder is core RN).
 *
 * The value is a 0..1 fraction. While dragging, the parent must render the
 * DRAG value, not the store value, so the thumb does not fight the 4 Hz
 * position ticks: `onSlide` reports every move, `onCommit` fires once on
 * release (the seek/volume write). A tap anywhere on the track commits that
 * position directly.
 */
import React, { useEffect, useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
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
  // eslint-disable-next-line react-hooks/refs
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => !handlersRef.current.disabled,
    onMoveShouldSetPanResponder: () => !handlersRef.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      const { pageX, locationX } = event.nativeEvent;
      originRef.current = pageX - locationX;
      const next = clamp01(locationX / Math.max(1, widthRef.current));
      dragRef.current = next;
      setDragValue(next);
      handlersRef.current.onSlide?.(next);
    },
    onPanResponderMove: (event) => {
      const next = clamp01(
        (event.nativeEvent.pageX - originRef.current) / Math.max(1, widthRef.current),
      );
      dragRef.current = next;
      setDragValue(next);
      handlersRef.current.onSlide?.(next);
    },
    onPanResponderRelease: () => {
      const next = dragRef.current;
      dragRef.current = null;
      setDragValue(null);
      if (next != null) handlersRef.current.onCommit(next);
    },
    onPanResponderTerminate: () => {
      dragRef.current = null;
      setDragValue(null);
    },
  });

  const shown = clamp01(dragValue ?? value);
  const fill = fillColor ?? tokens.primary;

  return (
    <View
      {...responder.panHandlers}
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
  );
};
