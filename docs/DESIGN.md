# DESIGN.md - Authoritative architecture for oms-music (Expo SDK 57, iOS + Android)

This document merges the three design proposals (design-playback.md, design-product.md,
design-shipping.md) into the single architecture every implementer codes against. Where the
proposals disagreed, the resolution is stated explicitly in section 15. Reading order for an
implementing agent: this doc, then SPEC.md for your FR numbers, then API.md for wire shapes,
then your topic doc.

Repo: `/Users/afonsocoutinho/Documents/oms-music`. Backend: `https://backend.omelhorsite.pt`,
unchanged, zero backend changes. Dev backend: `http://localhost:1143`.

Binding conventions for every work package:

- TypeScript strict. reactCompiler stays on; keep zustand selectors pure and stable.
- Never use the em-dash character anywhere (code, strings, comments, docs). Plain hyphens.
- All Portuguese copy is European Portuguese (PT-PT). New strings land in en + pt + lv in the
  same commit.
- Song ids are `number` in REST, `string` on the cable and in SQLite. `src/domain/ids.ts` is
  the ONLY legal conversion point (branded types + `toSongKey(n)` / `toSongId(s)`).
- Nobody edits files outside their package's ownership list (WORKPLAN.md). Changes to frozen
  contracts (section 14) go through the foundation owner as an explicit change request.
- All 126 FRs ship in v1 except the explicitly degraded items in section 16. Nothing in
  SPEC.md is silently dropped.

---

## 1. Directory layout under src/

One owning work package per top-level directory (ownership map in WORKPLAN.md). Route files
under `src/app/` are thin one-screen wrappers; screen logic lives in `src/features/<domain>/`;
shared visuals in `src/ui/`; all wire logic in `src/api/`, `src/cable/`, `src/player/`,
`src/downloads/`. Imports flow downward only:
`features -> (ui, api, player, downloads, cable, remote, jam, social, separation, i18n, theme, lib, domain, contracts)`;
`player/downloads/cable/remote/jam -> (api, domain, contracts, lib)`; nothing imports from
`features` except `src/app` route files and the pager/overlay hosts noted below.

```
src/
  app/                       expo-router tree (section 2). THIN wrappers only. WP2.
  domain/                    Frozen types + pure domain helpers, zero I/O. WP1.
    ids.ts                   SongId (number, REST), SongKey (string, cable/sqlite), FsNodeId,
                             UserId, toSongKey/toSongId, the only conversion point
    song.ts playlist.ts artist.ts album.ts user.ts playback.ts jam.ts social.ts
    mixes.ts lyrics.ts imports.ts downloads.ts api.ts       (section 4)
    format.ts                formatArtists / formatArtistsFull / duration mm:ss / tabular time
    artwork.ts               artwork URL fallback chains (song/playlist/artist), placeholder rule
    albumKey.ts              "album:<artistSlug>:<album>" composite key (lowercased; matches
                             backend (album, lead artist) grouping)
    rank.ts                  rankByMatch reimplementation (FR-30: mandatory client re-rank)
  contracts/                 Registration seams with inert defaults. WP1. (section 13)
    localSource.ts offlineFallback.ts transport.ts playbackInterceptor.ts songMenu.ts
  api/                       HTTP layer. WP1. (section 5)
    client.ts params.ts errors.ts queryClient.ts queryKeys.ts mediaUrl.ts
    endpoints/               one typed module per resource, request fns only (no hooks):
      sessions.ts users.ts songs.ts playlists.ts playlistSongs.ts likedSongs.ts
      playEvents.ts artists.ts fsNodes.ts lyrics.ts mixes.ts radios.ts jams.ts
      social.ts imports.ts separation.ts spotifySync.ts artistImports.ts
      serviceUsages.ts relationships.ts jobs.ts
    queries/                 react-query hooks per resource, mirrored file names
  auth/                      Session service layer. WP1.
    token.ts                 SecureStore accessor + in-memory sync mirror
    session.ts               zustand: { status: 'booting'|'anon'|'authed', session, user }
    guard.ts                 single-flight 401/404 verification, global authReady gate
    oauth.ts                 WebView ticket flow + /sessions/adopt (section 6)
    userAgent.ts             "oms-music/<ver> (<model>; <os> <osVer>)"
  db/                        SQLite open + migrations + kv facade. WP1. (section 9)
    index.ts schema.ts kv.ts
  i18n/                      WP1. (section 12)
    index.ts icu.ts mixLabels.ts catalogs/{en,pt,lv}.json
  theme/                     WP1. (section 11)
    tokens.ts provider.tsx gradients.ts accent.ts typography.ts
  lib/                       Pure helpers, unit-testable in bun. WP1.
    deepLinks.ts uuid.ts recentSearches.ts dates.ts
  player/                    The engine. WP3. (sections 7-8)
    queueOps.ts              pure quartet ops + sanitizeSnapshot (property-tested, no I/O)
    engine.ts                PlayerEngine singleton over one expo-audio AudioPlayer
    store.ts                 zustand UI mirror (position at 4 Hz max)
    resolver.ts              presigned URL cache by fs node id + prefetch one-shot slot
    sources.ts               source candidate ladder (uses contracts/localSource)
    recovery.ts              failure ladder + failedSongIds set + throttled toast
    recording.ts             forward-delta accumulator -> POST /play_events
    lockScreen.ts            setActiveForLockScreen metadata + remote command routing
    modes.ts                 playback mode node selection (original/instrumental/vocals/custom)
    sleepTimer.ts persistence.ts types.ts
  downloads/                 WP8. (section 9)
    manager.ts tasks.ts status.ts repair.ts collections.ts offlineLibrary.ts
    context.tsx register.ts
  cable/                     WP9. (section 10)
    client.ts types.ts
  remote/                    WP9. PlaybackChannel: presence, roles, snapshots.
    store.ts channel.ts publisher.ts controller.ts adoption.ts transport.ts register.ts
  jam/                       WP10.
    store.ts channel.ts followerPlayer.ts hostDuties.ts interceptor.ts register.ts
  social/                    WP10.
    listeningStore.ts notifications.ts
  separation/                WP11. Shared 3s poll service + trigger/delete + patch wiring.
    service.ts register.ts
  lyrics/                    WP7.
    lrc.ts translation.ts syncJob.ts offline.ts
  ui/                        Shared visual kit, no data fetching inside. WP4.
    ArtworkImage.tsx SongRow.tsx SongTable.tsx Tile.tsx Rail.tsx Hero.tsx ActionBar.tsx
    StickyTitle.tsx FilterPills.tsx PlayingBars.tsx LikedArtwork.tsx InitialsAvatar.tsx
    MiniPlayerPill.tsx SongMenu.tsx sheets/ dialogs/ skeletons/ EmptyState.tsx ErrorState.tsx
  features/                  Screen bodies. One folder = one owner (WORKPLAN).
    auth/ shell/ home/ search/ library/ liked/ playlists/ playlist/ artists/ artist/
    album/ mixes/ radios/ downloads/ player/ lyrics/ friends/ jam/ profile/ devices/
    settings/ import/
  boot/                      WP12 (scaffolded as an inert no-op by WP1, then owned by WP12).
    wireup.ts                imports every subsystem's register.ts; called from app/_layout
```

The existing template files (`src/components/*`, `src/hooks/*`, `src/constants/theme.ts`,
template routes) are deleted by WP2. `src/app` route files are created once by WP2 as
one-line wrappers (`export { default } from "@/features/home";`); WP2 also scaffolds each
`features/<domain>/index.tsx` placeholder (inline "not built yet" component, zero imports)
which the owning package replaces. After scaffolding, only the owner touches the folder.

---

## 2. Navigation tree (expo-router) - the 28 screens

Root `_layout.tsx` (WP2) renders the provider stack in this exact order:
`ThemeProvider > I18nProvider > QueryClientProvider > SessionGate > DownloadStatusProvider >
gesture root`, plus a side-effect import of `boot/wireup.ts` (inert until WP12 fills it; the
player engine, cable, remote, jam, and separation subsystems self-register through it).
`SessionGate` switches `(auth)` vs `(main)` on session status; `booting` shows splash.

