# Music REST API - full surface used by the web frontend

Audience: engineers rebuilding the omelhorsite music feature as a native React Native (Expo)
app talking to the SAME production backend with zero backend changes.

Sources of truth read for this doc:

- `frontend/services/MusicService.ts` (every call the music UI makes)
- `frontend/lib/queries/music.ts` (how those calls are paginated / cached / retried)
- `frontend/services/BackendService.ts`, `frontend/lib/request.ts` (transport + auth)
- `backend/config/routes.rb` (music sections)
- Backend controllers: `songs_controller.rb`, `playlists_controller.rb`,
  `playlist_songs_controller.rb`, `play_events_controller.rb`, `liked_songs_controller.rb`,
  `music_mixes_controller.rb`, `music_radios_controller.rb`, `artists_controller.rb`,
  `artist_metadata_controller.rb`, `lyrics_controller.rb`, `music/external_search_controller.rb`,
  `song_imports_controller.rb`, `artist_imports_controller.rb`
- Serializers in `backend/app/blueprints/` (Blueprinter)
- Shared machinery: `concerns/crud_actions.rb`, `concerns/authentication.rb`,
  `services/query_modifier.rb`, `services/query_searcher.rb`

---

## 1. Transport, base URL, auth

- Base URL (production): `https://backend.omelhorsite.pt`
- Every route in this doc is relative to that base, no `/api` prefix. Example:
  `GET https://backend.omelhorsite.pt/songs`
- All music endpoints REQUIRE an authenticated session (`Authentication` concern runs
  `require_authentication` on every controller here; none opt out). Unauthenticated
  requests get `401` with body `"Session required to access this resource."`.

### Credential resolution (backend `Session.candidate_tokens`)

The backend accepts a session token from, in order, first one that resolves to a LIVE session wins:

1. `Authorization: Bearer <token>` header
2. `?token=<token>` query parameter (any request; this is how media URLs are authenticated
   for `<audio>` elements / native players)
3. `session_token` httpOnly cookie (web only; irrelevant for a native app)

For a native app: store the token from login and send it as a Bearer header on every JSON
request, and as a `?token=` query param on media URLs handed to a player/download manager.
The existing iOS Capacitor build already works exactly this way (`isCookieAuth()` is false
under `capacitor:` protocol, so it uses the token).

### Response conventions

- Success bodies are BARE arrays or objects. There is no `{ data: ... }` envelope. The
  frontend's `response.data` is just the axios body.
- Status codes: `200` for reads/updates, `201` for creates, `204` (empty body) for deletes.
- ERROR bodies are usually a bare JSON string with the human message, e.g. a 404 body is
  literally `"Song not found"` (quotes included; `render json: "..."`). A few errors are
  objects (e.g. `{"deduped": true}` is a success, see play events). Do not assume
  `{ error: ... }` shapes.
- Index actions of CRUD controllers go through `stale?(resources)`, so they emit
  `ETag`/`304` for conditional GETs. A plain request without `If-None-Match` always gets `200`.
- Timestamps are ISO8601 strings. Every Blueprinter payload includes `id`, `created_at`,
  `updated_at` unless noted (`ApplicationBlueprint` adds them; named views INHERIT the base
  fields - a Blueprinter `view :extended` payload is base fields plus the extras).

### The null sentinel `"\b"` (important wire quirk)

`BackendService.transformNulls` replaces every `null` in outgoing params/bodies with the
literal one-character string `"\b"` (ASCII backspace). The backend (`CrudActions`) converts
`"\b"` back to `nil` inside `search` / `exact_search` / `modifiers` / create / update params.
So to filter "album IS NULL" the web app sends `exact_search[album]=%08`. If you want exact
parity (e.g. clearing a field on PATCH, or filtering by null), reproduce this encoding.
Omitting a key entirely means "no filter / do not touch".

### GET parameter encoding

For GET requests the "body" object is sent as query params, axios-style bracket encoding:

```
GET /songs?search[title]=amor&exact_search[artist]=Chico%20Buarque&modifiers[page]=1:500&modifiers[order]=created_at:asc
GET /playlist_songs?exact_search[playlist_id]=12&modifiers[page]=2:100&modifiers[order]=position:asc
```

Arrays encode as `key[]=a&key[]=b`.

---

## 2. The generic list-filter DSL (CRUD controllers)

`GET /songs`, `GET /playlists`, `GET /playlist_songs`, `GET /artists`, `GET /song_imports`
all speak the same query DSL:

- `search[<col>]=<value>` - partial, accent-insensitive match for string columns. The server
  lowercases, strips diacritics, collapses non-alphanumerics to `-`, and runs `LIKE %value%`
  on the normalized text (value gets the same normalization). Numbers/dates match exactly.
  A key may carry an array (`search[id][]=1&search[id][]=2`).
- `exact_search[<col>]=<value>` - plain SQL equality (`WHERE col = value`, arrays become `IN`).
- `modifiers[page]=N:SIZE` - offset pagination, 1-based page number, `SIZE` clamped to a hard
  max of 500 server-side. If an index request sends NO page modifier the server forces
  `1:500`, so you can never get more than 500 rows in one call.
