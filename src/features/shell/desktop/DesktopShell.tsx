/**
 * Native fork of the desktop shell: a pass-through, ALWAYS. The desktop grid
 * (topbar / sidebar / main / right panel / transport row) is a web-and-Tauri
 * concern - a native tablet at any width keeps the native mobile shell
 * untouched, per the plan's sacred invariant. Metro picks DesktopShell.web.tsx
 * on web; this file exists so native bundles never even parse the DOM code.
 */
import React from "react";

export interface DesktopShellProps {
  children: React.ReactNode;
}

export const DesktopShell = ({ children }: DesktopShellProps) => <>{children}</>;
