/**
 * Gestos do mini-leitor (só iOS/Android): arrastar para o lado muda de
 * música, para cima abre o leitor. A pílula segue o dedo na horizontal e
 * volta ao sítio com uma mola; a decisão é a de `miniSwipeMath`. A web usa o
 * par `.web.tsx`, sem gesture-handler nem Reanimated no bundle.
 */
import React from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { miniSwipeDecision, type MiniSwipe } from "./miniSwipeMath";

export interface MiniPlayerSwipeProps {
  onSwipe: (swipe: Exclude<MiniSwipe, null>) => void;
  children: React.ReactNode;
}

export const MiniPlayerSwipe = ({ onSwipe, children }: MiniPlayerSwipeProps) => {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const fire = (swipe: MiniSwipe) => {
    if (swipe) onSwipe(swipe);
  };
  const gesture = Gesture.Pan()
    // 14 px de folga: um toque (abrir, play) nunca chega a ser arrasto.
    .activeOffsetX([-14, 14])
    .activeOffsetY([-14, 10_000])
    .onUpdate((event) => {
      dragX.value = event.translationX * 0.6;
      dragY.value = Math.min(0, event.translationY) * 0.4;
    })
    .onEnd((event) => {
      const swipe = miniSwipeDecision(
        event.translationX,
        event.translationY,
        event.velocityX,
        event.velocityY,
      );
      runOnJS(fire)(swipe);
      dragX.value = withSpring(0, { damping: 20, stiffness: 260 });
      dragY.value = withSpring(0, { damping: 20, stiffness: 260 });
    })
    .onFinalize(() => {
      dragX.value = withSpring(0, { damping: 20, stiffness: 260 });
      dragY.value = withSpring(0, { damping: 20, stiffness: 260 });
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
};
