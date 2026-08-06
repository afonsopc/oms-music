/**
 * Small shared primitives for the settings and import screens (WP11):
 * section cards, navigation/switch rows, labelled text fields, inline
 * notices, tabs, chips, progress bars and the defensive ApiError-to-copy
 * mapping (bare-string bodies render verbatim, FR-5).
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { isApiError } from "@/domain/api";
import { useT } from "@/i18n";
import { switchColors } from "@/theme/switchColors";
import { useTheme } from "@/theme/provider";
import { statusInkFor } from "@/theme/scheme";
import { RADIUS } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui";

export const useApiErrorMessage = (): ((error: unknown) => string) => {
  const t = useT();
  return (error: unknown): string => {
    if (isApiError(error)) {
      if (error.status === 429) {
        return t("native.common.rateLimited", { seconds: error.retryAfter ?? 60 });
      }
      if (typeof error.body === "string" && error.body.length > 0 && error.body.length < 300) {
        return error.body;
      }
      if (error.status === 0) return t("native.common.offline");
    }
    return t("native.common.unknownError");
  };
};

export const SettingsSection = ({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={[{ gap: 8 }, style]}>
      {title ? (
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1,
            paddingHorizontal: 4,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderWidth: 1,
          borderColor: tokens.border,
          borderRadius: RADIUS * 2,
          backgroundColor: tokens.card,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
};

export const SettingsRow = ({
  icon,
  label,
  detail,
  onPress,
  disabled = false,
  destructive = false,
  trailing,
  first = false,
}: {
  icon?: IconName;
  label: string;
  detail?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  trailing?: React.ReactNode;
  first?: boolean;
}) => {
  const { tokens, ink } = useTheme();
  const color = destructive ? ink.destructive : tokens.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={20} color={destructive ? ink.destructive : tokens.mutedForeground} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color, fontSize: 15, fontWeight: "600" }}>{label}</Text>
        {detail ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 17 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-right" size={18} color={tokens.mutedForeground} /> : null)}
    </Pressable>
  );
};

export const SwitchRow = ({
  label,
  detail,
  value,
  onValueChange,
  disabled = false,
  first = false,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  first?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <SettingsRow
      label={label}
      detail={detail}
      first={first}
      trailing={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          {...switchColors(tokens)}
        />
      }
    />
  );
};

export const LabeledField = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = "sentences",
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.mutedForeground}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: tokens.input,
          borderRadius: RADIUS,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: tokens.foreground,
          fontSize: 15,
          backgroundColor: tokens.background,
        }}
      />
    </View>
  );
};

export const NoticeBanner = ({
  kind,
  message,
  style,
}: {
  kind: "error" | "success" | "info";
  message: string;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens, ink } = useTheme();
  const color =
    kind === "error" ? ink.destructive : kind === "success" ? tokens.primary : tokens.mutedForeground;
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: tokens.border,
          borderRadius: RADIUS,
          padding: 12,
          backgroundColor: tokens.card,
        },
        style,
      ]}
    >
      <Icon
        name={kind === "error" ? "alert-circle" : kind === "success" ? "circle-check" : "clock"}
        size={16}
        color={color}
      />
      <Text style={{ color, fontSize: 13, flex: 1, lineHeight: 18 }}>{message}</Text>
    </View>
  );
};

export const InlineSpinnerRow = ({ label }: { label: string }) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 }}>
      <ActivityIndicator color={tokens.mutedForeground} />
      <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{label}</Text>
    </View>
  );
};

export const PrimaryButton = ({
  label,
  onPress,
  disabled = false,
  busy = false,
  destructive = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
  compact?: boolean;
}) => {
  const { tokens } = useTheme();
  const background = destructive ? tokens.destructive : tokens.primary;
  const foreground = destructive ? tokens.destructiveForeground : tokens.primaryForeground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: 999,
        paddingHorizontal: compact ? 14 : 20,
        paddingVertical: compact ? 8 : 12,
        backgroundColor: background,
        opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={foreground} /> : null}
      <Text style={{ color: foreground, fontWeight: "700", fontSize: compact ? 13 : 15 }}>
        {label}
      </Text>
    </Pressable>
  );
};

/** Debounced mirror of a value (search boxes: 300 ms, web parity). */
export const useDebounced = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
};

/** Compact single-line filter/search box. */
export const SearchField = ({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = "none",
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: tokens.input,
          borderRadius: 999,
          paddingHorizontal: 12,
          height: 40,
          backgroundColor: tokens.card,
        },
        style,
      ]}
    >
      <Icon name="search" size={15} color={tokens.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.mutedForeground}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{ flex: 1, color: tokens.foreground, fontSize: 14, paddingVertical: 0 }}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button">
          <Icon name="x" size={14} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
};

/** Toggleable capsule used by the multi-select filters and album grids. */
export const ToggleChip = ({
  label,
  active,
  onPress,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? tokens.primary : tokens.border,
        backgroundColor: active ? tokens.primary : "transparent",
        paddingHorizontal: 12,
        paddingVertical: 6,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: active ? tokens.primaryForeground : tokens.foreground,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/** Horizontal tab strip (import screen tabs). */
export const TabStrip = <T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 4 }}
  >
    {tabs.map((tab) => (
      <ToggleChip
        key={tab.id}
        label={tab.label}
        active={tab.id === value}
        onPress={() => onChange(tab.id)}
      />
    ))}
  </ScrollView>
);

/** Determinate bar; `kind` recolors failures (import/sync progress rows). */
export const ProgressBar = ({
  value,
  kind = "normal",
}: {
  /** 0..1; values outside the range are clamped. */
  value: number;
  kind?: "normal" | "failed" | "done";
}) => {
  const { tokens, scheme } = useTheme();
  // The track is `muted`, not the page: the page ink for `destructive`
  // reaches only 2.85:1 on the dark muted fill.
  const ink = statusInkFor(scheme, "muted");
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const color =
    kind === "failed" ? ink.destructive : kind === "done" ? ink.sync : tokens.primary;
  return (
    <View
      style={{
        height: 4,
        borderRadius: 999,
        backgroundColor: tokens.muted,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${clamped * 100}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
};

export const GhostButton = ({
  label,
  onPress,
  disabled = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tokens.border,
        paddingHorizontal: compact ? 14 : 20,
        paddingVertical: compact ? 8 : 12,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: tokens.foreground, fontWeight: "600", fontSize: compact ? 13 : 15 }}>
        {label}
      </Text>
    </Pressable>
  );
};
