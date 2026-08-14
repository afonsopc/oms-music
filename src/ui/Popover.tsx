/**
 * Anchored popover (plano-uma-so-app 4.3, "Menus" row): the desktop-width
 * replacement for the full-width bottom sheet - "a 2560px drawer for a
 * five-item menu" is the audit line this component retires. Same RN Modal
 * transport as the sheet (so Escape closes it through onRequestClose on
 * web and the back button does on Android, should it ever render there),
 * but the card sits AT the anchor, clamped to the window by the pure
 * popoverPlacement module.
 *
 * The card renders transparent until its first onLayout: placement needs
 * the measured height, and a one-frame flash at the unclamped position
 * reads as a glitch every single right-click.
 */
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { popoverPlacement, type PopoverAnchor } from "./popoverPosition";
import { heavyShadow } from "./uiTheme";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface PopoverProps {
  visible: boolean;
  anchor: PopoverAnchor;
  onClose: () => void;
  children: React.ReactNode;
  /** Card width; menus read best around 300px. */
  width?: number;
}

export const Popover = ({ visible, anchor, onClose, children, width = 300 }: PopoverProps) => {
  const { tokens } = useTheme();
  const closeLabel = useT()("native.common.close");
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  if (!visible) return null;

  const maxHeight = Math.min(480, windowHeight - 16);
  const placement = popoverPlacement(
    anchor,
    { width, height: measuredHeight ?? maxHeight },
    { width: windowWidth, height: windowHeight },
  );

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      {/* Bare scrim: a context menu dims nothing, it just claims the next
          click. Sibling behind the card, same reasoning as BottomSheet. */}
      <Pressable
        onPress={onClose}
        accessibilityLabel={closeLabel}
        style={StyleSheet.absoluteFill}
      />
      <View
        onLayout={(event) => setMeasuredHeight(Math.round(event.nativeEvent.layout.height))}
        style={[
          {
            position: "absolute",
            left: placement.left,
            top: placement.top,
            width,
            maxHeight,
            borderRadius: 12,
            backgroundColor: tokens.popover,
            borderWidth: 1,
            borderColor: tokens.border,
            paddingVertical: 6,
            overflow: "hidden",
            opacity: measuredHeight == null ? 0 : 1,
          },
          heavyShadow,
        ]}
      >
        <ScrollView bounces={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
};
