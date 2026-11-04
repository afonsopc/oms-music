/**
 * Gestos do mini-leitor (só iOS/Android): para o lado muda de música, para
 * cima ABRE a folha do leitor a seguir o dedo (ronda 2): o arrasto vertical
 * escreve directamente no progresso da folha, na thread da UI, e ao largar a
 * mola acaba o movimento com a velocidade do dedo. A pílula desvanece à
 * medida que a folha sobe. A web usa o par `.web.tsx`.
 */
import React from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSheetProgress } from "@/features/player/sheet/PlayerSheet";
import { clampProgress, SHEET_SPRING, sheetSnapTarget } from "@/features/player/sheet/sheetMath";
import { mountPlayerSheet, setPlayerSheetOpen } from "@/features/player/sheet/sheetStore";
import { miniSwipeDecision, type MiniSwipe } from "./miniSwipeMath";

export interface MiniPlayerSwipeProps {
  onSwipe: (swipe: Exclude<MiniSwipe, null>) => void;
  children: React.ReactNode;
}

export const MiniPlayerSwipe = ({ onSwipe, children }: MiniPlayerSwipeProps) => {
  const progress = useSheetProgress();
  const { height } = useWindowDimensions();
  const dragX = useSharedValue(0);
  const vertical = useSharedValue(false);
  const fire = (swipe: MiniSwipe) => {
    if (swipe) onSwipe(swipe);
  };
  const gesture = Gesture.Pan()
    // 14 px de folga: um toque (abrir, play) nunca chega a ser arrasto.
    .activeOffsetX([-14, 14])
    .activeOffsetY([-14, 10_000])
    .onStart((event) => {
      vertical.value = Math.abs(event.translationY) > Math.abs(event.translationX);
      if (vertical.value && progress) {
        runOnJS(mountPlayerSheet)();
        runOnJS(setPlayerSheetOpen)(true);
      }
    })
    .onUpdate((event) => {
      if (vertical.value && progress) {
        progress.set(clampProgress(-event.translationY / height));
      } else {
        dragX.value = event.translationX * 0.6;
      }
    })
    .onEnd((event) => {
      if (vertical.value && progress) {
        const target = sheetSnapTarget(progress.get(), event.velocityY);
        progress.set(withSpring(target, { ...SHEET_SPRING, velocity: -event.velocityY / height }, (finished) => {
          if (finished && target === 0) runOnJS(setPlayerSheetOpen)(false);
        }));
        return;
      }
      const swipe = miniSwipeDecision(event.translationX, event.translationY, event.velocityX, event.velocityY);
      runOnJS(fire)(swipe);
      dragX.value = withSpring(0, { damping: 20, stiffness: 260 });
    })
    .onFinalize(() => {
      dragX.value = withSpring(0, { damping: 20, stiffness: 260 });
    });
  const style = useAnimatedStyle(() => {
    const p = progress ? progress.get() : 0;
    return {
      opacity: interpolate(p, [0, 0.35], [1, 0], "clamp"),
      transform: [{ translateX: dragX.value }, { translateY: -p * 40 }],
    };
  });
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
};
