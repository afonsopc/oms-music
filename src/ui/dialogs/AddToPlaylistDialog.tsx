/**
 * Add-to-playlist dialog SHELL (FR-74 render half). Purely presentational:
 * WP6 wires the data behavior (FR-49: non-system playlists only, membership
 * pre-check, toggle add/remove by join-row id, inline create-and-add).
 * Rows with a membership id draw a check (pressing removes, dialog stays
 * open); rows without draw a plus (pressing adds).
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArtworkImage } from "../ArtworkImage";
import { Icon } from "../icons";
import { BottomSheet } from "../sheets/BottomSheet";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface AddToPlaylistRow {
  id: number;
  name: string;
  artwork?: ArtworkSource | null;
  /** playlist_songs join-row id when the song is already in the playlist. */
  memberJoinRowId: number | null;
}

export interface AddToPlaylistDialogProps {
  visible: boolean;
  onClose: () => void;
  songTitle: string;
  rows?: AddToPlaylistRow[];
  loading?: boolean;
  error?: boolean;
  /** Membership toggle; the surface removes (join-row id) or adds. */
  onToggle: (row: AddToPlaylistRow) => void;
  /** Inline create-and-add flow. */
  onCreateAndAdd: (name: string) => void;
  createPending?: boolean;
}

export const AddToPlaylistDialog = ({
  visible,
  onClose,
  songTitle,
  rows,
  loading = false,
  error = false,
  onToggle,
  onCreateAndAdd,
  createPending = false,
}: AddToPlaylistDialogProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submitCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateAndAdd(trimmed);
    setName("");
    setCreating(false);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Text style={{ color: tokens.foreground, fontSize: 18, fontWeight: "700" }}>
          {t("components.music.AddToPlaylistDialog.title")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }} numberOfLines={1}>
          {t("components.music.AddToPlaylistDialog.description", { songTitle })}
        </Text>

        {creating ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("components.music.AddToPlaylistDialog.newPlaylistNamePlaceholder")}
              placeholderTextColor={tokens.mutedForeground}
              autoFocus
              onSubmitEditing={submitCreate}
              style={{
                flex: 1,
                height: 42,
                borderRadius: RADIUS,
                borderWidth: 1,
                borderColor: tokens.input,
                paddingHorizontal: 12,
                color: tokens.foreground,
                backgroundColor: tokens.secondary,
              }}
            />
            <Pressable
              onPress={submitCreate}
              disabled={createPending || name.trim().length === 0}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                height: 42,
                borderRadius: 999,
                backgroundColor: tokens.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed || createPending || name.trim().length === 0 ? 0.6 : 1,
              })}
            >
              {createPending ? (
                <ActivityIndicator size="small" color={tokens.primaryForeground} />
              ) : (
                <Text style={{ color: tokens.primaryForeground, fontWeight: "700" }}>
                  {t("components.music.AddToPlaylistDialog.create")}
                </Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 12,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: RADIUS,
                borderWidth: 1,
                borderColor: tokens.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="plus" size={18} color={tokens.foreground} />
            </View>
            <Text style={{ color: tokens.foreground, fontWeight: "600" }}>
              {t("components.music.AddToPlaylistDialog.createNewPlaylist")}
            </Text>
          </Pressable>
        )}

        {loading ? (
          <Text style={{ color: tokens.mutedForeground, paddingVertical: 16 }}>
            {t("components.music.AddToPlaylistDialog.loadingPlaylists")}
          </Text>
        ) : error ? (
          <Text style={{ color: tokens.destructive, paddingVertical: 16 }}>
            {t("components.music.AddToPlaylistDialog.errorLoadingPlaylists")}
          </Text>
        ) : (rows ?? []).length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, paddingVertical: 16 }}>
            {t("components.music.AddToPlaylistDialog.noPlaylists")}
          </Text>
        ) : (
          (rows ?? []).map((row) => {
            const member = row.memberJoinRowId != null;
            return (
              <Pressable
                key={row.id}
                onPress={() => onToggle(row)}
                accessibilityRole="button"
                accessibilityLabel={
                  member
                    ? t("components.music.AddToPlaylistDialog.alreadyInPlaylist")
                    : row.name
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <ArtworkImage source={row.artwork} size={40} />
                <Text
                  style={{ color: tokens.foreground, fontSize: 15, flex: 1 }}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                <Icon
                  name={member ? "check" : "plus"}
                  size={18}
                  color={member ? tokens.primary : tokens.mutedForeground}
                />
              </Pressable>
            );
          })
        )}
      </View>
    </BottomSheet>
  );
};
