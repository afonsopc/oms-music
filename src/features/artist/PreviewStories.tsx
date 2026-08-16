/**
 * Preview do artista em stories (pedido do dono, 2026-08-18, o idioma do
 * Spotify): o segundo inquilino do StoryPager. Cada cartão é uma das top
 * músicas e o áudio é REAL - toca um excerto pelo próprio motor, saltando
 * para ~1/3 da faixa, onde os refrões costumam viver.
 *
 * v1 assumida: tocar o preview substitui a fila (setQueue de uma música).
 * Um "player de preview" paralelo exigiria um segundo adapter e toda a
 * disciplina de sessão áudio outra vez; substituir a fila é o que o motor
 * já sabe fazer bem, e fechar o preview pausa em vez de fingir que
 * restaura o que lá estava.
 */
import React, { useCallback, useEffect } from "react";
import { Modal, Text, View } from "react-native";
import { Image } from "expo-image";
import { getTransport } from "@/contracts/transport";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { ArtworkImage, StoryPager, type StoryCard } from "@/ui";
import { previewSeekSeconds } from "./previewMath";

const CARD_MS = 15_000;
const MAX_SONGS = 5;



export const ArtistPreviewStories = ({
  visible,
  onClose,
  artistName,
  imageUri,
  songs,
}: {
  visible: boolean;
  onClose: () => void;
  artistName: string;
  imageUri: string | null;
  songs: readonly Song[];
}) => {
  const t = useT();
  const previewSongs = songs.slice(0, MAX_SONGS);
  // A identidade da lista muda por refetch; os ids são o que interessa.
  const signature = previewSongs.map((s) => s.id).join(",");

  const playAt = useCallback(
    (index: number): void => {
      const song = previewSongs[index];
      if (!song) return;
      getTransport().setQueue([song], 0);
      const target = previewSeekSeconds(song.duration);
      if (target > 0) getTransport().seek(target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const close = useCallback((): void => {
    getTransport().pause();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) playAt(0);
  }, [visible, playAt]);

  if (!visible || previewSongs.length === 0) return null;

  const cards: StoryCard[] = previewSongs.map((song, i) => ({
    key: `preview-${song.id}`,
    durationMs: CARD_MS,
    render: () => (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            contentFit="cover"
            blurRadius={24}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5 }}
          />
        ) : null}
        <View
          style={{
            flex: 1,
            paddingHorizontal: 28,
            paddingVertical: 96,
            justifyContent: "center",
            gap: 16,
          }}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 1.2,
            }}
          >
            {`${t("components.music.ArtistView.previewKicker")} ${artistName}`}
          </Text>
          <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={220} />
          <Text
            style={{ color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.6 }}
            numberOfLines={2}
          >
            {song.title}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 15 }} numberOfLines={1}>
            {formatArtists(song)}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
            {`${i + 1}/${previewSongs.length}`}
          </Text>
        </View>
      </View>
    ),
  }));

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <StoryPager cards={cards} onClose={close} onIndexChange={playAt} />
    </Modal>
  );
};
