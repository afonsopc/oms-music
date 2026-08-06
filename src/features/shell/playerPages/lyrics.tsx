import React from "react";
import LyricsBody from "@/features/lyrics";
import { PlayerSubpage } from "../PlayerPager";

/** Full-screen lyrics, opened from the card on the now playing scroll. */
export default function LyricsPage() {
  return (
    <PlayerSubpage>
      <LyricsBody />
    </PlayerSubpage>
  );
}
