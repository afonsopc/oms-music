# omelhorsite music backend: domain model reference

Audience: an engineer who has never seen this codebase and is rebuilding the music client as a React Native (Expo) app against the SAME production Rails backend (base URL `https://backend.omelhorsite.pt`) with zero backend changes.

Source of truth read for this document (Rails app under `backend/`):

- Models: `backend/app/models/{song,artist,song_artist,playlist,playlist_song,liked_song,play_event,playback_state,playback_device,jam,jam_member,vocal_separation,song_import,artist_import,relationship}.rb`
- Serializers (Blueprinter): `backend/app/blueprints/*_blueprint.rb`
- Schema: `backend/db/schema.rb`
- Supporting services that define wire shapes: `backend/app/services/{listening/snapshot,media_urls,jams/serializer,music_mix_generator,music_radio_generator,music_profiles/builder}.rb`, `backend/app/queries/play_events_query.rb`, `backend/app/channels/playback_channel.rb`

Everything below is read from the actual code, not guessed.

---

## 1. Big picture

The music library is strictly **per user**. There is no global catalog: every `Song`, `Artist`, and `Playlist` row belongs to exactly one `user_id`, and duplicate artists/songs exist per user by design. "Albums" are NOT a table; they are a virtual grouping of `songs.album` (a plain string column) by lead artist. Cross-user surfaces (friends feed, jams, public music profile) never expose raw library rows; they go through display-only hashes with **presigned URLs** instead of fs-node ids.

### Entity-relationship summary

```
User (id: string)
 |-- has many Songs (user_id)
 |-- has many Artists (user_id)            # per-user artist rows, deduped by canonical_name
 |-- has many Playlists (user_id)
 |-- has many LikedSongs (user_id)
 |-- has many PlayEvents (user_id)
 |-- has one  PlaybackState (user_id, unique)
 |-- has many PlaybackDevices (presence rows, one per live socket)
 |-- hosts    Jams (host_id) / joins via JamMember
 |-- has many SongImports / ArtistImports (async import jobs)
 |-- has many VocalSeparations (tool runs; song-attached runs too)

Song (id: bigint)
 |-- belongs_to User
 |-- belongs_to 6x FsNode (audio, compressed_audio, artwork, compressed_artwork,
 |                          vocals, instrumental) - all optional, all string ids
 |-- has_many SongArtists (ordered by position) -> Artists
 |-- has_many PlaylistSongs -> Playlists
 |-- has_many PlayEvents, LikedSongs
 |-- has_many VocalSeparations (dependent: destroy)

Artist (id: bigint)
 |-- belongs_to User
 |-- belongs_to 4x FsNode (image, compressed_image, banner, compressed_banner) - optional
 |-- has_many SongArtists -> Songs

SongArtist (join, id: bigint)
 |-- song_id + artist_id unique; (song_id, position) unique
 |-- role: "primary" | "featured" | "with"

Playlist (id: bigint) --< PlaylistSong (position, unique song per playlist) >-- Song
LikedSong: (user_id, song_id) unique, ordered by liked_at desc
PlayEvent: append-only listen log (user_id, song_id, played_at)
PlaybackState (id: string): one row per user; queue is a jsonb array of song ids
PlaybackDevice: one row per live PlaybackChannel subscription (tab/app instance)
Jam (id: bigint) --< JamMember (jam_id, user_id unique)
VocalSeparation (id: string): stem-split job; belongs_to user AND/OR song, both optional
SongImport (id: bigint): one yt-dlp/Spotify import job; may point at playlist + resulting song
ArtistImport (id: bigint): "import full discography from Spotify" batch job
Relationship: friend/block graph used by the social listening feed
```

### ID type conventions (important)

- `users.id`, `fs_nodes.id`, `playback_states.id`, `vocal_separations.id`, `sessions.id`: **strings** (opaque).
- `songs.id`, `artists.id`, `playlists.id`, `playlist_songs.id`, `liked_songs.id`, `play_events.id`, `jams.id`, `song_imports.id`, `artist_imports.id`: **integers** (bigint).
- All `*_fs_node_id` columns on songs/artists/playlists are string FKs into `fs_nodes`.

### How media bytes are fetched

