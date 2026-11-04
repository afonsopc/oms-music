/**
 * Shared building blocks for the auth screen (redesenho 2026-11-04): um
 * título grande, uma linha, e o botão em baixo, ao alcance do polegar. Sem
 * cartões, sem gradientes, sem mais nada.
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/provider";
import { Reveal } from "@/ui/motion";
import { useGutter } from "@/ui/page";

/** Largura máxima do bloco no computador (o telemóvel usa a largura toda). */
const MAX_WIDTH = 420;
/** Acima disto o botão vem logo por baixo do texto, não no fundo do ecrã. */
const WIDE = 700;

/**
 * `children` vai para cima (título e texto, centrados na altura); `footer`
 * fica colado ao fundo (o botão).
 */
export const AuthScreen = ({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  const wide = useWindowDimensions().width >= WIDE;
  if (wide) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.background,
          paddingHorizontal: gutter,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: MAX_WIDTH, gap: 32 }}>
          <Reveal>{children}</Reveal>
          {footer ? <Reveal order={2}>{footer}</Reveal> : null}
        </View>
      </View>
    );
  }
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.background,
        paddingHorizontal: gutter,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        alignItems: "center",
      }}
    >
      <View style={{ flex: 1, width: "100%", maxWidth: MAX_WIDTH, justifyContent: "center" }}>
        <Reveal>{children}</Reveal>
      </View>
      {footer ? (
        <Reveal order={2} style={{ width: "100%", maxWidth: MAX_WIDTH }}>
          {footer}
        </Reveal>
      ) : null}
    </View>
  );
};

export const AuthTitle = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: tokens.foreground,
        fontSize: 48,
        lineHeight: 52,
        fontWeight: "800",
        letterSpacing: -1.6,
        marginBottom: 12,
      }}
    >
      {text}
    </Text>
  );
};

export const AuthInfo = ({ text }: { text: string }) => {
  const { tokens } = useTheme();
  return (
    <Text style={{ color: tokens.mutedForeground, fontSize: 17, lineHeight: 23 }}>{text}</Text>
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
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy, disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        backgroundColor: tokens.primary,
        opacity: inactive ? 0.6 : 1,
        borderRadius: 999,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tokens.primaryForeground} />
      ) : (
        <Text style={{ color: tokens.primaryForeground, fontSize: 17, fontWeight: "700" }}>
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
    <Reveal distance={6} duration={220}>
      <Text style={{ color: ink.destructive, fontSize: 15, lineHeight: 20, marginTop: 16 }}>
        {message}
      </Text>
    </Reveal>
  );
};
