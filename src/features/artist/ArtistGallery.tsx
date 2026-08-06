/**
 * Artist gallery slideshow (FR-42, P2): 16:9 crossfading photos that
 * auto-advance every 6 seconds, pause while the user is touching the frame,
 * with chevron prev/next and dot indicators. The URLs come straight from
 * `gallery_image_urls` (arbitrary Wikimedia hosts) so they are rendered as
 * plain external images, never through the fs-node builder.
 */
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useT } from "@/i18n";
import { AA_LARGE, ON_DARK, preferredOn } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Icon, photoScrim } from "@/ui";

const ADVANCE_MS = 6000;

/** The chevrons float on arbitrary photos, so they carry their own scrim. */
const CHEVRON_SCRIM = photoScrim(0.45);
const CHEVRON_INK = preferredOn(CHEVRON_SCRIM, ON_DARK, AA_LARGE);

export interface ArtistGalleryProps {
  urls: string[];
}

export const ArtistGallery = ({ urls }: ArtistGalleryProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = urls.length;

  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, count]);

  if (count === 0) return null;

  // A shrinking gallery (refetch) must not strand the index: wrap at render
  // time rather than correcting it from an effect.
  const current = index % count;
  const step = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const uri = urls[current];

  return (
    <View style={{ gap: 8 }}>
      <View
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
        onTouchCancel={() => setPaused(false)}
        style={{
          width: "100%",
          aspectRatio: 16 / 9,
          borderRadius: RADIUS,
          overflow: "hidden",
          backgroundColor: tokens.muted,
          justifyContent: "center",
        }}
      >
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={400}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          accessible={false}
        />
        {count > 1 ? (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingHorizontal: 8,
            }}
          >
            <Pressable
              onPress={() => step(-1)}
              accessibilityRole="button"
              accessibilityLabel={t("components.music.Home.scrollPrev")}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: CHEVRON_SCRIM,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="chevron-left" size={18} color={CHEVRON_INK} />
            </Pressable>
            <Pressable
              onPress={() => step(1)}
              accessibilityRole="button"
              accessibilityLabel={t("components.music.Home.scrollNext")}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: CHEVRON_SCRIM,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="chevron-right" size={18} color={CHEVRON_INK} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {count > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          {urls.map((entry, i) => (
            <View
              key={`${entry}:${i}`}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === current ? tokens.foreground : tokens.border,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};
