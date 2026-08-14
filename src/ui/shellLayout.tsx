/**
 * Live-width companions to breakpoints.ts (plano-uma-so-app 4.2): the hooks
 * that decide which shell is active and how wide the CURRENT container is.
 *
 * `useContainerWidth` is the seam that makes container-based breakpoints
 * possible without rewriting every screen: the desktop shell's main pane
 * provides its measured width through context, and everything that used to
 * read `useWindowDimensions().width` reads this instead. Outside the
 * provider (the whole mobile shell, all of native) it falls back to the
 * window width, which is what those callers were measuring all along - so
 * below 900px nothing changes by construction.
 */
import React, { createContext, useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { isDesktopShellWidth, isRightPanelWidth } from "./breakpoints";

const ContainerWidthContext = createContext<number | null>(null);

export interface ContainerWidthProviderProps {
  width: number;
  children: React.ReactNode;
}

/** Mounted by the desktop shell's main pane with its measured width. */
export const ContainerWidthProvider = ({ width, children }: ContainerWidthProviderProps) => (
  <ContainerWidthContext.Provider value={width}>{children}</ContainerWidthContext.Provider>
);

/** Width of the pane this component actually lives in (window if unwrapped). */
export const useContainerWidth = (): number => {
  const provided = useContext(ContainerWidthContext);
  const { width } = useWindowDimensions();
  return provided ?? width;
};

/**
 * Is the desktop shell active? Web-only BY DESIGN: a native tablet at
 * 1000pt keeps the native mobile shell untouched - the desktop layout is a
 * web/desktop-bundle concern (the Tauri shell is the same web export).
 */
export const useDesktopShell = (): boolean => {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && isDesktopShellWidth(width);
};

/** Desktop shell AND wide enough for the right panel's real column. */
export const useRightPanelWide = (): boolean => {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && isDesktopShellWidth(width) && isRightPanelWidth(width);
};
