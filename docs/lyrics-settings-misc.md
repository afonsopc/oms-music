# Music web app spec: lyrics, settings, radio/mix generation, and import/upload flows

Audience: engineers rebuilding the omelhorsite web music feature as a native React Native (Expo) app that talks to the SAME production backend with zero backend changes. Everything below was read from the actual code (frontend Next.js SPA at `frontend/`, Rails backend at `backend/`).

Base URL for all endpoints: `https://backend.omelhorsite.pt`. All endpoints are JSON over HTTPS, authenticated with the app's normal auth (bearer token or cookie session; the web client sends `token` from storage). Paths below are relative to the base URL. `fs_node` ids referenced in payloads resolve to binary data via the storage endpoints (covered in the storage/playback spec, `FsNode.dataUrl(id)` on the web).

Source files this document is based on (main ones):

- `frontend/components/music/LyricsView.tsx`
- `frontend/components/music/Settings/**` (all files)
- `frontend/app/[language]/music/settings/**`, `discover/`, `mix/`, `radio/`
- `frontend/services/MusicService.ts`, `JobService.ts`, `SongImportsService.ts`, `ToolsDownloaderService.ts`, `SpotifySyncsService.ts`, `AccountService.ts`
- `frontend/lib/queries/music.ts`, `song-imports.ts`, `spotify-syncs.ts`, `artist-imports.ts`
- `frontend/lib/importTracker.ts`
- `backend/app/controllers/lyrics_controller.rb`, `music_mixes_controller.rb`, `music_radios_controller.rb`, `song_imports_controller.rb`, `playlist_imports_controller.rb`, `songs_controller.rb`, `spotify_syncs_controller.rb`, `artist_imports_controller.rb`, `jobs_controller.rb`
- `backend/app/services/music_radio_generator.rb`, `music_mix_generator.rb`, `lyrics/fetcher.rb`, `lyrics/aligner.rb`, `ai/lyrics_translator.rb`, `song_imports/creator.rb`, `song_services/importer.rb`, `spotify_syncs/*`
- `backend/app/jobs/lyrics_sync_job.rb`, `song_import_job.rb`

---

## 1. Lyrics

### 1.1 Where lyrics appear

