import type { Artist } from "./artist";
import type { Song } from "./song";

export type MixKind =
  | "top_artist"
  | "this_is"
  | "monthly_rewind"
  | "year_mix"
  | "repeat_rewind"
  | "time_capsule"
  | "discoveries";

export interface MixSummary {
  /** "mix:kind:..." - URL-ENCODE when building the request path, contains colons. */
  slug: string;
  kind: MixKind;
  /** English fallbacks - NEVER render these; use title_key/description_key. */
  title: string;
  description: string;
  title_key: string;
  title_params: Record<string, string | number>;
  description_key: string;
  description_params: Record<string, string | number>;
  seed: string | number | null;
  artist: Artist | null; // top_artist only
  gradient: unknown; // deliberately ignored; client owns kind gradients
}

export interface Mix extends MixSummary {
  songs: Song[];
}

export interface Radio {
  slug: string;
  kind: "artist" | "song";
  /** Pre-baked Portuguese; render as-is. */
  title: string;
  description: string;
  seed: string | number;
  gradient: unknown; // ignored
  songs: Song[]; // ~40; song radio: songs[0] is the seed
}
