/**
 * Artists REST (API.md section 8). PATCH is FLAT top-level (never nest under
 * `artist` - the web's nested body no-ops) and the banner upload field is
 * `banner` (the web's `image` field 400s). Do NOT copy the web bugs.
 */
import { request } from "../client";
import { pageModifier } from "../params";
import type { ListFilters } from "@/domain/api";
import type { ArtistId } from "@/domain/ids";
import type { Artist, ArtistMetadata, ArtistOverview } from "@/domain/artist";

export const ARTISTS_PAGE_SIZE = 60;

export const listArtists = (filters: ListFilters = {}): Promise<Artist[]> =>
  request("GET", "/artists", { params: filters });

export type ArtistsRosterOrder = "name:asc" | "created_at:desc";

/** One roster page (FR-37: infinite 60/page). */
export const listArtistsPage = (page: number, order: ArtistsRosterOrder): Promise<Artist[]> =>
  listArtists({ modifiers: { page: pageModifier(page, ARTISTS_PAGE_SIZE), order } });

/** Server-side roster search (debounced by the screen). */
export const searchArtists = (name: string): Promise<Artist[]> =>
  listArtists({
    search: { name },
    modifiers: { page: pageModifier(1, ARTISTS_PAGE_SIZE), order: "name:asc" },
  });

/** Cached 1h/user server-side. */
export const getArtistOverview = (): Promise<ArtistOverview> =>
  request("GET", "/artists/overview");

/** Resolves numeric id, slug, then canonical name; 404 "Artist not found". */
export const getArtist = (idOrSlug: string): Promise<Artist> =>
  request("GET", `/artists/${encodeURIComponent(idOrSlug)}`);

/** FLAT top-level body; gallery URLs must be http(s). */
export const updateArtist = (
  id: ArtistId,
  body: { name?: string; gallery_image_urls?: string[] },
): Promise<Artist> => request("PATCH", `/artists/${id}`, { body });

/** Refused (400) while song_artists still reference the artist. */
export const deleteArtist = (id: ArtistId): Promise<void> =>
  request("DELETE", `/artists/${id}`);

export const uploadArtistImage = (
  id: ArtistId,
  image: { uri: string; name: string; type: string },
): Promise<Artist> => {
  const formData = new FormData();
  formData.append("image", image as unknown as Blob);
  return request("POST", `/artists/${id}/upload_image`, { formData });
};

/** Field name is `banner`, NOT `image`. */
export const uploadArtistBanner = (
  id: ArtistId,
  banner: { uri: string; name: string; type: string },
): Promise<Artist> => {
  const formData = new FormData();
  formData.append("banner", banner as unknown as Blob);
  return request("POST", `/artists/${id}/upload_banner`, { formData });
};

/** Legacy Last.fm shim; ALWAYS 200 (unknown artist = all-null echo). */
export const getArtistMetadata = (name: string): Promise<ArtistMetadata> =>
  request("GET", `/artist_metadata/${encodeURIComponent(name)}`);
