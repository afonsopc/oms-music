/**
 * A horizontal shelf of artist avatars under a heading (FR-36). A shelf with
 * zero entries renders NOTHING - that is the rule the hub relies on to hide
 * "similar" and "neglected" for fresh libraries.
 */
import React from "react";
import { Text, View } from "react-native";
import type { Artist } from "@/domain/artist";
import { artistImageSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { ArtistCard, Rail } from "@/ui";

export interface ArtistShelfEntry {
  artist: Artist;
  /** Small line under the avatar ("N plays", "N songs"). */
  caption?: string;
}

export interface ArtistShelfProps {
  title: string;
  entries: ArtistShelfEntry[];
  onSelect: (artist: Artist) => void;
}

const CARD_SIZE = 120;

export const ArtistShelf = ({ title, entries, onSelect }: ArtistShelfProps) => {
  const { tokens } = useTheme();
  if (entries.length === 0) return null;

  return (
    <Rail title={title}>
      {entries.map(({ artist, caption }) => (
        <View key={artist.id} style={{ gap: 4, paddingHorizontal: 4 }}>
          <ArtistCard
            name={artist.name}
            image={artistImageSource(artist, "sm")}
            size={CARD_SIZE}
            onPress={() => onSelect(artist)}
          />
          {caption ? (
            <Text
              style={{
                width: CARD_SIZE + 16,
                textAlign: "center",
                color: tokens.mutedForeground,
                fontSize: 12,
              }}
              numberOfLines={1}
            >
              {caption}
            </Text>
          ) : null}
        </View>
      ))}
    </Rail>
  );
};
