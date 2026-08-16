/**
 * O slot "exportFiles" do menu da música (pedido do dono, 2026-08-16):
 * descarregar a música, o ficheiro original e os stems para FORA da app.
 * Nada disto toca no offline (downloads/) - é o utilizador a levar um
 * ficheiro consigo, por src/lib/exportMedia (blob no browser, comando Rust
 * no shell, share sheet no nativo).
 *
 * Regras de visibilidade, todas locais ao payload da música:
 *  - "música" = comprimida se existir, senão o original;
 *  - "original" só aparece quando há comprimida (senão era o mesmo byte);
 *  - stems só quando a separação já correu;
 *  - músicas de jam não têm nada (o payload é emprestado, mesmo critério do
 *    is_jam do Rust).
 */
import React from "react";
import { Alert } from "react-native";
import { registerSongMenuSlot, type SongMenuItem } from "@/contracts/songMenu";
import type { MediaId } from "@/domain/ids";
import { artistNamesLine } from "@/domain/format";
import { useT } from "@/i18n";
import { exportMedia } from "@/lib/exportMedia";

const K = "native.exports";

registerSongMenuSlot("exportFiles", (ctx) => {
  const t = useT();
  const [busy, setBusy] = React.useState<string | null>(null);
  const song = ctx.song;
  // Payload emprestado de um jam: nao ha media ids nossos para exportar.
  if (song.audio_url) return [];

  const artists = artistNamesLine(song.artists.length > 0 ? song.artists : song.artist_names);
  const base = artists ? `${artists} - ${song.title}` : song.title;

  const item = (
    id: string,
    labelKey: string,
    nodeId: MediaId | null,
    suffix: string,
  ): SongMenuItem | null => {
    if (!nodeId) return null;
    return {
      id,
      labelKey,
      icon: "download",
      disabled: busy != null,
      onPress: () => {
        setBusy(id);
        void exportMedia(nodeId, `${base}${suffix}`)
          .catch(() => {
            Alert.alert(t(`${K}.failed`));
          })
          .finally(() => setBusy((current) => (current === id ? null : current)));
      },
    };
  };

  const compressed = song.compressed_audio_media_id;
  return [
    item("export-song", `${K}.menuSong`, compressed ?? song.audio_media_id, ""),
    compressed ? item("export-original", `${K}.menuOriginal`, song.audio_media_id, " (original)") : null,
    item("export-vocals", `${K}.menuVocals`, song.vocals_media_id, " (voz)"),
    item("export-instrumental", `${K}.menuInstrumental`, song.instrumental_media_id, " (instrumental)"),
  ].filter((entry): entry is SongMenuItem => entry != null);
});
