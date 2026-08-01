/**
 * Song credits dialog (FR-125): artists grouped primary / featured / with,
 * each group ordered by `position`, empty groups hidden. Only rendered when
 * `song.artists` is non-empty (the menu item is conditioned the same way).
 */
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { ArtworkImage } from "../ArtworkImage";
import { featuredArtists, primaryArtists, withArtists } from "@/domain/format";
import type { Song, SongArtistEntry } from "@/domain/song";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface SongCreditsDialogProps {
  visible: boolean;
  song: Song;
  onClose: () => void;
}

const CreditsRow = ({ entry }: { entry: SongArtistEntry }) => {
  const { tokens } = useTheme();
  const node = entry.compressed_image_fs_node_id ?? entry.image_fs_node_id;
  const external = entry.picture_medium ?? entry.picture ?? entry.external_image_url;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
      <ArtworkImage
        nodeId={node}
        uri={node ? null : external}
        size={36}
        shape="circle"
      />
      <Text style={{ color: tokens.foreground, fontSize: 15, flex: 1 }} numberOfLines={1}>
        {entry.name}
      </Text>
    </View>
  );
};

const CreditsGroup = ({ label, entries }: { label: string; entries: SongArtistEntry[] }) => {
  const { tokens } = useTheme();
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      {entries.map((entry) => (
        <CreditsRow key={entry.id} entry={entry} />
      ))}
    </View>
  );
};

export const SongCreditsDialog = ({ visible, song, onClose }: SongCreditsDialogProps) => {
  const { tokens } = useTheme();
  const t = useT();
  if (!visible || (song.artists ?? []).length === 0) return null;

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: "100%",
            maxWidth: 360,
            maxHeight: "70%",
            borderRadius: RADIUS * 2,
            backgroundColor: tokens.popover,
            borderWidth: 1,
            borderColor: tokens.border,
            padding: 20,
          }}
        >
          <Text
            style={{
              color: tokens.foreground,
              fontSize: 18,
              fontWeight: "700",
              marginBottom: 4,
            }}
          >
            {t("components.music.SongCreditsDialog.title")}
          </Text>
          <Text
            style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 12 }}
            numberOfLines={1}
          >
            {song.title}
          </Text>
          <ScrollView bounces={false}>
            <View style={{ gap: 16 }}>
              <CreditsGroup
                label={t("components.music.SongCreditsDialog.rolePrimary")}
                entries={primaryArtists(song)}
              />
              <CreditsGroup
                label={t("components.music.SongCreditsDialog.roleFeatured")}
                entries={featuredArtists(song)}
              />
              <CreditsGroup
                label={t("components.music.SongCreditsDialog.roleWith")}
                entries={withArtists(song)}
              />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
