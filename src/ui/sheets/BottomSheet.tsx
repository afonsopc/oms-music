/**
 * Minimal self-contained bottom sheet (no sheet library is installed):
 * RN Modal + animated slide-up + backdrop press to dismiss. Content taller
 * than maxHeightRatio scrolls internally (callers embed their own
 * ScrollView/FlatList when needed via `scroll={false}`).
 */
import React, { useEffect, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/provider";

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
  const { tokens } = useTheme();
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
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)", justifyContent: "flex-end" }}
      >
        <Pressable onPress={() => {}} style={{ maxHeight: height * maxHeightRatio }}>
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
            {scroll ? <ScrollView bounces={false}>{body}</ScrollView> : body}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