- `modifiers[order]=column:asc|desc` - column must be a real column of the model, otherwise
  silently ignored. An optional third segment pins specific values first
  (`order=state:asc:queued,running`), unused by the music UI.
- `modifiers[random]=true` - random order (also disables the ETag/304 path).
- UNKNOWN filter keys FAIL CLOSED: `search[nope]=x` returns
  `400 "Unknown search filter(s): nope"` rather than being ignored. Allowed keys are listed
  per endpoint below (every controller also accepts `id`, `created_at`, `updated_at` on top
  of its own list).

Endpoints that are NOT CRUD-shaped (liked_songs, play_events, mixes, radios, lyrics,
external search, artist_imports) use their own bespoke params, documented inline.

---

## 3. Core payload shapes

### Song (SongBlueprint, default and extended views are identical)

```jsonc
{
  "id": 123,
  "created_at": "2026-01-01T10:00:00.000Z",
  "updated_at": "2026-01-01T10:00:00.000Z",
  "title": "Nome",
  "album": "Album" ,              // string | null
  "duration": 213,                 // seconds, integer
  "position": 4,                   // legacy library position, integer
  "year": 1998,                    // number | null
  "audio_fs_node_id": "uuid",      // original audio file node (see section 15)
  "compressed_audio_fs_node_id": "uuid" ,  // transcoded stream copy, may be null
  "artwork_fs_node_id": "uuid",            // may be null
  "compressed_artwork_fs_node_id": "uuid", // may be null
  "vocals_fs_node_id": null,       // set when stems exist
  "instrumental_fs_node_id": null,
  "vocal_separation_started_at": null,     // ISO string while a separation runs
  "user_id": "uuid",
  "source_kind": "upload",         // "upload" | "yt_dlp" | "spotify_sync"
  "source_provider": "youtube",   // "youtube" | "soundcloud" | "spotify" | "bandcamp" | "vimeo" | null | other
  "source_url": null,
  "source_id": null,
  "isrc": null,                    // present in payload, absent from the FE type
  "original_filename": "a.flac",  // string | null
  "audio_codec": "flac",          // string | null
  "audio_bitrate_kbps": 1411,      // number | null
  "audio_sample_rate_hz": 44100,   // number | null
  "audio_channels": 2,             // number | null
  "audio_lossless": true,
  "audio_filesize_bytes": 31457280, // number | null
  "artists": [ /* SongArtistEntry, see below */ ]
}
```

Notes:

- There is NO `track_number` / `disc_number` in the payload despite the FE type declaring
  them (they are optional there and always undefined). Do not rely on them.
- The legacy `artist` string column was DROPPED (Phase 5). `artists` is the only artist
  source. The FE keeps `artist?` in its type purely for old cached data.
- Display-name building (Spotify style): sort `artists` by `position`; line =
  primaries joined by `", "` + `(feat. X, Y)` for role `featured`; role `with` renders
  only in credits dialogs / media-session metadata.

### SongArtistEntry (SongArtistBlueprint, nested under `song.artists`)

```jsonc
{
  "id": 55,                        // song_artists join row id (NOT the artist id)
  "created_at": "...", "updated_at": "...",
  "song_id": 123,
  "artist_id": 9,
  "position": 0,                   // ordering within the song's credits
  "role": "primary",              // "primary" | "featured" | "with"
  "name": "Artist Name",
  "slug": "artist-name",
  "image_fs_node_id": null,
  "compressed_image_fs_node_id": null,
  "picture": "https://...deezer...", // cached Deezer picture URLs, may be null
  "picture_medium": "https://...",
  "external_image_url": null
}
```

### Playlist (PlaylistBlueprint; `extended` adds nothing)

```jsonc
{
  "id": 7, "created_at": "...", "updated_at": "...",
  "name": "Minhas",
  "user_id": "uuid",
  "artwork_fs_node_id": "uuid",   // may be null
  "source_kind": "manual",        // "manual" | "imported" | "spotify_sync"
  "source_provider": null,         // e.g. "spotify"
  "source_url": null,
  "source_external_id": null,      // "liked" marks the Spotify liked-tracks mirror
  "synced_at": null
}
```

A playlist is a SYSTEM playlist when `source_kind` is present and not `"manual"`. System
playlists refuse reorder / artwork upload / adding / removing songs (401 with an explanatory
message); copy them first.

### PlaylistSong (PlaylistSongBlueprint)

```jsonc
{
  "id": 900, "created_at": "...", "updated_at": "...",
  "playlist_id": 7,
  "song_id": 123,
  "position": 0,
  "song": { /* full Song */ }
}
```

### LikedSong (LikedSongBlueprint view :extended)

```jsonc
{
  "id": 41, "created_at": "...", "updated_at": "...",
  "user_id": "uuid",
  "song_id": 123,
  "liked_at": "2026-07-01T20:11:00.000Z",
  "song": { /* full Song */ }
}
```

### Artist (ArtistBlueprint)

Base view (returned by `GET /artists` index, plus two computed fields):

