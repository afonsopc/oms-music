/**
 * O Slider na web: pointer events em vez do gesture-handler (que não vai
 * para o bundle web). Arrastar com captura do ponteiro, um toque salta para
 * o sítio, e as setas do teclado andam 5 % (Shift: 1 %).
 */
import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/provider";
import { clamp01, SliderTrack, type SliderProps } from "./SliderTrack";

export type { SliderProps } from "./SliderTrack";

type DomPointer = {
  clientX: number;
  pointerId: number;
  currentTarget: HTMLElement;
  preventDefault(): void;
};

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
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = useRef(false);

  const at = (e: DomPointer): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return clamp01((e.clientX - rect.left) / Math.max(1, rect.width));
  };

  const shown = clamp01(dragValue ?? value);
  const fill = fillColor ?? tokens.primary;

  const dom = disabled
    ? {}
    : {
        onPointerDown: (e: DomPointer) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const next = at(e);
          setDragValue(next);
          onSlide?.(next);
        },
        onPointerMove: (e: DomPointer) => {
          if (!dragging.current) return;
          const next = at(e);
          setDragValue(next);
          onSlide?.(next);
        },
        onPointerUp: (e: DomPointer) => {
          if (!dragging.current) return;
          dragging.current = false;
          const next = at(e);
          setDragValue(null);
          onCommit(next);
        },
        onPointerCancel: () => {
          dragging.current = false;
          setDragValue(null);
        },
        onKeyDown: (e: { key: string; shiftKey: boolean; preventDefault(): void }) => {
          const step = e.shiftKey ? 0.01 : 0.05;
          const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
          if (!delta) return;
          e.preventDefault();
          const next = clamp01(value + delta);
          onSlide?.(next);
          onCommit(next);
        },
      };

  return (
    <View
      {...(dom as object)}
      focusable={!disabled}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      style={
        {
          height: 32,
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "default" : "pointer",
          touchAction: "none",
        } as object
      }
    >
      <SliderTrack
        shown={shown}
        height={height}
        fill={fill}
        trackColor={trackColor ?? tokens.muted}
        thumbSize={thumbSize}
      />
    </View>
  );
};