Tab model: 4 tabs (Home, Search, Library, Downloads). Everything else pushes onto the
`(main)` stack above the tabs. The overlay host in `(main)/_layout.tsx` renders the
MiniPlayer pill (or JamBar while following a jam, or the emerald controller strip when
controlling another device) above every screen; every scrollable screen adds bottom padding
so lists are never covered (FR-16). The `(player)` group is a full-screen modal with a
swipeable pager across Now Playing / Queue / Lyrics / Friends (FR-17; Friends page is P1
content from `features/friends`, not counted as a screen, matching the web's rail tabs).

```
src/app/
  _layout.tsx                          providers + SessionGate + wireup import
  (auth)/
    _layout.tsx
    login.tsx                          1  Login (email+password; OAuth buttons P1; reset link)
    signup.tsx                         2  Signup (email -> 6-digit OTP -> name/password ->
                                          auto POST /sessions; OTP is a step, not a route)
    reset.tsx                          3  Password reset (start + end steps)
  (main)/
    _layout.tsx                        stack + overlay host (MiniPlayer/JamBar/controller strip)
    (tabs)/
      _layout.tsx
      home.tsx                         4  Home (Discover)
      search.tsx                       5  Search (recents + suggestions + full results)
      library.tsx                      6  Library (pills playlists/artists/albums)
      downloads.tsx                    7  Downloads (in-flight + downloaded + storage header)
    liked.tsx                          8  Liked songs (cursor-paged, purple hero)
    playlists.tsx                      9  Playlists list + create dialog
    playlist/[id].tsx                  10 Playlist detail
    artists.tsx                        11 Artists hub (overview: spotlight, stats, shelves)
    artists-roster.tsx                 12 Artists roster (infinite 60/page, sort, server search)
    artist/[artist].tsx                13 Artist (slug-or-name resolve, hero, popular, discog)
    album/[artist]/[album].tsx         14 Album ("null" segment = unknown album; receives
                                          optional context-artist and highlight params)
    mix/[slug].tsx                     15 Mix detail (slug URL-encoded, contains ":")
    radio/artist/[artist].tsx          16 Artist radio
    radio/song/[id].tsx                17 Song radio
    profile/[idOrHandle].tsx           18 Music profile (visible:false renders private state)
    settings/
      index.tsx                        23 Settings hub (+ theme and language rows inline)
      import.tsx                       24 Import (tabs: files, URL, Spotify, artist)
      songs.tsx                        25 Songs management (+ FR-126 metadata modifier row)
      artists.tsx                      26 Artists management (FLAT PATCH, banner field)
      playback.tsx                     27 Playback settings (share_listening)
      downloads.tsx                    28 Download settings (wifiOnly/includeStems/onlyDownloaded)
      devices.tsx                      P2 addendum: sessions list + rename current (FR-14)
  (player)/
    _layout.tsx                        full-screen modal pager host
    now-playing.tsx                    19 Now Playing
    queue.tsx                          20 Queue (pager page, also directly routable)
    lyrics.tsx                         21 Lyrics (pager page, also directly routable)
  jam.tsx                              22 Jam panel (members, rules, votes, invites, joinable)
```

Non-route surfaces: DevicePicker, SongMenu, AddToPlaylist, credits, confirm dialogs and the
import confirm sheet are bottom sheets. The friends listening strip is embedded in Home; the
fuller friends panel is the 4th pager page of `(player)`.

Deep links (FR-20): `lib/deepLinks.ts` parses `https://omelhorsite.pt/<locale>/music/...`:
strip locale prefix (`/en|/pt|/lv`), `?id=`/`?slug=` detail params, BOTH
`/music/artist/<a>/<al>` and `/music/album/<a>/<al>` forms landing on screen 14, artist
segment = slug or URL-encoded name, literal `"null"` album segment preserved (maps to
`exact_search[album]="\b"`). Registered for the `omsmusic://` custom scheme on both
platforms plus an unverified https intent filter on Android. iOS universal links require an
AASA file on omelhorsite.pt which does not exist; see section 16.

---

## 3. State split

- react-query: ALL server data. One QueryClient for the app lifetime; `staleTime` 25s,
  `retry: false`, no refetch-on-focus, `onlineManager` wired to NetInfo, `focusManager` to
  AppState. Every authed query is `enabled: authReady && ...` (FR-5/6).
- zustand: player store, remote store, jam store, social store, session store, download
  status store. Split selectors; position updates isolated in a leaf slice at 4 Hz max.
- expo-sqlite: offline library + download state (section 9), per-user database file.
- expo-sqlite/kv-store: settings, locale, recent searches, persisted listener settings,
  folder-import trackers.
- expo-secure-store: the session token only.

---

## 4. Domain types (frozen; field names match API.md exactly)

`src/domain/*.ts`. Every Blueprinter payload includes `id`, `created_at`, `updated_at`
(ISO 8601 strings) unless noted; views INHERIT base fields (extended = base plus extras).

```ts
// ids.ts
export type SongId = number & { __brand: "SongId" };          // REST
export type SongKey = string & { __brand: "SongKey" };        // cable + sqlite
export type FsNodeId = string;  export type UserId = string;  export type SessionId = string;
export type PlaylistId = number; export type ArtistId = number; export type JamId = number;
export const toSongKey = (id: number): SongKey => String(id) as SongKey;
export const toSongId = (key: string): SongId => Number(key) as SongId;

// song.ts
export interface SongArtistEntry {
  id: number; song_id: number; artist_id: number; position: number;
  role: "primary" | "featured" | "with";
  name: string; slug: string;
  image_fs_node_id: FsNodeId | null; compressed_image_fs_node_id: FsNodeId | null;
  picture: string | null; picture_medium: string | null; external_image_url: string | null;
  created_at: string; updated_at: string;
}
export interface Song {
  id: SongId; created_at: string; updated_at: string;
  title: string; album: string | null; duration: number; position: number | null;
  year: number | null;
  audio_fs_node_id: FsNodeId | null; compressed_audio_fs_node_id: FsNodeId | null;
  artwork_fs_node_id: FsNodeId | null; compressed_artwork_fs_node_id: FsNodeId | null;
  vocals_fs_node_id: FsNodeId | null; instrumental_fs_node_id: FsNodeId | null;
  vocal_separation_started_at: string | null;
  user_id: UserId;
  source_kind: "upload" | "yt_dlp" | "spotify_sync" | null;
  source_provider: string | null; source_url: string | null; source_id: string | null;
  isrc: string | null; original_filename: string | null;
  audio_codec: string | null; audio_bitrate_kbps: number | null;
  audio_sample_rate_hz: number | null; audio_channels: number | null;
  audio_lossless: boolean | null; audio_filesize_bytes: number | null;
  artists: SongArtistEntry[];
  // jam-injected extras (present only on jam proposal entries)
  audio_url?: string; artwork_url?: string | null; artist_names?: string[];
  jam_song?: true; jam_proposer?: { id: UserId; handle: string; name: string };
}
export interface SnapshotSong {   // cross-user song (feeds, jams, profiles)
  id: string; title: string; album: string | null; duration: number;
  owner_id: UserId; artist_names: string[]; artwork_url: string | null;  // presigned
}

// playlist.ts
export interface Playlist {
  id: PlaylistId; created_at: string; updated_at: string;
  name: string; user_id: UserId; artwork_fs_node_id: FsNodeId | null;
  source_kind: "manual" | "spotify_sync" | "imported" | null;
  source_provider: string | null; source_url: string | null;
  source_external_id: string | null;   // "liked" = Spotify liked mirror
  synced_at: string | null;
}
export const isSystemPlaylist = (p: Playlist) => !!p.source_kind && p.source_kind !== "manual";
export const isLikedMirror = (p: Playlist) => p.source_external_id === "liked";
export interface PlaylistSong {
  id: number;              // JOIN-ROW id (DELETE /playlist_songs/:id uses this)
  created_at: string; updated_at: string;
  playlist_id: PlaylistId; song_id: SongId; position: number; song: Song;
}
export interface LikedSong {
  id: number; created_at: string; updated_at: string;
  user_id: UserId; song_id: SongId; liked_at: string; song: Song;
}

// album.ts - NOT a server entity; the /songs/albums summary row
export interface AlbumSummary {
  name: string | null;                       // null = unknown album
  artist: Artist | string | null;            // legacy rows may be a bare string
  artist_slug: string | null;
  artwork_fs_node_id: FsNodeId | null;
}

// artist.ts
export interface Artist {
  id: ArtistId; created_at: string; updated_at: string;
  name: string; canonical_name: string; slug: string; user_id: UserId;
  image_fs_node_id: FsNodeId | null; compressed_image_fs_node_id: FsNodeId | null;
  banner_fs_node_id: FsNodeId | null; compressed_banner_fs_node_id: FsNodeId | null;
  mbid: string | null; lastfm_listeners: number | null; lastfm_playcount: number | null;
  external_image_url: string | null;
  picture: string | null; picture_small: string | null; picture_medium: string | null;
  picture_big: string | null; picture_xl: string | null;
  pictures_fetched_at: string | null; bio_fetched_at: string | null;
  similar_fetched_at: string | null;
  songs_count: number; fallback_artwork_fs_node_id: FsNodeId | null;
  // extended view (show/update) only:
  bio_html?: string | null; gallery_image_urls?: string[];
  similar?: { name: string; match: number; mbid: string | null }[];
}
export interface ArtistOverview {
  stats: { artists: number; songs: number; new_artists: number; seconds_played: number };
  heavy_rotation_window: "30d" | "all";
  spotlight: { artist: Artist; songs_count: number; albums_count: number; play_count: number } | null;
  heavy_rotation: { artist: Artist; play_count: number }[];
  similar: { seed: Artist; artists: Artist[] } | null;
  neglected: { artist: Artist; songs_count: number }[];
}

// user.ts
export interface User {
  id: UserId; handle: string; name: string; bio: string | null;
  country_code: string | null; email_is_public: boolean; gender_is_public: boolean;
  library_public: boolean; library_name: string | null; library_description: string | null;
  // conditional (self/admin):
  group?: string; email?: string; gender?: string | null;
  allowed_to_use_spotify?: boolean; share_listening?: boolean;
}
export interface Session {
  id: SessionId; created_at: string; updated_at: string;
  ip_address: string; user_agent: string; name: string; description: string | null;
  device_type: string; last_used_at: string; user_id: UserId;
  user?: User; token?: string;   // token view only (POST /sessions response)
}

// playback.ts
export type LoopMode = "none" | "one" | "all";
export type PlaybackMode = "original" | "instrumental" | "vocals" | "custom";
export interface QueueState {
  queue: Song[]; queueOrder: number[]; queueIndex: number; shuffle: boolean;
}   // currentSong = queue[queueOrder[queueIndex]]
export interface PlaybackSnapshot {
  v?: number; active_device_id: string | null;
  song_id: string | null; position: number; paused: boolean;
  queue: string[]; queue_index: number; queue_order: number[];
  loop_mode: LoopMode;               // default "all"
  shuffle: boolean; volume: number;  // volume is device-local, never adopted
  playback_rate?: number; playback_mode?: PlaybackMode;
  eq_low?: number; eq_mid?: number; eq_high?: number; eq_enabled?: boolean;
  separation_enabled?: boolean; vocal_volume?: number; instrumental_volume?: number;
  queue_songs?: Song[];              // omitted on slim state_changed
}
export interface PlaybackDevice {
  id: string; label: string; name?: string; device_type: string; description?: string;
  last_seen_at?: string; last_used_at?: string; online: boolean;
}

// jam.ts
export interface Jam {
  id: JamId; host_id: UserId;
  queue_mode: "everyone" | "host"; skip_mode: "majority" | "host" | "anyone";
  created_at: string; ended_at: string | null;
  members: { id: UserId; handle: string; name: string; is_host: boolean; joined_at: string }[];
}
export interface JamState {
  song: (SnapshotSong & { audio_url: string }) | null;
  position: number; paused: boolean;
  upcoming?: { id: string; title: string; duration: number; artist_names: string[];
               artwork_url: string | null; proposer: { id: UserId; handle: string } | null }[];
  server_time: number;   // epoch ms
}

// social.ts
export interface FriendListening {
  user: { id: UserId; handle: string; name: string };
  song: SnapshotSong | null;         // null when sharing off
  paused: boolean; online: boolean; jam_id: number | null; updated_at: string | null;
}
export interface MusicProfile {
  visible: boolean;
  now_playing?: FriendListening;
  top_artists?: (Pick<Artist, "id" | "name" | "slug" | "picture" | "picture_medium" |
    "picture_big" | "picture_xl" | "external_image_url"> &
    { image_url: string | null; play_count: number })[];
  top_songs?: (SnapshotSong & { play_count: number })[];
  recent?: (SnapshotSong & { last_played_at: string })[];
  plays_30d?: number;
}

// mixes.ts
export type MixKind = "top_artist" | "repeat_rewind" | "time_capsule" | "discoveries";
export interface MixSummary {
  slug: string;                       // "mix:kind:..." - URL-ENCODE, contains colons
  kind: MixKind;
  title: string; description: string; // English fallbacks - NEVER render these
  title_key: string; title_params: Record<string, string | number>;
  description_key: string; description_params: Record<string, string | number>;
  seed: string | number | null;
  artist: Artist | null;              // top_artist only
  gradient: unknown;                  // deliberately ignored; client owns kind gradients
}
export interface Mix extends MixSummary { songs: Song[]; }
export interface Radio {
  slug: string; kind: "artist" | "song";
  title: string; description: string; // pre-baked Portuguese, render as-is
  seed: string | number; gradient: unknown;   // ignored
  songs: Song[];                      // ~40; song radio: songs[0] is the seed
}

// lyrics.ts
export interface Lyrics { synced: string | null; plain: string | null; attribution: string | null; }
export interface LyricsTranslation extends Lyrics { target: string; }
export interface LrcLine { time: number; text: string; }   // text "" renders placeholder dot
export interface Job {
  id: string; job_type: string; payload: unknown;
  status: "pending" | "processing" | "complete" | "failed" | "canceled";
  progress: number | null; started_at: string | null; finished_at: string | null;
  result: unknown; error: string | null; creator_id: UserId;
  created_at: string; updated_at: string;
}

// imports.ts  (SongImport, ArtistImport, SpotifySyncStatus, DownloaderPreview,
//  ExternalSearchResult - fields verbatim from API.md sections 11)
export interface SongImport {
  id: number; created_at: string; updated_at: string; user_id: UserId;
  playlist_id: PlaylistId | null; song_id: SongId | null;
  source_url: string | null; source_provider: string | null; source_id: string | null;
  source_kind: "yt_dlp" | "spotify_sync" | null;
  override_title: string | null; override_artist: string | null; override_album: string | null;
  expected_duration_s: number | null; position: number | null;
  sidecar_request_id: string | null;
  state: "pending" | "processing" | "complete" | "failed";
  progress_message: string | null; progress_pct: number | null;  // FLOAT 0..1
  error_message: string | null; deduped: boolean;
}

// downloads.ts
export type DownloadKind = "mixed" | "mixed_original" | "artwork" | "vocal" | "instrumental";
export type DownloadFileStatus = "queued" | "downloading" | "done" | "error";
export type SongDownloadStatus = "none" | "queued" | "downloading" | "done" | "error";
export interface DownloadEntry {              // mirrors the dl_files row
  song_key: SongKey; kind: DownloadKind; status: DownloadFileStatus;
  node_id: FsNodeId; sibling_node_id: FsNodeId | null;
  filename: string; local_uri: string | null;
  progress: number; size_bytes: number; savable: string | null; error: string | null;
  created_at: number; updated_at: number;
}
export type LyricsState = "unfetched" | "none" | "cached";   // FR-81 tri-state

// api.ts
export class ApiError extends Error {
  status: number; message: string; retryAfter?: number; body?: unknown;
}
export interface ListModifiers { page?: `${number}:${number}`; order?: string; random?: boolean; }
```

Artist display rules (domain/format.ts): sort `artists` by `position`; primaries joined
`", "`; `(feat. X)` for featured; `with` roles only in credits and lock-screen metadata
(`formatArtistsFull`). Artist image chain (domain/artwork.ts): compressed upload > upload >
Deezer picture by size (small contexts: picture_medium; hero: picture_xl/picture_big) >
picture > gallery[0] > fallback_artwork node > external_image_url > initials avatar. Song
and playlist artwork missing at the end of a chain ALWAYS falls back to the ONE shared
placeholder photo asset, never a letter tile or icon (FR-21); initials avatars are legal
only for pictureless artists in card grids.

---

## 5. API client (frozen contract)

`api/client.ts`:

```ts
interface RequestOpts {
  params?: Record<string, unknown>;  // GET query, bracket-encoded, null -> "\b"
  body?: unknown;                    // JSON body, deep null -> "\b" rewrite
  formData?: FormData;               // multipart, sent VERBATIM (sentinel exempt)
  raw?: boolean;                     // skip sentinel rewrite (WebAuthn ceremonies)
  auth?: boolean;                    // default true; false for public endpoints
  timeoutMs?: number;                // default 20s; imports pass 120s+
}
export function request<T>(method: HttpMethod, path: string, opts?: RequestOpts): Promise<T>;
```

Behavior, all mandatory:

1. **Token attachment.** `Authorization: Bearer <token>` on every authed request (the server
   strips exactly 7 chars, so the `Bearer ` prefix is mandatory). Token comes from the
   in-memory mirror in `auth/token.ts` (SecureStore is async; the mirror is sync). When the
   session store is `anon`, authed requests THROW locally before hitting the network
   (protects the anon 120/min/IP bucket). Meaningful `User-Agent` from `auth/userAgent.ts`
   on every request.
2. **Null sentinel (FR-3).** `api/params.ts` deep-rewrites every `null` in params AND JSON
   bodies to the literal one-char string `"\b"` (backspace). FormData and `raw: true`
   payloads are exempt and sent verbatim. Omitting a key means "no filter / unchanged".
   `exact_search[album]="\b"` is how the unknown-album screen queries IS NULL.
3. **Bracket encoding (FR-4).** axios-style: `search[title]=x`, `exact_search[artist]=Y`,
   `modifiers[page]=N:SIZE` (1-based, SIZE clamped 500 server-side; a missing page forces
   1:500 - ALWAYS send explicit pages), `modifiers[order]=col:asc|desc`,
   `modifiers[random]=true`, arrays as `key[]=a&key[]=b`. Unknown filter keys 400 - never
   ship one.
4. **Errors (FR-5).** Bodies are bare JSON strings (`"Song not found"`), occasionally arrays
   of validation messages, structured only for rate limits. Parse defensively into
   `ApiError { status, message, retryAfter?, body? }`. 429: read `retry_after` from the body
   plus the `Retry-After` header; a helper `parkQueryKey(key, untilMs)` pauses the affected
   query; NEVER a retry storm (each 429 pages the owner on Discord).
5. **401/404 discipline.** Any 401 from an authed endpoint, and any fs_node 404 while
   believed-authed, calls `guard.verify()`: ONE single-flight `GET /sessions/mine`. Probe
   succeeds -> transient / genuinely missing file, resume. Probe 401s -> flip
   `authReady = false` FIRST (parks all queries, stops the cable, pauses download enqueues,
   silences the publisher), then wipe token + caches and show login. No caller ever retries
   on its own.
6. **304.** The client sends `cache: "no-store"` and no manual validators. If the native
   stack still surfaces a 304 with an empty body, resolve with the previous data for that
   query (react-query structural sharing); never treat it as an error. Note: `modifiers[random]`
   responses carry no ETag.
7. **Media URLs** (`api/mediaUrl.ts`): `imageUrl(nodeId)` = `/fs_nodes/<id>/data?token=<token>`
   (302-following, rate-limit EXEMPT: use for ALL images and downloads);
   `avatarUrl(userId)` = `/users/<id>/picture` (public, NO token). Presigned resolution
   `fsNodes.resolveDataUrl(nodeId)` = `GET /fs_nodes/:id/data_url -> { url }` (6h validity,
   different every call, COUNTS against the 600/min ceiling: only the player uses it, via
   the cache in `player/resolver.ts`, section 8.2). Cache media by fs node id, NEVER by URL.
8. **Pagination helpers.** `pagedList` (explicit `N:SIZE`, short page = end of list) and
   `cursorLiked(before)` for `GET /liked_songs?limit=100&before=<liked_at>` (strictly
   less-than cursor).

`api/queryClient.ts`: the one QueryClient (section 3 defaults). `api/queryKeys.ts`: the
complete key namespace written up front (`keys.songs.list(f)`, `keys.likedIds`,
`keys.playlistSongs(id)`, `keys.artistOverview`, `keys.lyrics(songId)`, ...); invalidation
targets (imports invalidate songs/albums/artists/playlists; like toggles patch `likedIds`)
are part of the frozen contract.

---

## 6. Auth flows (FR-7..14)

- **One establishment path.** Every method ends on `auth/session.ts#establishSession(token,
  seed?)`: store the token, clear the query cache, flip the store to authed, then
  `setAuthReady(true)` so the cable registrars reconnect. Password and passkey pass the
  session they already received (both answer the full `:token` view); `/sessions/adopt`
  returns only a token, so it passes nothing and the helper reads `GET /sessions/mine`.
  Adding a fourth method means obtaining a token and calling it, never re-implementing the
  store writes.
- **Login.** `POST /sessions { email, password }` -> `establishSession`. Four real outcomes,
  told apart by `auth/authErrors.ts#classifyLoginError`: 401 bare string (wrong
  credentials), **422 with an EMPTY body (the account is DEACTIVATED** - `sessions.create!`
  trips `user_not_deactivated`, Rails' `PublicExceptions` finds no `public/422.html` and
  passes through), 429 (10/min per IP, holds the button for the reported window), 5xx.
  A body with no `password` key makes the server 500, so `login()` refuses to send one.
- **Signup.** `create_start` (409 "Email already registered." inline) -> OTP step (6 digits,
  15 min TTL, 5 attempts; resend disabled-with-countdown respecting 4/min + 20/h) ->
  `create_end` (does NOT log in) -> immediate `POST /sessions` -> Home. `*_end` answers the
  same 404 for a wrong, an expired AND a burned code, so the screens carry an `auth/otp.ts`
  budget and say which one it is; `create_end` also destroys the code BEFORE `User.create`,
  so a 422 on the account fields leaves a spent code and sends the user back to resend.
- **Reset.** `reset_password_start` (always 200, anti-enumeration copy) -> code + new
  password -> `reset_password_end` -> login prefilled. Same code budget as signup, and the
  same shared `verify_start` bucket, so the same client-side send cooldown.
- **Boot.** Stored token -> `GET /sessions/mine` then `GET /users/:id` behind splash; 401
  wipes and shows login; NETWORK FAILURE keeps the token and enters authed-offline (offline
  library still browses and plays, FR-91). Account payload gates Spotify UI
  (`allowed_to_use_spotify`) and share_listening.
- **Logout.** `DELETE /sessions/current` best-effort (the id is ignored; the server always
  kills the caller); wipe token, zustand stores, query cache, cable, download scheduler even
  on failure. SQLite files persist on disk namespaced per user id (re-login finds the
  library intact; a DIFFERENT user gets their own db + directory).
- **OAuth (FR-12, P1).** The callback is hardcoded server-side to
  `https://omelhorsite.pt/account/oauth/callback?ticket=...|?error=<code>`; no custom-scheme
  redirect exists. `react-native-webview` renders `/auth/<provider>?mode=<signin|signup>`;
  BOTH `onShouldStartLoadWithRequest` and `onNavigationStateChange` run the interception,
  because Android often reports only the final URL of a redirect chain. The match is on host
  plus normalised path, NOT a literal prefix: the apex 302s
  `/account/oauth/callback` to `/<locale>/account/oauth/callback/` (`_redirects:32`), so the
  URL that reaches the app may be locale prefixed and trailing slashed. Extract `ticket`
  (2 min TTL) -> `POST /sessions/adopt` -> `establishSession`, or `error` -> i18n copy
  (account_exists / account_not_found / unauthorized / conflict / internal /
  spotify_not_allowlisted). The legacy `?token=` branch is parsed and REFUSED: adopting a
  raw session token out of a URL is a fixation primitive the app has no use for. GitHub and
  Spotify ship, Google is hidden for a settled reason (section 16.4). Spotify account
  LINKING reuses the same WebView against `/auth/link/spotify?token=<session token>`, and
  its `?error=spotify_not_allowlisted` refusal is EXPLAINED in the Spotify tab rather than
  closing the sheet silently.
- **Passkeys (FR-13, P2).** IMPLEMENTED 2026-08-03, see `docs/PASSKEYS.md`. Sign in, register
  and manage passkeys against `/webauthn_credentials/*`; WebAuthn payloads are `raw: true`
  (sentinel bypass). What is left is domain and signing configuration outside this repo, not
  code. Section 16.
- **Devices (FR-14, P2).** `GET /sessions` list; rename current via `PATCH /sessions/:id`;
  NO fake revoke-other button (DELETE always kills the caller).

---

## 7. Player: queue model and store (frozen contract)

### 7.1 Queue quartet (`player/queueOps.ts`, pure, property-tested)

`QueueState = { queue, queueOrder, queueIndex, shuffle }`; the audible song is
`queue[queueOrder[queueIndex]]`. All operations `(state, args) -> state`, exact web
semantics (FR-57):

- `setQueue(songs, shuffle)`: order = identity, or a full shuffle of identity when shuffle
  is on; index 0.
- `setQueueIndex(visibleIndex)`.
- `setShuffle(on)`: the ONLY reshuffle point. ON: `order = [currentBackingIdx,
  ...shuffle(rest)]`, index 0. OFF: order = identity, index = natural position of the
  current song. Same-value toggle = no-op.
- `addToQueue(song)`: append to queue AND to the end of order.
- `playNext(song)`: append to queue; splice its backing index into order at queueIndex + 1.
- `reorderQueue(fromVisible, toVisible)`: move within order; cursor fixups (moved current
  row: index follows; from before to at/after cursor: index - 1; from after to at/before:
  index + 1).
- `removeFromQueue(visibleIndex)`: REFUSE when visibleIndex === queueIndex; remove the order
  entry and the backing entry; remap every order value > removedBackingIdx down by one;
  decrement index if the removed visible row was before it.
- `sanitizeSnapshot(queueSongs, order, index)`: drop `jam_song` entries with order/index
  remap, validate order is a permutation (else identity), clamp index. Used on EVERY
  snapshot adoption.
- `insertJamProposal(song)`: insert after current, BEHIND earlier pending proposals (FIFO
  scan of contiguous `jam_song` entries after the cursor).
- `nextIndex(state, loop)` / `previousIndex(state, loop, position)` helpers.

Invariants (fast-check-style property tests over random op sequences): order is always a
permutation of `0..queue.length-1`; index in `[0, order.length)` or queue empty; remove and
reorder never change the audible song.

### 7.2 Player store (`player/store.ts`, zustand UI mirror)

```ts
interface PlayerStoreState {
  queue: Song[]; queueOrder: number[]; queueIndex: number; shuffle: boolean;
  currentSong: Song | null;
  position: number; duration: number;         // leaf slice, 4 Hz max
  playing: boolean; buffering: boolean;
  loopMode: LoopMode;                          // default "all"
  volume: number; rate: number;                // rate 0.5..1.5
  playbackMode: PlaybackMode;
  separationEnabled: boolean; vocalVolume: number; instrumentalVolume: number;
  eqLow: number; eqMid: number; eqHigh: number; eqEnabled: boolean;
  sleepTimer: { minutes: number; endsAt: number } | { endOfSong: true } | null;
  failedSongKeys: ReadonlySet<SongKey>;
}
```

The store is a MIRROR: the synchronous source of truth for the quartet is a ref inside the
engine. Scrub bars, MediaSession and all UI read the store, never the AudioPlayer.
Persistence (`player/persistence.ts`, kv-store, debounced 250 ms; FR-65): rate, volume,
separationEnabled, playbackMode (`custom` restores as `original`), vocalVolume,
instrumentalVolume, EQ bands (NOT eqEnabled), loopMode. The queue is NEVER persisted
locally: the server snapshot is the account queue.

### 7.3 PlayerEngine public API (`player/types.ts`, frozen)

One `PlayerEngine` singleton (plain TS class, no React) owning a SINGLE `AudioPlayer` from
`createAudioPlayer()`. `AudioPlaylist` is NOT used: presigned rotation, the failure ladder,
repeat-one-on-ended, and jam/remote interception require JS-owned transitions.

```ts
type TransitionCause = "user" | "auto" | "hydration" | "activation" | "recovery" | "mode" | "patch";
type EngineEvent = "songChanged" | "status" | "ended" | "audiblePlaying"
                 | "streamError" | "queueChanged" | "playStateChanged";
interface PlayerEngine {
  // queue (delegate to queueOps, then reconcile the audio source)
  setQueue(songs: Song[], startIndex?: number, opts?: { shuffle?: boolean }): void;
  setQueueIndex(visibleIndex: number): void;
  setShuffle(on: boolean): void;
  addToQueue(song: Song): void;
  playNext(song: Song): void;
  reorderQueue(fromVisible: number, toVisible: number): void;
  removeFromQueue(visibleIndex: number): void;
  patchQueueSong(songId: SongId, patch: Partial<Song>): void;   // cause "patch": never restarts
  adoptSnapshot(s: QueueState, opts: { position: number; paused: boolean;
    cause: "hydration" | "activation" }): void;
  // transport
  play(): void; pause(): void; toggle(): void;
  next(cause?: TransitionCause): void; previous(): void;
  seek(seconds: number): void;
  setVolume(v: number): void; setRate(r: number): void;
  setLoopMode(m: LoopMode): void; setPlaybackMode(m: PlaybackMode): void;
  setSleepTimer(t: { minutes: number } | { endOfSong: true } | null): void;
  playFromIdle(): void;            // re-resolves when the source was cleared (controller)
  stopAndClearSource(): void;      // becoming controller: force-pause + clear
  // events
  on(event: EngineEvent, cb: (payload: unknown) => void): () => void;
}
```

Seams (registered through `src/contracts`, never imported downward): playback interceptor
(jam proposals consume "user" plays), LocalFileIndex (offline files), TransportActions
provider (remote decorator). Every UI surface and the lock screen calls the TRANSPORT layer
(`contracts/transport.ts`), never the engine directly; the default transport is the engine.

---

## 8. Player: transitions, sources, recovery, recording, lock screen

### 8.1 Transitions (FR-59)

- `transitionGen` increments on EVERY transition; all async continuations (URL resolve,
  delayed play, pending-seek application) capture the gen and bail when stale.
- `loadingSongId` guards the resolve: a late data_url answer for a skipped song is dropped.
- `requestedNodeId` records what the player was last pointed at. `patch` transitions compare
  wanted node vs requestedNodeId: same -> do nothing (never restart a playing track);
  different AND the mode wants a stem -> swap source preserving position + play state
  (stale-queue reconciliation when separation finishes).
- `pendingSeek`: seeks issued before a finite duration is reported are stored and applied on
  the first status with `duration > 0` for the current gen.
- Autoplay per cause: `user`/`auto` -> play; `hydration` -> load + pendingSeek, stay paused;
  `activation` -> honor the remote `paused` flag + seek to the remote position; `patch` /
  same-song re-runs -> never restart. `intendedPlay` survives async gaps so recovery knows
  whether to resume.

### 8.2 Presigned cache + source ladder (FR-55/56/90; `player/resolver.ts` + `sources.ts`)

`resolver.resolve(nodeId, { fresh? })`: Map keyed by fs node id (NEVER URL); in-flight
promise dedupe; 2 attempts of `GET /fs_nodes/:id/data_url`; an entry is reusable only for
playback START and only within a 5 minute freshness window (matches the web's
PREFETCHED_URL_TTL); `fresh: true` (error recovery) bypasses and hard-invalidates. Never
point the player at `/fs_nodes/:id/data`.

`sources.resolve(song, mode)` returns an ordered candidate list; the engine tries each until
one is accepted (first status without error). A candidate error BEFORE `audiblePlaying`
moves to the next candidate, not into the failure ladder:

1. `song.audio_url` present (jam proposal) -> use verbatim, single candidate; never resolve
   another user's fs nodes.
2. Wanted node by mode: `instrumental` -> instrumental_fs_node_id; `vocals` ->
   vocals_fs_node_id (either missing -> fall through to the plain mix); `original` /
   `custom` / fallback -> `compressed_audio_fs_node_id || audio_fs_node_id`. `custom` keeps
   pointing the MAIN player at the plain mix on purpose: per amendment 16.A that player is
   muted and serves as the clock and lock-screen owner while the mixer plays the stems,
   resolved separately by `resolveStemSource` (never part of this ladder).
3. Local-first via `contracts/localSource.ts` LocalFileIndex: plain mix -> local
   `mixed_original` file (quality upgrade; may fail iOS decode) then local `mixed`; stems ->
   local stem file. `file://` URIs. Decoder rejections fall through SILENTLY (FLAC-on-iOS
   case), they never mark the song failed.
4. Network: presigned URL from the resolver.

Prefetch (FR-60): on status when `duration - position <= 30`: skip when role controller,
LoopMode.One, no upcoming entry, upcoming is a jam song, or upcoming in failedSongKeys.
Resolve the upcoming song's wanted node into a one-shot slot `{ songKey, nodeId, url,
resolvedAt }`; honored only on songKey AND nodeId match within 5 min; cleared on use; one
in-flight prefetch per song.

### 8.3 Failure recovery (FR-61; `player/recovery.ts`)

1. First stream error for a songKey: capture position as pendingSeek; invalidate the node's
   cache entry; fresh resolve; reload; resume if `intendedPlay || playing`.
2. Second failure for the same songKey (or both resolve attempts failing): add to
   session-scoped `failedSongKeys`; toast "song unavailable" throttled to one per 3 s;
   advance +1 (wrap only under LoopMode.All); STOP the chain if the next entry is also
   failed. A song later reaching `audiblePlaying` leaves the failed set.

### 8.4 Ended, loop, previous (FR-58)

`ended` (didJustFinish): reset the listen accumulator; LoopMode.One -> seek 0 + play (NEVER
a native loop flag: ended must keep firing for the end-of-song sleep timer and accumulator
reset); else `next("auto")`. `next`: index + 1, wrap under All else clamp; a computed index
equal to current (single-song queue under All) restarts the source and plays. `previous`:
position > 3 s (or first entry under LoopMode.None) -> seek 0; else index - 1, wrap only
under All. Default loop mode: All.

### 8.5 Play recording (FR-62; `player/recording.ts`)

Accumulate forward status deltas in (0, 2) s; at `min(30, duration/2)` accumulated, POST
`/play_events { song_id }` fire-and-forget; reset on song change AND natural end (repeats
count again); never for `jam_song` entries or transferred-in seeds (the origin device
counted them). Scrubbing never inflates plays.

### 8.6 Lock screen + remote commands (FR-54/63; `player/lockScreen.ts`)

- `player.setActiveForLockScreen(true, metadata)` on EVERY song change, play-state change
  and metadata patch. Android hard requirement: background audio dies at ~3 min without it.
- Metadata: title, artist = `formatArtistsFull(song)`, album, artwork = local downloaded
  artwork file when present else `imageUrl(artworkNode)`. Fresh object per song. Metadata
  follows the song the user is HEARING ABOUT: the snapshot song on a controller, local
  otherwise.
- Remote command events (play/pause/next/prev/seek, +10/-10 jumps) are registered ONCE and
  dispatch through `contracts/transport.ts`, so a controller's lock-screen next advances the
  remote device once WP9 registers the decorator.
- Audio session: playback category, background enabled (plugin). Interruption (call) ->
  pause + publish truth; never auto-resume on Android.
- Volume 0..1; rate 0.5..1.5 with `shouldCorrectPitch: false` (deliberate pitch shift);
  sleep timer minutes (5/10/15/30/60) via engine timeout or endOfSong one-shot; not
  persisted (FR-64).

### 8.7 Playback modes and separation (FR-68/71; `player/modes.ts` + `src/separation`)

v1 ships `original`, `instrumental`, `vocals`, and the full separation lifecycle. Mode
switches capture position + play state and swap the source with pendingSeek (cause "mode").
Separation: explicit `POST /songs/:id/separate` (optional model_id); ONE shared 3 s
react-query poll per song id of `GET /songs/:id/separation` that parks on "no job, no
stems" and stops on stems_ready/terminal (`complete|failed` only - there is NO "canceled");
projection idle/pending/processing/ready/failed with a live elapsed m:ss counter; on ready
`engine.patchQueueSong` injects stem ids in place (never restarts); `DELETE
/songs/:id/separation` removes stems. Menu item disabled/relabelled while processing;
disabled for jam songs and on controllers. Custom blend + EQ: see amendment 16.A
(2026-08-03) - they ship, the muted main player stays the clock and the lock-screen owner
while a native mixer produces the blend from the two stem files.

Separation service interface (frozen so WP7's cog and WP11's songs screen share it):
`useSeparationStatus(songId)` -> `{ phase, progressPercent, elapsedSeconds, job }`;
`triggerSeparation(songId, modelId?)`; `deleteSeparation(songId)`.

### 8.8 Accent extraction (FR-66; `theme/accent.ts`)

Average color of the artwork; saturate +20; brighten +50 (light) / -50 (dark); BOTH theme
variants computed and cached per song id (LRU 100) with a stale-async guard; fallback
`#FF5555`. Hero variant: saturation -10, brightness -60 dark / +40 light, fallback
`#222222`. Theme flips restyle gradients without re-downloading bytes.