```jsonc
{
  "id": 9, "created_at": "...", "updated_at": "...",
  "name": "Chico Buarque",
  "canonical_name": "chico buarque",
  "slug": "chico-buarque",
  "user_id": "uuid",
  "image_fs_node_id": null,                 // user-uploaded avatar
  "compressed_image_fs_node_id": null,
  "banner_fs_node_id": null,                // user-uploaded hero banner
  "compressed_banner_fs_node_id": null,
  "mbid": "musicbrainz-id-or-null",
  "lastfm_listeners": 1200000,              // number | null
  "lastfm_playcount": 99000000,             // number | null
  "external_image_url": null,               // stamped from Last.fm/MusicBrainz backfill
  "picture": "https://...",                // cached Deezer picture set, all may be null
  "picture_small": "https://...",
  "picture_medium": "https://...",
  "picture_big": "https://...",
  "picture_xl": "https://...",
  "pictures_fetched_at": "...",
  "bio_fetched_at": "...",
  "similar_fetched_at": "...",
  "songs_count": 34,                        // computed; COUNT of song_artists rows
  "fallback_artwork_fs_node_id": "uuid"     // artwork of one of the artist's own lead songs;
                                            // only non-null on index/show (pre-computed there),
                                            // null when the blueprint renders standalone
}
```

`view :extended` (returned by `GET /artists/:id`, PATCH, uploads) = base fields PLUS:

```jsonc
{
  "bio_html": "<p>...</p>",                        // string | null
  "gallery_image_urls": ["https://...", "..."],   // Wikipedia/Wikimedia photos
  "similar": [ { "name": "Caetano Veloso", "match": 0.87, "mbid": "..." } ]
}
```

`view :compact` (used inside mixes, play-event album/artist aggregations) = ONLY:
`id`, `created_at`, `updated_at`, `name`, `slug`, `image_fs_node_id`,
`compressed_image_fs_node_id`.

`view :card` (used by `GET /artists/overview`) = `id`, timestamps, `name`, `slug`, both
image node ids, both banner node ids, `picture`, `picture_medium`, `picture_big`,
`picture_xl`, `external_image_url`, `lastfm_listeners`
(plus `songs_count` / `fallback_artwork_fs_node_id` computed fields, fallback pre-filled).

Avatar resolution chain the web app uses (reimplement client-side):
`compressed_image_fs_node_id` -> `image_fs_node_id` -> Deezer `picture_*` (size-appropriate:
medium for small avatars, xl for hero) -> `picture` -> `gallery_image_urls[0]` ->
`fallback_artwork_fs_node_id` -> `external_image_url` -> nothing.

### ArtistMetadata (legacy shim payload, ArtistMetadataBlueprint)

Returned by `GET /artist_metadata/:name`. No `created_at`/`updated_at`. Keys:
`id`, `name`, `slug`, `mbid`, `lastfm_listeners`, `lastfm_playcount`, `bio_html`
(sanitized), `image_url` (= `external_image_url`), `image_fs_node_id`,
`compressed_image_fs_node_id`, `banner_fs_node_id`, `compressed_banner_fs_node_id`,
`picture`, `picture_small`, `picture_medium`, `picture_big`, `picture_xl`,
`similar` (array of `{name, match, mbid}`).
When the artist is not in the user's roster the endpoint still answers `200` with every key
null except `name` (echoed back) and `similar: []`. It NEVER creates artist rows.

---

## 4. Songs

### GET /songs - list the library

- Search keys: `search`/`exact_search` on `id`, `created_at`, `updated_at`, `title`,
  `album`, `position`, `year`, plus the special `artist` filter (below).
- Special artist filter: `exact_search[artist]=<name-or-slug>` (or `search[artist]`,
  same behavior - both are EXACT lookups). The server resolves the value against the user's
  Artist roster by canonical name first, then slug, and joins through `song_artists`.
  An unknown artist yields an EMPTY list, not an error. This is not a partial match.
- `artist_role=primary|featured|with` - TOP-LEVEL query param (not inside exact_search),
  only meaningful together with the artist filter. `featured` means "appears as
  featured/with AND is not primary on that song".
- Pagination: forced; default and max page size 500. Base order `created_at asc, id asc`
  (stable pages); `modifiers[order]` reorders on top.
- Response: `Song[]`.
- The web app pages the management table with
  `modifiers[page]=N:500&modifiers[order]=created_at:asc` and treats a short page as the end.
- Renders: SongBlueprint (default view), `artists` preloaded.

### GET /songs/:id - one song

- Response: `Song` (view :extended, identical shape). 404 `"Resource not found"`.

### PATCH /songs/:id - edit metadata

- Body: JSON or multipart. Permitted song columns: `title`, `album`, `year`, `position`.
- Virtual inputs handled by hand:
  - `artist` (string) - legacy single-line artist input; re-parsed into song_artists.
  - `artist_names[]` (array of strings) - explicit multi-artist list; wins over `artist`.
  - `featured_artist_names[]` (array) - explicit featured credits. Sentinel protocol: to opt
    into "explicit mode with zero featured artists" the web app sends the key with a single
    empty string (`featured_artist_names[]=""`). Key absent = legacy title-based heuristic
    ("feat." parsing) applies.
  - `artwork` (multipart file) - stored as a new fs node in the user's music storage and
    attached.
