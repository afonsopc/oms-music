/**
 * Accessibility helpers shared by the ui kit.
 */
import { Platform } from "react-native";

/**
 * Role for an outer CARD pressable that contains its own buttons (a song row
 * with a menu, a tile with a play FAB, the mini player with its controls).
 * On native it is a plain button role. On web react-native-web renders
 * role="button" as a REAL <button>, and HTML forbids nesting those - React
 * logs hydration errors and browsers re-parent the DOM, which is what broke
 * clicking around. The outer card degrades to a clickable div there; the
 * inner controls keep their real button semantics.
 */
export const cardPressRole: "button" | undefined =
  Platform.OS === "web" ? undefined : "button";
