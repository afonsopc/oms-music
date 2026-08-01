/**
 * Artist edit dialog (FR-97). Two backend rules the web client gets wrong and
 * this client must not copy:
 *  1. PATCH /artists/:id takes a FLAT top-level body ({ name, gallery_image_urls });
 *     the web nests it under `artist` and the call silently no-ops.
 *  2. The banner upload multipart field is `banner`, NOT `image` (the web
 *     sends `image` and gets a 400).
 * Both live in api/endpoints/artists.ts; this screen just drives them.
 *
 * Gallery URLs are http(s) only (server-enforced) and come from the EXTENDED
 * artist view, so the dialog fetches the detail when it opens.
 */
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import {
  useArtist,
  useUpdateArtist,
  useUploadArtistBanner,
  useUploadArtistImage,
} from "@/api/queries/artists";
import { artistImageSource } from "@/domain/artwork";
import type { Artist } from "@/domain/artist";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon } from "@/ui";
import { pickImage } from "./pickers";
import {
  GhostButton,
  LabeledField,
  NoticeBanner,
  PrimaryButton,
  useApiErrorMessage,
} from "./ui";

const DIALOG_KEY = "components.music.Settings.ArtistsTable.EditArtistDialog";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

export const ArtistEditDialog = ({
  artist,
  visible,
  onClose,
}: {
  artist: Artist;
  visible: boolean;
  onClose: () => void;
}) => {
  const t = useT();
  const { tokens } = useTheme();
  const errorMessage = useApiErrorMessage();

  // The list view carries no gallery URLs (extended view only).
  const detail = useArtist(String(artist.id), visible);
  const update = useUpdateArtist();
  const uploadImage = useUploadArtistImage();
  const uploadBanner = useUploadArtistBanner();

  // The surface mounts this dialog per artist, so the form seeds once from
  // the row; the gallery follows the extended payload until the user edits
  // it (null = "still following the server").
  const [name, setName] = useState(artist.name);
  const [galleryDraft, setGalleryDraft] = useState("");
  const [galleryEdit, setGalleryEdit] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"image" | "banner" | "save" | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const detailGallery = detail.data?.gallery_image_urls;
  const initialGallery = useMemo(() => detailGallery ?? [], [detailGallery]);
  const gallery = galleryEdit ?? initialGallery;
  const setGallery = setGalleryEdit;
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== artist.name;
  const galleryChanged =
    gallery.length !== initialGallery.length ||
    gallery.some((url, index) => initialGallery[index] !== url);

  const addGalleryUrl = (): void => {
    const url = galleryDraft.trim();
    if (!url) return;
    if (!isHttpUrl(url)) {
      setNotice({ kind: "error", text: t(`${DIALOG_KEY}.galleryInvalidUrl`) });
      return;
    }
    if (!gallery.includes(url)) setGallery([...gallery, url]);
    setGalleryDraft("");
  };

  const save = async (): Promise<void> => {
    if (!nameChanged && !galleryChanged) {
      onClose();
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      // FLAT top-level body; rename re-slugs server-side (slug never changes).
      await update.mutateAsync({
        id: artist.id,
        body: {
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(galleryChanged ? { gallery_image_urls: gallery } : {}),
        },
      });
      setNotice({ kind: "success", text: t(`${DIALOG_KEY}.renamed`) });
      onClose();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (kind: "image" | "banner"): Promise<void> => {
    setNotice(null);
    const picked = await pickImage().catch(() => null);
    if (!picked) return;
    setBusy(kind);
    try {
      if (kind === "image") {
        await uploadImage.mutateAsync({ id: artist.id, image: picked });
      } else {
        // Multipart field `banner` (NOT `image`) - the web bug.
        await uploadBanner.mutateAsync({ id: artist.id, banner: picked });
      }
      setNotice({ kind: "success", text: t(`${DIALOG_KEY}.uploaded`) });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
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
            {t(`${DIALOG_KEY}.title`)}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t(`${DIALOG_KEY}.description`)}
          </Text>

          {notice ? <NoticeBanner kind={notice.kind} message={notice.text} /> : null}

          <View style={{ alignItems: "center", gap: 10 }}>
            <ArtworkImage source={artistImageSource(artist, "lg")} size={120} shape="circle" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GhostButton
                label={t(`${DIALOG_KEY}.uploadImage`)}
                compact
                disabled={busy !== null}
                onPress={() => void upload("image")}
              />
              <GhostButton
                label={t(`${DIALOG_KEY}.uploadBanner`)}
                compact
                disabled={busy !== null}
                onPress={() => void upload("banner")}
              />
            </View>
          </View>

          <LabeledField
            label={t(`${DIALOG_KEY}.nameLabel`)}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <View style={{ gap: 8 }}>
            <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
              {t(`${DIALOG_KEY}.galleryTitle`)}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
              {t(`${DIALOG_KEY}.galleryDescription`)}
            </Text>
            {gallery.length === 0 ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 12, paddingVertical: 8 }}>
                {t(`${DIALOG_KEY}.galleryEmpty`)}
              </Text>
            ) : (
              gallery.map((url, index) => (
                <View
                  key={url}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    borderWidth: 1,
                    borderColor: tokens.border,
                    borderRadius: RADIUS,
                    padding: 8,
                  }}
                >
                  <ArtworkImage uri={url} size={40} />
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, color: tokens.mutedForeground, fontSize: 11 }}
                  >
                    {url}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(`${DIALOG_KEY}.galleryRemove`)}
                    hitSlop={8}
                    onPress={() => setGallery(gallery.filter((_, i) => i !== index))}
                  >
                    <Icon name="x" size={15} color={tokens.mutedForeground} />
                  </Pressable>
                </View>
              ))
            )}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
              <View style={{ flex: 1 }}>
                <LabeledField
                  label={t(`${DIALOG_KEY}.galleryAddPlaceholder`)}
                  value={galleryDraft}
                  onChangeText={setGalleryDraft}
                  autoCapitalize="none"
                />
              </View>
              <GhostButton
                label={t(`${DIALOG_KEY}.galleryAdd`)}
                compact
                disabled={!galleryDraft.trim()}
                onPress={addGalleryUrl}
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
              label={t(`${DIALOG_KEY}.cancel`)}
              onPress={onClose}
              disabled={busy !== null}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={t(`${DIALOG_KEY}.save`)}
              onPress={() => void save()}
              busy={busy === "save"}
              disabled={!trimmedName || busy !== null}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};
