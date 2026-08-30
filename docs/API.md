# API.md - Consolidated API contract for the native music client

> **Nota (2026-08-31):** o cliente HTTP desta app é o `@omelhorsite/sdk` e os tipos AUTORITATIVOS são os do SDK (`src/resources/music/**`, `social/**`, `storage.ts`, `media.ts`). Este ficheiro fica como referência do FIO (o que o servidor manda, incluindo os campos que as views do Blueprinter herdam e que o SDK ainda tipa mais estreito). As convenções de pedido (secção 1: bracket encoding, sentinela `"\b"`, paginação) são agora responsabilidade do SDK; ver DESIGN.md secção 5.

Everything a React Native client needs to talk to the production backend, consolidated from the topic docs and verified against the Rails code where docs disagreed. Zero backend changes assumed.

## 0. Base URL and auth

- REST base: `https://backend.omelhorsite.pt` (no `/api` prefix). Dev: `http://localhost:1143`.
- WebSocket: `wss://backend.omelhorsite.pt/cable?token=<session token>`.
- Credential = a Session row's `token` (a UUID, minted at login, no expiry, revoked only by deletion). The server accepts it, first live candidate wins, from:
  1. `Authorization` header - parsed by blindly stripping the first 7 characters, so ALWAYS send `Bearer <token>` (a bare token gets its first 7 chars eaten).
  2. `?token=<token>` query/body param (first-class; use it on media URLs handed to players/downloaders).
  3. httpOnly cookie `oms_session` (web browsers only; native ignores it, and should disable any automatic cookie jar so a rotated token never leaves a stale cookie behind).
- The native app uses bearer-token mode exclusively (the existing Capacitor build already does). Store the token in SecureStore; attach the header on every JSON request; append `?token=` on media URLs. Avatars (`GET /users/:id/picture`) are public, no token.
- WebSocket handshake auth: the FIRST candidate wins with NO fallback (header beats query param); pass the token in the query string and do not send a stale Authorization header on the handshake. Anonymous connections are ACCEPTED; identity failures surface as `reject_subscription` per channel.
- No CSRF, no JWT, no refresh tokens. Logout = `DELETE /sessions/<any id>` (the id is ignored; it always destroys the CALLING session) then wipe local state.

## 1. Request/response conventions

- GET payloads go in the query string with axios-style bracket encoding: `search[title]=x`, `exact_search[artist]=Y`, `modifiers[page]=1:100`, `modifiers[order]=name:asc`, `modifiers[random]=true`, arrays as `key[]=a&key[]=b`. Non-GET bodies are JSON (`Content-Type: application/json`) unless multipart is stated.
- Null sentinel: every `null` in outgoing params/bodies must be sent as the literal one-char string `"\b"` (backspace). The backend converts it back to SQL NULL. Omitting a key means "no filter / unchanged". FormData and WebAuthn ceremony payloads are exempt (send verbatim).
- List DSL (CRUD indexes: /songs, /playlists, /playlist_songs, /artists, /song_imports):
  - `search[col]` = accent-insensitive partial match; `exact_search[col]` = equality (arrays -> IN; `"\b"` -> IS NULL).
  - `modifiers[page]=N:SIZE`, 1-based, SIZE clamped to 500; a missing page forces `1:500`. End-of-list = a short page.
  - `modifiers[order]=col:asc|desc` (unknown columns silently ignored); `modifiers[random]=true`.
  - UNKNOWN filter keys fail closed: `400 "Unknown search filter(s): ..."`. Every controller also accepts `id`, `created_at`, `updated_at`.
- Responses are BARE arrays/objects, no envelope. 200 read/update, 201 create, 204 delete (empty body). Error bodies are usually a bare JSON string (e.g. `"Song not found"`), occasionally an array of validation messages; only rate limiting has a structured body. Some success bodies are bare strings too. Parse defensively.
- Every Blueprinter payload includes `id`, `created_at`, `updated_at` (ISO 8601) unless noted. Blueprinter views INHERIT base fields: `:extended`/`:compact`/`:card` = base PLUS extras, never a subset.
- ID types: users, sessions, fs_nodes, playback_states, vocal_separations = strings. Songs, artists, playlists, playlist_songs, liked_songs, play_events, jams, song_imports, artist_imports = integers. On the cable, song ids and queue entries are STRINGS.
- Index endpoints emit ETag/304 (except with `modifiers[random]`); handle conditional GETs transparently.
- Rate limits: 429 with `{ "error": "rate_limited", "retry_after": <s> }` + `Retry-After` header; honor it (each 429 also pages the owner via Discord). Buckets: authed general 600/min (keyed by the literal Authorization header, only when it resolves to a live session); anon 120/min per IP (invalid tokens fall here - a stale-token retry loop can 429 the whole NAT); `/lyrics*`, `/artists/*`, `/artist_metadata/*`, `/music_radios/*` 60/min; login 10/min/IP; `*_start` code-send 4/min + 20/h; `*_end` 10/min; webauthn auth 20/min; `/users/search` 30/min; expensive tools 20/min. Exempt from ceilings: `/cable`, `/up`, `/fs_nodes/:id/data`, `/fs_nodes/:id/zip` (but `/fs_nodes/:id/data_url` COUNTS). App-level: external_search 30/min (returns 400, not 429); lyrics translation 60/h; lyrics sync 10/h; playlist import preview 60/h.