- Changing `title` alone also re-triggers artist parsing.
- Response: updated `Song` (200).

### DELETE /songs/:id

- 204 empty. Only the owner (or admin) may destroy; otherwise 401.

### POST /songs/import - upload an audio file

- Multipart body, field `file` (the audio file; tags/artwork are extracted server-side).
- Response: `200` with the created `Song` (note: 200, not 201).
- Errors: `400 "No file provided"`, `415` with validation messages for unsupported audio.

### GET /songs/artists - artist NAME strings

- Response: `string[]` - the names of ALL the user's Artist rows ordered by name.
- IGNORES every filter param sent (the web app sometimes passes filters; they do nothing).
- Kept for back-compat; prefer `GET /artists`.

### GET /songs/albums - album cards

- Same filters as `GET /songs` (including the artist join filter and `artist_role`).
- NOT paginated by default (no forced page; sending `modifiers[page]` works).
- Response: array of

```jsonc
{ "name": "Album name",           // string | null (null = single/no-album bucket)
  "artist": "Primary Artist",     // string | null
  "artist_slug": "primary-artist",// string | null
  "artwork_fs_node_id": "uuid" }   // string | null
```

- Deduped server-side by `[album, primary_artist_id]` (or `[album, filtered_artist_id]`
  when the artist filter is on).

### GET /songs/artist_pictures?name=<artist name>

- Deezer picture proxy, cached on the user's Artist row. Lookup-only (no stub rows).
- Response: `{ "pictures": [ { "picture", "picture_small", "picture_medium", "picture_big", "picture_xl" } ] }`
  (zero or one entry in practice; empty array when unknown).
- Prefer the `picture_*` fields already present on Artist/SongArtist payloads.

### POST /songs/metadata_modifier - tag editor for a LOCAL file (no library write)

- Multipart: `audio_file` (max 50MB, else `413`), `metadata[title]`, `metadata[artist]`,
  `metadata[album]`, `metadata[year]`, `metadata[genre]`, `metadata[artwork]` (file).
- The web app also sends `metadata[track_number]`; the backend permit list DROPS it silently.
- Response: the modified audio file as a binary attachment
  (`Content-Disposition: attachment`). Not JSON.

### POST /songs/clean

- Route exists (`post :clean, on: :collection`) but the controller defines no `clean`
  action; calling it raises server-side. Dead route, do not implement.

---

## 5. Vocal separation (stems)

### POST /songs/:id/separate

- Body: `{ "model_id": "<optional sidecar model id>" }` (omit for default).
- 201 with a VocalSeparation extended payload (below). Errors: `400 "Song has no audio"`,
  `400 "Unknown model"`, 401 if not owner.

### GET /songs/:id/separation - status poll

Response wrapper:

```jsonc
{
  "stems_ready": false,
  "vocals_fs_node_id": null,
  "instrumental_fs_node_id": null,
  "progress_percent": 42.0,        // duplicated from job for FE convenience; null unless processing
  "job": { /* VocalSeparation extended, or null when none ever ran */ }
}
```

`job` (VocalSeparationBlueprint view :extended) fields: `id`, `created_at`, `updated_at`,
`status` (`"pending" | "processing" | "complete" | "failed"` - there is NO "canceled" even
though the web FE checks for it), `model_id`, `duration_seconds`, `error`, `finished_at`,
`song_id`, `user_id`, `ip_address`, `has_vocals`, `has_instrumental`, `has_original`,
`song_title`, `progress_percent` (null unless processing), `queue_position` (0 = next up,
null once processing/terminal), `vocals_url` / `instrumental_url` (always null for
song-owned separations; the stems land on the Song as `vocals_fs_node_id` /
`instrumental_fs_node_id`).

Polling contract used by the web app: poll every 3s while `job.status` is pending/processing;
stop when `stems_ready` or terminal status or `job == null`. A song with
`vocal_separation_started_at != null` is "separation in flight".

### DELETE /songs/:id/separation

- Deletes the stems. 204.

---

## 6. Playlists

### GET /playlists

- Filters: `search`/`exact_search` on `id`, `name`, `created_at`, `updated_at`.
- Forced pagination (default/max 500). Response: `Playlist[]`.

### GET /playlists/:id

- Response: `Playlist`.

### POST /playlists

- Body: `{ "name": "...", "artwork_fs_node_id": "uuid-or-omitted", "song_ids": [1,2,3] }`
- `song_ids` is optional seeding (used by "save radio/mix as playlist"): capped at 500,
  order preserved, unknown/unauthorized ids silently dropped, positions start at 1.
- 201 with the `Playlist`.

### PATCH /playlists/:id

- Body: `{ "name": "...", "artwork_fs_node_id": "..." }` (top-level keys).
- 200 with the `Playlist`. (Renaming a system playlist is NOT blocked; only structural
  edits are.)

### DELETE /playlists/:id - 204.

### POST /playlists/:id/reorder

- Body: `{ "song_ids": [23, 11, 42, ...] }` - full desired order of SONG ids.
- 401 for system playlists. 200; the body is internal reorderer output, the web app ignores
  it - treat as void and refetch.

