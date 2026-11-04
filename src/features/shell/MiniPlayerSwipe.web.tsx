/**
 * Na web o mini-leitor não tem gestos (rato e teclado chegam aos botões):
 * este par existe para o bundle web nunca levar gesture-handler nem
 * Reanimated.
 */
import React from "react";
import type { MiniSwipe } from "./miniSwipeMath";

export interface MiniPlayerSwipeProps {
  onSwipe: (swipe: Exclude<MiniSwipe, null>) => void;
  children: React.ReactNode;
}

export const MiniPlayerSwipe = ({ children }: MiniPlayerSwipeProps) => <>{children}</>;
