/**
 * Locks the global shortcut map (plano-uma-so-app 4.4). The load-bearing
 * rules: bare arrows are NEVER transport (the plan's deliberate divergence
 * from Spotify), typing targets swallow everything except Cmd/Ctrl+K and
 * Cmd/Ctrl+/, Space stands down on real buttons (the browser clicks them),
 * and the Alt+Shift panel chords match on `code` so macOS Alt-symbols
 * cannot break them.
 */
import { describe, expect, test } from "bun:test";
import {
  isEditableTagName,
  matchShortcut,
  VOLUME_STEP,
  type ShortcutStroke,
} from "../shortcutMap";

const stroke = (over: Partial<ShortcutStroke>): ShortcutStroke => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  onEditable: false,
  onButton: false,
  ...over,
});

describe("matchShortcut", () => {
  test("Space toggles playback on a plain target", () => {
    expect(matchShortcut(stroke({ key: " ", code: "Space" }))).toBe("togglePlay");
  });

  test("Space stands down on buttons and while typing", () => {
    expect(matchShortcut(stroke({ key: " ", code: "Space", onButton: true }))).toBeNull();
    expect(matchShortcut(stroke({ key: " ", code: "Space", onEditable: true }))).toBeNull();
  });

  // Pedido do dono (2026-08-17): as setas nuas portam o /music antigo -
  // esquerda/direita saltam 5 s, cima/baixo mexem no volume. A primeira
  // versão reservava-as para listas; a decisão foi revertida de propósito.
  test("bare arrows seek and drive the volume, like the old /music", () => {
    expect(matchShortcut(stroke({ key: "ArrowRight" }))).toBe("seekForward");
    expect(matchShortcut(stroke({ key: "ArrowLeft" }))).toBe("seekBackward");
    expect(matchShortcut(stroke({ key: "ArrowUp" }))).toBe("volumeUp");
    expect(matchShortcut(stroke({ key: "ArrowDown" }))).toBe("volumeDown");
  });

  test("bare arrows still yield to inputs, buttons and shifted strokes", () => {
    expect(matchShortcut(stroke({ key: "ArrowRight", onEditable: true }))).toBeNull();
    expect(matchShortcut(stroke({ key: "ArrowRight", onButton: true }))).toBeNull();
    expect(matchShortcut(stroke({ key: "ArrowUp", shiftKey: true }))).toBeNull();
  });

  test("Cmd/Ctrl+arrows drive transport and volume", () => {
    expect(matchShortcut(stroke({ key: "ArrowRight", metaKey: true }))).toBe("nextTrack");
    expect(matchShortcut(stroke({ key: "ArrowLeft", ctrlKey: true }))).toBe("previousTrack");
    expect(matchShortcut(stroke({ key: "ArrowUp", metaKey: true }))).toBe("volumeUp");
    expect(matchShortcut(stroke({ key: "ArrowDown", ctrlKey: true }))).toBe("volumeDown");
  });

  test("Cmd/Ctrl+arrows yield to a focused input (caret-jump keys)", () => {
    expect(
      matchShortcut(stroke({ key: "ArrowLeft", metaKey: true, onEditable: true })),
    ).toBeNull();
  });

  test("M mutes; Shift+M and Cmd+M do not", () => {
    expect(matchShortcut(stroke({ key: "m", code: "KeyM" }))).toBe("toggleMute");
    expect(matchShortcut(stroke({ key: "M", code: "KeyM", shiftKey: true }))).toBeNull();
    expect(matchShortcut(stroke({ key: "m", code: "KeyM", metaKey: true }))).toBeNull();
    expect(matchShortcut(stroke({ key: "m", code: "KeyM", onEditable: true }))).toBeNull();
  });

  test("Cmd/Ctrl+K focuses search, even from inside an input", () => {
    expect(matchShortcut(stroke({ key: "k", code: "KeyK", metaKey: true }))).toBe("focusSearch");
    expect(
      matchShortcut(stroke({ key: "k", code: "KeyK", ctrlKey: true, onEditable: true })),
    ).toBe("focusSearch");
  });

  test("Cmd/Ctrl+/ opens the overlay even when / needs Shift (PT-PT layout)", () => {
    expect(matchShortcut(stroke({ key: "/", metaKey: true }))).toBe("toggleShortcutsOverlay");
    expect(matchShortcut(stroke({ key: "/", metaKey: true, shiftKey: true }))).toBe(
      "toggleShortcutsOverlay",
    );
    expect(
      matchShortcut(stroke({ key: "/", ctrlKey: true, onEditable: true })),
    ).toBe("toggleShortcutsOverlay");
  });

  test("Alt+Shift chords match on code, not on the layout-dependent key", () => {
    expect(
      matchShortcut(stroke({ key: "Œ", code: "KeyQ", altKey: true, shiftKey: true })),
    ).toBe("toggleQueuePanel");
    expect(
      matchShortcut(stroke({ key: "R", code: "KeyR", altKey: true, shiftKey: true })),
    ).toBe("toggleNowPlayingPanel");
    expect(
      matchShortcut(stroke({ key: "L", code: "KeyL", altKey: true, shiftKey: true })),
    ).toBe("toggleSidebar");
  });

  test("Alt without Shift (and Alt+Cmd) match nothing", () => {
    expect(matchShortcut(stroke({ key: "q", code: "KeyQ", altKey: true }))).toBeNull();
    expect(
      matchShortcut(
        stroke({ key: "q", code: "KeyQ", altKey: true, shiftKey: true, metaKey: true }),
      ),
    ).toBeNull();
  });

  test("volume step is a sane fraction of the 0..1 scale", () => {
    expect(VOLUME_STEP).toBeGreaterThan(0);
    expect(VOLUME_STEP).toBeLessThanOrEqual(0.25);
  });
});

describe("isEditableTagName", () => {
  test("inputs, textareas and selects are editable; divs and buttons are not", () => {
    expect(isEditableTagName("INPUT")).toBe(true);
    expect(isEditableTagName("TEXTAREA")).toBe(true);
    expect(isEditableTagName("SELECT")).toBe(true);
    expect(isEditableTagName("DIV")).toBe(false);
    expect(isEditableTagName("BUTTON")).toBe(false);
  });
});
