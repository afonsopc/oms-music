/**
 * Fork web do domPortal (ver domPortal.ts): monta o no directamente no
 * document.body via react-dom, fora de qualquer stacking context do grid.
 * Guarda de SSG: em Node nao ha document e o no volta inline (o prerender
 * nunca tem overlays abertos).
 */
import type React from "react";
import { createPortal } from "react-dom";

export const domPortal = (node: React.ReactNode): React.ReactNode =>
  typeof document === "undefined" ? node : createPortal(node, document.body);