Song/artist/playlist payloads for the OWNER carry `*_fs_node_id` fields, not URLs. The client resolves bytes via the file-system API: `GET /fs_nodes/:id/data_url` returns `{ "url": "<presigned storage URL>" }` (expiry 6 hours, `FsNodesController::MEDIA_URL_EXPIRY`). Cross-user payloads (jams, friends feed, music profile) instead carry ready-made `artwork_url` / `audio_url` presigned by `MediaUrls.for_node` (6h expiry, cached 5h so URLs stay stable across broadcasts).

---

## 2. Serialization conventions (Blueprinter)

Gem: `blueprinter 1.1.2`. All model blueprints inherit `ApplicationBlueprint`:

```ruby
class ApplicationBlueprint < Blueprinter::Base
  identifier :id
  fields :created_at, :updated_at
end
```

Three rules the client can rely on:

1. **Every payload has `id`, `created_at`, `updated_at`** (ISO 8601 timestamps), except `ArtistMetadataBlueprint` which deliberately inherits `Blueprinter::Base` directly and omits the timestamps (legacy shape).
2. **Blueprinter views INHERIT the default (base) fields.** `view :compact` etc. is base fields PLUS the view's fields, not a restriction. E.g. `ArtistBlueprint` view `:compact` still contains every base artist field. Do not assume a "compact" payload is small.
3. **CrudActions controllers**: `index` renders the default view; `show`/`create`/`update` render `view: :extended`. Responses are the bare JSON (no envelope). Index endpoints are server-paginated: without a `modifiers[page]` param the server forces page `1:500` (`QueryModifier::DEFAULT_PAGE_SIZE = 500`, also the hard max page size).

---

## 3. Song

Table `songs` (id bigint). Model: `app/models/song.rb`.

### Columns

| column | type | notes |
|---|---|---|
| `title` | string, NOT NULL | |
| `album` | string, nullable | free text; the ONLY album representation in the system |
| `duration` | integer, NOT NULL | seconds; validated present |
| `position` | integer, default 0 | track number within the album |
| `year` | integer, nullable | |
| `user_id` | string, NOT NULL | owner |
| `audio_fs_node_id` | string | original audio file |
| `compressed_audio_fs_node_id` | string | auto-generated m4a (see callbacks) |
| `artwork_fs_node_id` | string | original artwork |
| `compressed_artwork_fs_node_id` | string | auto-generated webp |
| `vocals_fs_node_id` / `instrumental_fs_node_id` | string | stems produced by vocal separation |
| `vocal_separation_started_at` | datetime | in-flight flag for the stem job |
| `lyrics_synced` | text | LRC-timestamped lyrics |
| `lyrics_plain` | text | plain lyrics |
| `lyrics_fetched_at` | datetime | positive-cache marker |
| `lyrics_translations` | jsonb, default {} | `{ "<locale>": { "synced", "plain", "digest" } }` |
| `lyrics_source` | string | e.g. "lrclib.net", genius attribution |
| `source_kind` | string, default "upload" | `upload` \| `yt_dlp` \| `spotify_sync` |
| `source_provider` | string | e.g. `spotify` |
| `source_url` / `source_id` | string | provenance of imports |
| `original_filename` | string | |
| `audio_codec` | string | e.g. "flac", "aac" (used uppercased in quality label) |
| `audio_bitrate_kbps` | integer | |
| `audio_sample_rate_hz` | integer | |
| `audio_channels` | integer | 1 = mono, 2 = stereo |
| `audio_lossless` | boolean, default false | |
| `audio_filesize_bytes` | bigint | |
| `isrc` | string | dedupe key across sources, unique per (user_id, isrc) |

Notable indexes: unique-ish partial indexes on `(user_id, isrc)`, `(user_id, source_provider, source_id)`, `(user_id, source_url)`; `(user_id, album, position)` for album ordering.

### Associations, validations, behavior

- `belongs_to :user`; six optional `FsNode` belongs_to, all `dependent: :destroy` (deleting a song purges its files).
- `has_many :song_artists` ordered by `position`; `has_many :artists, through:`.
- `has_many :playlist_songs / :play_events / :liked_songs / :vocal_separations`, all `dependent: :destroy`.
- Validation: only `duration` presence (title is NOT NULL at DB level).
- `before_save` hooks: changing `audio_fs_node_id` regenerates the compressed m4a; changing `artwork_fs_node_id` regenerates the compressed webp. Files are created inside the owner's hidden `.oms-music` folder (`User#music_storage`).
- Access: `viewable_by(user)` = own songs only. `creatable/updatable/destroyable_by?` = owner only.
- `primary_artist` = the `song_artists` row with role `primary` and lowest position (position 0 is "the lead"); `featured_artists` = role `featured` ordered by position.
- `stems_ready?` = both `vocals_fs_node_id` and `instrumental_fs_node_id` present.
- `quality_label` (server-side only, not serialized): "FLAC Lossless 44.1 kHz stereo" style string.

