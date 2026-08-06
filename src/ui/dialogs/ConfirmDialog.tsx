/**
 * Centered confirm dialog (delete playlist, delete stems...). Copy comes
 * from the caller through i18n'd strings; the cancel label defaults to the
 * shared native.common.cancel key.
 */
import React from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { modalScrim } from "../uiTheme";
import { RADIUS } from "@/theme/tokens";

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  if (!visible) return null;

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: modalScrim(scheme),
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: "100%",
            maxWidth: 360,
            borderRadius: RADIUS * 2,
            backgroundColor: tokens.popover,
            borderWidth: 1,
            borderColor: tokens.border,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
            {title}
          </Text>
          {message ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
              {message}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Pressable
              onPress={onCancel}
              disabled={pending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: tokens.foreground, fontWeight: "600" }}>
                {cancelLabel ?? t("native.common.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={pending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: destructive ? tokens.destructive : tokens.primary,
                opacity: pressed || pending ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              })}
            >
              {pending ? (
                <ActivityIndicator
                  size="small"
                  color={destructive ? tokens.destructiveForeground : tokens.primaryForeground}
                />
              ) : null}
              <Text
                style={{
                  color: destructive ? tokens.destructiveForeground : tokens.primaryForeground,
                  fontWeight: "700",
                }}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