## 2. Sessions and auth

| Verb/Path | Body / params | Response |
|---|---|---|
| POST /sessions | `{ email, password }` | 201 Session token view: `{ id, created_at, updated_at, ip_address, user_agent, name, description, device_type, last_used_at, user_id, user: User, token }`; 401 bare string on bad creds. Send a meaningful User-Agent (names the session). |
| GET /sessions/mine | - | 200 Session extended view (no token); 401 => drop stored token, show login |
| GET /sessions | list filters | own sessions |
| PATCH /sessions/:id | `{ name?, description?, device_type? }` | updated session (device_type is a long whimsical enum; name 1..50, description 1..255) |
| DELETE /sessions/:id | - | 204; ALWAYS destroys the calling session regardless of :id |
| POST /sessions/adopt | `{ ticket }` | 201 `{ token }`; 401 expired (ticket TTL 2 min) |
| GET /sessions/oauth_ticket | - (auth) | `{ ticket }` (web cookie flow only; native passes raw token instead) |

Signup / account codes (6-digit email OTP, 15 min TTL, 5 attempts, one live code per email+reason):

| Verb/Path | Body | Notes |
|---|---|---|
| POST /users/create_start | `{ email }` | 200 bare string; 409 "Email already registered." |
| POST /users/create_end | `{ email, code, name, password }` | 201 User; 404 "Invalid Verification"; does NOT create a session - follow with POST /sessions |
| POST /users/reset_password_start | `{ email }` | always 200 (anti-enumeration) |
| POST /users/reset_password_end | `{ email, code, password }` | no auth |
| POST /users/update_email_start | `{ email: newEmail }` (auth) | codes to BOTH addresses |
| POST /users/update_email_end | `{ email, prev_email_code, new_email_code }` (auth) | |
| POST /users/destroy_start | `{}` (auth) | |
| POST /users/destroy_end | `{ code }` (auth) | deletes the account |

OAuth (providers `google_oauth2`, `github`, `spotify`): open `GET /auth/<provider>?mode=signin|signup|link` in a browser view; the callback ALWAYS redirects to `https://omelhorsite.pt/account/oauth/callback?ticket=...` (or `?error=account_exists|account_not_found|unauthorized|conflict|internal|spotify_not_allowlisted`); intercept it, then `POST /sessions/adopt`. Linking while signed in: `GET /auth/link/<provider>?token=<session token>`. Identities: `GET /identities` -> `[{ id, provider, email, name, avatar_url, created_at, updated_at }]`; `DELETE /identities/:id`.

WebAuthn (out of scope for v1; needs associated domains that do not exist): `POST /webauthn_credentials/authentication_options` -> `{ handle, options }`; `POST /webauthn_credentials/authentication` `{ credential, handle }` -> 201 Session token view; `registration_options` / `registration { credential, nickname }` (auth); `GET/DELETE /webauthn_credentials`. Payloads must bypass the null-sentinel rewriting.

## 3. Users, account, social graph

