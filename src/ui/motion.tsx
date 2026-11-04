/**
 * Kit de movimento comum (redesenho 2026-11-04). Só o `Animated` do React
 * Native: no nativo corre no driver nativo (opacidade e transform), na web
 * é o do react-native-web, que já vem no bundle - o Reanimated e o
 * gesture-handler ficam só para os gestos do nativo e deixam de pesar na web.
 *
 * Tudo curto (150-420 ms), a abrandar no fim, e desligado quando o sistema
 * pede menos movimento (`useReducedMotion`).
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { staggerDelay } from "./motionMath";

export const EASE_OUT = Easing.out(Easing.cubic);

let reduced = false;
let reducedLoaded = false;
const listeners = new Set<(v: boolean) => void>();

const loadReduced = () => {
  if (reducedLoaded) return;
  reducedLoaded = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then((v) => {
      reduced = !!v;
      listeners.forEach((l) => l(reduced));
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => {
    reduced = !!v;
    listeners.forEach((l) => l(reduced));
  });
};

/** True quando o sistema pede menos movimento. */
export const useReducedMotion = (): boolean => {
  loadReduced();
  const [v, setV] = useState(reduced);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
};

export { staggerDelay } from "./motionMath";

/**
 * Um valor que anda até `target` (0..1) com uma curva suave. Mudar o alvo
 * anima a partir de onde está; com menos movimento salta logo.
 */
export const useTween = (
  target: number,
  { duration = 240, delay = 0, from }: { duration?: number; delay?: number; from?: number } = {},
): Animated.Value => {
  const reduce = useReducedMotion();
  const [value] = useState(() => new Animated.Value(from ?? target));
  useEffect(() => {
    if (reduce) {
      value.setValue(target);
      return;
    }
    const anim = Animated.timing(value, {
      toValue: target,
      duration,
      delay,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [target, duration, delay, reduce, value]);
  return value;
};

/** Entra a subir um pouco e a aparecer, em cascata pela ordem. */
export const Reveal = ({
  order = 0,
  step,
  distance = 12,
  duration = 300,
  style,
  children,
}: {
  order?: number;
  step?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) => {
  const p = useTween(1, { from: 0, duration, delay: staggerDelay(order, step) });
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: p,
          transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

/** Aparece (só opacidade). */
export const FadeIn = ({
  duration = 220,
  delay = 0,
  style,
  children,
}: {
  duration?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) => {
  const p = useTween(1, { from: 0, duration, delay });
  return <Animated.View style={[style, { opacity: p }]}>{children}</Animated.View>;
};

/**
 * Botão que encolhe um pouco ao toque (0,97) e volta com mola curta: cada
 * toque responde no próprio frame, antes de qualquer pedido.
 */
export const PressableScale = ({
  scaleTo = 0.97,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) => {
  const reduce = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const to = (v: number, ms: number) =>
    Animated.timing(scale, { toValue: v, duration: ms, easing: EASE_OUT, useNativeDriver: true }).start();
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        if (!reduce) to(scaleTo, 90);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduce) to(1, 160);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

/** Conta de 0 até `value` (contagens que saltam ao chegar). */
export const useCountUp = (value: number, duration = 900, delay = 0): number => {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce || value <= 0) return;
    let frame = 0;
    let start = 0;
    const timer = setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const k = Math.min(1, (t - start) / duration);
        setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
        if (k < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [value, duration, delay, reduce]);
  return reduce || value <= 0 ? value : n;
};
