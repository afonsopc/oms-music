/** Web: gesture-handler is native-only here, so the handle alone pulls. */
import React, { useMemo, useState } from "react";
import { Animated, PanResponder, ScrollView, View, type ViewStyle } from "react-native";
import type { SheetBodyProps } from "./SheetBody";
import { SheetHandle } from "./SheetHandle";
import { shouldDismissSheet } from "./sheetDismiss";

export const SheetBody = ({ panelStyle, maxHeight, scroll, onClose, children }: SheetBodyProps) => {
  const [y] = useState(() => new Animated.Value(0));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gesture) => y.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_event, gesture) => {
          if (shouldDismissSheet(gesture.dy, gesture.vy * 1000, maxHeight)) onClose();
          else Animated.spring(y, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => y.setValue(0),
      }),
    [y, maxHeight, onClose],
  );
  return (
    <View style={{ maxHeight }}>
      <Animated.View style={[panelStyle, { transform: [{ translateY: y }] }]}>
        <View {...responder.panHandlers} style={{ cursor: "grab", touchAction: "none" } as unknown as ViewStyle}>
          <SheetHandle />
        </View>
        {scroll ? (
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </Animated.View>
    </View>
  );
};
