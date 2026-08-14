/**
 * Song edit dialog (FR-96): title / album / year / position, artist chips
 * with per-chip role toggle (primary/feat), artwork slot, and the embedded
 * vocal-separation controls (FR-71 via contracts/separation).
 *
 * Request shape: metadata + artists go as a JSON PATCH (nullable fields
 * clear via null -> "\b" sentinel; multipart cannot carry the sentinel, per
 * the WP1 note); artwork uploads go as a SEPARATE multipart PATCH with only
 * the `artwork` part. `featured_artist_names[]` is always present
 * (songsFilters.artistParamsFromChips).
 */
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useUpdateSong } from "@/api/queries/songs";
import { getSeparationService } from "@/contracts/separation";
import { songArtworkSource } from "@/domain/artwork";
import { formatDuration } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { defaultModelId, useSeparationModels } from "@/separation/models";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, BottomSheet, ConfirmDialog, Icon } from "@/ui";
import { IMAGE_PICKER_AVAILABLE, pickImage, type PickedImage } from "./pickers";
import {
  artistParamsFromChips,
  chipsFromSong,
  type ArtistChip,
} from "./songsFilters";
import {
  GhostButton,
  LabeledField,
  NoticeBanner,
  PrimaryButton,
  useApiErrorMessage,
} from "./ui";

const DIALOG_KEY = "components.music.Settings.SongsTable.EditSongDialog";

