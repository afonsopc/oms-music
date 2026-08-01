/** Artist imports REST (FR-104). Requires a linked Spotify IDENTITY (400
 *  "Connect Spotify first." / relink message), NOT the allowlist flag. */
import { request } from "../client";
import type {
  ArtistImport,
  ArtistImportAlbum,
  ArtistImportSearchResponse,
} from "@/domain/imports";

export const searchArtistImports = (q: string): Promise<ArtistImportSearchResponse> =>
  request("GET", "/artist_imports/search", { params: { q }, timeoutMs: 60_000 });

export const listArtistImportAlbums = (
  spotifyArtistId: string,
): Promise<{ items: ArtistImportAlbum[] }> =>
  request("GET", "/artist_imports/albums", {
    params: { spotify_artist_id: spotifyArtistId },
    timeoutMs: 60_000,
  });

export const createArtistImport = (body: {
  spotify_artist_id: string;
  spotify_artist_name: string;
  album_ids: string[];
}): Promise<ArtistImport> => request("POST", "/artist_imports", { body });

/** Note the { items } wrapper (max 50, newest first). */
export const listArtistImports = (limit = 20): Promise<{ items: ArtistImport[] }> =>
  request("GET", "/artist_imports", { params: { limit } });