### POST /playlists/:id/upload_artwork

- Multipart, field `artwork` (image file). 401 for system playlists.
- 200 with the updated `Playlist`.

### POST /playlists/:id/copy

- Clones the playlist (works on system playlists too; that is its purpose). New name is
  `"<name> (cópia)"`, `source_kind: "manual"`, same artwork node, songs re-numbered 1..n.
- 201 with the new `Playlist`.

---

## 7. Playlist songs (join rows)

### GET /playlist_songs

- Filters: `id`, `playlist_id`, `song_id`, `position`, `created_at`, `updated_at`.
- The web app pages a playlist with
  `exact_search[playlist_id]=<id>&modifiers[page]=N:100&modifiers[order]=position:asc`
  (server clamp is 500; forced default page 1:500 if you send none).
- Response: `PlaylistSong[]` with the full nested `song` on every row.

### POST /playlist_songs

- Body: `{ "playlist_id": 7, "song_id": 123 }`. Position auto-assigned to the end.
- 201 with the `PlaylistSong` (extended = same shape).
- Errors: `400 "Song has already been taken"` (duplicate), `404 "Song not found"`,
  401 for system playlists.

### DELETE /playlist_songs/:id

- `:id` is the playlist_song ROW id (not the song id). 204. 401 for system playlists.

---

## 8. Liked songs

### GET /liked_songs?limit=N&before=<iso timestamp>

- Reverse-chronological by `liked_at`. `limit` default 200, max 500.
- CURSOR pagination, not pages: `before` = the `liked_at` of the last row you already have
  (strictly-less-than filter). The web app pages with `limit=100` and
  `before = lastRow.liked_at`; a short page ends the list.
- Response: `LikedSong[]` (each with full nested `song`).

### GET /liked_songs/ids

- Response: `number[]` of song ids - cheap "is this song liked" set. The web app keeps this
  as the optimistic source of truth for the heart toggle.

### POST /liked_songs

- Body: `{ "song_id": 123 }`. Idempotent (find_or_create). 201 with the `LikedSong`.
- `404 "Song not found"` for songs you cannot see.

### DELETE /liked_songs/:song_id

- Keyed by SONG id, not the liked_song row id. 204, or `404 "Not liked"`.

---

## 9. Play events (history and stats)

### POST /play_events

- Body: `{ "song_id": 123 }`.
- Server-side dedupe: a second play of the same song within 30 seconds returns
  `200 {"deduped": true}` instead of creating a row. Otherwise `201` with
  `{ id, created_at, updated_at, user_id, song_id, played_at, song: Song }`.
- The web app fires this when playback of a track starts and treats it as
  fire-and-forget (no error UI).

### GET /play_events/recent?group_by=song|album&limit=N

- `limit` default 24, max 100. `group_by` default `song`. Invalid group_by = 400.
- `group_by=song`: `[{ "song": Song, "last_played_at": "..." }, ...]`
  (each song at most once, newest first).
- `group_by=album`: `[{ "album": "name-or-null", "artist": Artist(compact) | null,
  "artwork_fs_node_id": "uuid-or-null", "last_played_at": "..." }, ...]`

### GET /play_events/top?scope=song|album|artist&since=7d|30d|90d|all&artist=X&limit=N

- `limit` default 10, max 100. `scope` default `song`. `since` default `all`
  (`7d`/`30d`/`90d`/`all` only, anything else 400).
- `artist=<name>` narrows scope=song only ("popular tracks by this artist").
- Responses:
  - song: `[{ "song": Song, "play_count": 12 }]`
  - album: `[{ "album", "artist": Artist(compact)|null, "artwork_fs_node_id", "play_count" }]`
  - artist: `[{ "artist": Artist(compact), "play_count": 40 }]`

---

## 10. Mixes (daily generated shelves)

Kinds: `"top_artist" | "repeat_rewind" | "time_capsule" | "discoveries"`.
Payloads are generated per user and cached server-side for 24h.

### GET /music_mixes

Response: `MixSummary[]`:

```jsonc
{
  "slug": "mix:top_artist:1:ab12cd34",   // contains colons; URL-ENCODE when requesting one
  "kind": "top_artist",
  "title": "English fallback title",
  "description": "English fallback description",
  "title_key": "top_artist",              // i18n key (same values as kind)
  "title_params": { "artist": "X" },      // params for the i18n template
  "description_key": "top_artist",
  "description_params": { },
  "seed": "chico buarque",                // string | number | null
  "artist": { /* Artist compact view */ } | null,  // only on top_artist mixes
  "gradient": "from-rose-500 to-orange-500"        // tailwind gradient classes for the card
}
```

### GET /music_mixes/:slug

- Slug must be URL-encoded (`mix%3Atop_artist%3A1%3Aab12cd34`). Route accepts any
  non-slash id.
- Response: the same summary object PLUS `"songs": Song[]` in mix order.
- `404 "Mix not found"` when the cached shelf no longer contains that slug (mixes rotate;
  refetch the list).

---

## 11. Radios (artist / song radio)

Cached per user for 7 days. Built from Last.fm similar-artist data intersected with the
user's own library; 404 when it cannot build one.

