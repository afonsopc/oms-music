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
  active = false,
}: {
  shown: number;
  height: number;
  fill: string;
  trackColor: string;
  thumbSize: number;
  /** A arrastar: a barra engrossa (ronda 2), para o dedo saber que a agarrou. */
  active?: boolean;
}) => {
  const h = active ? Math.round(height * 1.8) : height;
  const thumb = active && thumbSize > 0 ? Math.round(thumbSize * 1.4) : thumbSize;
  return (
  <View
    style={{
      height: h,
      borderRadius: h / 2,
      backgroundColor: trackColor,
      overflow: "visible",
    }}
  >
    <View
      style={{
        width: `${shown * 100}%`,
        height: h,
        borderRadius: h / 2,
        backgroundColor: fill,
      }}
    />
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: `${shown * 100}%`,
        top: h / 2 - thumb / 2,
        width: thumb,
        height: thumb,
        marginLeft: -thumb / 2,
        borderRadius: thumb / 2,
        backgroundColor: fill,
      }}
    />
  </View>
);
};
