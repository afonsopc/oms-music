/**
 * O ecrã inteiro da app é o visualizador (decisão do dono, 2026-11-04: o
 * modo cinema saiu). Abrir pede também o ecrã inteiro a sério: no desktop
 * (Tauri) a janela, no browser o Fullscreen API. Tem de correr dentro do
 * clique: os browsers só dão ecrã inteiro a um gesto do utilizador.
 */
import { Platform } from "react-native";
import { router } from "expo-router";

type TauriWindow = { setFullscreen?: (on: boolean) => Promise<void>; isFullscreen?: () => Promise<boolean> };

const tauriWindow = (): TauriWindow | null => {
  const t = (globalThis as { __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } } }).__TAURI__;
  try {
    return t?.window?.getCurrentWindow?.() ?? null;
  } catch {
    return null;
  }
};

export const enterFullscreen = (): void => {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const win = tauriWindow();
  if (win?.setFullscreen) {
    void win.setFullscreen(true).catch(() => {});
    return;
  }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
  else el.webkitRequestFullscreen?.();
};

export const exitFullscreen = (): void => {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const win = tauriWindow();
  if (win?.setFullscreen) {
    void win.setFullscreen(false).catch(() => {});
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
};

export const openVisualizer = (): void => {
  enterFullscreen();
  router.push("/(player)/visualizer");
};
