/** Sync diário por artista (3.5): o contrato vive em
 *  docs/propostas/2026-08-17-artist-sync-diario.md. Sem o diff do backend
 *  aplicado responde 404; a UI degrada com honestidade. */
import { request } from "../client";

export interface ArtistSyncRow {
  id: number;
  spotify_artist_id: string;
  artist_name: string | null;
  enabled: boolean;
  last_checked_at: string | null;
  known_album_count: number;
}

export const listArtistSyncs = (): Promise<{ items: ArtistSyncRow[] }> =>
  request("GET", "/artist_syncs");

export const createArtistSync = (body: {
  spotify_artist_id: string;
  spotify_artist_name: string;
}): Promise<ArtistSyncRow> => request("POST", "/artist_syncs", { body });

export const deleteArtistSync = (id: number): Promise<unknown> =>
  request("DELETE", `/artist_syncs/${id}`);
