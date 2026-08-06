/**
 * Lyrics CARD for the now playing scroll (the Spotify idiom the owner asked
 * for by screenshot): an accent-coloured panel below the controls showing the
 * current line and the next few, tap anywhere to open the full lyrics page.
 *
 * The card renders nothing while lyrics are loading or absent: a "no lyrics"
 * card would just be furniture, and the full page already owns the rich empty
 * and error states.
 *
 * Re-render discipline: the playback position is read through a selector that
 * returns the ACTIVE LINE INDEX, so the card re-renders when the line changes,
 * not at the 4 Hz position tick.
 */
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useLyrics } from "@/api/queries/lyrics";
import { useT } from "@/i18n";
import { activeLineIndex, parseLrc } from "@/lyrics/lrc";
import { splitPlainLines } from "@/lyrics/translation";
import { usePlaybackView } from "@/remote/mirror";
import { useSongAccent } from "@/features/player";
import { onColor, withAlpha } from "@/theme/contrast";
import { RADIUS } from "@/theme/tokens";
import { Icon } from "@/ui";

/** Lines shown on the card: the active one plus the next few. */
const CARD_LINES = 5;

export const LyricsCard = () => {
  const t = useT();
  const router = useRouter();
  const song = usePlaybackView((v) => v.song);
  const accent = useSongAccent(song);

  const lyricsQuery = useLyrics(song?.id ?? null);
  const synced = lyricsQuery.data?.synced ?? null;
  const plain = lyricsQuery.data?.plain ?? null;

  const lines = useMemo(() => (synced ? parseLrc(synced) : []), [synced]);

  // Selector returns a primitive, so the card only re-renders on line change.
  const active = usePlaybackView((v) => (lines.length > 0 ? activeLineIndex(lines, v.position) : -1));

  const shown = useMemo(() => {
    if (lines.length > 0) {
      const start = Math.max(0, active);
      return lines.slice(start, start + CARD_LINES).map((l) => l.text || "♪");
    }
    if (plain) return splitPlainLines(plain).filter(Boolean).slice(0, CARD_LINES);
    return [];
  }, [lines, active, plain]);

  if (!song || shown.length === 0) return null;

  const ink = onColor(accent);

  return (
    <Pressable
      onPress={() => router.push("/(player)/lyrics")}
      accessibilityRole="button"
      accessibilityLabel={t("native.lyrics.cardTitle")}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginTop: 8,
        borderRadius: RADIUS * 2,
        backgroundColor: accent,
        padding: 20,
        gap: 14,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: ink, fontSize: 15, fontWeight: "800", flex: 1 }}>
          {t("native.lyrics.cardTitle")}
        </Text>
        <Icon name="chevron-right" size={18} color={ink} />
      </View>
      {shown.map((text, index) => (
        <Text
          key={index}
          style={{
            color: index === 0 && lines.length > 0 ? ink : withAlpha(ink, 0.55),
            fontSize: 22,
            lineHeight: 28,
            fontWeight: "800",
          }}
        >
          {text}
        </Text>
      ))}
    </Pressable>
  );
};
