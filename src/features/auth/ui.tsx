/**
 * Shared building blocks for the auth screens (login/signup/reset): themed
 * screen scaffold, fields, buttons and API-error -> message mapping.
 */
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isApiError } from "@/domain/api";
import { useTheme } from "@/theme/provider";
import { useT } from "@/i18n";

export const AuthScreen = ({ children }: { children: React.ReactNode }) => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: tokens.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export const AuthTitle = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text
      style={{
        color: tokens.foreground,
        fontSize: 30,
        fontWeight: "900",
        letterSpacing: -0.5,
        marginBottom: 6,
      }}
    >
      {text}
    </Text>
  );
};

export const AuthInfo = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text style={{ color: tokens.mutedForeground, fontSize: 14, marginBottom: 18 }}>{text}</Text>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: React.ComponentProps<typeof TextInput>["autoComplete"];
  maxLength?: number;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}

export const AuthField = ({
  label,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  autoComplete,
  maxLength,
  autoFocus,
  onSubmitEditing,
}: FieldProps) => {
  const { tokens } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 12,
          fontWeight: "600",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        placeholderTextColor={tokens.mutedForeground}
        style={{
          backgroundColor: tokens.secondary,
          color: tokens.foreground,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: tokens.border,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
        }}
      />
    </View>
  );
};

export const AuthButton = ({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) => {
  const { tokens } = useTheme();
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={{
        backgroundColor: tokens.primary,
        opacity: inactive ? 0.55 : 1,
        borderRadius: 999,
        paddingVertical: 14,
        alignItems: "center",
        marginTop: 6,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tokens.primaryForeground} />
      ) : (
        <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "700" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};

export const AuthLink = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
};

export const AuthLinkRow = ({
  hint,
  label,
  onPress,
}: {
  hint?: string;
  label: string;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        gap: 6,
        marginTop: 18,
        flexWrap: "wrap",
      }}
    >
      {hint ? <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{hint}</Text> : null}
      <AuthLink label={label} onPress={onPress} />
    </View>
  );
};

export const AuthError = ({ message }: { message: string | null }) => {
  const { tokens } = useTheme();
  if (!message) return null;
  return (
    <Text style={{ color: tokens.destructive, fontSize: 14, marginBottom: 12 }}>{message}</Text>
  );
};

/**
 * Generic ApiError -> user message. Screens override specific statuses (401
 * login, 409 signup start, 404 create_end) before falling back to this.
 */
export const useApiErrorMessage = (): ((error: unknown) => string) => {
  const t = useT();
  return (error: unknown): string => {
    if (isApiError(error)) {
      if (error.status === 429) {
        return t("native.common.rateLimited", { seconds: error.retryAfter ?? 60 });
      }
      if (typeof error.body === "string" && error.body.length > 0 && error.body.length < 200) {
        return error.body;
      }
      if (error.status === 0) return t("native.common.offline");
      return t("native.common.unknownError");
    }
    return t("native.common.unknownError");
  };
};
