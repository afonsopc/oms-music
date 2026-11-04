/**
 * Tocar na tab já aberta, na raiz, sobe a lista ao topo. No iOS é o sistema
 * que o faz; no Android o react-native-screens procura a ScrollView pela
 * mesma cadeia de primeiros filhos que falha no popToRoot (ver tabPress.ts),
 * por isso aqui fica o useScrollToTop do react-navigation, só no Android.
 */
import { useRef, type RefObject } from "react";
import { Platform } from "react-native";
import { useScrollToTop } from "expo-router";

const ANDROID = Platform.OS === "android";

export const useTabScrollToTop = (ref: RefObject<unknown>): void => {
  const none = useRef(null);
  useScrollToTop((ANDROID ? ref : none) as Parameters<typeof useScrollToTop>[0]);
};
