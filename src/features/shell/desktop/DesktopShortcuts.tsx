/**
 * Global keyboard shortcuts + mouse history buttons (plano-uma-so-app 4.4),
 * the imperative half over the pure shortcutMap. Renders nothing; mounted
 * by DesktopShell only while the desktop shell is active, so below 900px
 * (and on native) not a single listener exists and the mobile shell keeps
 * its exact behaviour.
 *
 * Ordering contract with the focused widgets: React handlers run while the
 * event bubbles through the tree, this listener sits on `window` and runs
 * last - so anything that already answered the key (a song row claiming
 * Space, the typeahead claiming Enter) preventDefault's it and the check
 * below stands down. That one line is what lets a global Space exist
 * without fighting inputs.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { getTransport } from "@/contracts/transport";
import { getPlaybackView } from "@/remote/mirror";
import type { RightPanelTenant } from "./rightPanelModel";
import { focusTopbarSearch } from "./searchFocus";
import {
  isEditableTagName,
  matchShortcut,
  SEEK_STEP_S,
  VOLUME_STEP,
  type ShortcutAction,
} from "./shortcutMap";

export interface DesktopShortcutsProps {
  /** Window fits the right panel (>= 1200px): panel toggles drive tenants. */
  panelAvailable: boolean;
  onToggleTenant: (tenant: RightPanelTenant) => void;
  onToggleSidebar: () => void;
  onToggleShortcutsOverlay: () => void;
}

/** Actions where holding the key down should keep stepping. */
const REPEATABLE: ReadonlySet<ShortcutAction> = new Set([
  "volumeUp",
  "volumeDown",
  "nextTrack",
  "previousTrack",
  "seekForward",
  "seekBackward",
]);

/**
 * The two "works even while typing" combos ride a CAPTURE-phase listener:
 * react-native-web's TextInput calls stopPropagation on every keydown
 * (their #612), so a bubble listener on window never hears Cmd+K pressed
 * inside the sidebar's search box. Capture runs window-first, before any
 * widget can stop or claim the event - safe for exactly these two, because
 * no focused widget has a legitimate use for them. Everything else stays
 * on the bubble path, where a widget that answered the key first (a row
 * claiming Space, the typeahead claiming Enter) wins by preventDefault.
 */
const CAPTURE_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  "focusSearch",
  "toggleShortcutsOverlay",
]);

const clampVolume = (volume: number): number => Math.max(0, Math.min(1, volume));

export const DesktopShortcuts = ({
  panelAvailable,
  onToggleTenant,
  onToggleSidebar,
  onToggleShortcutsOverlay,
}: DesktopShortcutsProps) => {
  const router = useRouter();

  // Latest-ref pattern: ONE stable pair of window listeners for the life of
  // the shell, reading fresh props/state through the ref - re-subscribing
  // per render would drop key events between remove and add. The ref is
  // written from an effect (not during render, per the compiler's rule);
  // key events can only arrive after effects have run, so it is never
  // stale when read.
  const stateRef = useRef({ panelAvailable, onToggleTenant, onToggleSidebar, onToggleShortcutsOverlay, router });
  useEffect(() => {
    stateRef.current = { panelAvailable, onToggleTenant, onToggleSidebar, onToggleShortcutsOverlay, router };
  });

  // Volume before the last mute, so M restores instead of guessing. Kept
  // across renders but not across reloads - a muted reload starting loud
  // would be worse than a mute that restores to a modest default.
  const preMuteVolume = useRef<number | null>(null);

  useEffect(() => {
    const run = (action: ShortcutAction): void => {
      const { panelAvailable: wide, onToggleTenant: toggleTenant, onToggleSidebar: toggleSidebar, onToggleShortcutsOverlay: toggleOverlay, router: r } = stateRef.current;
      switch (action) {
        case "togglePlay":
          getTransport().toggle();
          return;
        case "nextTrack":
          getTransport().next();
          return;
        case "previousTrack":
          getTransport().previous();
          return;
        case "seekForward": {
          const { position, duration } = getPlaybackView();
          // O tecto -0.25 é o do /music antigo: saltar exactamente para o
          // fim dispararia o ended e engoliria o fim da música.
          const cap = duration > 0 ? duration - 0.25 : Number.POSITIVE_INFINITY;
          getTransport().seek(Math.min(cap, position + SEEK_STEP_S));
          return;
        }
        case "seekBackward":
          getTransport().seek(Math.max(0, getPlaybackView().position - SEEK_STEP_S));
          return;
        case "volumeUp":
          getTransport().setVolume(clampVolume(getPlaybackView().volume + VOLUME_STEP));
          return;
        case "volumeDown":
          getTransport().setVolume(clampVolume(getPlaybackView().volume - VOLUME_STEP));
          return;
        case "toggleMute": {
          const volume = getPlaybackView().volume;
          if (volume > 0) {
            preMuteVolume.current = volume;
            getTransport().setVolume(0);
          } else {
            getTransport().setVolume(preMuteVolume.current ?? 0.5);
          }
          return;
        }
        case "focusSearch":
          focusTopbarSearch();
          return;
        case "toggleQueuePanel":
          // Below 1200px the panel cannot open; the shortcut lands on the
          // same full-screen route the transport bar's queue button keeps.
          if (wide) toggleTenant("queue");
          else r.push("/(player)/queue");
          return;
        case "toggleNowPlayingPanel":
          if (wide) toggleTenant("nowPlaying");
          else r.push("/(player)/now-playing");
          return;
        case "toggleSidebar":
          toggleSidebar();
          return;
        case "toggleShortcutsOverlay":
          toggleOverlay();
          return;
      }
    };

    const toAction = (event: KeyboardEvent): ShortcutAction | null => {
      const target = event.target instanceof Element ? event.target : null;
      const editable =
        !!target &&
        (isEditableTagName(target.tagName) ||
          (target instanceof HTMLElement && target.isContentEditable));
      const onButton =
        !!target && !!target.closest?.("button, a, [role='button'], [role='menuitem']");
      return matchShortcut({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        onEditable: editable,
        onButton,
      });
    };

    const onKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      const action = toAction(event);
      if (!action || !CAPTURE_ACTIONS.has(action)) return;
      // Also stops the browser's own Cmd/Ctrl+K (address-bar search).
      event.preventDefault();
      run(action);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      // A widget already answered this key (row activation, typeahead...),
      // or the capture listener above did.
      if (event.defaultPrevented) return;
      const action = toAction(event);
      if (!action || CAPTURE_ACTIONS.has(action)) return;
      if (event.repeat && !REPEATABLE.has(action)) return;
      // Also stops the browser's own binding (Cmd+Left = Back, Space =
      // page scroll).
      event.preventDefault();
      run(action);
    };

    // Mouse buttons 4/5 -> history (plan 4.4). Chromium and Firefox on
    // Windows/Linux navigate on these NATIVELY and the page cannot cancel
    // it, so acting there would double-step every press; macOS browsers do
    // nothing natively, which is exactly the hole this fills. The router's
    // history and the browser's are the same history (topbar contract).
    const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 3) window.history.back();
      else if (event.button === 4) window.history.forward();
    };

    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keydown", onKeyDown);
    if (mac) window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("keydown", onKeyDown);
      if (mac) window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return null;
};
