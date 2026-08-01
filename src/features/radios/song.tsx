/**
 * Song radio route body (FR-122). A non-numeric or missing id falls back
 * Home instead of requesting a radio that cannot exist (FR-123 AC).
 */
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import type { SongId } from "@/domain/ids";
import { RadioScreen } from "./index";

export default function SongRadioScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const songId = Number(params.id);
  if (!Number.isInteger(songId) || songId <= 0) {
    return <Redirect href="/(main)/(tabs)/home" />;
  }
  return <RadioScreen kind="song" songId={songId as SongId} />;
}