### GET /music_radios/artist/:artist

- `:artist` is the artist SLUG (the web app passes `primaryArtistSlug(song)`, which is the
  slug, URL-encoded). Lookup-only against the user's roster.

### GET /music_radios/song/:id

- `:id` = song id.

Both respond:

```jsonc
{
  "slug": "...",
  "kind": "artist",              // "artist" | "song"
  "title": "...",
  "description": "...",
  "seed": "...",                  // seed artist name / song descriptor
  "gradient": "from-rose-600 via-purple-600 to-blue-600",
  "songs": [ /* full Song[] in radio order, target ~40 tracks */ ]
}
```

---

## 12. Artists (first-class per-user resource)

### GET /artists

- Filters: `search`/`exact_search` on `id`, `name`, `slug`, `canonical_name`, `created_at`
  (+ default `updated_at`). Forced pagination default/max 500.
- The web app pages the roster `modifiers[page]=N:60&modifiers[order]=name:asc` (or
  `created_at:desc`) and searches with `search[name]=<term>&modifiers[page]=1:60`.
- Response: `Artist[]` (BASE view + `songs_count` + `fallback_artwork_fs_node_id`;
  no bio/gallery/similar here).

### GET /artists/overview

- One-request editorial header for the Artists page. Server-cached 1h per user.
- Response:

```jsonc
{
  "stats": { "artists": 318, "songs": 4900, "new_artists": 4, "seconds_played": 123456 },
  "heavy_rotation_window": "30d",         // "30d" | "all" (fallback when 30d is empty)
  "spotlight": { "artist": Artist(card), "songs_count": 12, "albums_count": 3, "play_count": 91 } | null,
  "heavy_rotation": [ { "artist": Artist(card), "play_count": 40 }, ... ],
  "similar": { "seed": Artist(card), "artists": [ Artist(card), ... ] } | null,
  "neglected": [ { "artist": Artist(card), "songs_count": 9 }, ... ]
}
```

### GET /artists/:idOrSlug

- `:idOrSlug` resolves, in order: numeric id -> slug -> canonical name. URL-encode names.
- Lazily refreshes stale external metadata (Last.fm bio, similar, pictures) before replying,
  so first hit on a cold artist can be slower.
- Response: `Artist` EXTENDED view (base + `bio_html` + `gallery_image_urls` + `similar`).
- `404 "Artist not found"`.

### PATCH /artists/:id

- Backend permits TOP-LEVEL `name` and `gallery_image_urls: []` (gallery URLs must start
  with http(s), else 400). NOTE: the web FE nests the body under `{ "artist": { ... } }`,
  which does not match the top-level permit - send FLAT top-level keys from the native app.
- Response: `Artist` extended. Renaming re-slugs server-side.

### DELETE /artists/:id - 204.

### POST /artists/:id/upload_image

- Multipart, field `image`. Response: `Artist` extended.

### POST /artists/:id/upload_banner

- Backend requires multipart field `banner` (400 `"banner required"` otherwise).
  NOTE: the current web FE sends the file under `image`, which the backend rejects - use
  `banner` in the native app (that is what the backend reads:
  `Artists::ImageAttacher.perform(artist, file: params[:banner], kind: :banner)`).
- Response: `Artist` extended.

### GET /artist_metadata/:name (legacy shim)

- Name OR slug, URL-encoded. Always 200, see the ArtistMetadata shape in section 3.
- Kept alive on purpose; the artist page uses `GET /artists/:idOrSlug` instead.

---

## 13. Lyrics

### GET /lyrics?song_id=X

- Fetches (and caches on the song row for 30 days) lyrics via lrclib.net with Genius
  fallback. Negative results cached 24h.
- Response, ALWAYS 200 when the song exists:

```jsonc
{ "synced": "[00:12.30] line\n...", // LRC text with timestamps, or null
  "plain": "line\nline\n...",       // plain text, or null
  "attribution": "lrclib.net" }      // source name
```

- Both null = no lyrics found (do not retry aggressively; server negative-caches).
- `404 "Song not found"` only for bad ids.

### GET /lyrics/translation?song_id=X&target=pt

- `target` must be one of: `pt`, `en`, `es`, `fr`, `de`, `it`, `lv` (else 400).
- Same shape as /lyrics plus `"target": "pt"`. LRC timestamps preserved line-for-line so
  the same parser aligns original and translation.
- Cached per (song, target, lyrics digest) on the song row - one real translation per song.
- Throttle: 60 fresh translations per user per hour -> `429` (do NOT auto-retry 429 or 404;
  the web app disables retries for both). `404 "No lyrics for this song"`,
  `503` when the translator is down.

### POST /lyrics/sync

- Body: `{ "song_id": X }`. Generates LRC timestamps for plain-only lyrics by transcribing
  the vocals stem on a Whisper sidecar.
- Preconditions: song must HAVE `plain` lyrics and NOT have `synced` (else 400).
- Throttle 10/user/hour -> 429.
- Response: `201 { "job_id": "<active-job id>" }`. The web app listens on ActionCable
  JobChannel for completion then refetches `/lyrics`; a native app can simply poll
  `GET /lyrics?song_id=X` until `synced` appears.

