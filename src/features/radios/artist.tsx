/**
 * Artist radio route body (FR-122). The `[artist]` segment is a slug or a
 * raw name; a missing/blank segment falls back Home rather than firing a
 * request that can only 404 (FR-123 AC).
 */
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { RadioScreen } from "./index";

export default function ArtistRadioScreen() {
  const params = useLocalSearchParams<{ artist: string }>();
  const artist = (params.artist ?? "").trim();
  if (!artist || artist === "null") {
    return <Redirect href="/(main)/(tabs)/home" />;
  }
  return <RadioScreen kind="artist" artist={artist} />;
}
