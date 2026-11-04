/**
 * Na web não há gesture-handler (os gestos da web são pointer events, ver
 * PlayerPager.web.tsx e Slider.web.tsx): a raiz é uma View simples, e o
 * pacote e o hammerjs ficam fora do bundle.
 */
import React from "react";
import { View, type ViewProps } from "react-native";

export const GestureRoot = (props: ViewProps) => <View {...props} />;
