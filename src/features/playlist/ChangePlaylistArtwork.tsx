/**
 * Capa editável das playlists MANUAIS (FR-51). As de sistema nunca a têm
 * (FR-53).
 *
 * Desde o redesenho de 2026-11-04 a capa é só a capa: o "Mudar a capa" saiu
 * de cima dela e passou para o menu "⋯" da playlist. Por isso a lógica vive
 * num hook (`usePlaylistArtworkChange`), que o ecrã partilha entre o item do
 * menu e a capa; a capa só mostra o que está a acontecer (a preparar, a
 * enviar, um aviso se falhou).
 *
 * A imagem é recortada num quadrado e reconvertida para JPEG abaixo de ~2 MB
 * antes de sair do aparelho (artworkPicker / @/lib/artworkTranscode). Campo
 * multipart `artwork` (POST /playlists/:id/upload_artwork); a mutação escreve
 * a playlist devolvida na cache, a capa nova aparece sem recarregar.
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useUploadPlaylistArtwork } from "@/api/queries/playlists";
import type { ArtworkSource } from "@/domain/artwork";
import type { PlaylistId } from "@/domain/ids";
import { useT } from "@/i18n";
import { ArtworkImage, photoScrim } from "@/ui";
import { FadeIn } from "@/ui/motion";
import { ON_DARK, preferredOn } from "@/theme/contrast";
import { MAX_ARTWORK_MB, pickPlaylistArtwork } from "./artworkPicker";

const NOTICE_SCRIM = photoScrim(0.7);
const OVERLAY_INK = preferredOn(NOTICE_SCRIM, ON_DARK);
const ART_RADIUS = 8;

export interface PlaylistArtworkChange {
  /** Abre o seletor de imagem e envia a escolhida. */
  pick: () => void;
  busy: boolean;
  /** Texto do que está a acontecer (a preparar / a enviar), ou null. */
  status: string | null;
  /** Aviso de falha ou recusa, ou null. */
  notice: string | null;
}

export const usePlaylistArtworkChange = (playlistId: PlaylistId): PlaylistArtworkChange => {
  const t = useT();
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const upload = useUploadPlaylistArtwork();
  const busy = preparing || upload.isPending;

  const pick = useCallback(async () => {
    if (busy) return;
    setNotice(null);
    let outcome;
    setPreparing(true);
    try {
      outcome = await pickPlaylistArtwork();
    } catch {
      setNotice(t("components.music.ChangePlaylistArtwork.errorLoadingFile"));
      return;
    } finally {
      setPreparing(false);
    }
    if (outcome.kind === "canceled") return;
    if (outcome.kind === "notAnImage") {
      setNotice(t("components.music.ChangePlaylistArtwork.notAnImage"));
      return;
    }
    if (outcome.kind === "tooLarge") {
      setNotice(t("native.playlistArtwork.tooLarge", { max: MAX_ARTWORK_MB }));
      return;
    }
    upload.mutate(
      { id: playlistId, artwork: outcome.artwork },
      { onError: () => setNotice(t("components.music.ChangePlaylistArtwork.errorOccurred")) },
    );
  }, [busy, playlistId, t, upload]);

  return {
    pick: () => void pick(),
    busy,
    status: preparing
      ? t("components.music.ChangePlaylistArtwork.loadingFile")
      : upload.isPending
        ? t("components.music.ChangePlaylistArtwork.uploadingArtwork")
        : null,
    notice,
  };
};

export interface ChangePlaylistArtworkProps {
  source: ArtworkSource | null;
  /** Lado da capa (o Hero passa-o). */
  size?: number;
  change: PlaylistArtworkChange;
}

/** A capa, com o estado do envio por cima só enquanto há alguma coisa a dizer. */
export const ChangePlaylistArtwork = ({ source, size = 136, change }: ChangePlaylistArtworkProps) => {
  const message = change.notice ?? change.status;
  return (
    <View style={{ width: size, height: size, borderRadius: ART_RADIUS, overflow: "hidden" }}>
      <ArtworkImage source={source} size={size} borderRadius={ART_RADIUS} />
      {message ? (
        <FadeIn
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: NOTICE_SCRIM,
          }}
        >
          {change.busy ? <ActivityIndicator size="small" color={OVERLAY_INK} /> : null}
          <Text style={{ color: OVERLAY_INK, fontSize: 13, flex: 1 }} numberOfLines={3}>
            {message}
          </Text>
        </FadeIn>
      ) : null}
    </View>
  );
};
