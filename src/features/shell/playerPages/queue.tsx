import React from "react";
import QueueBody from "@/features/player/queue";
import { PlayerSubpage } from "../PlayerPager";

/** Full-screen queue, opened from the row on the now playing scroll. */
export default function QueuePage() {
  return (
    <PlayerSubpage>
      <QueueBody />
    </PlayerSubpage>
  );
}
