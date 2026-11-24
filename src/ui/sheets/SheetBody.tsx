/**
 * iOS/Android: the sheet's panel, with the pull-down. Dragging the handle, or
 * the content while it is scrolled to the top, carries the whole sheet with
 * the finger (UI thread); letting go past a third or with a flick closes it.
 * The web pair has the handle only.
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SheetHandle } from "./SheetHandle";
import { shouldDismissSheet } from "./sheetDismiss";

export interface SheetBodyProps {
  panelStyle: StyleProp<ViewStyle>;
  maxHeight: number;
  scroll: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** Finger travel before a pull is a pull (a tap or a scroll never gets here). */
const PULL_SLOP = 10;

export const SheetBody = ({ panelStyle, maxHeight, scroll, onClose, children }: SheetBodyProps) => {
  const y = useSharedValue(0);
  const height = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const handleY = useSharedValue(0);
  const closing = useSharedValue(false);
  const pulling = useSharedValue(false);

  const settle = (translation: number, velocity: number): void => {
    "worklet";
    if (closing.value) return;
    if (shouldDismissSheet(translation, velocity, height.value)) {
      closing.value = true;
      y.value = withTiming(Math.max(height.value, translation), { duration: 160 }, () => runOnJS(onClose)());
    } else {
      y.value = withSpring(0, { damping: 30, stiffness: 320, overshootClamping: true });
    }
  };

  const native = Gesture.Native();
  // By hand: it only becomes a pull going DOWN with the content at the top, so
  // the list scrolls as always and pulls once there is nothing above.
  const pull = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event, state) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches > 1) {
        state.fail();
        return;
      }
      startX.value = touch.absoluteX;
      startY.value = touch.absoluteY;
    })
    .onTouchesMove((event, state) => {
      const touch = event.allTouches[0];
      if (!touch || closing.value) return;
      if (scrollY.value > 0.5) {
        startX.value = touch.absoluteX;
        startY.value = touch.absoluteY;
        return;
      }
      const dy = touch.absoluteY - startY.value;
      const dx = Math.abs(touch.absoluteX - startX.value);
      if (dx > PULL_SLOP && dx > Math.abs(dy)) state.fail();
      else if (dy > PULL_SLOP && dy > dx) state.activate();
    })
    .onStart((event) => {
      startY.value = event.absoluteY;
      pulling.value = true;
    })
    // Absolute, never `translationY`: that one is measured against a view this
    // very gesture is moving, and the sheet would chase its own tail.
    .onUpdate((event) => {
      y.value = Math.max(0, event.absoluteY - startY.value);
    })
    .onEnd((event) => settle(y.value, event.velocityY))
    .onFinalize((_event, success) => {
      pulling.value = false;
      if (!success) settle(y.value, 0);
    })
    .simultaneousWithExternalGesture(native);

  const handle = Gesture.Pan()
    .activeOffsetY([-10_000, 3])
    .onStart((event) => {
      handleY.value = event.absoluteY;
    })
    .onUpdate((event) => {
      y.value = Math.max(0, event.absoluteY - handleY.value);
    })
    .onEnd((event) => settle(y.value, event.velocityY))
    .onFinalize((_event, success) => {
      if (!success) settle(y.value, 0);
    })
    .blocksExternalGesture(pull);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  // The content holds still while the sheet itself is being carried.
  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: !pulling.value }));
  const pulled = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    // A Modal is its own window on Android: gestures need a root in here.
    <GestureHandlerRootView style={{ maxHeight }}>
      <GestureDetector gesture={pull}>
        {/* Still on purpose: the gesture lives on what does not move. */}
        <View style={{ maxHeight }} collapsable={false}>
        <Animated.View
          style={[panelStyle, pulled]}
          onLayout={(event) => {
            height.value = event.nativeEvent.layout.height;
          }}
        >
          <GestureDetector gesture={handle}>
            <View>
              <SheetHandle />
            </View>
          </GestureDetector>
          {scroll ? (
            <GestureDetector gesture={native}>
              <Animated.ScrollView
                bounces={false}
                overScrollMode="never"
                keyboardShouldPersistTaps="handled"
                onScroll={onScroll}
                animatedProps={scrollProps}
                scrollEventThrottle={16}
              >
                {children}
              </Animated.ScrollView>
            </GestureDetector>
          ) : (
            children
          )}
        </Animated.View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
};
