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

/** The DOM keydown surface react-native-web forwards (typed minimally). */
export interface CardKeyDownEvent {
  key: string;
  target: unknown;
  currentTarget: unknown;
  preventDefault: () => void;
}

/**
 * Keyboard reach for those same outer cards (plano-uma-so-app 4.3, the
 * "nothing is focusable" gap). The diagnosis behind cardPressRole was right
 * (no nested <button>), but the remedy left every card as a div the Tab key
 * cannot reach. The desktop remedy: `tabIndex={0}` plus `onKeyDown` on the
 * OUTER element - react-native-web forwards both - with NO role="button",
 * so the inner real buttons stay valid HTML.
 *
 * DELIBERATE exception to the sub-900px freeze: these props apply on every
 * WEB width, not just the desktop shell. Tab reach and Space-to-activate
 * render nothing and change no pointer behavior, and a keyboard user on a
 * narrow window deserves them as much as one on a wide one. Auditors: this
 * is by design, not a missed gate.
 *
 * Only SPACE is claimed here. Enter is deliberately left alone:
 * react-native-web's PressResponder treats Enter as a valid key press on
 * ANY focused Pressable and fires onPress itself - claiming it too would
 * activate every card twice. Space, by contrast, is only handled by RNW on
 * button-ish roles (which these cards gave up), so it is ours; the
 * preventDefault stops the page scroll AND tells the global Space shortcut
 * (which skips defaultPrevented events) to stand down. The target check
 * matters: key events from the inner buttons bubble through the card, and
 * without it a focused menu button would also play the row.
 */
export const cardKeyProps = (
  onActivate: () => void,
): { tabIndex?: 0; onKeyDown?: (event: CardKeyDownEvent) => void } =>
  Platform.OS === "web"
    ? {
        tabIndex: 0,
        onKeyDown: (event: CardKeyDownEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== " ") return;
          event.preventDefault();
          onActivate();
        },
      }
    : {};

/** The DOM mouse surface for context-menu anchoring (typed minimally). */
export interface CardContextMenuEvent {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
}

/**
 * Right-click hook for the card pressables: react-native-web forwards
 * `onContextMenu` with the real DOM event, whose clientX/Y anchor the
 * popover menu. Native returns nothing - long-press stays the only door.
 */
export const cardContextMenuProps = (
  onContextMenu: (event: CardContextMenuEvent) => void,
): { onContextMenu?: (event: CardContextMenuEvent) => void } =>
  Platform.OS === "web" ? { onContextMenu } : {};

/**
 * Focus-within tracking for reveal-on-hover controls: React focus events
 * bubble (focusin under the hood), so the OUTER card hears its inner
 * buttons gaining focus and can reveal them - a control that only appears
 * on mouse hover would otherwise be invisible to the keyboard user who just
 * tabbed onto it.
 */
export const cardFocusProps = (
  onFocus: () => void,
  onBlur: () => void,
): { onFocus?: () => void; onBlur?: () => void } =>
  Platform.OS === "web" ? { onFocus, onBlur } : {};

/**
 * Plain-View hover (rails, containers): react-native-web forwards the DOM
 * mouseenter/mouseleave pair on any View; native gets nothing. Pressables
 * should use their own onHoverIn/onHoverOut instead.
 */
export const viewHoverProps = (
  onEnter: () => void,
  onLeave: () => void,
): { onMouseEnter?: () => void; onMouseLeave?: () => void } =>
  Platform.OS === "web" ? { onMouseEnter: onEnter, onMouseLeave: onLeave } : {};
