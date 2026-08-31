import type { FsNodeId, SongId, UserId } from "./ids";

/** song_artists JOIN row as embedded in Song payloads (API.md section 5). */
export interface SongArtistEntry {
  id: number;
  song_id: number;
  artist_id: number;
  position: number;
  role: "primary" | "featured" | "with";
  name: string;
  slug: string;
  image_media_id: FsNodeId | null;
  compressed_image_media_id: FsNodeId | null;
  picture: string | null;
  picture_medium: string | null;
  external_image_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The `artist_names` display field. Every backend serializer that emits it
 * (`Listening::Snapshot.song_hash`, `Jams::Serializer`) joins the names with
 * ", " into a single STRING; array payloads survive from the web's legacy
 * shape. Never index or `.join()` it: go through `domain/format`'s
 * `artistNamesLine` / `artistNamesList`.
 */
export type ArtistNames = string | string[];

export interface Song {
  id: SongId;
  created_at: string;
  updated_at: string;
  title: string;
  album: string | null;
  duration: number;
  position: number | null;
  year: number | null;
  audio_media_id: FsNodeId | null;
  compressed_audio_media_id: FsNodeId | null;
  artwork_media_id: FsNodeId | null;
  compressed_artwork_media_id: FsNodeId | null;
  vocals_media_id: FsNodeId | null;
  instrumental_media_id: FsNodeId | null;
  vocal_separation_started_at: string | null;
  user_id: UserId;
  source_kind: "upload" | "yt_dlp" | "spotify_sync" | null;
  source_provider: string | null;
  source_url: string | null;
  source_id: string | null;
  isrc: string | null;
  /**
   * Idioma CANTADO, em ISO 639-1 ("es", "pt", "ja"), tirado da letra pelo
   * servidor. `null` e "ainda nao sabemos" (musica sem letra guardada, ou
   * instrumental), nunca "sem idioma". Opcional porque as musicas guardadas
   * antes de 2026-08-31 (downloads, snapshots) nao o trazem.
   */
  language?: string | null;
  /** Etiquetas do Last.fm, minusculas, no maximo seis. Opcional, como acima. */
  tags?: string[];
  /** Batidas por minuto, pelo ISRC da gravacao. Nulo e comum. */
  bpm?: number | null;
  original_filename: string | null;
  audio_codec: string | null;
  audio_bitrate_kbps: number | null;
  audio_sample_rate_hz: number | null;
  audio_channels: number | null;
  audio_lossless: boolean | null;
  audio_filesize_bytes: number | null;
  artists: SongArtistEntry[];
  // jam-injected extras (present only on jam proposal entries)
  audio_url?: string;
  artwork_url?: string | null;
  artist_names?: ArtistNames;
  jam_song?: true;
  jam_proposer?: { id: UserId; handle: string; name: string };
  /** Marca uma intervenção falada do DJ. Ver {@link DjClipMeta}. */
  dj_clip?: DjClipMeta;
}

/**
 * Uma INTERVENÇÃO do DJ, na fila como se fosse uma música (dono,
 * 2026-08-31: "ele aparece a tocar como se fosse uma música"). Não é uma:
 * o áudio é um ficheiro local com a voz do Kokoro, o id é sintético e
 * negativo, e por isso o clip
 *
 *  - não conta play (player/recording.ts),
 *  - não se descarrega nem persiste (o `audio_url` já barra os downloads),
 *  - não vai pelo cabo para outro dispositivo (remote/publisher.ts tira-o
 *    da fila publicada: o ficheiro é local a quem está a ouvir),
 *  - não se arrasta nem se faz scrub, e não abre menu de música.
 *
 * Pô-lo na fila em vez de o tocar por fora é o que faz a passagem soar a
 * rádio: o motor encadeia voz e música com o mesmo leitor, sem pausar e
 * retomar (que era o "salto" da primeira versão do botão).
 */
export interface DjClipMeta {
  /** O que este bloco é, 2 a 5 palavras ("Late-night Portuguese soul"). */
  theme: string | null;
  /** As palavras ditas, para a página do DJ as mostrar enquanto ele fala. */
  script: string;
}

/** Guarda única para as regras acima. */
export const isDjClip = (song: Song | null | undefined): boolean => !!song?.dj_clip;

/** Cross-user song shape used by feeds, jams and profiles (SnapshotSong). */
export interface SnapshotSong {
  id: string;
  title: string;
  album: string | null;
  duration: number;
  owner_id: UserId;
  artist_names: ArtistNames;
  artwork_url: string | null; // presigned
}

/** VocalSeparation extended view. NO "canceled" status exists server-side. */
export interface VocalSeparation {
  id: string;
  created_at: string;
  updated_at: string;
  status: "pending" | "processing" | "complete" | "failed";
  model_id: string | null;
  duration_seconds: number | null;
  error: string | null;
  finished_at: string | null;
  song_id: SongId;
  user_id: UserId;
  ip_address: string | null;
  has_vocals: boolean;
  has_instrumental: boolean;
  has_original: boolean;
  song_title: string | null;
  progress_percent: number | null;
  queue_position: number | null;
  vocals_url: string | null;
  instrumental_url: string | null;
}

/** GET /songs/:id/separation response. */
export interface SongSeparationStatus {
  stems_ready: boolean;
  vocals_media_id: FsNodeId | null;
  instrumental_media_id: FsNodeId | null;
  progress_percent: number | null;
  job: VocalSeparation | null;
}