| Verb/Path | Notes |
|---|---|
| GET /users/:id (auth) | User JSON: `id, handle, name, bio, country_code, email_is_public, gender_is_public, library_public, library_name, library_description` + conditional `group, email, gender, allowed_to_use_spotify, share_listening` (self/admin) |
| PATCH /users/:id (auth, multipart) | fields: name, handle, country_code, email_is_public, gender_is_public, gender, bio, library_public, library_name, library_description, share_listening, picture (image; re-encoded webp 1024px) |
| GET /users/:id/picture (public) | avatar bytes, 302 to storage; 404 when missing. No token needed; safe for lock-screen artwork |
| GET /users/by_handle/:handle, GET /users/:id/profile (public) | public profile; profile adds followers_count, following_count, is_following, member_since |
| GET /users/search?q= (public) | >= 2 chars, max 8 `{ id, handle, name }`, 30/min/IP |
| POST /users/:id/follow, DELETE /users/:id/follow (auth) | |
| GET /users/:idOrHandle/music_profile (auth) | `{ visible: false }` for strangers/private (a 200); visible: `{ visible: true, now_playing: FriendListening, top_artists: [{ id, name, slug, picture, picture_medium, picture_big, picture_xl, external_image_url, image_url, play_count }] (max 8, 30d), top_songs: [SnapshotSong + play_count] (max 10), recent: [SnapshotSong + last_played_at] (max 10), plays_30d }` |
| GET /relationships (auth) | relationship rows; friends = kind "friend" + status "accepted" (take the other side of requester/accepter) |
| GET /account, GET /account/usage (auth) | legacy self view; usage counters |
| POST /service_usages `{ service_id: "music" }`, GET /service_usages/top?limit=3 | visit counter only, optional |

SnapshotSong (cross-user song, `Listening::Snapshot.song_hash`): `{ id: string, title, album, duration, owner_id, artist_names, artwork_url (presigned|null) }`.

## 4. Storage (fs_nodes)

- `GET /fs_nodes/:id/data_url` (auth JSON) -> `{ url }`: presigned MinIO GET, valid 6 hours, DIFFERENT on every resolve. RECOMMENDED for playback and downloads: resolve, hand the plain URL to the player/downloader; cache by node id, never by URL; re-resolve on failure. Counts against the rate ceiling.
- `GET /fs_nodes/:id/data?token=` -> 302 to the presigned URL (or streamed attachment fallback). Fine for images and for native downloaders that follow redirects WITHOUT forwarding the Authorization header onto the presigned URL (S3 rejects double auth). Anonymous/wrong-user = 404, not 401. Exempt from rate ceilings.
- Node preference ladders: audio `compressed_audio_fs_node_id` (AAC 192k m4a, faststart) else `audio_fs_node_id` (arbitrary codec; see `audio_codec`/`audio_lossless`); artwork `compressed_artwork_fs_node_id` else `artwork_fs_node_id`; stems `vocals_fs_node_id` / `instrumental_fs_node_id` (mp3).
- Cross-user media (jams, friends feed, music profile) arrives as ready-made presigned `artwork_url`/`audio_url` (6h validity, server-cached 5h so strings stay stable across broadcasts; all nullable). NEVER try to resolve another user's fs node ids (404).

## 5. Songs

`Song` payload: `id, created_at, updated_at, title, album (nullable), duration (s), position, year, audio_fs_node_id, compressed_audio_fs_node_id, artwork_fs_node_id, compressed_artwork_fs_node_id, vocals_fs_node_id, instrumental_fs_node_id, vocal_separation_started_at, user_id, source_kind (upload|yt_dlp|spotify_sync), source_provider, source_url, source_id, isrc, original_filename, audio_codec, audio_bitrate_kbps, audio_sample_rate_hz, audio_channels, audio_lossless, audio_filesize_bytes, artists: SongArtistEntry[]`. NO track_number/disc_number. `artists` are the song_artists JOIN rows: `{ id (join id), song_id, artist_id, position, role (primary|featured|with), name, slug, image_fs_node_id, compressed_image_fs_node_id, picture, picture_medium, external_image_url, created_at, updated_at }`. Display: sort by position; primaries joined ", "; `(feat. X)` for featured; `with` only in credits/media-session. Jam-injected songs additionally carry `audio_url, artwork_url, artist_names, jam_song: true, jam_proposer {id, handle, name}`.

| Verb/Path | Params/body | Response |
|---|---|---|
| GET /songs | filters on id/created_at/updated_at/title/album/position/year; special EXACT `exact_search[artist]=<name-or-slug>` (search[artist] behaves identically - also exact) joined via song_artists; top-level `artist_role=primary|featured|with`; forced page max 500, base order created_at asc | `Song[]` |
| GET /songs/:id | | `Song`; 404 |
| PATCH /songs/:id | JSON or multipart: title, album, year, position; virtual: `artist` (legacy string), `artist_names[]`, `featured_artist_names[]` (ALWAYS send this key - a single empty string means "explicitly none"; absent = legacy "feat." title heuristic), `artwork` (file) | updated `Song` |
| DELETE /songs/:id | | 204 (cascades files, likes, plays, playlist rows, separations) |
| POST /songs/import | multipart `file` (max 1 GB; mp3 wav flac aac ogg m4a opus) | 200 (not 201) `Song`; 400 no file; 415 invalid. Synchronous, can take tens of seconds |
| GET /songs/albums | same filters as /songs + artist_role; NOT force-paginated | `[{ name (nullable), artist, artist_slug, artwork_fs_node_id }]` deduped by (album, lead artist) |
| GET /songs/artists | (ignores ALL filters) | `string[]` artist names; legacy |
| GET /songs/artist_pictures?name= | | `{ pictures: [{ picture, picture_small, picture_medium, picture_big, picture_xl }] }` (0..1 entries; Deezer proxy, cached on the Artist row) |
| POST /songs/metadata_modifier | multipart: audio_file (<=50MB else 413), metadata[title/artist/album/year/genre/artwork]; track_number silently dropped | modified audio binary (attachment), not JSON |
| POST /songs/clean | DEAD ROUTE (no controller action) - do not call | |