On the web, `LyricsView` renders inside the right-hand rail (`QueuePanel`, tab `lyrics`, one of three tabs: queue / lyrics / friends) and inside the mobile `NowPlayingSheet`. It takes a single prop: `songId` (the currently playing song's numeric id).

### 1.2 Fetch endpoint and data shape

```
GET /lyrics?song_id=<id>
```

Response (always HTTP 200 when the song exists and is viewable; 404 only when the SONG is not found):

```json
{
  "synced": "[00:12.34] First line\n[00:15.10] Second line\n...",
  "plain": "First line\nSecond line\n...",
  "attribution": "lrclib.net"
}
```

- `synced`: LRC-format string or `null`. `plain`: newline-separated plain text or `null`. Both can be present; both can be `null` (song has no lyrics anywhere).
- `attribution`: source string to display, e.g. `"lrclib.net"`, `"genius.com"`, or `"<source> + sync gerada"` after on-demand sync generation. The web renders it as a small footer line: `t("attribution", { source })`.
- IMPORTANT: "no lyrics found" is NOT a 404. It is a 200 with `synced: null, plain: null`. Show an empty state in that case.

Backend behavior you must know for UX expectations:

- Positive results are cached on the song row (columns `lyrics_synced`, `lyrics_plain`, `lyrics_source`, `lyrics_fetched_at`) for 30 days; repeats are instant.
- The FIRST fetch for a song runs the whole external lookup chain inline in the request: lrclib.net exact match, then lrclib fuzzy search (scored by duration within 4s tolerance + token overlap, floor 0.5, synced beats plain), then Genius (plain text only, scraped, section markers like `[Chorus]` stripped). This can take seconds. Show a skeleton.
- A full miss is negative-cached server-side for 24h (`lyrics:miss:v2:<song_id>`), so retrying within a day returns nulls instantly.
- The fetcher refuses variant mismatches: a remix/live/sped/slowed/etc. candidate never provides lyrics for the original and vice versa.

Client caching on the web: react-query `staleTime` 24h for lyrics, keyed `["getLyrics", songId]`. The mobile web build also falls back to an IndexedDB offline cache when the backend is unreachable; the RN app should implement an equivalent offline lyrics cache if it does offline playback.

### 1.3 Synced (LRC) rendering and timing behavior

Parsing (`parseLrc` in `LyricsView.tsx`, replicate exactly):

- Line format: one or more `[mm:ss.xx]` timestamps followed by text. Regex: `\[(\d+):(\d+(?:\.\d+)?)\]`, global, per raw line.
- Multiple timestamps on one raw line emit multiple entries with the same text.
- Lines with no digit-colon timestamp (metadata tags like `[ar:Bladee]`, empty lines) are skipped entirely.
- `time = minutes * 60 + seconds` (float seconds). Result sorted ascending by time.
- Empty text after stripping timestamps is rendered as a middle dot placeholder (the web shows `"·"`) - it still occupies a line and is tappable.

Active-line tracking:

- A per-frame loop (rAF on web; use a display-link/timer in RN) reads the audio element's `currentTime` each frame and computes the active index as the LAST line whose `time <= currentTime` (linear scan, `max(0, i - 1)`); state only updates when the index actually changes, so playback does not re-render at 60fps.
- Active line is styled bigger/bold (`text-base font-bold`, full opacity); other lines are 60% opacity.
- Index resets to -1 whenever the parsed lines change (song change).

Tap-to-seek: tapping a synced line calls `seek(line.time)` on the player AND resumes auto-follow.

Auto-scroll ("follow") behavior:

- When the active index changes, the view smooth-scrolls the active line to the vertical CENTER of the nearest scrollable ancestor (the rail's scroll container, not the page).
- Any manual user gesture in the scroll container (wheel / touchmove / pointerdown) suppresses auto-follow for a 4000ms grace period (`USER_SCROLL_GRACE_MS`), refreshed on each gesture.
- While suppressed AND lyrics are synced, a floating pill ("back to current line") is shown pinned near the bottom; tapping it clears suppression and re-centers immediately.

Plain-only lyrics rendering: split `plain` on `\r?\n`, render as static lines (85% opacity), no timing, no seek, no auto-scroll, no active line.

### 1.4 On-demand sync generation (plain -> synced)

When lyrics are plain-only (`!synced && plain`), the web shows a small "generate sync" icon button in the sticky header of the lyrics view.

```
POST /lyrics/sync
Body: { "song_id": <id> }
201 -> { "job_id": "<uuid>" }
```

Errors: 404 song not found; 400 `"No plain lyrics to synchronize"`; 400 `"Lyrics are already synchronized"`; 429 after 10 requests per user per hour (`SYNC_HOURLY_CAP`).

What happens server-side (so you can set expectations): a `LyricsSyncJob` (global concurrency 1) downloads the vocals stem if the song has one (else compressed audio, else original), transcribes it with Whisper on a local sidecar, and aligns the KNOWN plain lines against the transcript segments (transcript is trusted only for TIME, never for text; monotonic matching, gap interpolation, monotonicity enforcement). If under a third of lines anchor, the job fails ("alignment failed..."). On success `lyrics_synced` is written and `lyrics_source` becomes `"<old source> + sync gerada"`. This can take a while (roughly the length of the vocals at faster-than-realtime, plus queueing behind other transcriptions).

Client flow after POST:

1. Await the job: subscribe to ActionCable channel `{ channel: "JobChannel", id: <job_id> }`; the channel transmits a snapshot on subscribe and a payload on every status/progress change; each message contains `{ job: {...} }`. As a safety net, poll `GET /jobs/<job_id>` every ~10s (web: `interval * 5` with default interval 2000ms). The job is done when `finished_at` is non-null. Job shape:

```json
{
  "id": "uuid", "job_type": "...", "payload": {}, "status": "pending|processing|complete|failed|canceled",
  "progress": 0, "started_at": null, "finished_at": null, "result": null, "error": null,
  "creator_id": "...", "created_at": "...", "updated_at": "..."
}
```

Note: `GET /jobs/:id` returns 404 until the row is visible; the web treats 404 during polling as "keep waiting", any other error as fatal.

2. If `status === "complete"`: invalidate/refetch `GET /lyrics?song_id=` - it now returns `synced` and the timed view takes over. Show a success toast. Otherwise show a failure toast.
3. Keep the button disabled with a spinner while the job runs.

### 1.5 Lyrics translation

UI: a "languages" dropdown button in the lyrics sticky header. Options (native names, fixed list):

```
pt Português, en English, es Español, fr Français, de Deutsch, it Italiano, lv Latviešu
```

Selecting a language enables translation mode and persists the chosen target per device (web: localStorage key `music-lyrics-target`; RN: AsyncStorage equivalent). The default target initializes to the UI locale. An extra menu item turns translation off (does not clear the stored target).

```
GET /lyrics/translation?song_id=<id>&target=<code>
```

Response: `{ "synced": "...|null", "plain": "...|null", "target": "pt", "attribution": "lrclib.net" }`

- The backend translates line-by-line and KEEPS the LRC timestamps and line counts identical to the source, so the translated `synced` parses with the same LRC code and lines align one-to-one by timestamp.
- Server caches translations on the song row per `(target, digest of source lyrics)`; a lyrics refetch invalidates them. First call per (song, target) does live LLM translation (free OpenRouter models first, local sidecar fallback) and can take many seconds. Max 400 unique lines; songs longer than that error.
- Errors: 400 unsupported target (only the 7 codes above); 404 `"No lyrics for this song"` when the song has no lyrics at all; 429 after 60 fresh translations per user per hour; 503 when the translator is down.

Client behavior (replicate):

- Query is enabled only when translation mode is on AND the song has some lyrics. `staleTime: Infinity` (fetch once per session per song+target). Do NOT auto-retry on 429 or 404 (retry at most once otherwise).
- Synced rendering with translation visible: build a map keyed by `time.toFixed(2)` from the translated LRC. For each original line, the translation (if found and DIFFERENT from the original text) becomes the primary text and the original drops to a smaller secondary line underneath. Identical lines (instrumental breaks, vocalizations, lines already in the target language) show no secondary line.
- Plain rendering with translation: align by line INDEX (split both on `\r?\n`); same "identical line suppressed" rule.
- On 429 show a "translation limit" inline message; other errors show "translation unavailable". The dropdown trigger shows a spinner while fetching, and is highlighted while translation mode is on.

---

## 2. Settings area

Routes (web): `/music/settings` renders the Import page by default; sidebar sub-entries route to `/music/settings/import`, `/music/settings/songs`, `/music/settings/artists`, `/music/settings/playback`. Sidebar labels: Import, Songs, Artists, Playback.

### 2.1 Import page

Four tabs: Files (`files`), URL (`url`), Spotify (`spotify`, conditional), Artist (`artist`).

The Spotify tab only renders when the account has the allowlist flag: `GET` own account -> `allowed_to_use_spotify: boolean` (field on the account/user payload). The backend also enforces this with 403 on every `/spotify_syncs/*` call.

#### 2.1.1 Files tab - direct upload (`ImportDropzone`)

Endpoint, one request per file, fully synchronous (no job):

```
POST /songs/import
Content-Type: multipart/form-data
Field: file=<audio file>
200 -> full Song JSON (the created song)
```

Server rules: max 1 GB per file; accepted extensions `mp3 wav flac aac ogg m4a opus`; 415 (unsupported media type) with error messages when the model fails to persist; 400 for missing file. The server reads tags with TagLib (title falls back to the filename, artist string is parsed into the song_artists association server-side, track/disc numbers fold into `position` as `disc*1000 + track`), detects the real codec from the file header (not the extension), extracts embedded artwork, and stores audio + artwork as fs nodes under the user's music storage.

Client-side flow (replicate the semantics, not necessarily the DOM):

- Inputs: multi-file picker (`accept="audio/*"`), folder picker (webkitdirectory on web; use a document picker on RN), and drag-and-drop with recursive directory traversal. Non-audio files (MIME not starting with `audio/`) are filtered out; if nothing remains, show "no audio files selected".
- Uploads run with a concurrency limit of 3, sequential batches, with a progress counter `current/total` and a progress bar.
- A global busy flag (web: `window.musicImportBusy`) marks an import in progress so a second import surface disables itself ("import in progress elsewhere"). RN: a shared store flag.
- Per-file success/failure toasts are aggregated: one success toast with count, one error/warning toast if any failed.

Folder import resume tracking (client-only, IndexedDB database `MusicImportTracker`, store `imports`, keyPath `path`):

- A folder import is detected when every file has a relative path and they all share one root folder; the root folder name is the `path` key.
- Record shape: `{ path: string, status: { success: string[], failed: string[] } }`, file names being the relative paths.
- Before importing a folder, files already in `status.success` are skipped ("all files already imported" toast if nothing remains). Each file's outcome appends to `success` or `failed`.
- After the run: if every file in the folder succeeded, the record is deleted and a success toast shows; if some failed, the record persists and a warning card ("incomplete import") lists the failed files with actions: retry (re-pick the folder; already-successful files are skipped), ignore a single failed file (moves it to success; record auto-deletes when both lists empty), or dismiss the whole warning (confirm dialog, deletes the record).
- Warnings load on mount and render only when no import is running.

#### 2.1.2 URL tab - yt-dlp import (`PlaylistImport` + `PlaylistImportModal`)

Step 1 - preview:

```
POST /playlist_imports/preview
Body: { "url": "<user pasted URL>" }
200 -> DownloaderPreview
```

`DownloaderPreview` is a discriminated union on `kind`:

```ts
type DownloaderTrackPreview = {
  title?: string; artist?: string; album?: string; duration_s?: number;
  thumbnails?: { url: string; width?: number; height?: number; resolution?: string }[];
  formats?: {...}[];       // not used by this flow
  webpage_url?: string; id?: string; extractor?: string;  // e.g. "youtube", "soundcloud"
};
type DownloaderPreview =
  | ({ kind: "track" } & DownloaderTrackPreview)
  | { kind: "playlist"; title?: string; id?: string; count: number; tracks: DownloaderTrackPreview[] };
```

Errors: 400 `"url is required"`; 400 with the message `"Spotify imports require linking your Spotify account in /account/dashboard."` for open.spotify.com/spotify.com URLs (show it verbatim or map it - Spotify content cannot be imported by URL); 400 `"url is not allowed"` (SSRF guard rejects private/non-http URLs); 502 with the upstream error text when yt-dlp fails. Rate limit: 60 previews/hour/user (on top of a burst throttle). Previews can take several seconds (yt-dlp metadata fetch); show a spinner and render errors inline, do not auto-retry.

Step 2 - confirm modal. Tracks with no `webpage_url` are dropped. For each track the user can edit title / artist / album (pre-filled from the preview) and pick artwork. Target selector (radio group), one of:

- `new`: create a new playlist (name pre-filled with the playlist title) via `POST /playlists` with `{ name }`, then use its id.
- `existing`: choose from `GET /playlists` (user's playlists).
- `library`: no playlist, songs land in the library only.

Artwork picker (component `ArtworkPicker`, shared with the yt-dlp tool): default artwork is the preview's last (largest) thumbnail; the user can search for real covers via

```
POST /tools_downloader/artwork_search
Body: { artist?, title?, album?, query? }
200 -> { items: [{ url, thumb_url?, source: "itunes"|"musicbrainz"|"deezer", width?, height?, label?, subtitle? }] }
```

or upload an image. For YouTube extractors the picker defaults to preferring an external (searched) cover over the video thumbnail. The selection ends up as either `artwork_url` (a remote URL) or `artwork_data_b64` (base64 bytes of an uploaded image).

Step 3 - start imports. One `POST /song_imports` per track, sequentially, with `position` starting at 1 and incrementing (only when a playlist target exists):

```
POST /song_imports
Body: {
  "source_url": "<webpage_url>",
  "source_provider": "<extractor before ':'>" | null,   // e.g. "youtube"
  "source_id": "<preview.id>" | null,
  "source_kind": "yt_dlp",
  "playlist_id": <id> | null,
  "position": <n> | null,
  "override_title": "...", "override_artist": "...", "override_album": "...",  // omitted when empty
  "artwork_url": "..." | omitted,
  "artwork_data_b64": "..." | omitted,
  "expected_duration_s": <float> | omitted
}
201 -> SongImport
```

`SongImport` shape (also returned by `GET /song_imports/:id` and listable via `GET /song_imports` with the standard search params `id, state, playlist_id, user_id, created_at, updated_at`):

```json
{
  "id": 123, "user_id": "...", "playlist_id": 45, "song_id": null,
  "source_url": "...", "source_provider": "youtube", "source_id": "...", "source_kind": "yt_dlp",
  "override_title": "...", "override_artist": "...", "override_album": "...",
  "expected_duration_s": 213.0, "position": 1, "sidecar_request_id": "...",
  "state": "pending", "progress_message": null, "progress_pct": 0.0,
  "error_message": null, "deduped": false, "created_at": "...", "updated_at": "..."
}
```

- `state` enum: `pending | processing | complete | failed`.
- `progress_pct` is a FLOAT 0..1 - multiply by 100 for display.
- Dedup: if the user already has the song (matched by ISRC first, then provider+source_id, then source_url), the create call returns immediately with `state: "complete"`, `deduped: true`, `progress_pct: 1.0`, `progress_message: "deduped"`, `song_id` set, and the song attached to the target playlist. Handle this without any polling.
- Errors on create: 400 `"source_url is not allowed"` (SSRF), 400 `"source_url or (search_artist + search_title) required"`, 400 `"artwork_url is not allowed"`, 404/401 for bad playlist ids.

Progress: poll `GET /song_imports/:id` every 1500ms while `state` is `pending`/`processing`; stop on `complete`/`failed`. Render `progress_message` (or "deduped") + percent + a progress bar (destructive color on failed) + `error_message` when failed. When an import completes with a `song_id`, invalidate the songs and playlists lists. In the multi-track modal each sidebar row shows a per-track state icon (spinner / check / X) driven by the same polling query.

Server-side, `SongImportJob` drives a yt-dlp sidecar (create download job, poll every 3s, 10 min timeout), downloads the audio, reads tags, creates the `Song` with source metadata + quality headers, extracts artwork, attaches to the playlist at `position` (or appends), and marks the import `complete`. Transient sidecar errors reset the import to `pending` and retry.

#### 2.1.3 External search import (used by the search page, same pipeline)

`GET /music/external_search?q=<query>&kind=track|album|artist|any` returns `{ tracks, albums, artists }` of external results (Spotify/YouTube/SoundCloud/Bandcamp/iTunes). Importing an external track POSTs to the same `/song_imports` endpoint:

- YouTube / SoundCloud results: send `source_url` directly.
- Spotify / iTunes results (no downloadable URL): send SEARCH MODE instead - `search_artist`, `search_title`, `search_album?`, `isrc?` and NO `source_url`. The backend resolves ISRC via MusicBrainz to a canonical stream link when possible, else runs a duration/artist-guarded yt-dlp search cascade.
- Always include `source_provider`, `source_id`, `override_*`, `artwork_url`, `expected_duration_s` (ms/1000) so the resulting song carries proper metadata.
- Then poll `GET /song_imports/:id` as above.

#### 2.1.4 Spotify tab - playlist sync (`SpotifySync`)

Gate: `allowed_to_use_spotify` on the account; backend answers 403 otherwise on every endpoint here.

Connect flow (OAuth link): navigate the system browser to `https://backend.omelhorsite.pt/auth/link/spotify?token=<auth token>` (native clients pass the bearer token; the cookie-web variant first mints a ticket via `GET /sessions/oauth_ticket` -> `{ ticket }` and passes `?ticket=`). Mark the flow as pending before redirecting so the callback only adopts a result for a flow this client started (login-CSRF guard).

```
GET /spotify_syncs/status
200 -> { "connected": false }
   or {
     "connected": true,
     "identity_id": "...",
     "spotify_user_name": "..." | null,
     "last_synced_at": "ISO" | null,
     "sync_settings": { "sync_liked": bool?, "enabled_playlists": string[] | null, "auto_sync": bool },
     "sync_progress": {
       "state": "idle" | "running" | "complete" | "failed",
       "started_at": "ISO" | null, "finished_at": "ISO" | null, "error": string | null,
       "playlists": [ { "id", "name", "total": number|null, "queued": number, "skipped": number,
                        "state": "pending"|"running"|"complete"|"failed" } ]
     }
   }
```

- `auto_sync` in `sync_settings` defaults server-side to "true if ever synced" when unset.
- A `running` progress older than 2h is rewritten to `failed` by the status endpoint itself (lost-job failsafe), so clients never see an eternal spinner.

```
GET /spotify_syncs/preview
200 -> { "sync_liked": bool, "playlists": [ { "id", "name", "track_count": n|null, "owner": string|null, "cover_url": string|null, "enabled": bool } ] }
```

Only playlists the user owns or collaborates on are listed (Spotify API restriction); editorial playlists are excluded. `enabled` is true when `enabled_playlists` is null (never configured) or contains the id. Errors: 404 when not linked; 502 on Spotify auth/upstream failures.

```
PATCH /spotify_syncs/settings
Body (all keys optional; a key is only applied when PRESENT):
  { "enabled_playlists": ["id", ...], "sync_liked": bool, "auto_sync": bool }
200 -> { "ok": true, "sync_settings": {...} }
```

Destructive side effects to warn about: deselecting a playlist DELETES its locally synced copy (and its membership rows) immediately; turning `sync_liked` off deletes the locally synced "liked" mirror playlist. Re-enabling re-creates them on the next sync.

```
POST /spotify_syncs
Body: { "playlist_ids": ["id", ...] }   // optional narrowing; omit to sync enabled set
200 -> { "ok": true, "queued_at": "ISO" }
409 -> "a sync is already running"  (unless stale)
```

UI behavior: while `sync_progress.state === "running"`, poll status every 1500ms; render a per-playlist progress list (done = queued + skipped over `total`, bar per state, `queued` = new tracks, `skipped` = already in library) and an overall header ("k / n playlists" while running; "X new, Y already in library" when complete; error text when failed). Toggle changes save immediately via the PATCH (optimistic local state). "Sync now" disabled while running. Show `last_synced_at` when idle.

The synced content shows up as playlists with `source_kind: "spotify_sync"`, `source_provider: "spotify"`, `source_external_id` = Spotify playlist id or `"liked"` for the liked-songs mirror (the web gives the liked mirror the same purple-heart artwork as local Liked Songs). Individual tracks arrive through the same `song_imports` pipeline in the background (search mode with ISRC), on the default queue.

#### 2.1.5 Artist tab - import a whole artist (`ArtistImport`)

Requires a linked Spotify identity (the metadata comes from Spotify's catalog; backend answers 400 `"Connect Spotify first."` / `"Spotify connection needs to be relinked."` otherwise). Note this is NOT gated by `allowed_to_use_spotify` in the FE tab list, but backend Spotify errors are surfaced inline (see error classification below).

```
GET /artist_imports/search?q=<text>
200 -> {
  "roster":  [ { "kind": "roster",  "id": 1, "name": "...", "slug": "...", "image_url": string|null } ],
  "spotify": [ { "kind": "spotify", "id": "spotifyId", "name": "...", "followers": n|null,
                 "genres": ["..."], "image_url": string|null, "external_url": string|null } ]
}
```

Search is debounced (300ms). `roster` = artists already in the user's library; picking one re-runs the Spotify search by that name and selects the exact (case-insensitive) name match, else the first hit, to obtain a Spotify artist id ("not found on Spotify" toast when none).

```
GET /artist_imports/albums?spotify_artist_id=<id>
200 -> { "items": [ { "id", "name", "album_type": string|null, "album_group": string|null,
                      "release_date": "YYYY-MM-DD"|null, "total_tracks": n|null,
                      "image_url": string|null, "external_url": string|null } ] }
```

All albums start selected; the user can toggle each, select all, or clear. A summary line shows selected/total albums and total tracks.

```
POST /artist_imports
Body: { "spotify_artist_id": "...", "spotify_artist_name": "...", "album_ids": ["...", ...] }
201 -> ArtistImportRecord
```

```
GET /artist_imports?limit=20   // recent, newest first, limit clamps 1..50
200 -> { "items": [ ArtistImportRecord ] }
```

`ArtistImportRecord`:

```json
{
  "id": 7, "user_id": "...", "spotify_artist_id": "...", "spotify_artist_name": "...",
  "album_ids": ["..."], "state": "queued",
  "total_albums": 12, "total_tracks": 140, "processed_albums": 3,
  "queued_count": 30, "skipped_count": 5, "failed_count": 0,
  "last_message": "Waiting in queue…", "error_message": null,
  "started_at": null, "finished_at": null, "created_at": "...", "updated_at": "..."
}
```

`state` enum: `queued | running | complete | failed`. The recent list polls every 1500ms while any record is `queued`/`running`. Render each as a progress row: albums processed/total drives the bar; `queued_count` (tracks queued for import) + `skipped_count` (already in library) as a caption; `last_message` while active; `error_message` when failed. Each album's tracks funnel into the same `song_imports` pipeline server-side.

Spotify error classification (worth reproducing so routine issues do not raise generic error UI): match the response body text - `"Connect Spotify first"` -> show a "connect" banner linking to the account dashboard; `"needs to be relinked"` -> "relink" banner with the same link; `"Spotify upstream error"` or any network/502/503/504/timeout -> "upstream" banner with a Retry button that re-triggers the last search/albums fetch. Everything else -> normal error toast.

### 2.2 Songs settings page (`SongsTable`)

Library management table over `GET /songs`:

- The backend clamps `/songs` pages at 500 rows (`modifiers[page]=n:500`); the web uses an infinite query accumulating pages and a "load more" button; total shown as `<loaded>+` while more pages remain.
- Client-side filters over the loaded rows: title / artist (against the formatted artists line) / album substring; multi-select origin (`source_provider || source_kind || "upload"` values present in data); quality (lossless/lossy from `audio_lossless`); codec (`audio_codec` lowercased). While a title/album filter is typed, a parallel server-side search fetches matching rows beyond the loaded pages and folds them in (`useSongLibrarySearch`).
- Row selection + bulk delete via `DELETE /songs/:id` per song (confirm dialog).
- Edit dialog per song (PATCH `/songs/:id`, multipart FormData):
  - Fields: `title`, `album`, `year`, `position`, optional `artwork` file (image/*; server stores it as a new fs node).
  - Artists are edited as chips with a per-chip role toggle (primary/featured). Submission sends `artist_names[]` (primaries, in order) and `featured_artist_names[]`. CRITICAL PROTOCOL: always send the `featured_artist_names[]` key, appending a single empty string when there are no featured artists - the presence of the key is what makes the backend use the explicit split verbatim instead of its legacy title-based "feat." heuristic. Empty strings are stripped server-side.
  - The dialog also hosts vocal-separation (stems) controls: `POST /songs/:id/separate` with optional `model_id` (models list from the vocal-separations endpoint), status via `GET /songs/:id/separation` (`{ stems_ready, vocals_fs_node_id, instrumental_fs_node_id, progress_percent, job }`), delete stems via `DELETE /songs/:id/separation`. `song.vocal_separation_started_at` non-null means processing.

### 2.3 Artists settings page (`ArtistsTable`)

Table over `GET /artists` (full list, client-side name filter and pagination). Row actions: edit (rename via `PATCH /artists/:id` with `{ artist: { name } }`; upload image `POST /artists/:id/upload_image`, banner `POST /artists/:id/upload_banner`, multipart field `image`) and delete (`DELETE /artists/:id`). Artist payload fields are in `MusicService.ts` (`Artist` type): `id, name, slug, songs_count, image_fs_node_id, compressed_image_fs_node_id, banner_fs_node_id, ..., picture_* (cached Deezer sizes), gallery_image_urls, fallback_artwork_fs_node_id, external_image_url, similar, bio_html, ...`. Avatar resolution order (replicate `Artist.artworkUrl`): compressed uploaded image > uploaded image > Deezer picture by requested size (sm prefers medium, lg prefers xl) > `picture` > first gallery URL > fallback song artwork node > `external_image_url` > null.

### 2.4 Playback settings page (`PlaybackPage`)

One setting today: "share listening" (whether accepted friends can see what you are playing - powers the friends strip, friend activity panel and jam presence).

- Read: own account payload, field `share_listening` (boolean). The web DEFAULTS the displayed value to `true` when absent.
- Write: `PATCH /users/:id` (own id) as multipart FormData with `share_listening=<bool>`; the web invalidates all queries afterwards. Other self-editable fields on the same endpoint include `library_public`, `library_name`, `library_description`.
- Effects server-side: friends only receive your listening snapshots / appear-in-strip when `share_listening` is true; it also filters the FriendListeningChannel.

---

## 3. Discover, mixes and radios

### 3.1 Discover page

`/music/discover` renders `Home`: filter pills (All / Playlists / Albums / Artists) plus, on "All":

- Top tiles: `GET /play_events/recent?group_by=album&limit=8` (recently played albums; falls back to the first 8 playlists when no history). Album tile links to `/music/artist/<artistSlug>/<encodedAlbumName>`.
- Friends listening strip (social; separate spec).
- "Made for you" carousel: mixes (below).
- "Recommendations today": `GET /songs/albums?modifiers[random]=true&modifiers[page]=1:10`.
- "Your playlists": `GET /playlists?modifiers[page]=1:20`.
- "Your artists": `GET /play_events/top?scope=artist&since=30d&limit=10` (TopArtist rows `{ artist: Artist|string, play_count }`).

### 3.2 Mixes

```
GET /music_mixes            -> MixSummary[]        (no songs)
GET /music_mixes/<slug>     -> MixSummary & { songs: Song[] }   (slug URL-encoded; contains ':')
```

`MixSummary`:

```json
{
  "slug": "mix:top_artist:1:ab12cd34",
  "kind": "top_artist",
  "title": "Bladee Mix",                       // English fallback only
  "description": "Your favourites from Bladee.",
  "title_key": "topArtist", "title_params": { "artist": "Bladee" },
  "description_key": "topArtist", "description_params": { "artist": "Bladee" },
  "seed": "Bladee",                            // artist name | decade number | null
  "artist": { ...compact Artist... } | null,   // present on top_artist mixes
  "gradient": "from-rose-500 to-orange-500"    // IGNORED by the client, see below
}
```

Kinds and generation rules (server, `MusicMixGenerator`):

- `top_artist` (up to 3): the user's 3 most-played primary artists of the last 30 days; 30 random songs by that artist. Slugs `mix:top_artist:<rank>:<sha8 of canonical name>`.
- `repeat_rewind`: 30 most-played songs of the last 90 days. Slug `mix:repeat_rewind`.
- `time_capsule`: the user's most common decade by song `year`; 30 random songs from that decade. Slug `mix:time_capsule:<decade>`, `seed` = decade number (e.g. 1990).
- `discoveries`: 30 random playlisted songs whose primary artist was NOT played in the last 90 days. Slug `mix:discoveries`.

Empty mixes are omitted, so the list can have 0..6 entries. The whole payload is server-cached per user for 24 HOURS (cache key `music_mixes:v2:<user_id>`) - the mixes and their song sets refresh at most daily; there is no client-facing refresh endpoint. The `artist` object is resolved at render time (not cached), so artist image updates show up immediately.

Client rendering rules to replicate:

- Titles/descriptions MUST be rendered from `title_key` + `title_params` (and description twins) through the app's own translations; `title`/`description` are English-only fallbacks for unknown keys. Web keys live under `components.music.mixLabels` (`title.topArtist`, `title.repeatRewind`, `title.timeCapsule`, `title.discoveries` + descriptions).
- The backend `gradient` field is intentionally IGNORED. The client owns a per-kind gradient map (web values, Tailwind-style stops):
  - top_artist: rose-600 -> fuchsia-600 -> indigo-700
  - repeat_rewind: amber-500 -> orange-600 -> rose-700
  - time_capsule: emerald-500 -> teal-600 -> cyan-700
  - discoveries: sky-500 -> blue-600 -> violet-700
- Mix artwork: for `top_artist`, the artist's image via the standard artist artwork resolution on the carried `artist` object (same picture on tile and detail page, by design); other kinds have no photo, only the gradient. When a photo exists, overlay a dark vertical gradient for text/icon legibility.
- Tile "stamp" text (big uppercase word over the art): artist name for `top_artist`; `"<seed>s"` (e.g. "1990s") for `time_capsule`; otherwise the localized title. Font size steps down with length (<=8 chars largest, <=14, <=22, else smallest).
- Tile icons per kind: top_artist sparkles, repeat_rewind music note, time_capsule clock, discoveries compass.
- Detail page (web route `/music/mix?slug=<encoded>`): hero with stamp/photo, localized description + "N songs", Play and Shuffle actions (set the player queue to `mix.songs` in order; shuffle picks a random start index and enables shuffle mode), and a song table with columns index / title / album / duration. Playing from row i sets the queue to the whole list at index i with shuffle off.
- Client caching: mixes list has no special staleTime; the mix detail is fetched per slug.

### 3.3 Radios (artist radio / song radio)

```
GET /music_radios/artist/<artist>     // <artist> = artist SLUG (preferred) or canonical name, URL-encoded
GET /music_radios/song/<songId>
200 -> {
  "slug": "radio:artist:<sha12>" | "radio:song:<id>",
  "kind": "artist" | "song",
  "title": "Bladee Radio" | "Obedient Radio",
  "description": "Estação inspirada em Bladee." | "Estação inspirada em Obedient, de Bladee.",
  "seed": "Bladee" | "Obedient",
  "gradient": "from-rose-600 via-purple-600 to-blue-600",   // IGNORED by the client
  "songs": [ Song, ... ]                                     // full Song payloads, ordered
}
404 -> "Could not build radio for ..."   // artist not in the user's library, or no songs
```

Generation (server, `MusicRadioGenerator`): target 40 songs; ~30% (12) random songs by the seed artist; the rest random songs by the user's LIBRARY artists that appear in the seed artist's Last.fm similar list (`artist.similar_json`); shuffled together. The artist lookup is by canonical name OR slug within the user's own artists - it never creates artist rows, and an artist the user does not have yields 404. Song radio builds the artist radio of the song's primary artist, retitles it after the song, and unshifts the seed song to position 0 (so `songs[0]` is the seed track).

Refresh semantics (important): the built radio is server-cached for 7 DAYS per (user, seed) - keys `music_radio:v2:artist:<user>:<sha of lowercased artist>` and `music_radio:v2:song:<user>:<song_id>`. Within that window every visit returns the same batch. The web additionally caches for 5 minutes client-side (`staleTime`). There is no refresh button; the UI treats the radio as ephemeral and offers "Save as playlist" to freeze the current batch: `POST /playlists` with `{ name: radio.title, song_ids: [...] }`, then navigate to the new playlist.

Radio titles/descriptions are PRE-BAKED PORTUGUESE strings from the server (unlike mixes, no keys). Render them as-is or accept the Portuguese description.

Entry points on the web (replicate as actions): artist page and artist spotlight -> "artist radio" navigates to `/music/radio/artist?artist=<slug>`; song context menu -> "song radio" navigates to `/music/radio/song?id=<songId>`. Both routes redirect to `/music/discover` when the query param is missing.

Radio detail rendering (`RadioView`): same layout as a mix detail. Client-owned gradients per kind: artist = rose-600 -> fuchsia-600 -> indigo-700; song = amber-500 -> orange-600 -> rose-700. Backdrop image: artist radio uses the seed artist's photo from `GET /songs/artist_pictures?name=<artistName>` -> `{ pictures: [{ picture, picture_small, picture_medium, picture_big, picture_xl }] }` (first picture, xl > big > medium); song radio uses `songs[0]`'s artwork. When there is no photo, use a static accent color per kind (web: fuchsia-600 for artist, orange-600 for song). Actions: Play, Shuffle, Save as playlist. Song table columns: index / title / album / duration; row play sets the queue.

---

## 4. Generic async-job machinery (used by lyrics sync and other tools)

- `Job` REST: `GET /jobs/:id` (shape in section 1.4). Optional `?watch_token=<signed token>` grants access to that single job for anonymous tool flows; authenticated owners do not need it. Music flows (lyrics sync) are authenticated and get the job id from the enqueueing endpoint.
- Realtime: ActionCable websocket channel `JobChannel`, subscribe params `{ channel: "JobChannel", id: "<job id>", token?: "<watch token>" }`. Messages carry `{ job: Job }` on subscribe (snapshot) and on every change. The web's `Job.await` combines the channel with a slow REST poll (every `interval * 5`, default interval 2000ms => 10s) and resolves once `finished_at` is set; a 404 during polling means "row not visible yet, keep waiting".
- Song imports, artist imports and spotify syncs do NOT use `Job`/JobChannel - they have their own records polled via plain REST (1500ms) as described above.

---

## 5. Gotchas checklist for the RN rebuild

1. `GET /lyrics` never 404s for missing lyrics - it returns 200 with nulls. 404 means the song id is wrong. First-ever fetch per song is slow (inline external lookups); the server negative-caches misses for 24h, so "try again" within a day is pointless.
2. LRC parsing must skip metadata tags and lines without `[m:ss]` timestamps, support multiple timestamps per line, and keep empty-text timed lines (render a placeholder dot).
3. Translation alignment: synced lines align by timestamp string `time.toFixed(2)`, plain lines by index. Suppress translations identical to the source line. Never auto-retry on 429 (burns the hourly cap) or 404. Translation cap is 60/h per user; sync-generation cap is 10/h.
4. `song_imports.progress_pct` is 0..1; multiply by 100. A `deduped: true` create response is already terminal - do not poll it.
5. Mix and radio `gradient` fields from the backend are ignored by the client on purpose (they are Tailwind class strings); own your gradient/accent maps per kind. Mix titles must render from `title_key`/`title_params` (client-side i18n), while radio titles/descriptions come pre-baked in Portuguese.
6. Mixes are server-cached 24h per user; radios 7 days per (user, seed). Do not build "pull to refresh regenerates the mix" UX - it will return the same batch. "Save as playlist" is the freeze mechanism for radios.
7. Radio artist parameter should be the artist SLUG (canonical name also resolves); a radio for an artist not in the user's library is a 404, not an empty list.
8. When PATCHing a song's artists, ALWAYS include `featured_artist_names[]` (single empty string when none) alongside `artist_names[]`; omitting the key flips the backend into a legacy title-parsing heuristic.
9. `/songs` is hard-capped at 500 rows per page and heavy; paginate with `modifiers[page]="n:500"` and accumulate, as the settings table does.
10. Spotify: URL imports of open.spotify.com links are rejected by design (400 with a human message); Spotify content arrives via linked-account sync or external-search search-mode imports. The whole `/spotify_syncs/*` surface is 403 unless the account has `allowed_to_use_spotify`. Deselecting a synced playlist (or disabling liked sync) DELETES local copies immediately - warn the user.
11. Concurrency etiquette from the web client worth keeping: 3 parallel file uploads max; sequential `POST /song_imports` when importing a playlist; 1500ms polls only while something is active; playlist preview limited to 60/h.
12. `POST /songs/import` is synchronous and can take tens of seconds for large lossless files - use a long HTTP timeout and per-file progress UI, and keep a global "import busy" flag so two surfaces do not import at once (web uses `window.musicImportBusy`).
13. Job awaiting should prefer the ActionCable `JobChannel` with a REST fallback poll; a 404 from `GET /jobs/:id` right after enqueue is normal (row not yet visible) - keep waiting.
14. The lyrics rail on the web mounts/unmounts with tab visibility so the rAF loop does not run for a hidden view; in RN, stop the frame timer when the lyrics screen is not visible (battery).
