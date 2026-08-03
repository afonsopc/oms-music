/**
 * Shared primitives for the Now Playing cog sheet: chips, section headers with
 * an optional trailing control, the thin progress bar and a labelled 0..1
 * slider row.
 *
 * Split out of settingsSheet.tsx so the separation disclosure and the
 * equalizer (features/player/separationSection.tsx) share ONE definition of
 * each instead of growing a second look-alike.
 *
 * `SliderRow` reports on every move AND on release: the blend gains and the
 * EQ bands are live parameter writes on the mixer (web parity - the Web Audio
 * graph writes AudioParams without restarting anything), so dragging has to be
 * audible while the finger is still down. The <Slider/> renders its own drag
 * value, so the store write it triggers can never fight the thumb.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme/provider";
import { Slider } from "./Slider";

export const Chip = ({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: selected ? tokens.primary : tokens.secondary,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: selected ? tokens.primaryForeground : tokens.secondaryForeground,
          fontSize: 13,
          fontWeight: selected ? "700" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const Section = ({
  title,
  trailing,
  children,
}: {
  title: string;
  /** Rendered on the header row (the separation and equalizer switches). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {title}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
};

/** Muted explanatory line; `tone="error"` for the failure copy. */
export const NoteLine = ({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "error";
}) => {
  const { tokens } = useTheme();
  return (
    <Text
      style={{
        color: tone === "error" ? tokens.destructive : tokens.mutedForeground,
        fontSize: 12,
        lineHeight: 17,
        marginTop: 8,
      }}
    >
      {text}
    </Text>
  );
};

export const ProgressBar = ({ fraction }: { fraction: number }) => {
  const { tokens } = useTheme();
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return (
    <View
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: tokens.muted,
        marginTop: 8,
        overflow: "hidden",
      }}
    >
      <View
        style={{ width: `${clamped * 100}%`, height: 4, backgroundColor: tokens.primary }}
      />
    </View>
  );
};

export const SliderRow = ({
  label,
  valueLabel,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  /** Right-aligned readout ("0.75", "+3.0 dB"). */
  valueLabel: string;
  /** 0..1 track fraction; the caller maps and quantizes its own unit. */
  value: number;
  onChange: (fraction: number) => void;
  disabled?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: tokens.foreground, fontSize: 12, flex: 1 }}>{label}</Text>
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
        >
          {valueLabel}
        </Text>
      </View>
      <Slider
        value={value}
        accessibilityLabel={label}
        disabled={disabled}
        height={3}
        thumbSize={10}
        onSlide={onChange}
        onCommit={onChange}
      />
    </View>
  );
};
