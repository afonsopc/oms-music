/**
 * LRC parsing (FR-76), an exact port of the web `parseLrc` in
 * frontend/components/music/LyricsView.tsx. The four frozen rules:
 *
 *  1. `[mm:ss.xx]` timestamps via the regex /\[(\d+):(\d+(?:\.\d+)?)\]/g;
 *     multiple timestamps on one raw line fan out into multiple entries
 *     with the same text.
 *  2. Lines with no digit-colon timestamp (metadata tags like [ar:Bladee],
 *     untimed/empty lines) are skipped entirely.
 *  3. Empty text after stripping timestamps is KEPT (`text: ""`); the UI
 *     renders it as a placeholder dot and it stays tappable (FR-78).
 *  4. `time = minutes * 60 + seconds` (float), result sorted ascending.
 *
 * Pure module: no I/O, no React - unit-tested in bun.
 */
import type { LrcLine } from "@/domain/lyrics";

const TIMESTAMP_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

export const parseLrc = (lrc: string): LrcLine[] => {
  const lines: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    const local = new RegExp(TIMESTAMP_RE.source, "g");
    while ((match = local.exec(raw)) !== null) matches.push(match);
    if (matches.length === 0) continue;
    const text = raw.replace(local, "").trim();
    for (const m of matches) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseFloat(m[2]);
      lines.push({ time: minutes * 60 + seconds, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
};

/**
 * Active line = LAST line with `time <= position` (web tick loop semantics:
 * linear scan, `max(0, i - 1)`, so the first line is active even before its
 * timestamp). Returns -1 for an empty list (the web never runs its loop
 * with zero lines; the sentinel keeps that behavior explicit here).
 */
export const activeLineIndex = (lines: readonly LrcLine[], position: number): number => {
  if (lines.length === 0) return -1;
  let i = 0;
  while (i < lines.length && lines[i].time <= position) i++;
  return Math.max(0, i - 1);
};