### SongBlueprint (what the client gets)

Base fields (also inherited by any view): `id, created_at, updated_at, title, album, duration, position, year, audio_fs_node_id, compressed_audio_fs_node_id, artwork_fs_node_id, compressed_artwork_fs_node_id, vocals_fs_node_id, instrumental_fs_node_id, vocal_separation_started_at, user_id, source_kind, source_provider, source_url, source_id, isrc, original_filename, audio_codec, audio_bitrate_kbps, audio_sample_rate_hz, audio_channels, audio_lossless, audio_filesize_bytes`.

Plus association: **`artists`** - CAUTION: despite the name, this is the `song_artists` JOIN rows rendered with `SongArtistBlueprint` (see section 5), each carrying role/position plus denormalized artist display fields. It is not a list of Artist records.

Lyrics fields are NOT in the blueprint; lyrics travel through the dedicated `/lyrics` endpoints (section 12).

---

## 4. Artist

Table `artists` (id bigint). Model: `app/models/artist.rb`. Per-user rows: the same real-world artist exists once per user.

### Columns

| column | type | notes |
|---|---|---|
| `name` | string, NOT NULL | display name |
| `canonical_name` | string, NOT NULL | normalized identity, unique per (user_id) |
| `slug` | string, NOT NULL | URL identity, unique per (user_id); NEVER changes on rename |
| `user_id` | string, NOT NULL | |
| `image_fs_node_id`, `compressed_image_fs_node_id` | string | user-uploaded avatar |
| `banner_fs_node_id`, `compressed_banner_fs_node_id` | string | user-uploaded banner |
| `mbid` | string | MusicBrainz id (from Last.fm) |
| `lastfm_listeners`, `lastfm_playcount` | bigint | cached Last.fm stats |
| `bio_html` | text | Last.fm bio (sanitized at render time in the metadata endpoint) |
| `bio_fetched_at`, `similar_fetched_at`, `pictures_fetched_at`, `gallery_fetched_at` | datetime | cache markers |
| `external_image_url` | string | Last.fm image fallback |
| `similar_json` | jsonb, default {} | `{ "artists": [{ "name", "match", "mbid" }, ...] }` from Last.fm |
| `picture`, `picture_small`, `picture_medium`, `picture_big`, `picture_xl` | string | cached **Deezer** picture URLs (what actually renders for most artists) |
| `gallery_image_urls` | jsonb, default [] | |

### Identity rules (matter to any client that searches/links artists)

- `canonical_name` = NFKC normalize, downcase, collapse `[-_./]+` to a single space (`Artist.canonical`). "laura-les" and "Laura Les" collapse to the same identity; `P!nk` and `Ke$ha` keep their punctuation.
- `slug` = `name.parameterize`, with `-2`, `-3` counters on collision. Slugs survive renames (bookmarks stay valid); `canonical_name` is recomputed on rename.
- Server resolves artist params by canonical name first, then slug (radios, metadata, top-songs filter). The FE passes slugs around.
- Deletion is refused while any `song_artists` row references the artist.

### ArtistBlueprint views (remember: views ADD to base)

