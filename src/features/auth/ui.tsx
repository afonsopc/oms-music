/**
 * Shared building blocks for the auth screen: themed scaffold, title, info
 * text, button and error line.
 */
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/provider";

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

export const AuthError = ({ message }: { message: string | null }) => {
  const { ink } = useTheme();
  if (!message) return null;
  return (
    <Text style={{ color: ink.destructive, fontSize: 14, marginBottom: 12 }}>{message}</Text>
  );
};