const ArtistChips = ({
  chips,
  onChange,
}: {
  chips: ArtistChip[];
  onChange: (next: ArtistChip[]) => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const [draft, setDraft] = useState("");

  const toggleRole = (index: number): void => {
    onChange(
      chips.map((chip, i) =>
        i === index
          ? { ...chip, role: chip.role === "primary" ? "featured" : "primary" }
          : chip,
      ),
    );
  };

  const remove = (index: number): void => {
    onChange(chips.filter((_, i) => i !== index));
  };

  const add = (): void => {
    const name = draft.trim();
    if (!name) return;
    onChange([...chips, { name, role: chips.length === 0 ? "primary" : "featured" }]);
    setDraft("");
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {chips.map((chip, index) => (
          <View
            key={`${chip.name}-${index}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderWidth: 1,
              borderColor: tokens.border,
              borderRadius: 999,
              paddingLeft: 4,
              paddingRight: 8,
              paddingVertical: 4,
              backgroundColor: tokens.secondary,
            }}
          >
            <Pressable
              onPress={() => toggleRole(index)}
              accessibilityRole="button"
              style={{
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
                backgroundColor: chip.role === "primary" ? tokens.primary : tokens.muted,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color:
                    chip.role === "primary" ? tokens.primaryForeground : tokens.mutedForeground,
                }}
              >
                {chip.role === "primary"
                  ? t(`${DIALOG_KEY}.roleToggle.primary`)
                  : t(`${DIALOG_KEY}.roleToggle.featured`)}
              </Text>
            </Pressable>
            <Text style={{ color: tokens.foreground, fontSize: 13 }}>{chip.name}</Text>
            <Pressable onPress={() => remove(index)} hitSlop={8} accessibilityRole="button">
              <Icon name="x" size={13} color={tokens.mutedForeground} />
            </Pressable>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <LabeledField
            label={t(`${DIALOG_KEY}.artist`)}
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="words"
          />
        </View>
        <GhostButton label="+" onPress={add} disabled={!draft.trim()} compact />
      </View>
    </View>
  );
};

const StemsSection = ({ song }: { song: Song }) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();
  const service = getSeparationService();
  const status = service.useSeparationStatus(song.id);
  const modelsQuery = useSeparationModels();
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data]);

  const [pickerOpen, setPickerOpen] = useState(false);
  // null = follow the catalog default; a string = the user's pick.
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const selectedModelId = pickedModelId ?? defaultModelId(models);

  const stemsReady = !!song.vocals_media_id && !!song.instrumental_media_id;
  const running = status.phase === "pending" || status.phase === "processing";

  const startRun = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await service.triggerSeparation(song.id, selectedModelId ?? undefined);
      setNotice({ kind: "success", text: t(`${DIALOG_KEY}.separationStarted`) });
      setPickerOpen(false);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const deleteStems = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await service.deleteSeparation(song.id);
      setNotice({ kind: "success", text: t(`${DIALOG_KEY}.stemsDeleted`) });
    } catch {
      setNotice({ kind: "error", text: t(`${DIALOG_KEY}.errorDeletingStems`) });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
        {t(`${DIALOG_KEY}.stems`)}
      </Text>

      {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}

      {running ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: RADIUS,
            padding: 12,
          }}
        >
          <ActivityIndicator size="small" color={tokens.primary} />
          <Text style={{ color: tokens.foreground, fontSize: 13, flex: 1 }}>
            {t(`${DIALOG_KEY}.separating`)}
          </Text>
          <Text
            style={{ color: tokens.mutedForeground, fontSize: 13, fontVariant: ["tabular-nums"] }}
          >
            {formatDuration(status.elapsedSeconds ?? 0)}
            {status.progressPercent != null && status.progressPercent > 0
              ? `  ${Math.min(100, Math.round(status.progressPercent))}%`
              : ""}
          </Text>
        </View>
      ) : null}

      {stemsReady && !running ? (
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="circle-check" size={15} color={tokens.primary} />
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t(`${DIALOG_KEY}.vocals`)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="circle-check" size={15} color={tokens.primary} />
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t(`${DIALOG_KEY}.instrumental`)}
            </Text>
          </View>
        </View>
      ) : null}

      {!running ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={
                stemsReady ? t(`${DIALOG_KEY}.regenerateStems`) : t(`${DIALOG_KEY}.generateStems`)
              }
              onPress={() => setPickerOpen(true)}
              busy={busy}
              compact
            />
          </View>
          {stemsReady ? (
            <GhostButton
              label={t(`${DIALOG_KEY}.deleteStems`)}
              onPress={() => setConfirmDelete(true)}
              compact
            />
          ) : null}
        </View>
      ) : null}

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 12 }}>
          <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "700" }}>
            {t(`${DIALOG_KEY}.model`)}
          </Text>
          {models.map((model) => {
            const active = model.id === selectedModelId;
            return (
              <Pressable
                key={model.id}
                onPress={() => setPickedModelId(model.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  borderWidth: 1,
                  borderColor: active ? tokens.primary : tokens.border,
                  borderRadius: RADIUS,
                  padding: 12,
                  gap: 2,
                }}
              >
                <Text style={{ color: tokens.foreground, fontWeight: "600", fontSize: 14 }}>
                  {t(`${DIALOG_KEY}.models.${model.translation_key}.name`)}
                </Text>
                <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                  {t(`${DIALOG_KEY}.models.${model.translation_key}.description`)}
                </Text>
              </Pressable>
            );
          })}
          {models.length === 0 ? (
            <ActivityIndicator color={tokens.mutedForeground} />
          ) : null}
          <PrimaryButton
            label={
              stemsReady ? t(`${DIALOG_KEY}.regenerateStems`) : t(`${DIALOG_KEY}.generateStems`)
            }
            onPress={() => void startRun()}
            busy={busy}
            disabled={!selectedModelId}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete}
        title={t(`${DIALOG_KEY}.deleteStems`)}
        message={t(`${DIALOG_KEY}.deleteStemsConfirm`)}
        confirmLabel={t(`${DIALOG_KEY}.deleteStems`)}
        destructive
        pending={busy}
        onConfirm={() => void deleteStems()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
};

export const SongEditDialog = ({
  song,
  visible,
  onClose,
}: {
  song: Song;
  visible: boolean;
  onClose: () => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();
  const updateSong = useUpdateSong();

  // The dialog is mounted per song by its surface, so the form seeds from
  // the row once instead of syncing through an effect.
  const [title, setTitle] = useState(song.title ?? "");
  const [album, setAlbum] = useState(song.album ?? "");
  const [year, setYear] = useState(song.year != null ? String(song.year) : "");
  const [position, setPosition] = useState(song.position != null ? String(song.position) : "");
  const [chips, setChips] = useState<ArtistChip[]>(() => chipsFromSong(song));
  const [artwork, setArtwork] = useState<PickedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const artworkSource = useMemo(() => songArtworkSource(song), [song]);

  const parseIntOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      // JSON PATCH carries metadata + artists; nullable clears ride the
      // sentinel (null -> "\b"). Artwork goes in a separate multipart PATCH.
      await updateSong.mutateAsync({
        id: song.id,
        patch: {
          title: title.trim(),
          album: album.trim() ? album.trim() : null,
          year: parseIntOrNull(year),
          position: parseIntOrNull(position),
          ...artistParamsFromChips(chips),
        },
      });
      if (artwork) {
        await updateSong.mutateAsync({ id: song.id, patch: {}, artwork });
      }
      setNotice({ kind: "success", text: t(`${DIALOG_KEY}.songUpdatedSuccessfully`) });
      onClose();
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const pickArtwork = async (): Promise<void> => {
    const picked = await pickImage();
    if (!picked) return;
    if (!picked.type.startsWith("image/")) {
      setNotice({ kind: "error", text: t(`${DIALOG_KEY}.artworkMustBeImage`) });
      return;
    }
    setArtwork(picked);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        {/* RN does not inset modal content for the keyboard: without these
            two the lower fields and the save button sit underneath it. */}
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}>
            {t(`${DIALOG_KEY}.editSong`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t(`${DIALOG_KEY}.editSongDescription`)}
          </Text>

          {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}

          <View style={{ alignItems: "center", gap: 8 }}>
            {artwork ? (
              <ArtworkImage uri={artwork.uri} size={140} />
            ) : (
              <ArtworkImage source={artworkSource} songId={song.id} size={140} />
            )}
            <GhostButton
              label={t(`${DIALOG_KEY}.artwork`)}
              onPress={() => void pickArtwork()}
              disabled={!IMAGE_PICKER_AVAILABLE}
              compact
            />
            {!IMAGE_PICKER_AVAILABLE ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 11, textAlign: "center" }}>
                {t("native.settings.pickers.unavailable")}
              </Text>
            ) : null}
          </View>

          <LabeledField label={t(`${DIALOG_KEY}.title`)} value={title} onChangeText={setTitle} />
          <ArtistChips chips={chips} onChange={setChips} />
          <LabeledField label={t(`${DIALOG_KEY}.album`)} value={album} onChangeText={setAlbum} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <LabeledField
                label={t(`${DIALOG_KEY}.year`)}
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <LabeledField
                label={t(`${DIALOG_KEY}.position`)}
                value={position}
                onChangeText={setPosition}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: tokens.border }} />
          <StemsSection song={song} />
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
            <GhostButton label={t(`${DIALOG_KEY}.cancel`)} onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t(`${DIALOG_KEY}.saveChanges`)}
              onPress={() => void save()}
              busy={saving}
              disabled={!title.trim()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};