---

## 14. External search and imports

### GET /music/external_search?q=<query>&kind=track|album|artist|any

- Searches Spotify/YouTube/SoundCloud/Bandcamp/iTunes metadata. Server-cached 15 min per
  (kind, query). Custom rate limit 30 req/min per user -> `400 "Rate limit exceeded"`
  (yes, 400 not 429).
- Empty/blank q returns `{ "tracks": [], "albums": [], "artists": [] }`.
- Response:

```jsonc
{
  "tracks": [ { "source": "spotify|youtube|soundcloud|bandcamp|itunes", "kind": "track",
                 "source_id": "...", "source_url": "https://...|null", "title": "...",
                 "artist": "...", "album": "...|null", "duration_ms": 213000|null,
                 "isrc": "...|null", "artwork_url": "https://...|null" } ],
  "albums":  [ { "source": "spotify", "kind": "album", "source_id", "source_url",
                 "title", "artist", "total_tracks", "artwork_url" } ],
  "artists": [ { "source": "spotify", "kind": "artist", "source_id", "source_url",
                 "name", "followers": 123|null, "artwork_url" } ]
}
```

- The web app debounces and only queries at >= 2 chars.

### POST /song_imports - import one external track into the library

Two modes (web logic in `importExternalTrack`):

- Direct-URL mode (YouTube / SoundCloud results, which have a downloadable `source_url`):
  `{ "source_url": "<url>", ... }`. The URL must be public HTTP(S)
  (SSRF-guarded, else `400 "source_url is not allowed"`).
- Search mode (Spotify / iTunes results): omit `source_url` and send
  `{ "search_artist": "...", "search_title": "...", "search_album": "...?", "isrc": "...?" }`;
  the backend runs an ISRC fast path plus a duration/artist-guarded search cascade.

Common optional fields both modes carry:
`source_provider`, `source_id`, `override_title`, `override_artist`, `override_album`,
`artwork_url` (public http(s) only), `artwork_data_b64`, `expected_duration_s`,
`playlist_id` (append the finished song to that playlist; 404/401 checked), `position`,
`source_kind`.

- Response: `201` SongImport record (below). Then POLL `GET /song_imports/:id`.

### GET /song_imports / GET /song_imports/:id

- Index filters: `id`, `state`, `playlist_id`, `user_id`, `created_at`, `updated_at`.
- SongImport payload (SongImportBlueprint):

```jsonc
{
  "id": 1, "created_at": "...", "updated_at": "...",
  "user_id": "uuid", "playlist_id": null, "song_id": null,   // song_id set on success
  "source_url": "...", "source_provider": "spotify", "source_id": "...",
  "source_kind": "yt_dlp",
  "override_title": "...", "override_artist": "...", "override_album": null,
  "expected_duration_s": 213.0, "position": null, "sidecar_request_id": "...",
  "state": "pending",            // "pending" | "processing" | "complete" | "failed"
  "progress_message": "Downloading...", "progress_pct": 40,
  "error_message": null, "deduped": false     // deduped=true: track already in library
}
```

### Artist imports (import a whole discography via Spotify)

Requires the user to have a linked Spotify identity; without it these answer
`400 "Connect Spotify first."` / `400 "Spotify connection needs to be relinked."`.

- `GET /artist_imports/search?q=<term>` ->
  `{ "roster": [ { "kind": "roster", "id": 9, "name", "slug", "image_url" } ],
     "spotify": [ { "kind": "spotify", "id": "spotifyId", "name", "followers", "genres": [],
                    "image_url", "external_url" } ] }`
- `GET /artist_imports/albums?spotify_artist_id=<id>` ->
  `{ "items": [ { "id", "name", "album_type", "album_group", "release_date",
                  "total_tracks", "image_url", "external_url" } ] }`
- `POST /artist_imports` body
  `{ "spotify_artist_id": "...", "spotify_artist_name": "...", "album_ids": ["...", ...] }`
  -> `201` ArtistImport record.
- `GET /artist_imports?limit=N` (default 20, max 50, newest first) ->
  `{ "items": [ ArtistImport ] }` - note the `items` wrapper, unlike most indexes.
- ArtistImport payload (ArtistImportBlueprint): `id`, timestamps, `user_id`,
  `spotify_artist_id`, `spotify_artist_name`, `album_ids`,
  `state` (`"queued" | "running" | "complete" | "failed"`), `total_albums`, `total_tracks`,
  `processed_albums`, `queued_count`, `skipped_count`, `failed_count`, `last_message`,
  `error_message`, `started_at`, `finished_at`. The web app polls the index for the live
  progress strip.

---

## 15. Getting the actual audio and images (fs_nodes)

Songs, playlists and artists never embed media bytes; they carry fs node ids. Two routes
matter (they live on the generic storage controller, outside the music namespace):

- `GET /fs_nodes/:id/data?token=<session token>` - authenticated download/stream of the
  node. This route REDIRECTS to the storage backend (MinIO behind Cloudflare). Browsers
  choke on the credentialed redirect for media elements; native HTTP stacks generally
  follow it fine, but the redirect target expects no credentials.
