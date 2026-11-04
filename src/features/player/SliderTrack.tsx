/**
 * O desenho da barra (trilho, enchimento, botão) e o contrato do Slider,
 * partilhados pelo Slider nativo (gesture-handler) e pelo da web
 * (Slider.web.tsx, pointer events).
 */
import React from "react";
import { View } from "react-native";

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

export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export const SliderTrack = ({
  shown,
  height,
  fill,
  trackColor,
  thumbSize,
}: {
  shown: number;
  height: number;
  fill: string;
  trackColor: string;
  thumbSize: number;
}) => (
  <View
    style={{
      height,
      borderRadius: height / 2,
      backgroundColor: trackColor,
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
);
