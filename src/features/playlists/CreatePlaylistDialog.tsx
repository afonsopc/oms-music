/**
 * Create-playlist dialog (FR-47): single name input, Enter submits, Create
 * disabled until non-blank. POST /playlists { name }; the mutation hook
 * invalidates the playlists list so the new row appears without a manual
 * refresh.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCreatePlaylist } from "@/api/queries/playlists";
import type { Playlist } from "@/domain/playlist";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface CreatePlaylistDialogProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the created playlist (e.g. to navigate into it). */
  onCreated?: (playlist: Playlist) => void;
}

export const CreatePlaylistDialog = ({
  visible,
  onClose,
  onCreated,
}: CreatePlaylistDialogProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const [name, setName] = useState("");
  const createMutation = useCreatePlaylist();

  const close = () => {
    setName("");
    onClose();
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || createMutation.isPending) return;
    createMutation.mutate(
      { name: trimmed },
      {
        onSuccess: (playlist) => {
          close();
          onCreated?.(playlist);
        },
      },
    );
  };

  if (!visible) return null;

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
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
            borderRadius: RADIUS * 2,
            backgroundColor: tokens.popover,
            borderWidth: 1,
            borderColor: tokens.border,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
            {t("components.music.CreatePlaylistDialog.title")}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            {t("components.music.CreatePlaylistDialog.description")}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("components.music.CreatePlaylistDialog.playlistNamePlaceholder")}
            placeholderTextColor={tokens.mutedForeground}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel={t("components.music.CreatePlaylistDialog.playlistNameLabel")}
            style={{
              borderWidth: 1,
              borderColor: tokens.input,
              borderRadius: RADIUS,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: tokens.foreground,
              fontSize: 15,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Pressable
              onPress={close}
              disabled={createMutation.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: tokens.mutedForeground, fontWeight: "600", fontSize: 14 }}>
                {t("components.music.CreatePlaylistDialog.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!name.trim() || createMutation.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: tokens.primary,
                opacity: !name.trim() || createMutation.isPending ? 0.5 : pressed ? 0.8 : 1,
              })}
            >
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color={tokens.primaryForeground} />
              ) : null}
              <Text style={{ color: tokens.primaryForeground, fontWeight: "700", fontSize: 14 }}>
                {t("components.music.CreatePlaylistDialog.create")}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