- `GET /fs_nodes/:id/data_url` (JSON, Bearer auth) -> `{ "url": "https://..." }` - a
  presigned storage URL. This is what the web app uses for `<audio>` elements
  (`FsNode.resolveDataUrl`). RECOMMENDED for a native player: resolve, then hand the plain
  URL to the OS player/downloader. Treat the URL as short-lived; re-resolve on failure.

Which node to play: prefer `compressed_audio_fs_node_id` (transcoded, smaller, served
through the SSD cache) and fall back to `audio_fs_node_id`. Artwork: prefer
`compressed_artwork_fs_node_id` then `artwork_fs_node_id`. Vocal/instrumental stems:
`vocals_fs_node_id` / `instrumental_fs_node_id`.

Jam sessions (out of scope here, ActionCable-driven) inject songs that carry ready-made
`artwork_url` / `audio_url` presigned URLs plus `jam_song: true`,
`jam_proposer: { id, handle, name }` and an `artist_names` string, because the host cannot
resolve another user's fs nodes. Never POST play events for `jam_song` entries.

---

## 16. Pagination cheat sheet

| Endpoint | Style | Client page size used by web |
|---|---|---|
| GET /songs | `modifiers[page]=N:SIZE`, forced, max 500 | 500, order `created_at:asc` |
| GET /playlists | same | default (500) |
| GET /playlist_songs | same | 100, order `position:asc`, filter `exact_search[playlist_id]` |
| GET /artists | same | 60, order `name:asc` or `created_at:desc` |
| GET /liked_songs | cursor: `limit` + `before=<liked_at>` | 100 |
| GET /play_events/recent | `limit` only (max 100) | 24 default |
| GET /play_events/top | `limit` only (max 100) | 10 default |
| GET /artist_imports | `limit` only (max 50) | 20 default |
| mixes / radios / lyrics / overview | none (single payloads) | - |

End-of-list detection everywhere: a page shorter than the requested size.

---

## 17. Rate limits and caching worth knowing

- Global rack-attack ceiling: ~600 req/min authenticated, 120 anonymous. No short burst
  windows (the SPA fires parallel queries; so can you).
- `music/external_search`: 30/min/user (400 on excess). Server caches queries 15 min.
- Lyrics translation: 60/h/user (429). Lyrics sync: 10/h/user (429).
- Mixes cached 24h/user; radios 7d/user; artists overview 1h/user; artist external
  metadata refreshed lazily on show.
- Index endpoints support ETag/If-None-Match.

---

## 18. Adjacent music endpoints NOT wrapped by MusicService (for completeness)

Used by other music-area screens through their own services; same conventions apply:

- `POST /playlist_imports/preview` `{ "url": "..." }` - preview an external playlist URL
  before importing (returns the downloader preview shape).
- `GET /spotify_syncs/status`, `GET /spotify_syncs/preview`, `PATCH /spotify_syncs/settings`,
  `POST /spotify_syncs` - Spotify library sync management.
- `resources :jams` + member actions (`join`, `leave`, `invite`, `propose`, `skip_vote`) -
  listen-together sessions; realtime flow rides ActionCable, not covered here.
- `GET /users/:id/music_profile` - public music profile for the social feed.
- `GET /jobs/:id` - generic job records (lyrics sync job ids resolve here / over JobChannel).

---

## 19. Top gotchas for a native reimplementation (summary)

1. Error bodies are bare JSON strings, not objects. Parse defensively.
2. `null` on the wire is the `"\b"` sentinel in params/bodies (see section 1); omitting a
   key means "not filtered / unchanged".
3. Unknown `search`/`exact_search`/`modifiers`/`extra_options` keys are a 400, never
   silently ignored.
4. `/songs` artist filtering is EXACT (canonical name or slug) via `exact_search[artist]`,
   with the separate top-level `artist_role` param; `search[artist]` behaves identically
   (also exact), so client-side filtering is needed for partial artist search.
5. `GET /songs/artists` ignores all filters. `POST /songs/metadata_modifier` drops
   `track_number`. `POST /songs/clean` is a dead route.
6. Artist PATCH must send FLAT top-level `name`/`gallery_image_urls`; banner upload must use
   form field `banner` (the web client deviates on both and those paths 400/no-op against
   the current backend).
7. `DELETE /liked_songs/:song_id` is keyed by song id; `DELETE /playlist_songs/:id` is keyed
   by join-row id. Do not mix them up.
8. Separation statuses are `pending|processing|complete|failed` only. `progress_percent`
   is null except while processing. Poll every ~3s.
9. Mix slugs contain `:` - always URL-encode path segments (mix slugs, artist slugs/names).
10. `POST /songs/import` returns 200 (not 201); `POST /play_events` returns 200
    `{"deduped":true}` within the 30s dedupe window, 201 otherwise.
11. System playlists (`source_kind != "manual"`) 401 on reorder/artwork/add/remove; offer
    "copy" instead.
12. Stream audio via `GET /fs_nodes/:id/data_url` -> presigned URL (preferred), or
    `GET /fs_nodes/:id/data?token=...` if your player follows redirects without forwarding
    credentials. Prefer `compressed_audio_fs_node_id`.
