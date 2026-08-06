/**
 * Minimal self-contained bottom sheet (no sheet library is installed):
 * RN Modal + animated slide-up + backdrop press to dismiss. Content taller
 * than maxHeightRatio scrolls internally (callers embed their own
 * ScrollView/FlatList when needed via `scroll={false}`).
 *
 * Keyboard: RN does NOT inset modal content on iOS, and this sheet is pinned
 * to the bottom edge, so a KeyboardAvoidingView wraps the backdrop - without
 * it the sheets that host a TextInput (the inline "create playlist" field,
 * the import artwork search) are created straight underneath the keyboard.
 * `keyboardShouldPersistTaps` keeps the first tap on a button working while
 * the field still has focus.
 */
import React, { useEffect, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { modalScrim } from "../uiTheme";

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Max sheet height as a fraction of the window (default 0.8). */
  maxHeightRatio?: number;
  /** Wrap children in a ScrollView (default true). */
  scroll?: boolean;
}

export const BottomSheet = ({
  visible,
  onClose,
  children,
  maxHeightRatio = 0.8,
  scroll = true,
}: BottomSheetProps) => {
  const { tokens, scheme } = useTheme();
  const closeLabel = useT()("native.common.close");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible, slide]);

  if (!visible) return null;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const body = (
    <View style={{ paddingBottom: insets.bottom + 12 }}>{children}</View>
  );

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* The backdrop is a SIBLING behind the sheet, not its parent.
              Wrapping the sheet in a Pressable to swallow taps also made that
              Pressable claim every touch that began on the sheet's own
              background, so the ScrollView underneath it never saw the drag:
              the sheet could only be scrolled by starting on a button, which
              hands the gesture back on move. */}
          <Pressable
            onPress={onClose}
            accessibilityLabel={closeLabel}
            style={[StyleSheet.absoluteFill, { backgroundColor: modalScrim(scheme) }]}
          />
          <View style={{ maxHeight: height * maxHeightRatio }}>
            <Animated.View
              style={{
                backgroundColor: tokens.popover,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                borderWidth: 1,
                borderColor: tokens.border,
                transform: [{ translateY }],
                maxHeight: height * maxHeightRatio,
                paddingTop: 8,
              }}
            >
              <View
                style={{
                  alignSelf: "center",
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: tokens.muted,
                  marginBottom: 8,
                }}
              />
              {scroll ? (
                <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
                  {body}
                </ScrollView>
              ) : (
                body
              )}
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
