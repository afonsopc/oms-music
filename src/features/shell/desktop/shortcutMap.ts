/**
 * Global shortcut map, pure half (plano-uma-so-app 4.4). Free of DOM and
 * React imports so the matching rules are bun-testable: a keystroke
 * (already reduced to plain fields) either names ONE action or nothing.
 *
 * The plan's deliberate divergence from Spotify is encoded here: bare
 * arrows are NOT transport - they belong to list navigation - so every
 * transport/volume binding rides the Cmd/Ctrl modifier. Panel toggles take
 * Alt+Shift and match on `code`, because on macOS Alt+letter produces a
 * dead key or a symbol in `key` ("œ" for Alt+Q) and the binding would only
 * work on some layouts. Cmd/Ctrl+/ matches on `key` for the opposite
 * reason: on the PT-PT layout "/" lives on Shift+7, so requiring "no
 * shift" would make the overlay unreachable on the owner's own keyboard.
 */

export type ShortcutAction =
  | "togglePlay"
  | "nextTrack"
  | "previousTrack"
  | "volumeUp"
  | "volumeDown"
  | "toggleMute"
  | "focusSearch"
  | "toggleQueuePanel"
  | "toggleNowPlayingPanel"
  | "toggleSidebar"
  | "toggleShortcutsOverlay";

/** A keydown, reduced to what matching needs (built by DesktopShortcuts). */
export interface ShortcutStroke {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Focus sits in an input/textarea/select/contenteditable. */
  onEditable: boolean;
  /** The event target is (or sits inside) a real interactive control. */
  onButton: boolean;
}

/** Tags whose focus means "the user is typing, keep your hands off". */
export const isEditableTagName = (tagName: string): boolean =>
  tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";

/** Volume step per Cmd/Ctrl+Up/Down press (0..1 scale). */
export const VOLUME_STEP = 0.1;

export const matchShortcut = (stroke: ShortcutStroke): ShortcutAction | null => {
  const primary = stroke.metaKey || stroke.ctrlKey;

  if (primary && !stroke.altKey) {
    // These two work even from inside an input: K moves focus to ANOTHER
    // input and / opens an overlay - neither fights the typing.
    if (stroke.key === "/") return "toggleShortcutsOverlay";
    if (stroke.shiftKey) return null;
    if (stroke.key === "k" || stroke.key === "K") return "focusSearch";
    if (stroke.onEditable) return null;
    if (stroke.key === "ArrowRight") return "nextTrack";
    if (stroke.key === "ArrowLeft") return "previousTrack";
    if (stroke.key === "ArrowUp") return "volumeUp";
    if (stroke.key === "ArrowDown") return "volumeDown";
    return null;
  }

  if (stroke.altKey && stroke.shiftKey && !primary) {
    if (stroke.code === "KeyQ") return "toggleQueuePanel";
    if (stroke.code === "KeyR") return "toggleNowPlayingPanel";
    if (stroke.code === "KeyL") return "toggleSidebar";
    return null;
  }

  if (primary || stroke.altKey || stroke.onEditable) return null;

  if (stroke.key === " ") {
    // Space on a focused button clicks the button (the browser's own
    // binding); a second toggle from here would undo it.
    return stroke.onButton ? null : "togglePlay";
  }
  if (!stroke.shiftKey && stroke.code === "KeyM") return "toggleMute";
  return null;
};
