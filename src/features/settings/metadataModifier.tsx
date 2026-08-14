/**
 * Metadata modifier tool (FR-126, P2). Pick a local audio file, fill the tag
 * form, POST /songs/metadata_modifier (multipart) and save the returned
 * BINARY (not JSON) into the app documents directory.
 *
 * Backend contract: 50 MB cap (413 above it) and `track_number` is silently
 * dropped, so the form never offers it and the copy says so. This tool is
 * deliberately outside the library flows: nothing here touches the user's
 * songs.
 */
import React, { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { modifyMetadata } from "@/api/endpoints/songs";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import {
  blobToBase64,
  pickAudioFile,
  saveBase64ToDocuments,
  type PickedAudio,
} from "./pickers";
import {
  GhostButton,
  LabeledField,
  NoticeBanner,
  PrimaryButton,
  useApiErrorMessage,
} from "./ui";

const MAX_BYTES = 50 * 1024 * 1024;

const outputName = (source: string): string => {
  const dot = source.lastIndexOf(".");
  if (dot <= 0) return `${source}-tagged`;
  return `${source.slice(0, dot)}-tagged${source.slice(dot)}`;
};

export const MetadataModifierDialog = ({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();

  const [file, setFile] = useState<PickedAudio | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const reset = (): void => {
    setFile(null);
    setTitle("");
    setArtist("");
    setAlbum("");
    setYear("");
    setGenre("");
    setNotice(null);
  };

  const choose = async (): Promise<void> => {
    setNotice(null);
    try {
      const picked = await pickAudioFile();
      if (!picked) return;
      if (picked.size > MAX_BYTES) {
        setNotice({ kind: "error", text: t("native.settings.songs.metadataToolTooLarge") });
        return;
      }
      setFile(picked);
      if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ""));
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  };

  const run = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      // The picked object goes through AS IS: on web it is a real browser
      // File (pickers.web.ts) and rebuilding a { uri, name, type } literal
      // would strip the bytes FormData needs; on native it already is that
      // plain shape.
      const blob = await modifyMetadata(
        file,
        {
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(artist.trim() ? { artist: artist.trim() } : {}),
          ...(album.trim() ? { album: album.trim() } : {}),
          ...(year.trim() ? { year: year.trim() } : {}),
          ...(genre.trim() ? { genre: genre.trim() } : {}),
        },
      );
      const base64 = await blobToBase64(blob);
      const uri = await saveBase64ToDocuments(base64, outputName(file.name));
      setNotice({ kind: "success", text: t("native.settings.songs.metadataToolSaved", { uri }) });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}>
            {t("native.settings.songs.metadataToolTitle")}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {t("native.settings.songs.metadataToolDescription")}
          </Text>
          <NoticeBanner kind="info" message={t("native.settings.songs.metadataToolNote")} />

          {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}

          <GhostButton
            label={
              file ? file.name : t("native.settings.songs.metadataToolPick")
            }
            onPress={() => void choose()}
          />

          <LabeledField
            label={t("components.music.Settings.SongsTable.EditSongDialog.title")}
            value={title}
            onChangeText={setTitle}
          />
          <LabeledField
            label={t("components.music.Settings.SongsTable.EditSongDialog.artist")}
            value={artist}
            onChangeText={setArtist}
            autoCapitalize="words"
          />
          <LabeledField
            label={t("components.music.Settings.SongsTable.EditSongDialog.album")}
            value={album}
            onChangeText={setAlbum}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <LabeledField
                label={t("components.music.Settings.SongsTable.EditSongDialog.year")}
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <LabeledField
                label={t("native.settings.songs.metadataToolGenre")}
                value={genre}
                onChangeText={setGenre}
              />
            </View>
          </View>
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: 12,
            padding: 20,
            borderTopWidth: 1,
            borderTopColor: tokens.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <GhostButton
              label={t("native.common.cancel")}
              onPress={() => {
                reset();
                onClose();
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t("native.settings.songs.metadataToolRun")}
              onPress={() => void run()}
              busy={busy}
              disabled={!file}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};