Vocal separation:

| Verb/Path | Body | Response |
|---|---|---|
| POST /songs/:id/separate | `{ model_id? }` | 201 VocalSeparation extended; 400 "Song has no audio" / "Unknown model" |
| GET /songs/:id/separation | | `{ stems_ready, vocals_fs_node_id, instrumental_fs_node_id, progress_percent (null unless processing), job: VocalSeparation extended | null }`. Poll ~3s while pending/processing; stop on stems_ready / terminal / null job |
| DELETE /songs/:id/separation | | 204 (deletes stems) |

VocalSeparation extended: `id, created_at, updated_at, status (pending|processing|complete|failed - NO "canceled"), model_id, duration_seconds, error, finished_at, song_id, user_id, ip_address, has_vocals, has_instrumental, has_original, song_title, progress_percent, queue_position (0 = next, null once processing/terminal), vocals_url, instrumental_url (null for song runs - stems land on the Song)`.

## 6. Playlists

`Playlist`: `id, created_at, updated_at, name, user_id, artwork_fs_node_id, source_kind (manual|spotify_sync|imported), source_provider, source_url, source_external_id ("liked" = Spotify liked mirror), synced_at`. `description` exists in the DB but is NOT serialized. System = `source_kind` present and != "manual": server rejects rename, artwork, add/remove/reorder (verified: `updatable_by?` = owner AND not system); DELETE and COPY are allowed.

| Verb/Path | Body | Response |
|---|---|---|
| GET /playlists | filters id/name/created_at/updated_at | `Playlist[]` |
| GET /playlists/:id | | `Playlist` |
| POST /playlists | `{ name, artwork_fs_node_id?, song_ids? }` (song_ids: seed <= 500, order preserved, unknown ids dropped) | 201 `Playlist` |
| PATCH /playlists/:id | `{ name?, artwork_fs_node_id? }` top-level | 200; 401 for system playlists |
| DELETE /playlists/:id | | 204 |
| POST /playlists/:id/reorder | `{ song_ids: [full desired SONG-id order] }` | 200 (ignore body, refetch); 401 system |
| POST /playlists/:id/upload_artwork | multipart `artwork` | 200 `Playlist`; 401 system |
| POST /playlists/:id/copy | - | 201 new `Playlist` ("<name> (cópia)", manual, songs renumbered); works on system playlists |

PlaylistSong: `{ id (join id), created_at, updated_at, playlist_id, song_id, position, song: Song }`; default-scoped position asc; song unique per playlist.

| Verb/Path | Notes |
|---|---|
| GET /playlist_songs | e.g. `exact_search[playlist_id]=12&modifiers[page]=N:100&modifiers[order]=position:asc`; also `exact_search[song_id]=` for membership pre-checks |
| POST /playlist_songs | `{ playlist_id, song_id }` -> 201; 400 "Song has already been taken"; 401 system |
| DELETE /playlist_songs/:id | :id is the JOIN-ROW id, not the song id; 204; 401 system |

## 7. Liked songs and play events

| Verb/Path | Notes |
|---|---|
| GET /liked_songs?limit=100&before=<liked_at> | CURSOR pagination (strictly-less-than on liked_at), limit default 200 max 500; rows `{ id, created_at, updated_at, user_id, song_id, liked_at, song: Song }` newest first |
| GET /liked_songs/ids | `number[]` of song ids (cheap heart-state set) |
| POST /liked_songs | `{ song_id }`; idempotent; 201 |
| DELETE /liked_songs/:song_id | keyed by SONG id; 204 or 404 "Not liked" |
| POST /play_events | `{ song_id }`; 201 PlayEvent or 200 `{ deduped: true }` within a 30s same-user+song window; fire-and-forget |
| GET /play_events/recent?group_by=song\|album&limit=N | limit default 24 max 100. song: `[{ song, last_played_at }]`; album: `[{ album (nullable), artist: Artist(compact)\|null\|string(legacy), artwork_fs_node_id, last_played_at }]` |
| GET /play_events/top?scope=song\|album\|artist&since=7d\|30d\|90d\|all&artist=X&limit=N | limit default 10 max 100; `artist` narrows scope=song. song: `[{ song, play_count }]`; album: `[{ album, artist, artwork_fs_node_id, play_count }]`; artist: `[{ artist: compact, play_count }]` |

