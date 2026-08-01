/**
 * Dev-only component gallery (WP4 acceptance). Not part of the 28-screen
 * product tree and unreachable from any UI: navigate to `/gallery` from the
 * dev client (or a temporary router.push) while working on the UI kit.
 * Production builds render nothing.
 */
import React from "react";
import { GalleryScreen } from "@/ui/gallery/GalleryScreen";

export default function GalleryRoute() {
  if (!__DEV__) return null;
  return <GalleryScreen />;
}
