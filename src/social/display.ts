/**
 * Display helpers for cross-user payloads (friends feed, jams, profiles).
 *
 * `artist_names` is DEFENSIVE on purpose: the frozen domain type declares
 * `string[]`, but every producing serializer on the backend
 * (Listening::Snapshot.song_hash, Jams::Serializer) emits a comma-joined
 * STRING. Rather than trust either shape, everything that renders a
 * cross-user artist line goes through here. See the note in the WP10
 * handover: the domain type is the one that should move.
 */

export const artistNamesLine = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(", ");
  }
  return "";
};

/** mm:ss for cross-user songs (they carry a plain `duration` in seconds). */
export const formatSnapshotDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
};

/**
 * Music profile artist image pick order (FR-120), verbatim from the web's
 * `musicProfileArtistImage`: the user-uploaded presigned image wins, then
 * the Deezer sizes largest-first, then the external fallback.
 */
export const musicProfileArtistImage = (artist: {
  image_url?: string | null;
  picture_big?: string | null;
  picture_xl?: string | null;
  picture_medium?: string | null;
  picture?: string | null;
  external_image_url?: string | null;
}): string | null =>
  artist.image_url ||
  artist.picture_big ||
  artist.picture_xl ||
  artist.picture_medium ||
  artist.picture ||
  artist.external_image_url ||
  null;