## 8. Artists

Base Artist (index): `id, created_at, updated_at, name, canonical_name, slug, user_id, image_fs_node_id, compressed_image_fs_node_id, banner_fs_node_id, compressed_banner_fs_node_id, mbid, lastfm_listeners, lastfm_playcount, external_image_url, picture, picture_small, picture_medium, picture_big, picture_xl, pictures_fetched_at, bio_fetched_at, similar_fetched_at` + computed `songs_count`, `fallback_artwork_fs_node_id`. Extended (show/update) adds `bio_html, gallery_image_urls, similar: [{ name, match, mbid }]`. Compact/card views are effectively base (views inherit). Slugs never change on rename; canonical_name does. Image chain: compressed upload > upload > Deezer picture by size (sm: medium; hero: xl/big) > picture > gallery[0] > fallback_artwork node > external_image_url > initials.

| Verb/Path | Notes |
|---|---|
| GET /artists | filters id/name/slug/canonical_name/created_at; web pages 60/page name:asc or created_at:desc |
| GET /artists/overview | cached 1h/user: `{ stats: { artists, songs, new_artists, seconds_played }, heavy_rotation_window: "30d"\|"all", spotlight: { artist, songs_count, albums_count, play_count }\|null, heavy_rotation: [{ artist, play_count }], similar: { seed, artists }\|null, neglected: [{ artist, songs_count }] }` |
| GET /artists/:idOrSlug | resolves numeric id, then slug, then canonical name (URL-encode); lazily refreshes external metadata (first cold hit slow); extended view; 404 "Artist not found" |
| PATCH /artists/:id | FLAT top-level `{ name?, gallery_image_urls? }` (http(s) URLs only). Do NOT nest under `artist` (the web does; it no-ops) |
| DELETE /artists/:id | refused while song_artists reference it |
| POST /artists/:id/upload_image | multipart `image` |
| POST /artists/:id/upload_banner | multipart `banner` (NOT `image`; the web's `image` field 400s) |
| GET /artist_metadata/:name | legacy shim; name or slug; ALWAYS 200; keys without timestamps: `id, name, slug, mbid, lastfm_listeners, lastfm_playcount, bio_html, image_url, image_fs_node_id, compressed_image_fs_node_id, banner_fs_node_id, compressed_banner_fs_node_id, picture*, similar`; unknown artist = all-null + echoed name + `similar: []` |

## 9. Mixes and radios

- `GET /music_mixes` -> `MixSummary[]`: `{ slug ("mix:kind:..." - URL-ENCODE, contains colons), kind (top_artist|repeat_rewind|time_capsule|discoveries), title, description (English fallbacks), title_key, title_params, description_key, description_params, seed (string|number|null), artist: Artist compact | null (top_artist only), gradient (IGNORE - client owns per-kind gradients) }`. Server-cached 24h/user; 0..6 entries.
- `GET /music_mixes/:slug` -> summary + `songs: Song[]`; 404 "Mix not found" when rotated (refetch the list).
- `GET /music_radios/artist/:artist` (artist SLUG preferred, canonical name also resolves, URL-encoded; user's roster only) and `GET /music_radios/song/:id` -> `{ slug, kind (artist|song), title, description (pre-baked Portuguese), seed, gradient (IGNORE), songs: Song[] (~40; song radio's songs[0] = seed track) }`; 404 when unbuildable. Server-cached 7 days per (user, seed); no refresh; "save as playlist" freezes a batch.

## 10. Lyrics

- `GET /lyrics?song_id=` -> 200 `{ synced: LRC|null, plain: string|null, attribution }` (both null = none; NOT a 404; 404 only for bad song ids). First fetch runs external lookups inline (seconds); positive cache 30 days on the song row; misses negative-cached 24h.
- `GET /lyrics/translation?song_id=&target=pt|en|es|fr|de|it|lv` -> same shape + `target`; timestamps preserved line-for-line; 400 bad target; 404 "No lyrics for this song"; 429 beyond 60/h/user; 503 translator down. Never auto-retry 429/404.
- `POST /lyrics/sync` `{ song_id }` -> 201 `{ job_id }`; 400 no plain / already synced; 429 beyond 10/h. Await via JobChannel (+ ~10s REST poll fallback of `GET /jobs/:id`; 404 during polling = keep waiting), then refetch /lyrics.
- `GET /jobs/:id` (optional `?watch_token=`) -> `{ id, job_type, payload, status (pending|processing|complete|failed|canceled), progress, started_at, finished_at, result, error, creator_id, created_at, updated_at }`.

## 11. External search and imports

- `GET /music/external_search?q=&kind=track|album|artist|any` -> `{ tracks: [{ source (spotify|youtube|soundcloud|bandcamp|itunes), kind, source_id, source_url|null, title, artist, album|null, duration_ms|null, isrc|null, artwork_url|null }], albums: [...], artists: [...] }`. Min 2 chars; 30/min/user returns `400 "Rate limit exceeded"` (not 429); server cache 15 min.
- `POST /song_imports` -> 201 SongImport. URL mode: `{ source_url }` (public http(s) only; SSRF-guarded 400). Search mode: `{ search_artist, search_title, search_album?, isrc? }` and NO source_url. Common optional: `source_provider, source_id, source_kind, override_title, override_artist, override_album, artwork_url, artwork_data_b64, expected_duration_s, playlist_id, position`. Dedupe (isrc, then provider+source_id, then source_url) returns immediately terminal: `state: "complete", deduped: true, progress_pct: 1.0, song_id set`.
- `GET /song_imports/:id`, `GET /song_imports` (filters id/state/playlist_id/user_id/created_at/updated_at). SongImport: `id, created_at, updated_at, user_id, playlist_id, song_id, source_url, source_provider, source_id, source_kind (yt_dlp|spotify_sync), override_*, expected_duration_s, position, sidecar_request_id, state (pending|processing|complete|failed), progress_message, progress_pct (FLOAT 0..1), error_message, deduped`. Poll 1.5s while active.
- `POST /playlist_imports/preview` `{ url }` -> `DownloaderPreview`: `{ kind: "track", title?, artist?, album?, duration_s?, thumbnails?, webpage_url?, id?, extractor? }` or `{ kind: "playlist", title?, id?, count, tracks: [...] }`. 400 "url is required" / Spotify-URL refusal message / "url is not allowed"; 502 yt-dlp error; 60/h.
- `POST /tools_downloader/artwork_search` `{ artist?, title?, album?, query? }` -> `{ items: [{ url, thumb_url?, source (itunes|musicbrainz|deezer), width?, height?, label?, subtitle? }] }`.
- Spotify sync (ALL 403 unless account `allowed_to_use_spotify`):
  - `GET /spotify_syncs/status` -> `{ connected: false }` or `{ connected: true, identity_id, spotify_user_name, last_synced_at, sync_settings: { sync_liked?, enabled_playlists|null, auto_sync }, sync_progress: { state (idle|running|complete|failed), started_at, finished_at, error, playlists: [{ id, name, total|null, queued, skipped, state (pending|running|complete|failed) }] } }` (running > 2h auto-rewritten to failed).
  - `GET /spotify_syncs/preview` -> `{ sync_liked, playlists: [{ id, name, track_count|null, owner|null, cover_url|null, enabled }] }`; 404 not linked; 502 upstream.
  - `PATCH /spotify_syncs/settings` `{ enabled_playlists?, sync_liked?, auto_sync? }` (keys applied only when present) -> `{ ok, sync_settings }`. Deselecting a playlist / disabling liked DELETES local copies immediately.
  - `POST /spotify_syncs` `{ playlist_ids? }` -> `{ ok, queued_at }`; 409 while running.
- Artist imports (require a linked Spotify IDENTITY; 400 "Connect Spotify first." / "Spotify connection needs to be relinked."):
  - `GET /artist_imports/search?q=` -> `{ roster: [{ kind: "roster", id, name, slug, image_url }], spotify: [{ kind: "spotify", id, name, followers, genres, image_url, external_url }] }`.
  - `GET /artist_imports/albums?spotify_artist_id=` -> `{ items: [{ id, name, album_type, album_group, release_date, total_tracks, image_url, external_url }] }`.
  - `POST /artist_imports` `{ spotify_artist_id, spotify_artist_name, album_ids }` -> 201 record.
  - `GET /artist_imports?limit=20` (max 50, newest first) -> `{ items: [...] }` (note the wrapper). Record: `id, timestamps, user_id, spotify_artist_id, spotify_artist_name, album_ids, state (queued|running|complete|failed), total_albums, total_tracks, processed_albums, queued_count, skipped_count, failed_count, last_message, error_message, started_at, finished_at`. Poll 1.5s while active.

## 12. Jams (REST)

| Verb/Path | Body | Response / rules |
|---|---|---|
| GET /jams | - | `{ current: Jam\|null, joinable: Jam[] }` (joinable = active jams containing >= 1 accepted friend, i.e. exactly the join authorization) |
| POST /jams | none | 201 Jam; caller becomes host + first member; silently leaves/ends any previous jam. Host must then claim_active (steal) on PlaybackChannel or the jam is silent |
| POST /jams/:id/join | none | 200 Jam; 404 (incl. ended); 401 "Only friends of a jam member can join"; leaves previous jam first |
| POST /jams/:id/leave | none | 200 null; HOST leaving ENDS the jam (no handoff) |
| DELETE /jams/:id | - | host only; ends the jam |
| PATCH /jams/:id | `{ queue_mode?: everyone\|host, skip_mode?: majority\|host\|anyone }` | host only; broadcasts jam_updated |
| POST /jams/:id/invite | `{ user_id }` | member + target must be caller's accepted friend + not in jam; creates a `jam_invite` notification (no accept API - invitee uses GET /jams) |
| POST /jams/:id/propose | `{ song_id }` | member's OWN song only; queue_mode gate; 400 "The host is not playing right now" without an active host device; injects server-built `jam_add_song` to the host |
| POST /jams/:id/skip_vote | none | 200 `{ skipped, count, needed }`; needed = 1 (anyone) or floor(n/2)+1 (majority); host vote always skips; tallies keyed per song id (silent reset on track change); 400 non-host in host mode / nothing playing |

Jam: `{ id: number, host_id, queue_mode, skip_mode, created_at, ended_at|null, members: [{ id, handle, name, is_host, joined_at }] }`. JamState: `{ song: SnapshotSong + audio_url | null, position, paused, upcoming?: [{ id, title, duration, artist_names, artwork_url, proposer|null }] (max 10), server_time (epoch ms) }`.

## 13. ActionCable channels

Framing (ActionCable v1 over a raw WebSocket; `identifier` is a JSON-ENCODED STRING and the server echoes your exact string - keep key order stable):

- Server -> client: `{"type":"welcome"}`, `{"type":"ping"}`, `{"type":"confirm_subscription","identifier":...}`, `{"type":"reject_subscription",...}`, `{"type":"disconnect"}`, or `{"identifier":"...","message":<payload>}`.
- Client -> server: `{"command":"subscribe"|"unsubscribe","identifier":"..."}` and `{"command":"message","identifier":"...","data":"<JSON string {action, ...args}>"}`.
- Wait for `welcome` before subscribing; resubscribe everything on reconnect; backoff 1s doubling to 30s; sends before welcome are silently dropped.

### 13.1 PlaybackChannel (remote playback, presence, host jam duties)

Subscribe: `{"channel":"PlaybackChannel","device_id":"<per-launch token [A-Za-z0-9-]{8,64}>","device_label":"<free text, 80 chars>","predecessor":"<optional previous device uuid>"}`. Server composes the real device id as `<session_id>:<device_id>`; that composed id appears in all wire fields.

Client -> server actions:

| action | data | notes |
|---|---|---|
| heartbeat | `{}` | every 20s; registry TTL 75s |
| request_snapshot | `{}` | also on every app foreground (+ heartbeat) |
| claim_active | `{ mode: "if_none" \| "steal" }` | if_none = compare-and-set, loser gets claim_rejected (stay pessimistic); steal = adopt optimistically |
| transfer | `{ target_device_id }` | online devices only; error device_offline otherwise |
| command | `{ command, args }` | controller -> active device; <= 8KB; vocabulary: play/pause/toggle/next/previous `{}`; seek `{time>=0}`; set_queue_index `{index}`; set_queue_order `{order: int[] <=1000}`; set_shuffle `{shuffle}`; set_loop_mode `{mode: none\|one\|all}`; set_volume `{0..1}`; add_to_queue / play_next `{song_id: "<digits>"}`; remove_from_queue `{visible_index}`; reorder_queue `{from, to}`. `jam_add_song` is server-built ONLY |
| state_changed | `{ payload: Partial<snapshot> }` | active device only; debounce 200ms; song ids AS STRINGS; server clamps (queue 1000, rate 0.25..4, EQ +-12, volumes 0..1) and strips unknown song ids with remap |
| position_tick | `{ position, paused, song_id }` | active only, 1 Hz while playing; server persists at most every 5s |
| activation_blocked | `{}` | active only; fans out the needs-a-tap hint |

Server -> client messages: `snapshot` `{ v: 2, state, devices, active_device_id, your_device_id, active_session_id, your_session_id }`; `state_changed` `{ state, active_device_id, from_device_id }` (SLIM variant omits `state.queue_songs` when the queue did not change - merge with the last full list); `position_tick` `{ position, paused, song_id, server_time, from_device_id }`; `devices_changed` `{ devices, active_device_id }`; `command` `{ command, args, target_device_id, from_device_id }` (execute ONLY when target is you); `claim_rejected`; `no_active_device`; `activation_blocked` `{ device_id }`; `error` `{ action, reason }` (resync with request_snapshot).

PlaybackSnapshot (`state`): `{ v?, active_device_id|null, song_id: string|null, position, paused, queue: string[], queue_index, queue_order: int[], loop_mode (none|one|all, default all), shuffle, volume (active device's output; NOT adopted on takeover), playback_rate?, playback_mode? (original|instrumental|vocals|custom), eq_low?, eq_mid?, eq_high?, eq_enabled?, separation_enabled?, vocal_volume?, instrumental_volume?, queue_songs: Song[] (may be omitted on slim) }`. Listener settings (rate, mode, EQ, separation, stem volumes) travel with the account and ARE adopted on takeover/hydration. PlaybackDevice: `{ id, label, name?, device_type, description?, last_seen_at/last_used_at, online }`; offline entries = recent sessions (7d), display-only; no is_self flag (compare ids). Active-device unsubscribe has a 15s grace before activeness clears (paused: true).

### 13.2 JamChannel

Subscribe: `{"channel":"JamChannel","id":<jam id (number)>}`. Must be an active-jam MEMBER (join via REST first) or `reject_subscription` (= jam gone, clear state). ZERO client actions - receive-only. On subscribe: transmit `{ "type":"snapshot", "jam": Jam, "state": JamState }` (position up to ~5s stale; ticks correct it). Stream messages: `state_changed {state}`, `position_tick {position, paused, song_id, server_time}` (no song payload; correlate by song_id), `members_changed {jam}`, `jam_updated {jam}`, `song_proposed {song: {id,title,artist_names}, proposer}`, `skip_votes {song_id, count, needed}`, `skipped {}`, `ended {}`.

### 13.3 FriendListeningChannel

Subscribe: `{"channel":"FriendListeningChannel"}`; rejected when unauthenticated. Snapshot on subscribe: `{ "type":"snapshot", "friends": FriendListening[] }`. Updates: `{ "type":"listening_update", ...FriendListening fields at top level }` - full row replace by `user.id`, append when new. FriendListening: `{ user: { id, handle, name }, song: SnapshotSong|null (null when sharing off), paused, online (device seen <= 75s), jam_id: number|null, updated_at|null }`. Fires on song/pause/jam transitions, never on ticks. Rosters are subscribe-time: resubscribe (e.g. on foreground) to pick up new friends/privacy flips.

### 13.4 JobChannel

Subscribe: `{"channel":"JobChannel","id":"<job id>","token":"<optional watch token>"}`. Transmits `{ job: Job }` on subscribe and on every change. Done when `finished_at` non-null. Combine with a slow REST poll of `GET /jobs/:id` (~10s; 404 = keep waiting).

### 13.5 NotificationsChannel

Per-user notifications stream (generic). Relevant here: `kind: "jam_invite"` with context `{ jam_id, host_id, host_handle, inviter_id, inviter_handle }`. Render as a link into the music area; the jam appears in `GET /jams` joinable.

## 14. Client-behavior contract highlights (normative)

1. Cache media by fs node id, never by URL; presigned URLs rotate per resolve and die at 6h.
2. `song_id` and queue entries are strings on the cable, integers in REST; normalize deliberately.
3. Merge slim `state_changed` with the last full `queue_songs`; on cable `error`, resync with `request_snapshot`.
4. Drop jam proposals when adopting any snapshot; never persist, download, play-event, or fs-resolve them.
5. Repeat-one on the ended event, not a native loop flag; play recording via the forward-delta accumulator, `min(30s, duration/2)`.
6. Heartbeat 20s; snapshot + heartbeat on foreground; server reaps at 75s; active grace 15s.
7. Client-side re-ranking after every LIKE search (backend returns alphabetical order).
8. Poll cadences: separations 3s; song/artist imports and spotify sync 1.5s while active; jobs via JobChannel + 10s fallback; lyrics translation/sync respect hourly caps with no auto-retry on 429/404.
