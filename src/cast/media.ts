/**
 * As músicas para a TV. A TV não tem a sessão: pede-se ao servidor, de uma
 * vez, um URL assinado (24 h) por áudio e por capa (POST /media/cast_urls).
 * O token da sessão NUNCA entra num URL que vá para a TV (o imageUrl da app
 * leva-o; aqui não se usa). As músicas de jam já trazem URLs assinados.
 */
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { wantedNodeId } from "@/player/modes";
import type { CastItem } from "./types";

export interface SignedMedia {
  url: string;
  content_type: string | null;
}

export interface SignedBatch {
  items: Record<string, SignedMedia>;
  /** Para o receptor próprio ir buscar a análise e a letra (24 h). */
  vizToken?: string | null;
}

export type SignMedia = (ids: string[]) => Promise<SignedBatch>;

/** O que o receptor próprio precisa (o do Google ignora o customData). */
export interface CastVizContext {
  api: string;
}

/** O áudio que a TV toca: sempre a mistura (os stems e o karaoke são cá). */
const audioIdOf = (song: Song): string | null => {
  const id = wantedNodeId(song, "original");
  return id == null ? null : String(id);
};

const artworkIdOf = (song: Song): string | null => {
  const id = song.compressed_artwork_media_id ?? song.artwork_media_id;
  return id == null ? null : String(id);
};

/** Pelo nome do ficheiro, quando o servidor não diz (raro). */
const guessContentType = (song: Song): string => {
  const name = (song.original_filename ?? "").toLowerCase();
  if (song.compressed_audio_media_id) return "audio/mp4";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".ogg") || name.endsWith(".opus")) return "audio/ogg";
  if (name.endsWith(".wav")) return "audio/wav";
  return "audio/mp4";
};

/**
 * CastItems pela mesma ordem; uma música que não se consegue assinar (de
 * outra pessoa, apagada) fica de fora em vez de partir a fila inteira.
 */
export const buildCastItems = async (
  songs: Song[],
  sign: SignMedia,
  viz?: CastVizContext,
): Promise<CastItem[]> => {
  const ids = new Set<string>();
  for (const song of songs) {
    if (song.audio_url) continue;
    const a = audioIdOf(song);
    const art = artworkIdOf(song);
    if (a) ids.add(a);
    if (art) ids.add(art);
  }
  const batch: SignedBatch = ids.size > 0 ? await sign([...ids]) : { items: {} };
  const signed = batch.items;
  const custom = (song: Song): Record<string, unknown> => ({
    songId: String(song.id),
    tags: song.tags ?? [],
    bpm: song.bpm ?? null,
    ...(viz && batch.vizToken ? { viz: { api: viz.api, t: batch.vizToken } } : {}),
  });
  const items: CastItem[] = [];
  for (const song of songs) {
    const base = {
      key: String(song.id),
      title: song.title,
      artist: formatArtists(song),
      album: song.album ?? null,
      duration: song.duration ?? 0,
      custom: custom(song),
    };
    if (song.audio_url) {
      items.push({
        ...base,
        url: song.audio_url,
        contentType: "audio/mp4",
        artworkUrl: song.artwork_url ?? null,
      });
      continue;
    }
    const a = audioIdOf(song);
    const audio = a ? signed[a] : undefined;
    if (!audio) continue;
    const art = artworkIdOf(song);
    items.push({
      ...base,
      url: audio.url,
      contentType: audio.content_type || guessContentType(song),
      artworkUrl: art ? (signed[art]?.url ?? null) : null,
    });
  }
  return items;
};