- **base** (index): `id, created_at, updated_at, name, canonical_name, slug, user_id, image_fs_node_id, compressed_image_fs_node_id, banner_fs_node_id, compressed_banner_fs_node_id, mbid, lastfm_listeners, lastfm_playcount, external_image_url, picture, picture_small, picture_medium, picture_big, picture_xl, pictures_fetched_at, bio_fetched_at, similar_fetched_at` plus computed `songs_count` (int) and `fallback_artwork_fs_node_id` (artwork of one of the artist's lead songs; may be null when rendered outside the artists index).
- **`:compact`** adds nothing new beyond re-declaring `name, slug, image_fs_node_id, compressed_image_fs_node_id` - effectively identical to base. Used in mixes, play_events album/artist aggregates.
- **`:card`** re-declares the picture/banner set - again effectively base fields.
- **`:extended`** (show/update) adds `bio_html`, `gallery_image_urls`, and `similar` (array of `{ name, match, mbid }`).

### Image fallback chain the web FE uses (replicate in RN)

`compressed_image_fs_node_id` or `image_fs_node_id` (owner upload, resolve via fs_nodes data_url) -> Deezer `picture_*` -> `external_image_url` -> `fallback_artwork_fs_node_id` -> generic placeholder.

---

## 5. SongArtist (the credits join)

Table `song_artists`. Model: `app/models/song_artist.rb`.

- `role` enum: **`primary` | `featured` | `with`** (`SongArtist::ROLES`).
- `position` integer >= 0, unique per song; `(song_id, artist_id)` unique.
- The **lead** artist = role `primary` AND position 0 (`SongArtist.lead` scope). Primaries are always written first starting at position 0. Album grouping and "filed under" logic key on the lead, not on all primaries (a multi-primary Spotify track would otherwise fan out).

### SongArtistBlueprint (rendered as `artists` inside every song payload)

Fields: `id` (the JOIN row id, NOT the artist id), `created_at`, `updated_at`, `song_id`, `artist_id`, `position`, `role`, plus denormalized from the artist: `name`, `slug`, `image_fs_node_id`, `compressed_image_fs_node_id`, `picture`, `picture_medium`, `external_image_url`.

To display "Artist, Artist feat. X" strings, sort by `position` and use `role`.

---

## 6. Playlist and PlaylistSong

Tables `playlists`, `playlist_songs`. Models: `app/models/playlist.rb`, `playlist_song.rb`.

### Playlist columns

`name` (NOT NULL), `description` (text, NOT serialized), `artwork_fs_node_id` (string), `user_id` (NOT NULL), `source_kind` (default `"manual"`), `source_provider`, `source_url`, `source_external_id`, `synced_at`.

- **System playlists**: `source_kind != "manual"` (today the only other value is `"spotify_sync"`, with `source_provider: "spotify"`; the Spotify Liked Songs sync uses `source_external_id: "liked"`). `Playlist#system?` playlists are read/delete only for the user: `updatable_by?` returns false, so name/artwork edits and add/remove/reorder are rejected server-side. A client must gate its UI on `source_kind`.
- `after_create` fires a Discord ops alert (harmless to clients).

### PlaylistBlueprint

`id, created_at, updated_at, name, user_id, artwork_fs_node_id, source_kind, source_provider, source_url, source_external_id, synced_at`. Note `description` is NOT serialized. No songs are embedded; membership comes from `/playlist_songs?exact_search[playlist_id]=X`.

### PlaylistSong

- `position` integer >= 0 required; `song_id` unique per playlist (a song can appear only once per playlist).
- `default_scope` orders by `position asc` - listings arrive pre-sorted.
- Authorization derives entirely from the playlist owner.
- Blueprint: `id, created_at, updated_at, playlist_id, song_id, position` + embedded `song` (full SongBlueprint including its `artists`).

---

## 7. LikedSong (favorites)

Table `liked_songs`. Model: `app/models/liked_song.rb`.

- `(user_id, song_id)` unique; `liked_at` required, auto-set to now on create; index on `(user_id, liked_at desc)`.
- `LikedSong.for_user` orders by `liked_at desc` (the listing order).
- Blueprint base: `id, created_at, updated_at, user_id, song_id, liked_at`; `:extended` adds embedded `song` (full SongBlueprint). The listing endpoint renders `:extended` for every row.
- Listing pagination is a **cursor**, not offset: `GET /liked_songs?limit=N&before=<liked_at of last row>` (default limit 200, max 500). `GET /liked_songs/ids` returns a bare array of song ids for cheap "is this liked" checks.
- DELETE is keyed by **song_id**, not the LikedSong row id: `DELETE /liked_songs/:song_id`.

---

## 8. PlayEvent (listens/history)

Table `play_events`. Model: `app/models/play_event.rb`, aggregations in `app/queries/play_events_query.rb`.

- Append-only: `user_id`, `song_id`, `played_at` (auto now). Index `(user_id, played_at desc)`.
- **Server-side dedupe**: `POST /play_events {song_id}` returns `200 {"deduped": true}` if the same user+song was recorded within the last **30 seconds** (`PlayEvent::DEDUPE_WINDOW`); otherwise `201` with the extended payload. A client should not try to be clever about scrubs/replays; the server already is.
- Blueprint base: `id, created_at, updated_at, user_id, song_id, played_at`; `:extended` adds embedded `song`.

### Aggregation shapes (used by home shelves, artist pages, profile)

`GET /play_events/recent?group_by=song|album&limit=N` (default 24, max 100):

- `group_by=song`: `[{ song: <SongBlueprint>, last_played_at }]`
- `group_by=album`: `[{ album: "<string>", artist: <ArtistBlueprint :compact> | null, artwork_fs_node_id, last_played_at }]`

`GET /play_events/top?scope=song|album|artist&since=7d|30d|90d|all&limit=N&artist=<name-or-slug>` (default limit 10, max 100; `artist` filter only for scope=song):

- scope=song: `[{ song: <SongBlueprint>, play_count }]`
- scope=album: `[{ album, artist: <compact>|null, artwork_fs_node_id, play_count }]`
- scope=artist: `[{ artist: <compact>, play_count }]`

Album aggregates group by `(songs.album, lead artist)` and exclude songs with blank album. Artist aggregates count every credited PRIMARY (a duo's track counts for both members).

---

## 9. PlaybackState + PlaybackDevice (server-synced player)

Table `playback_states` (string id, one row per user, unique on user_id). Model: `app/models/playback_state.rb`. This state is read/written over **ActionCable** (`PlaybackChannel`, stream `playback:user:<user_id>`), not REST.

### Columns / state fields

`song_id` (bigint, nullable), `position` (float seconds, >= 0), `paused` (bool, default true), `queue` (jsonb array of song ids, hard cap 1000 = `MAX_QUEUE`), `queue_index` (int >= 0, index into `queue`), `queue_order` (jsonb array of ints: the VISIBLE order as a permutation of queue indices; empty = natural order), `loop_mode`, `shuffle` (bool), `volume` (float 0..1), `playback_rate` (float), `playback_mode`, `eq_low/eq_mid/eq_high` (floats), `eq_enabled` (bool), `separation_enabled` (bool), `vocal_volume`/`instrumental_volume` (floats), `active_device_id` (string, pointer into playback_devices, may dangle), `active_session_id` (legacy v1 shim, ignore).

### Enums

- `loop_mode`: **`none` | `one` | `all`** (default `all`) - `PlaybackState::LOOP_MODES`.
- `playback_mode`: **`original` | `instrumental` | `vocals` | `custom`** (default `original`) - `PlaybackChannel::PLAYBACK_MODES`. `custom` uses `vocal_volume`/`instrumental_volume` over the stems.

### Wire payload (`PlaybackChannel.serialize_state`)

```json
{
  "active_device_id": "...", "active_session_id": "...",
  "song_id": 123, "position": 42.5, "paused": false,
  "queue": [123, 456], "queue_index": 0, "queue_order": [1, 0],
  "loop_mode": "all", "shuffle": false,
  "volume": 1.0, "playback_rate": 1.0, "playback_mode": "original",
  "eq_low": 0.0, "eq_mid": 0.0, "eq_high": 0.0, "eq_enabled": false,
  "separation_enabled": false, "vocal_volume": 1.0, "instrumental_volume": 1.0,
  "queue_songs": [ <SongBlueprint>, ... ]
}
```

`queue_songs` (full blueprints, ordered like `queue`) only rides along when the queue changed; clients keep the last copy otherwise. `queue_songs` is scoped to the owner's songs plus jam proposals, so a bad id in `queue` silently disappears from `queue_songs`.

Channel actions worth knowing (validated server-side): `play`, `pause`, `next`, `previous`, `seek {time}`, `set_queue_index {index}`, `set_queue_order {order}`, `set_shuffle {shuffle}`, `set_loop_mode {mode}`, `set_volume {volume}`, `add_to_queue {song_id}`, `play_next {song_id}`, `remove_from_queue {visible_index}`, `reorder_queue {from,to}`.

### PlaybackDevice

Presence rows, one per live channel subscription. `device_id` (unique, client-generated per page load/app instance), `label`, `device_type` (from the session), `last_seen_at`. Online = seen within **75 s** (`ONLINE_TTL`); clients heartbeat every 20 s. Stale rows are reaped lazily. Device list payload: `{ id, label, device_type, last_seen_at, online: true }` for online devices, plus recently-used sessions (7 days) as offline entries `{ id, label, device_type, description, online: false }`. No `is_self` flag; the client recognizes itself by its own device id.

---

## 10. Jam and JamMember (group listening)

Tables `jams`, `jam_members`. Models: `app/models/jam.rb`, `jam_member.rb`.

- Jam: `host_id` (string user id), `ended_at` (null = active), `queue_mode`, `skip_mode`. Active scope = `ended_at IS NULL`.
- Enums: `queue_mode`: **`everyone` | `host`** (default `everyone`, controls who may propose into the queue); `skip_mode`: **`majority` | `host` | `anyone`** (default `majority`).
- JamMember: `(jam_id, user_id)` unique. The host is not necessarily a member row; `is_host` is computed in the serializer.

There is no Blueprinter class for jams; `Jams::Serializer` builds hashes:

```json
// jam_hash
{ "id": 1, "host_id": "...", "queue_mode": "everyone", "skip_mode": "majority",
  "created_at": "...", "ended_at": null,
  "members": [{ "id": "...", "handle": "...", "name": "...", "is_host": true, "joined_at": "..." }] }

// state_hash (what a member follows, over JamChannel)
{ "song": { "id", "title", "album", "duration", "owner_id", "artist_names",
             "artwork_url", "audio_url" } | null,
  "position": 42.1, "paused": false,
  "upcoming": [{ "id", "title", "duration", "artist_names", "artwork_url",
                  "proposer": { "id", "handle", "name" } | null }],   // max 10
  "server_time": 1730000000000 }
```

Member playback streams the host's audio via the presigned `audio_url` (compressed audio preferred), authorized by jam membership. Proposed songs injected into the host's queue arrive as `proposal_song_hash`: song fields + `artists` (SongArtistBlueprint array) + `artwork_url`/`audio_url` + `jam_song: true` + `jam_proposer {id, handle, name}` - the host client must play those via the URLs and skip play-event recording.

---

## 11. VocalSeparation (stems)

Table `vocal_separations` (string id). Model: `app/models/vocal_separation.rb`.

Two flavors share the table:

1. **Tool runs** (public vocal-separator tool): `user_id` OR anonymous `ip_address`; audio lives in ActiveStorage attachments (`original_audio`, `vocals`, `instrumental`); swept after 24 h; count against a daily quota (12 min anon, 30 min authed, failed runs excluded).
2. **Song runs** (`song_id` present): triggered from the library (`POST /songs/:id/separate`); the resulting stems are moved onto the Song as `vocals_fs_node_id` / `instrumental_fs_node_id`; the VocalSeparation row is just a tracking record; exempt from quota and retention.

- Status enum: **`pending` | `processing` | `complete` | `failed`** (terminal = complete/failed).
- Columns: `duration_seconds` (> 0), `model_id` (required; whitelist from `Rails.configuration.vocal_separator_models`), `error`, `finished_at`, `ip_address`.
- `queue_position`: while pending, how many live runs entered before it (0 = next); nil otherwise. Separations run serially against one CPU sidecar; a 3-minute song takes 5-15 minutes.

### VocalSeparationBlueprint

Base: `id, created_at, updated_at, status, model_id, duration_seconds, error, finished_at, song_id, user_id, ip_address`.

`:extended` adds: `has_vocals`, `has_instrumental`, `has_original` (booleans over attachments), `song_title`, `progress_percent` (live from the sidecar, only while processing, else null), `queue_position`, `vocals_url`, `instrumental_url` (rails blob URLs; ONLY for complete tool runs - song runs keep these null because stems live on the Song as fs nodes).

`GET /songs/:id/separation` wraps it: `{ stems_ready, vocals_fs_node_id, instrumental_fs_node_id, progress_percent, job: <extended blueprint or null> }`.

---

## 12. Lyrics (on Song, own endpoints)

No blueprint; hand-built JSON in `LyricsController`.

- `GET /lyrics?song_id=X` -> `{ "synced": "<LRC text>|null", "plain": "<text>|null", "attribution": "lrclib.net" | <lyrics_source> }`. First hit lazily fetches (lrclib exact, lrclib fuzzy, Genius) and caches on the song row; misses are negative-cached 24 h and return the all-null shape with 200.
- `GET /lyrics/translation?song_id=X&target=pt` -> same `{synced, plain}` shape plus `target`; targets: **pt en es fr de it lv**; LRC timestamps preserved line-for-line; per-user cap 60/hour (429 beyond).
- `POST /lyrics/sync?song_id=X` -> `201 { "job_id": "..." }`; generates LRC from plain lyrics via whisper; only valid when `lyrics_plain` present and `lyrics_synced` absent; cap 10/hour. Client awaits the job over JobChannel then refetches.

---

## 13. SongImport and ArtistImport (async ingestion)

### SongImport (`song_imports`, bigint id)

One row per track being imported via the yt-dlp sidecar or the Spotify sync. State enum: **`pending` | `processing` | `complete` | `failed`** (`SongImport::STATES`). Two creation modes (validated: one required): URL mode (`source_url`) or search mode (`search_artist` + `search_title`, optional `search_album`).

Blueprint: `id, created_at, updated_at, user_id, playlist_id, song_id, source_url, source_provider, source_id, source_kind, override_title, override_artist, override_album, expected_duration_s, position, sidecar_request_id, state, progress_message, progress_pct, error_message, deduped`.

- `source_kind`: `yt_dlp` (default) or `spotify_sync`.
- `song_id` fills in when the import completes; `deduped: true` means an existing song was reused.
- Not serialized but in schema: `artwork_url`, `artwork_data_b64`, `isrc`, `search_*`.

### ArtistImport (`artist_imports`, bigint id)

Batch "import a Spotify artist's albums". State enum: **`queued` | `running` | `complete` | `failed`** (note: differs from SongImport's states). Blueprint: `id, created_at, updated_at, user_id, spotify_artist_id, spotify_artist_name, album_ids, state, total_albums, total_tracks, processed_albums, queued_count, skipped_count, failed_count, last_message, error_message, started_at, finished_at`.

---

## 14. Virtual entities (no table)

### Albums

Derived on the fly from songs: `GET /songs/albums` (optionally `?exact_search[artist]=<slug or name>`) returns `[{ "name": "<songs.album>", "artist": "<lead artist name>", "artist_slug": "...", "artwork_fs_node_id": "..." }]`, deduped by `(album, lead artist)`. Track lists come from `GET /songs?search[album]=...`. There is no album id anywhere.

### Mixes (`MusicMixesController`, `MusicMixGenerator`)

Generated per user, cached 24 h. Kinds: `top_artist` (x3), `repeat_rewind`, `time_capsule`, `discoveries`. Payload per mix (index strips `song_ids`):

```json
{ "slug": "mix:top_artist:1:ab12cd34", "kind": "top_artist",
  "title": "<english fallback>", "description": "<english fallback>",
  "title_key": "...", "title_params": {...},
  "description_key": "...", "description_params": {...},
  "seed": "...", "gradient": "from-rose-500 to-orange-500",
  "artist": <ArtistBlueprint :compact> | null }
```

Render titles from `title_key`/`description_key` + params (i18n keys); `title`/`description` are English fallbacks. `gradient` is a Tailwind class string - an RN client must map these to native gradients. `GET /music_mixes/:slug` adds `songs: [<SongBlueprint>]`.

### Radios (`MusicRadiosController`, `MusicRadioGenerator`)

Last.fm-similarity radios over the user's own library, cached 7 days. `GET /music_radios/artist/:artist` (slug or name) and `GET /music_radios/song/:id` return `{ slug, kind, title, description, seed, gradient, songs: [<SongBlueprint>] }` or 404 when a radio cannot be built.

### Music profile (`GET /users/:id/music_profile`, `MusicProfiles::Builder`)

Public-profile music section, viewer does not own the media, so artwork is presigned:

```json
{ "visible": true,
  "now_playing": { "user": {"id","handle","name"}, "song": <snapshot song|null>,
                    "paused": true, "online": false, "jam_id": null, "updated_at": "..." },
  "top_artists": [{ "id","name","slug","picture","picture_medium","picture_big",
                     "picture_xl","external_image_url","image_url","play_count" }],
  "top_songs":   [ <snapshot song> + {"play_count"} ],
  "recent":      [ <snapshot song> + {"last_played_at"} ],
  "plays_30d": 123 }
```

Snapshot song = `{ id, title, album, duration, owner_id, artist_names: "A, B", artwork_url }` (`Listening::Snapshot.song_hash`). `song` in now_playing is null when the target user disabled `share_listening` (users column, default true); presence/jam stay visible.

### Artist metadata (legacy) - `GET /artist_metadata/:name`

`ArtistMetadataBlueprint` (no created_at/updated_at). Keys: `id, name, slug, mbid, lastfm_listeners, lastfm_playcount, bio_html (sanitized), image_url (= external_image_url), image_fs_node_id, compressed_image_fs_node_id, banner_fs_node_id, compressed_banner_fs_node_id, picture, picture_small, picture_medium, picture_big, picture_xl, similar: [{name, match, mbid}]`. Unknown artist returns the same key set all-null with `name` echoed and `similar: []` (HTTP 200). Prefer the modern `/artists` endpoints; this exists for FE compatibility.

---

## 15. Social prerequisites

- `Relationship` (friend graph): `requester_id`, `accepter_id`, `status` **`pending` | `accepted`**, `kind` **`friend` | `block`**. The friends listening feed (`FriendListeningChannel`) and jam invitations sit on accepted friend relationships; feed rows are `Listening::Snapshot.for_user` hashes (see music profile above).
- Users table music-relevant flags: `share_listening` (bool, default true), `library_public` + `library_name` + `library_description` (public BOOK library, not music), `allowed_to_use_spotify` (gates the Spotify sync feature).

---

## 16. Enum quick reference

| entity.field | values | default |
|---|---|---|
| `song.source_kind` | `upload`, `yt_dlp`, `spotify_sync` | `upload` |
| `song_artist.role` | `primary`, `featured`, `with` | `primary` |
| `playlist.source_kind` | `manual`, `spotify_sync` | `manual` |
| `playback_state.loop_mode` | `none`, `one`, `all` | `all` |
| `playback_state.playback_mode` | `original`, `instrumental`, `vocals`, `custom` | `original` |
| `jam.queue_mode` | `everyone`, `host` | `everyone` |
| `jam.skip_mode` | `majority`, `host`, `anyone` | `majority` |
| `vocal_separation.status` | `pending`, `processing`, `complete`, `failed` | `pending` |
| `song_import.state` | `pending`, `processing`, `complete`, `failed` | `pending` |
| `artist_import.state` | `queued`, `running`, `complete`, `failed` | `queued` |
| `relationship.status` / `.kind` | `pending`, `accepted` / `friend`, `block` | `pending` / - |
| `play_events top since` param | `7d`, `30d`, `90d`, `all` | `all` |
| lyrics translation targets | `pt`, `en`, `es`, `fr`, `de`, `it`, `lv` | - |

---

## 17. Gotchas for a reimplementation

1. **`artists` inside a song payload are SongArtist join rows**, not Artist records: their `id` is the join id; use `artist_id` for the real artist. Sort by `position`, split by `role`.
2. **Blueprinter views inherit base fields.** `:compact`/`:card` artist payloads still contain the whole base field set; `:extended` = base + extras. Never build TypeScript types assuming a view is a subset.
3. **Every listing is capped at 500 rows** (forced `page=1:500` when absent). Liked songs paginate by `before` cursor on `liked_at`, not by page.
4. **fs-node ids are not URLs.** Owner flows must call `GET /fs_nodes/:id/data_url` and cache the result (valid 6 h). Cross-user flows get presigned `artwork_url`/`audio_url` directly and must NOT try to resolve foreign fs-node ids (404).
5. Prefer `compressed_audio_fs_node_id` / `compressed_artwork_fs_node_id` and fall back to the originals; compressed variants can be null (compression is best-effort at write time).
6. **Albums do not exist as records** - they are `(songs.album, lead artist)` string groupings. There is no album id, no album artwork of its own (a song's artwork is borrowed), and blank-album songs are excluded from album aggregates.
7. **System (Spotify-synced) playlists are read-only** for the user; check `source_kind != "manual"` before offering edit/add/reorder UI, the server will 401 the update anyway.
8. **Play tracking**: just POST on play start; the server dedupes 30 s repeats and answers `{deduped: true}` with 200 instead of 201.
9. **Playback state lives on ActionCable**, not REST; the queue is ids only, with `queue_order` as a separate visible-order permutation, and full `queue_songs` only sent when the queue changes.
10. Deleting a Song cascades to files, likes, play events, playlist entries, and its vocal separations. Deleting an Artist is refused while songs still reference it.
11. `viewable_by` for songs/artists/playlists/likes/play-events is strictly the owner - there is no shared music library; sharing happens only through jams/feed/profile snapshot hashes.
12. Timestamps everywhere are ISO 8601 strings; user ids and fs-node ids are opaque strings while music-entity ids are integers - do not model all ids as numbers.