---

## 9. Downloads and offline (FR-82..94)

### 9.1 SQLite DDL (frozen; `db/schema.ts`, database file `oms-music-<userId>.db`)

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dl_songs (
  song_key     TEXT PRIMARY KEY,           -- String(song.id): the ONE storage representation
  song_json    TEXT NOT NULL,              -- full Song payload, stored BEFORE any bytes
  stored_at    INTEGER NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched'
               CHECK (lyrics_state IN ('unfetched','none','cached')),   -- FR-81 tri-state
  lyrics_json  TEXT
);

CREATE TABLE IF NOT EXISTS dl_files (
  song_key        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                  ('mixed','mixed_original','artwork','vocal','instrumental')),
  status          TEXT NOT NULL CHECK (status IN ('queued','downloading','done','error')),
  node_id         TEXT NOT NULL,           -- fs node the bytes came from (repair key)
  sibling_node_id TEXT,                    -- mixed_original only: the compressed node it upgrades
  filename        TEXT NOT NULL,           -- "<song_key>_<kind>.<realExt>" (m4a/mp3/flac/jpg...)
  local_uri       TEXT,                    -- file:// once done
  progress        REAL NOT NULL DEFAULT 0,
  size_bytes      INTEGER NOT NULL DEFAULT 0,   -- file stat on completion
  savable         TEXT,                    -- serialized DownloadTask.savable() for re-attach
  error           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (song_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_dl_files_status ON dl_files (status);

CREATE TABLE IF NOT EXISTS offline_collections (
  key      TEXT PRIMARY KEY,               -- '<playlistId>' or 'album:<artistSlug>:<album>'
  added_at INTEGER NOT NULL
);
```

Settings (wifiOnly=false, includeStems=true, showOnlyDownloaded=false), locale, recent
searches (max 6), listener settings and folder-import trackers live in
`expo-sqlite/kv-store`. Files live under a per-user directory
`<documents>/oms-downloads/<userId>/` with real extensions, excluded from cloud backup.
Per-user db + per-user directory resolve account switching (no shared-store purge logic).

### 9.2 Download engine (`downloads/manager.ts` + `tasks.ts`)

- `download(song, opts)`: refuse jam songs; WiFi gate AT ENQUEUE (NetInfo probe; refuse with
  a clear i18n message, PT-PT "Sem WiFi - transferencia recusada."; never silently queue;
  allow when the probe fails); write the `dl_songs` row first; best-effort lyrics fetch into
  the tri-state; enqueue kinds `mixed` (compressed || original node), `mixed_original` (only
  when the original node differs from compressed), `artwork` (compressed-first),
  `vocal`/`instrumental` when includeStems and ids exist. Dedup: enqueue no-ops when that
  (song_key, kind) is `done` or `downloading` - idempotency is what makes repair and
  keep-synced trivial.
- Transfer: JS scheduler, 3 concurrent, over `File.createDownloadTask` with
  `sessionType: 'background'` on iOS. Source URL = `/fs_nodes/:id/data?token=<token>` built
  at DEQUEUE time (redirect-following, rate-exempt, never expires unlike a presigned URL);
  the task must NOT forward an Authorization header onto the presigned S3 hop (S3 rejects
  double auth). Savables persisted per row on task create; on boot,
  `DownloadTask.fromSavable()` re-attaches every `queued`/`downloading` row; unresumable
  savables are dropped and re-enqueued by repair. Completion stats the file into size_bytes.
- Progress events update the row + the in-memory status map, then bump ONE coarse version
  counter throttled to ~4 Hz - the FR-82 contract.

### 9.3 DownloadStatusContext (frozen contract; `downloads/context.tsx`)

```ts
interface DownloadStatusApi {
  getStatus(songId: SongId | SongKey): SongDownloadStatus;   // reads the "mixed" kind only
  getProgress(songId: SongId | SongKey): number;             // 0..1
  subscribe(cb: () => void): () => void;                     // one coarse version counter
  download(song: Song): Promise<void>;
  downloadMany(songs: Song[]): Promise<void>;
  remove(songId: SongId | SongKey): Promise<void>;
  isOfflineCollection(key: string): boolean;
  toggleOfflineCollection(key: string, songs: Song[]): Promise<void>;
  showOnlyDownloaded: boolean;
  setShowOnlyDownloaded(v: boolean): void;
  storageUsageBytes(): Promise<number>;                      // native directory walk
}
```

List rows read status/progress synchronously; no per-row subscriptions (FR-82/86). Row
badges: check when done, pulsing icon + percent while queued/downloading, error icon on
failure; menu items Download / "Downloading N%" (disabled) / Remove download.

### 9.4 Collections, repair, offline browsing (FR-87..91)

- `collections.ts`: toggle adds/removes the key (`'<playlistId>'` or
  `albumKey(artistSlug, album)`) and sequentially downloads/removes each song (dedup makes
  re-toggle resume; removal skips songs required by another offline collection).
  `useOfflineCollectionSync(key, songs)` runs on every collection query success and enqueues
  missing songs - newly added songs sync automatically. ActionBar offline toggle =
  keep-synced semantics.
- `repair.ts`: on boot-while-online and on every NetInfo reconnect: `retryFailures()` then
  `verifyAndRepair()` (walk dl_songs; re-enqueue any missing kind including stems newly
  available and `lyrics_state='unfetched'`). Idempotent via dedup. This single pass heals:
  process-death losses, pre-stems libraries, quality upgrades, partial toggles.
- Offline browsing: `offlineLibrary.ts` registers resolvers into
  `contracts/offlineFallback` - songs/albums/artists derived from dl_songs (albums grouped
  by the backend's (album, lead-artist) key via `domain/albumKey.ts`), offline image
  resolver for ArtworkImage, offline lyrics resolver (tri-state). A global `isOfflineNow`
  flag (NetInfo) makes wrapped queries skip doomed network calls. WP1 wraps the relevant
  query fns with `withOfflineFallback(primary, fallbackKey)` up front; the fallbacks are
  inert until WP8 registers them.
- Playback ladder is section 8.2 step 3: local original -> local compressed -> network;
  stems the same. FLAC masters play when the OS decodes them, silently fall back otherwise.
- `maxStorageBytes` (FR-94, P2): NOT enforced in v1 and therefore no cap UI (per SPEC AC).

---

## 10. Realtime layer

### 10.1 CableClient (frozen interface; `cable/client.ts`)

Hand-rolled minimal ActionCable v1 client (~200 lines). Rationale: byte-stable identifier
strings (the server echoes the exact string; key order matters), welcome gating, and
deterministic resubscription are correctness-critical; `@kesha-antonov/react-native-action-cable`
stays available as an escape hatch behind the same interface.

```ts
interface CableClient {
  connect(token: string): void;      // wss://backend.omelhorsite.pt/cable?token=<token>
  disconnect(): void;
  subscribe(channelParams: Record<string, unknown>, handlers: {
    onMessage(msg: unknown): void;
    onConfirm?(): void;
    onReject?(): void;               // per-channel auth failure signal
  }): CableSubscription;
  onStateChange(cb: (s: "disconnected" | "connecting" | "connected") => void): () => void;
  notifyForeground(): void;          // fires per-subscription wake hooks; reconnects if dropped
}
interface CableSubscription {
  perform(action: string, data?: Record<string, unknown>): void;
  unsubscribe(): void;
  setWakeHook(fn: () => void): void; // e.g. request_snapshot + heartbeat on foreground
}
```

Rules (all mandatory, from API.md section 13): token in the QUERY ONLY, never an
Authorization header on the handshake (first candidate wins; a stale header beats the
param); wait for `welcome` before any subscribe (pre-welcome sends are dropped server-side);
the identifier is a JSON-encoded string with stable key order, stored and compared verbatim;
reconnect backoff 1 s doubling to 30 s, reset on welcome; resubscribe the entire
subscription map on every welcome; ping frames refresh a liveness watchdog and a silent
socket is proactively cycled; anonymous connects SUCCEED - `reject_subscription` is the auth
failure. All timers live in the client so foreground/wake behavior is centralized. Connect
when authed, disconnect on logout; the socket is left alone in background (iOS freezes it;
the wake path heals).

### 10.2 PlaybackChannel: presence, roles, remote playback (FR-105..112)

- Subscribe `{"channel":"PlaybackChannel","device_id":"<per-launch [A-Za-z0-9-]{8,64}>",
  "device_label":"<model name>"}`; heartbeat every 20 s (server TTL 75 s, active grace
  15 s); on every foreground: `request_snapshot` + `heartbeat`.
- Role machine (`remote/store.ts`): `offline | no_active | active | controller` derived from
  snapshots; `activating`/`blocked` as active sub-states. Becoming controller ->
  `engine.stopAndClearSource()`. Exactly one audible device, always.
- Claims: `steal` adopts optimistically (takeover must play NOW); `if_none` stays
  pessimistic until confirmed; `claim_rejected` demotes. `setQueue` on a non-active device =
  takeover (steal + play locally), never a command.
- Cold-start hydration (FR-108): role no_active + non-empty server snapshot + empty local
  queue -> adopt the SANITIZED snapshot (sanitizeSnapshot: jam proposals dropped with
  remap, permutation validated, index clamped), adopt loop + listener settings (rate, mode,
  EQ, separation, stem volumes) but NEVER volume; plant a paused activation seed at the
  snapshot position; play from idle claims `if_none` pessimistically.
- Controller (`remote/controller.ts`): mirror the snapshot; SLIM `state_changed` (no
  `queue_songs`) merges with the last full list per identifier; 1 Hz interval tick
  interpolation (`tick.position + elapsed`) with 5 s staleness fallback; ticks whose
  `song_id` mismatches the snapshot song are DROPPED (string compare via domain/ids); all
  transport actions become validated `command` sends; volume drag = `set_volume` on the
  active device; local-only settings greyed out.
- Active publishing (`remote/publisher.ts`): debounced 200 ms `state_changed` with song ids
  AS STRINGS, `paused: !playing`, live position, full listener settings; `position_tick` at
  1 Hz while playing; server `error` message -> `request_snapshot` resync, never blind
  retry; respect clamps (queue 1000, rate 0.25..4, EQ +-12, volumes 0..1).
- Command router: full vocabulary play/pause/toggle/next/previous/seek/set_queue_index/
  set_queue_order/set_shuffle/set_loop_mode/set_volume/add_to_queue/play_next (id-only:
  resolve from queue -> query cache -> `GET /songs/:id`)/remove_from_queue/reorder_queue,
  executed ONLY when `target_device_id` is us; server-built `jam_add_song` and `next` route
  to `jam/hostDuties.ts`.
- Transfer IN (FR-111): adopt sanitized quartet + loop + listener settings (never volume);
  plant activation seed `{songId, position, paused}` (valid 5 s); mark the seed song
  play-recorded; if transferring playing audio, enter `activating` and suppress publishes
  until the first audible status force-publishes truth + a tick; audio-session acquisition
  failure maps to `activation_blocked {}` and the picker hint.
- Reconnect steal (FR-112, ships in v1): if the cable dropped while WE were active (audio
  kept playing) and the reconnect snapshot shows `active == null || active == us`:
  `claim_active {steal}` + force-publish full state + tick. A WS blip never pauses local
  audio. The `predecessor` subscribe param (web reload handoff) is NOT used natively.

### 10.3 Jams (FR-113..118; `src/jam`)

- Lifecycle: `GET /jams` on app start resumes `current`; create -> immediately
  `claim_active {steal}` (a host with no active device is a silent jam); join via REST
  BEFORE subscribing JamChannel (rejection = jam gone, clear state); host leaving ENDS the
  jam (warn); rules PATCH host-only.
- Follower (`jam/followerPlayer.ts`): a SECOND dedicated AudioPlayer fed by
  `JamState.song.audio_url`; the main engine stays silent and untouched. Track identity by
  song id, never URL (presigned strings rotate; server caches them ~5 h). New song -> set
  source + pendingSeek to state.position on metadata. Ticks: host paused -> hard pause;
  drift > 2.5 s -> hard seek; else ride. Local pause allowed; resume extrapolates
  `tick.position + (now - receivedAt)`. Local volume only. Starting real local playback
  auto-leaves (1.5 s join grace). JamBar replaces the MiniPlayer while following.
- Proposal interception (`jam/interceptor.ts` via `contracts/playbackInterceptor.ts`):
  while following with `queue_mode == "everyone"`, "play" on an own-library song becomes
  `POST /jams/:id/propose`; nothing plays locally.
- Host duties: execute server-injected `jam_add_song` (insert after current, behind earlier
  proposals, FIFO) and `next`; play proposals via their presigned `audio_url` with proposer
  attribution. Jam songs are NEVER play-recorded, persisted, downloaded, separated, or
  fs-resolved - enforced independently in recording.ts, downloads/manager.ts, and
  sanitizeSnapshot (three guards).
- Skip votes: `POST /jams/:id/skip_vote` -> `{skipped, count, needed}` display; local tally
  resets silently when the state song id changes; UI per skip_mode (hidden for non-hosts in
  host mode); host vote always skips.

### 10.4 Friends, jobs, notifications (FR-119, FR-80, FR-118)

FriendListeningChannel: snapshot + full-row `listening_update` replace keyed by `user.id`;
sort live rows first then updated_at desc; rosters are subscribe-time -> resubscribe on
foreground; feeds the Home strip, the Friends pager page and profile now-playing rows;
sharing-off friends show presence without the song. JobChannel: lyrics sync jobs
(`{"channel":"JobChannel","id":...,"token":...}`) + a ~10 s REST poll fallback of
`GET /jobs/:id` where 404 during polling means keep waiting; done when `finished_at` set.
NotificationsChannel: `kind: "jam_invite"` -> toast linking into the jam panel (no accept
API; the jam appears in `GET /jams` joinable).

---

## 11. Theme tokens (frozen; `theme/tokens.ts`)

- Both shadcn-style HSL palettes (light `:root` + dark) ported from the web `globals.css`
  verbatim as TS constants; token names: background, foreground, card, cardForeground,
  popover, popoverForeground, primary, primaryForeground, secondary, secondaryForeground,
  muted, mutedForeground, accent, accentForeground, destructive, destructiveForeground,
  border, input, ring; radius base 8. `primary` is MONOCHROME: near-black on light,
  near-white on dark (active pills, liked hearts, play FABs, active toggles).
- Fixed identity colors: MUSIC_ACCENT `#4B1E6D`; LIKED_ACCENT `#7e22ce` + liked gradient
  violet-700 -> purple-700 -> indigo-900 with centered white heart; EMERALD for Spotify-sync
  markers and the "Playing on X" controller strip; ACCENT_FALLBACK `#FF5555`; HERO_FALLBACK
  `#222222`.
- Mix kind gradients (client-owned; server `gradient` field ignored): top_artist
  rose/fuchsia/indigo; repeat_rewind amber/orange/rose; time_capsule emerald/teal/cyan;
  discoveries sky/blue/violet. Hex values ported from the web tailwind classes at
  implementation time. Radio kind accents analogous.
- `gradients.ts`: player/now-playing surfaces sit on a vertical gradient of the song accent
  mixed toward white (light) or black (dark); hero headers use the hero accent variant.
- `provider.tsx`: light/dark/system with persisted choice; `useTheme()` returns resolved
  tokens + scheme; consumers restyle on flip without re-downloading artwork (dual-variant
  accent cache).
- `typography.ts`: Inter (body), Druk Wide Super weight 900 + Cantarell (display). Hero
  titles huge black-weight; section headers 2xl bold tight; kind labels tiny uppercase;
  time labels tabular numerals; mix stamp text black-weight uppercase white, size stepped by
  length (<=8 largest, <=14, <=22, else smallest).
- Shape: base radius 8; pills and play buttons fully round; MiniPlayer pill rounded-xl with
  blur and heavy shadow.

---

## 12. i18n (frozen plumbing; `src/i18n`)

- Exactly three locales: `en` (default), `pt` (PT-PT ONLY), `lv`. Catalogs ported from the
  web as-is, music keys preserved under `components.music.<Component>.<key>`; new native
  namespaces (`native.auth`, `native.downloads`, `native.settings`, ...) added to all three
  catalogs in the same commit. A CI check (bun test) compares the three key trees for
  equality.
- Hand-rolled ICU-lite interpolation (`icu.ts`): `{param}` substitution + the plural/select
  forms actually present in the ported catalogs (audit during the port; add nothing
  speculative). No new dependency. If the audit finds heavy ICU usage, escalate for
  `use-intl` install approval instead of extending icu.ts.
- API: `t(key, params?)`, `useT()` (re-renders on locale change), `getLocale()`,
  `setLocale("en"|"pt"|"lv")` persisted in kv-store; initial = device locale mapped into
  {en, pt, lv} else en. Time zone Europe/Lisbon for date labels.
- `mixLabels.ts`: mix titles/descriptions render from `title_key` + `title_params` /
  `description_key` + `description_params` through the catalog, NEVER the English fallback
  strings in the payload. Radios render their pre-baked Portuguese strings as-is.

---

## 13. Contract seams (`src/contracts`, frozen)

Each seam ships in WP1 with an inert default so every package builds and runs before its
counterpart exists; subsystems register real implementations from their own `register.ts`
(imported by `boot/wireup.ts`).

1. `localSource.ts` - `LocalFileIndex: get(songKey, kind) -> file uri | null`. Default:
   null (everything streams). WP8 registers the real index.
2. `offlineFallback.ts` - `withOfflineFallback(primaryFn, fallbackKey)` + resolver
   registry + `isOfflineNow()`. WP1 wraps the query fns; WP8 registers resolvers.
3. `transport.ts` - `TransportActions` (play/pause/toggle/next/previous/seek/setVolume/
   setRate/setLoopMode/setShuffle/setQueueIndex/addToQueue/playNext/removeFromQueue/
   reorderQueue/setQueue) + provider. Default = engine. WP9 swaps in the remote-aware
   decorator (controller -> validated cable commands). All UI and the lock screen call this.
4. `playbackInterceptor.ts` - `setPlaybackInterceptor(fn)`. Default: none. WP10's jam
   follower registers the proposal interception.
5. `songMenu.ts` - the canonical song action list (FR-74). The contract FIXES the full
   order and visibility conditions: Play/Pause, Like/Unlike, Play next, Add to queue, Open
   album, Open artist, View credits, Add to playlist, surface extras (e.g. Remove from
   playlist), Start radio (P1), Propose to jam (P1; only while following with queue_mode
   everyone), Separate vocals (P1; only when stems absent; disabled with elapsed label while
   processing), Download / Downloading N% / Remove download. Slots are typed; packages
   register implementations for their slots (WP8 download, WP10 propose, WP11 separate);
   unregistered slots render nothing. `ui/SongMenu.tsx` (WP4) renders the registry so the
   menu is byte-identical on every surface.

---

## 14. Frozen contracts summary

After WP1 lands and is reviewed, these are change-controlled (foundation owner merges
requested edits; no drive-bys): (1) `api/client.ts` request interface + params/sentinel
encoding + ApiError; (2) `api/queryKeys.ts` namespace + invalidation targets;
(3) `src/domain/**` types + ids; (4) `src/contracts/**` seams; (5) the SQLite DDL;
(6) theme tokens + accent rules; (7) i18n `t()`/catalog key scheme; (8) the route tree +
param shapes. After WP3 lands: (9) PlayerEngine public API + store shape + queueOps
signatures. After WP8/WP9 land their first cut: (10) DownloadStatusApi; (11) CableClient
interface. (12) The separation service interface (section 8.7) freezes with WP1's types.

---

## 15. Contradictions between proposals, resolved

1. **Cable client**: hand-rolled (playback, product) vs wrap the kesha lib (shipping).
   RESOLVED: hand-rolled behind the frozen CableClient interface; the lib is the escape
   hatch. Byte-stable identifiers and welcome gating are too load-bearing to delegate.
2. **Presigned cache reuse**: 5 h TTL (shipping) vs 5 min (playback). RESOLVED: 5 minute
   reuse window, playback-start only - verified against playback-core.md
   (`PREFETCHED_URL_TTL_MS = 5 min`, "treat a prefetched URL as one-shot with a 5 min
   freshness window").
3. **Tabs**: 3 tabs + downloads pushed (product) vs 4 tabs (playback, shipping). RESOLVED:
   4 tabs (Home, Search, Library, Downloads) - offline access is a first-class surface.
4. **fs_node 404 handling**: auth loss per SPEC FR-2 vs "also legit missing" (shipping).
   RESOLVED: 404-while-authed triggers the single-flight `/sessions/mine` probe; probe OK =
   missing file, probe 401 = auth loss. Satisfies both readings without false logouts.
5. **304 handling**: "no code needed" (shipping) vs validator stripping (playback).
   RESOLVED: `cache: "no-store"`, no manual validators, defensive keep-previous-data if a
   304 still surfaces (section 5.6).
6. **Adopted `playback_mode: "custom"`**: rewrite to original and publish original
   (product/shipping) vs keep the wire value (playback). RESOLVED: keep `custom` in local
   state and republish it untouched (SPEC FR-69: "wire value custom in snapshots either
   way"); AUDIO plays the plain mix (the stems-missing fallback); the mode UI shows a
   "custom blend not available on this device" note; the user picking a different mode
   publishes that mode. EQ bands + stem volumes always round-trip untouched.
7. **OAuth**: WebView interception (product) vs web-callback forwarder page (shipping).
   RESOLVED: WebView interception is v1 primary (auth-account.md confirms interception of
   the hardcoded https callback is the only backend-free path); Google may refuse WebViews -
   degraded behavior + forwarder follow-up in section 16.
8. **i18n engine**: `use-intl` dependency (playback) vs hand-rolled ICU-lite (product,
   shipping). RESOLVED: hand-rolled (no-installs-without-approval rule); escalation path
   documented in section 12.
9. **SQLite layout**: single db + ownerUserId (shipping) vs per-user db (playback).
   RESOLVED: per-user db file + per-user download directory; kills the account-switch purge
   question.
10. **Savables table**: separate dl_tasks (shipping) vs column on the download row
    (playback/product). RESOLVED: `savable` column on dl_files - one row per (song, kind)
    is already the task granularity.
11. **FR-112 reconnect steal**: ship (playback) vs defer (shipping). RESOLVED: ships in
    WP9 - it is small and protects "a WS blip never pauses local audio". The `predecessor`
    handoff param stays unused (web reload artifact).
12. **Artists hub**: one screen (shipping) vs hub + roster split (playback). RESOLVED:
    two screens (11 artists hub overview, 12 artists-roster) - matches FR-36/FR-37's
    distinct behaviors (overview shelves vs infinite roster with sort/search).
13. **Query hooks ownership**: split per feature WP (product) vs one data-layer package
    (shipping). RESOLVED: WP1 owns ALL of `src/api` (endpoints + queries) so feature
    packages never touch shared data files.
14. **Song menu ownership**: player-UI package (playback) vs UI kit with injected deps
    (product) vs registry (shipping). RESOLVED: typed slot registry in
    `contracts/songMenu.ts` (order + conditions frozen in WP1), renderer in WP4, slot
    implementations registered by WP8/WP10/WP11.

Known backend contradictions (from SPEC.md, restated as guardrails): system playlists
reject rename server-side - never render the affordance; artist PATCH is FLAT top-level and
banner upload field is `banner` (do NOT copy the web's bugs); VocalSeparation has NO
`canceled` status; `POST /songs/clean` is dead and `GET /songs/artists` ignores filters -
never call either; native uses bearer tokens only and disables any cookie jar.

---

## 16. Degraded-in-v1 behaviors and follow-up paths

Nothing else in SPEC.md is dropped. Each item below states the exact v1 behavior and the
follow-up.

1. **FR-69 custom blend (P2).** SUPERSEDED by amendment 16.A (2026-08-03): the blend ships
   for real on both platforms. The original position - blend sliders hidden, `custom` plays
   the plain mix, wire values stored and republished untouched - survives only as the
   FALLBACK, taken when no mixer is in the build or the stems are not on disk yet.
2. **FR-70 3-band EQ (P2).** SUPERSEDED by amendment 16.A: the EQ ships inside the mixer
   path, with per-band bypass so a flat EQ still costs nothing in the audio path.
3. **FR-13 passkeys (P2).** SUPERSEDED on 2026-08-03: implemented. react-native-passkeys
   drives the four `/webauthn_credentials/*` endpoints the backend always had, sign-in is
   the discoverable-credential ceremony, and registration plus management live under
   Settings. WebAuthn payloads keep the verbatim-payload (`raw: true`) rule. What remains is
   platform configuration outside this repo, tracked in `docs/PASSKEYS.md`: publishing the
   two `.well-known` files (already written into the website repo), confirming the Apple
   Developer Program membership since Associated Domains is a paid capability, and choosing
   the Android signing key before `assetlinks.json` and the backend's allowed origins can
   name it.
4. **FR-12 Google OAuth (P1).** SETTLED: GitHub + Spotify ship via WebView interception and
   Google stays hidden. Google refuses OAuth in embedded user agents with
   `disallowed_useragent`, and neither escape exists on this stack today.
   `openAuthSessionAsync` (expo-web-browser, already a dependency) hands the round trip to
   ASWebAuthenticationSession / Custom Tabs, which Google accepts, but iOS matches the
   return by CUSTOM SCHEME only, and the backend's return target is hardcoded to
   `https://omelhorsite.pt/account/oauth/callback` with no per-request `redirect_uri`
   (`identities_controller.rb:203-218`), so the session would succeed and then strand the
   ticket on the website; a universal link would work, but the apex serves no AASA and
   claiming that path would hijack it for the web client too. The reasoning lives beside the
   code in `auth/oauthCallback.ts#oauthProvidersFor`, which is also the single line to change
   when it lands. Follow-up unchanged: an "open in app" bounce on the web callback page
   (`omelhorsite.pt/account/oauth/callback` forwards ticket to `omsmusic://oauth` - a
   frontend-only change, backend untouched) + `openAuthSessionAsync`; the
   `/sessions/adopt` plumbing ships in v1 regardless.
5. **FR-20 universal links.** v1: `omsmusic://` custom scheme both platforms + unverified
   https intent filter on Android (disambiguation dialog); iOS cannot claim https links
   without AASA. The parser handles full web URLs from day one. Follow-up: same AASA/
   assetlinks shipment as passkeys turns on verified https links on both platforms.
6. **FR-94 storage cap (P2).** Not enforced in v1; per SPEC, no cap UI is shown. Follow-up:
   enforce at enqueue + settings UI in one change.
7. **Background downloads across process termination.** iOS background sessions survive
   suspension, not kill; Android downloads pause with the process. v1: persisted savables +
   boot re-attach + verify-and-repair heal everything on next launch. Follow-up if field
   data shows unacceptable losses: `@kesha-antonov/react-native-background-downloader`
   (install requires approval) behind `downloads/tasks.ts`.

### 16.A Amendment 2026-08-03 - the custom blend and the EQ ship

Items 1 and 2 above are lifted. FR-69 and FR-70 are implemented, on both platforms, and the
architecture MIRRORS THE WEB rather than replacing the player:

**The muted-clock design.** The expo-audio player stays loaded on the plain mix
(`compressed_audio_fs_node_id || audio_fs_node_id`) in `custom` mode, but MUTED. It remains
the transport clock, the source of `duration` / `position` / `ended`, and the owner of the
lock screen (iOS `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`, Android MediaSession).
A separate native mixer produces the audible signal from the two stem files. This is exactly
`frontend/lib/vocalSeparation.ts` with `mainGain = 0`, and it is what keeps us out of a
fight with expo-audio over the media session, which is bound to its own `AVPlayer` /
`ExoPlayer` instance.

**Gain law (verbatim from the web, `player/gainLaw.ts`, unit-tested).**

| | mainGain | mixer master | vocal | instrumental |
|---|---|---|---|---|
| stems OFF | `masterVolume` | 1 | - | - |
| stems ON | **0** | `masterVolume` | `vocalVolume` | `instrumentalVolume` |

Both stems at 1.0 reproduce the original at roughly unity. EQ: low shelf 120 Hz, mid peaking
1000 Hz Q=1, high shelf 8000 Hz, every band clamped -12..+12 dB, default 0, `eqEnabled`
session-only and never persisted.

**Stems must be fully on local disk first.** iOS `AVAudioFile` cannot open a remote URL and
two independent progressive streams that must never underrun relative to each other double
the failure surface on Android, so the blend is gated on both stem files being resident -
the same shape as the web, which fetches and decodes both stems whole before muting the
original. Not-yet-resident stems are fetched through the existing download machinery
(`downloads/stemProvision.ts` -> `downloadStemsForPlayback`), the plain mix stays audible
throughout, and progress is surfaced. A half mix is never audible. Those transfers write NO
`dl_songs` row on purpose: playing a song in custom mode must not enrol it in the offline
library, which `verifyAndRepair` walks.

**Seams added (all additive; the frozen 7.3 surface is untouched).**

- `contracts/stemMixer.ts` - `StemMixer` (`isAvailable`, `prepare`, `play`, `pause`, `seek`,
  `setGains`, `setEq`, `setRate`, `onStatus`, `release`) with an INERT default that reports
  itself unavailable, so this package compiles and tests green before the native module
  lands. `player/register.ts` installs the real one with
  `setStemMixer(getNativeStemMixer())`, BEFORE it constructs the engine (the constructor
  seeds `stemMixerAvailable` from the adapter, which answers from this seam). The module
  never imports app code, so the dependency arrow keeps pointing app -> module, exactly as
  with the FR-63 remote-track router next to it. The engine subscribes to the mixer's
  `onStatus` in its constructor: a mixer that gives up mid-track would otherwise leave
  NOTHING audible (the main player is muted by the gain law), so a non-null `error` tears
  the blend down, restores `mainGain` and puts the cog in `failed` with a Retry.
- `contracts/stemFiles.ts` - `StemFileProvider` (`resident`, `fetch`), defaulting to a
  LocalFileIndex-only reader; `downloads/register.ts` installs the fetching one.
- `player/types.ts` `AudioAdapter` gains OPTIONAL `stemsActive`, `supportsStems`,
  `replaceStems(vocalsUri, instrumentalUri)`, `setStemGains`, `setEqBands`, `setEqEnabled`,
  `releaseStems`. Optional keeps every mixer-less adapter (and `FakeAudioPlayer`) valid.
  The ADAPTER owns the fan-out: while the stems are active, `play` / `pause` / `seekTo` /
  `setRate` drive the mixer as well as the muted original, and `replace` always releases the
  mixer first - stems can never survive a track change.
  It also owns the fan-IN, which is not optional: expo-audio's lock-screen targets act
  straight on its own player and never reach JS (`MediaController.swift:234-306` calls
  `player.ref.pause()` / `player.ref.seek(to:)` / the +-10 s skips), and interruptions and
  audio-focus loss arrive the same way. So on every status tick the adapter mirrors
  `status.playing` onto the mixer exactly (a disagreement can only mean the change came from
  outside) and hands `status.currentTime` to the OPTIONAL `StemMixer.resync(reference,
  tolerance)`, which compares it against the mixer's own clock NATIVELY - the one place that
  clock is exact - and re-pairs both stems only past 0.5 s. Without the fan-in, pausing from
  the lock screen in custom mode would stop a player nobody can hear and leave the blend
  playing on.
- `player/sources.ts` gains a `{ kind: "stems"; vocals; instrumental }` `SourceCandidate`
  plus `resolveStemSource(song)`. It is deliberately NOT in the ladder `resolveSources`
  returns (typed `MainSourceCandidate[]`): that ladder feeds the one main player.
- `player/store.ts` gains `stemPhase` (`off | unsupported | fetching | active | failed`),
  `stemProgress` and `stemMixerAvailable` for the cog.
- `PlayerEngineExtras` gains `supportsStemMixing()`, `retryStemBlend()` (the cog's Retry,
  web parity `retryStems`) and `setSeparationEnabledUserAction()`.

**Two separation-state fixes that ship with it.**

- `setSeparationEnabled` is now the RAW setter with no cascade, and the force-to-original
  cascade moved into `setSeparationEnabledUserAction` - web parity (MusicProvider 1871-1876).
  Remote adoption calls the raw setter, so a snapshot carrying
  `{ playback_mode: "custom", separation_enabled: false }` lands verbatim instead of being
  rewritten to `original` and republished over the account state.
- Choosing any non-original mode now implies `separationEnabled: true` (and a persisted
  stem mode does the same at boot), so this device can no longer publish the
  self-contradictory pair `{ playback_mode: "instrumental", separation_enabled: false }`.
  Adoption applies `separation_enabled` AFTER the mode, so remote snapshots still win.

Unchanged by this amendment: `custom` is still never restored from persistence
(`player/persistence.ts` writes it out as `original`), `eqEnabled` is still session-only,
and the mode wire value still round-trips untouched on devices with no mixer.

---

## 17. Testing baseline and device gates

- bun test (no new dependency) over: queueOps property tests, sanitizeSnapshot, slim-merge,
  LRC parser (all four FR-76 rules), null-sentinel encoder, bracket encoding, rankByMatch,
  deepLinks, id converters, albumKey, i18n key-tree equality, accent math.
- Services take injected fakes (FakeAudioPlayer, FakeCable, in-memory sqlite) so protocol
  logic runs in CI without devices.
- Two device spikes run at the START of their packages, because their outcome picks between
  the primary design and a named fallback: (a) WP3 day 1 - expo-audio background playback
  10+ min both platforms, setActiveForLockScreen metadata + artwork + every remote command,
  status cadence, rate without pitch correction, two simultaneous AudioPlayers, FLAC local
  decode failure mode; escape hatch: @rntp/player v5 (paid) behind the engine interface.
  (b) WP9 day 1 - cable framing against production (identifier echo, welcome gating,
  query-only token).
- Definition of done for any playback-touching package: the two-device matrix
  (active/controller swap, transfer mid-song, reconnect blip, rapid-skip soak at 300 ms for
  5 min, jam host + follower) passes on iOS and Android dev builds.
