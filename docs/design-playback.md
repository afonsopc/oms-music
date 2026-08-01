# design-playback.md - Architecture for oms-music (Expo SDK 57, iOS + Android)

Lens: PLAYBACK CORRECTNESS FIRST. The player, queue, remote playback, jams, stems and the offline
audio ladder are designed in full detail; browse/content screens are broader brush and inherit the
shared contracts. All 126 FRs from SPEC.md are covered by the work-package split at the end.

Repo: `/Users/afonsocoutinho/Documents/oms-music` (Expo 57, expo-router under `src/app`, TS strict,
react compiler on). Backend: `https://backend.omelhorsite.pt`, unchanged. No em-dash anywhere; PT-PT
only for Portuguese copy.

---

## 1. Directory layout under src/

Rule: each top-level directory below is owned by exactly one work package (section 11). Cross-package
communication happens ONLY through the modules marked `[contract]`, which are written first (WP1/WP3)
and treated as frozen interfaces afterwards. Screens in `src/app/` are thin: route wiring + a single
feature component import.

```
src/
  app/                          expo-router tree (section 2). Thin files only.
  api/                          [contract] HTTP layer
    client.ts                   fetch wrapper: base URL, Bearer header, User-Agent, 401/429/304, error parsing
    params.ts                   bracket encoding + "\b" null sentinel (FormData/WebAuthn exempt)
    errors.ts                   ApiError type, bare-string body parsing, rate-limit shape
    keys.ts                     react-query key factory (single source of query keys)
    queryClient.ts              the one QueryClient + onlineManager(NetInfo) + focusManager(AppState)
    endpoints/                  one file per resource, typed request fns only (no hooks)
      sessions.ts users.ts songs.ts playlists.ts playlistSongs.ts likedSongs.ts playEvents.ts
      artists.ts fsNodes.ts lyrics.ts mixes.ts radios.ts jams.ts social.ts imports.ts
      separation.ts spotifySync.ts artistImports.ts serviceUsages.ts relationships.ts jobs.ts
  domain/                       [contract] pure types + helpers, zero I/O
    types.ts                    Song, SongArtistEntry, Playlist, PlaylistSong, LikedSong, Artist, Jam,
                                JamState, FriendListening, MixSummary, Radio, PlaybackSnapshot, Device...
    ids.ts                      wire boundary: toCableId(n)->string, fromCableId(s)->number, SongKey (string)
    artists.ts                  formatArtists / formatArtistsFull / primaryArtistSlug
    artwork.ts                  artwork URL fallback chains (song/playlist/artist), placeholder rule
    albumKey.ts                 "album:<artistSlug>:<album>" composite key (matches backend grouping)
  player/                       [contract] the engine (WP3, section 3)
    engine.ts                   PlayerEngine singleton (owns the expo-audio AudioPlayer)
    queue.ts                    pure quartet operations + invariants (property-tested)
    resolver.ts                 source resolution ladder + PresignedUrlCache (by fs node id)
    prefetch.ts                 next-track prefetch slot (one-shot, 5 min TTL)
    recovery.ts                 failure ladder, failedSongIds set, throttled toast hook
    recording.ts                forward-delta listen accumulator -> POST /play_events
    lockScreen.ts               setActiveForLockScreen metadata + remote-command routing
    modes.ts                    playback modes (original/instrumental/vocals; custom stub) + separation glue
    store.ts                    zustand player store (UI mirror) + persisted listener settings
    types.ts                    engine action interface, TransitionCause, seams (interceptor, source hook,
                                command sink, engine events) - THE integration contract for WP6/7/8/10
  remote/                       remote playback (WP7, section 6)
    cable.ts                    minimal hand-rolled ActionCable v1 client
    playbackSync.ts             role machine, snapshot adoption, publisher, command router, heartbeats
    transport.ts                remote-aware action dispatch (controller -> command, else engine)
    store.ts                    zustand remote store (role, devices, snapshot mirror, tick interp)
  jam/                          jams (WP8, section 6.5)
    service.ts                  REST lifecycle + JamChannel subscription
    followerPlayer.ts           dedicated second AudioPlayer for following
    hostDuties.ts               jam_add_song / next command execution + proposal FIFO
    store.ts
  social/                       friends feed + profile queries (WP8)
    friendListening.ts store.ts
  offline/                      downloads + offline library (WP6, section 4)
    db.ts                       expo-sqlite schema + migrations, per-user db file
    downloadEngine.ts           queue (3 concurrent) over File.createDownloadTask, savable persistence
    registry.ts                 in-memory maps: nodeId->localUri, songId->status/progress
    collections.ts              keep-synced collections + auto-sync on refetch
    repair.ts                   verify-and-repair + retryFailures (boot + reconnect)
    settings.ts                 wifiOnly/includeStems/showOnlyDownloaded/maxStorageBytes (kv-store)
    statusContext.tsx           DownloadStatusContext port (sync getStatus/getProgress + one version counter)
    offlineResolvers.ts         library/image/lyrics offline fallbacks + isOfflineNow flag
  auth/                         (WP2, section 5)
    service.ts                  login/signup OTP/reset/adopt/logout flows
    guard.ts                    single-flight 401 verification, global authReady gate
    secure.ts                   expo-secure-store token accessor (sync-ish cached)
    store.ts                    session/user zustand store
  lyrics/                       (WP5)
    lrc.ts                      LRC parser (4 exact rules, unit-tested)
    queries.ts translation.ts syncJob.ts
  i18n/                         [contract] (WP1)
    index.ts                    ICU rendering (use-intl core), locale persistence, PT-PT catalog
    catalogs/en.json pt.json lv.json    ported from web as-is (components.music.* keys)
  theme/                        [contract] (WP1)
    tokens.ts                   both HSL palettes as hex + radius + fixed gradients (mix kinds, liked purple)
    provider.tsx                light/dark/system selection
    accent.ts                   artwork average color, dual-variant LRU(100) per song id
    typography.ts               Inter/Druk Wide/Cantarell registration + scale
  ui/                           shared presentational components (WP4)
    ArtworkImage.tsx SongRow.tsx SongTable.tsx Tile.tsx Hero.tsx ActionBar.tsx StickyTitle.tsx
    PlayingBars.tsx FilterPills.tsx Rail.tsx MiniPlayer.tsx EmptyStates.tsx sheets/ menus/
    songMenu/                   canonical song action list (FR-74) - owned by WP5
  features/                     screen-level components, one folder per destination
    home/ search/ library/ liked/ playlists/ playlist/ artistsHub/ artist/ album/ mix/ radio/
    downloads/ nowPlaying/ queuePanel/ lyricsView/ jamView/ profile/ devices/
    settings/ (hub/, import/, songs/, artists/, playback/, downloads/, app/)
  deepLinks/
    parse.ts                    omelhorsite.pt URL -> native route (locale prefix, both album forms,
                                literal "null" album, ?id=/?slug= forms)
```

Existing template files (`src/components`, `src/constants/theme.ts`, `src/hooks`) are absorbed or
deleted by WP2; nothing else touches them.

---

## 2. Navigation tree (expo-router, 28 screens)

Root stack: `(auth)` group when logged out, `(app)` group when authed (gate in `src/app/_layout.tsx`
reading `auth/store`). Modals presented over everything so music context is never unmounted.

```
src/app/
  _layout.tsx                        providers: Theme > I18n > QueryClient > Auth > Remote > Player > Jam > DownloadStatus
  (auth)/
    login.tsx                        1  Login (email+password; OAuth buttons; reset link)
    signup.tsx                       2  Signup (email -> 6-digit OTP -> name/password -> auto POST /sessions)
    reset.tsx                        3  Password reset (start/end)
  (app)/
    _layout.tsx                      tab bar + MiniPlayer pill overlay + controller strip + JamBar swap
    (tabs)/
      index.tsx                      4  Home (Discover): pills, top tiles, friends strip, rails
      search.tsx                     5  Search (recent searches + live suggestions)
      library.tsx                    6  Library (playlists/artists/albums pills, windowed list)
      downloads.tsx                  7  Downloads (in-flight + downloaded + storage header)
    search-results.tsx               8  Full search results (pills: all/songs/playlists/albums/artists)
    liked.tsx                        9  Liked songs (cursor-paged, purple hero)
    playlists.tsx                    10 Playlists grid + create
    playlist/[id].tsx                11 Playlist detail
    artists.tsx                      12 Artists hub (overview: spotlight, stats, shelves)
    artists-roster.tsx               13 Artists roster (infinite 60/page, sort, server search)
    artist/[artist].tsx              14 Artist (slug-or-name resolve, hero, popular, discography)
    album/[artist]/[album].tsx       15 Album (also target of /music/artist/<a>/<al> deep links)
    mix/[slug].tsx                   16 Mix detail (slug URL-encoded, contains ":")
    radio/artist/[artist].tsx        17 Artist radio
    radio/song/[id].tsx              18 Song radio
    profile/[idOrHandle].tsx         19 Music profile (visible:false renders nothing)
    settings/index.tsx               20 Settings hub
    settings/import.tsx              21 Import (file upload, URL import, Spotify sync, artist import tabs)
    settings/songs.tsx               22 Songs management (bulk edit/delete, stems controls)
    settings/artists.tsx             23 Artists management (FLAT PATCH, banner field "banner")
    settings/playback.tsx            24 Playback settings (share_listening)
    settings/downloads.tsx           25 Download settings (wifiOnly, includeStems, showOnlyDownloaded)
    settings/app.tsx                 26 App prefs (theme light/dark/system, language en/pt/lv)
  now-playing.tsx                    27 Now Playing modal: full-screen pager with pages
                                        Playing / Queue / Lyrics / Friends (rail tabs of the web)
  jam.tsx                            28 Jam panel modal (members, rules, invites, skip votes, joinable list)
```

P2 addendum (not in the 28): `devices.tsx` (sessions list/rename, FR-14) and song credits dialog
(rendered inside songMenu, not a route). Queue and Lyrics are pages INSIDE now-playing (mobile web
parity: NowPlayingSheet owns them); they are separate features/ folders so ownership stays split.

Deep links (FR-20): `deepLinks/parse.ts` maps `https://omelhorsite.pt/<locale>/music/...` into this
tree; both `/music/album/<artist>/<album>` and `/music/artist/<artist>/<album>` land on screen 15;
artist segment is slug or URL-encoded name; literal `"null"` album segment maps to the unknown-album
screen (`exact_search[album]="\b"`).

---

## 3. Player service over expo-audio (the heart)

### 3.1 Shape

One `PlayerEngine` singleton (plain TS class, created at import time in `player/engine.ts`, no React).
It owns a SINGLE `AudioPlayer` created via `createAudioPlayer()` and never uses `AudioPlaylist`:
shuffle/repeat/jam interception/presigned lifecycle demand per-track control in JS, and repeat-one
must run on the ended event, which a native playlist would hide. The engine exposes:

- an actions interface (`player/types.ts`): setQueue, setQueueIndex, setShuffle, addToQueue, playNext,
  reorderQueue, removeFromQueue, patchQueueSong, play, pause, toggle, next, previous, seek, setVolume,
  setRate, setLoopMode, setPlaybackMode, setSleepTimer, playFromIdle;
- a typed event emitter: `songChanged`, `status` (position/duration/playing/buffering), `ended`,
  `audiblePlaying`, `streamError`, `queueChanged` - consumed by remote publisher, jam, recording,
  accent extraction, downloads;
- seams (registered, never imported downward): `setPlaybackInterceptor(fn)` (jam proposals),
  `setSourceHook(fn)` (offline local-file resolution), `setCommandSink(fn)` (unused by engine itself;
  transport wrapper lives in remote/).

`player/store.ts` (zustand) mirrors state for UI at bounded rates: position updates at 4 Hz max
(from `playbackStatusUpdate` with `updateInterval: 250` ms), everything else on change. Scrub bars
and MediaSession read the STORE, never the AudioPlayer. The synchronous source of truth for the
queue quartet is a ref inside the engine (`queueRef`); React state is a mirror.

### 3.2 Queue model (FR-57): pure module `player/queue.ts`

```ts
type QueueState = { queue: Song[]; queueOrder: number[]; queueIndex: number; shuffle: boolean };
// currentSong = queue[queueOrder[queueIndex]]
```

All operations are pure `(state, args) -> state` functions with the EXACT web semantics:

- `setQueue(songs, shuffle)`: order = identity, or full shuffle of identity when shuffle on; index 0.
- `setShuffle(on)`: the ONLY reshuffle point. ON: `order = [currentVisibleBackingIdx, ...shuffle(rest)]`,
  index 0. OFF: order = identity, index = natural position of current. Same-value toggle = no-op.
- `addToQueue`: append to queue AND to end of order.
- `playNext`: append to queue, splice its backing index into order at queueIndex + 1.
- `reorderQueue(fromVisible, toVisible)`: move within order; cursor fixups (moved current row: index
  follows; from before to at/after cursor: index - 1; from after to at/before: index + 1).
- `removeFromQueue(visible)`: refuse when visible === queueIndex; remove order entry and backing
  entry; remap every order value > removedBackingIdx down by one; decrement index if removed visible
  row was before it.
- `sanitizeSnapshot(queueSongs, order, index)`: drop `jam_song` entries with order/index remap,
  validate order is a permutation (else identity), clamp index. Used on every adoption.
- `insertJamProposal(song)`: insert after current, BEHIND earlier pending proposals (FIFO scan of
  contiguous `jam_song` entries after the cursor).

Invariants (property tests in `queue.test.ts`, fast-check style over random op sequences):
order is always a permutation of `0..queue.length-1`; index in `[0, order.length)` or queue empty;
removing never changes the audible song; reorder never changes the audible song.

### 3.3 Transitions, generation tokens, autoplay causes (FR-59)

Every song transition calls `engine.transition(cause)` where
`cause: "user" | "auto" | "hydration" | "activation" | "recovery" | "mode" | "patch"`.

- `transitionGen` increments on EVERY transition. All async continuations (URL resolve, delayed
  play, pending seek application) capture the gen and bail when stale.
- `loadingSongId` guards the resolve itself: a late data_url answer for a skipped song is dropped.
- `requestedNodeId` records which fs node (or jam URL, or local file) the player was last pointed at.
  `cause: "patch"` (separation finished, stem ids landed) compares wanted node vs requestedNodeId:
  same -> do nothing (never restart a playing track); different AND mode wants a stem -> swap source
  preserving position + play state (stale-queue reconciliation).
- `pendingSeek`: seeks issued before the source reports a finite duration are stored and applied on
  the first `status` with `duration > 0` for the current gen (expo-audio equivalent of
  loadedmetadata). Used by: activation seeds, stream-error resume, mode switches, hydration.
- Autoplay per cause: `user`/`auto` -> play; `hydration` -> load + pendingSeek, stay paused;
  `activation` -> honor remote `paused` flag + seek to remote position; `patch`/same-song role
  re-runs -> never restart. The jam interceptor may consume a `user` transition entirely (source
  cleared, nothing plays, proposal fired).
- `intendedPlay` flag survives async gaps so recovery knows whether to resume.

### 3.4 Source resolution ladder (FR-55/56/90) - `player/resolver.ts`

`resolveSource(song, mode): SourceCandidate[]`, tried in order until the player accepts one
(acceptance = first status without error; a candidate error before `audiblePlaying` moves to the
next candidate, NOT into the failure ladder):

1. `song.audio_url` present (jam proposal) -> use verbatim, single candidate. Never resolve fs nodes.
2. Pick wanted node by mode: `instrumental` -> instrumental_fs_node_id, `vocals` -> vocals_fs_node_id
   (either missing -> fall through to plain mix); `original`/`custom`/fallback ->
   `compressed_audio_fs_node_id || audio_fs_node_id`.
3. Local-first (via `setSourceHook` from offline/): for plain mix -> local `mixed_original` file
   (quality upgrade; may fail iOS decode) then local `mixed` file; for stems -> local stem file.
   Candidates are `file://` URIs from the registry.
4. Network: presigned URL from `PresignedUrlCache.resolve(nodeId)`.

`PresignedUrlCache` (keyed by fs node id, NEVER by URL):

- `resolve(nodeId)`: in-flight promise dedupe; 2 attempts of `GET /fs_nodes/:id/data_url`; stores
  `{ url, resolvedAt }`. Entries are reusable for at most 5 minutes (PREFETCHED_URL_TTL) and only
  for playback START; a stream error hard-invalidates the entry and the retry mints a fresh URL.
- `data_url` COUNTS against rate ceilings: playback uses this cache, images use
  `/fs_nodes/:id/data?token=` (exempt) instead. A 404 from either while we believe we are authed
  triggers a single-flight auth verification (section 5.4), not a "file missing" state.

### 3.5 Prefetch (FR-60) - `player/prefetch.ts`

On `status` when `duration - position <= 30`: skip when role controller, LoopMode.One, no upcoming
entry, upcoming is a jam song, or upcoming is in failedSongIds. Resolve the upcoming song's wanted
node (same mode rules) into a one-shot slot `{ songId, nodeId, url, resolvedAt }`. Consumed only if
songId AND nodeId match what the transition wants and age < 5 min; cleared on use (a stream error
re-resolving the same song must mint a genuinely fresh URL). One in-flight prefetch per song id.

### 3.6 Failure recovery ladder (FR-61) - `player/recovery.ts`

Stream error (player status error) funnel:

1. First failure for this songId: capture `position` as pendingSeek; invalidate cache for the node;
   fresh resolve (not prefetched); replace source; resume if `intendedPlay || playing`.
2. Second failure for the same songId: `markSongFailedAndAdvance`.
3. Resolve failure (both attempts): `markSongFailedAndAdvance` directly.

`markSongFailedAndAdvance`: add to session-scoped `failedSongIds`; toast "song unavailable" at most
every 3 s; advance +1 (wrap to 0 only under LoopMode.All); STOP the chain if the next entry is also
failed (no runaway skip through a dead queue). A song that later reaches `audiblePlaying` is removed
from the failed set. Local-file candidates that fail decode do NOT mark the song failed; they just
fall down the ladder (FLAC-on-iOS case).

### 3.7 Ended, loop, previous (FR-58)

`ended` (didJustFinish status): reset listen accumulator; LoopMode.One -> seek 0 + play (NEVER a
native loop flag: ended must keep firing for the end-of-song sleep timer and accumulator reset);
else `next("auto")`. `next`: index + 1; past end wraps under All else clamps; computed index equal
to current (single-song queue under All) restarts the source and plays. `previous`: position > 3 s
(or first entry under LoopMode.None) -> seek 0; else index - 1; below 0 wraps only under All;
single-entry wrap restarts. Default loop mode: All.

### 3.8 Lock screen + remote commands (FR-54/63) - `player/lockScreen.ts`

- `player.setActiveForLockScreen(true, metadata)` on EVERY song change, play state change and
  metadata patch. Android hard requirement: without it background audio dies after ~3 min.
- Metadata: title, artist = `formatArtistsFull(song)`, album, artwork URL = local artwork file when
  downloaded else `/fs_nodes/<artworkNode>/data?token=` (token in query; avatar-style public URLs
  need none). Fresh metadata object per song.
- Metadata follows the song the user is HEARING ABOUT: on a controller, the snapshot song; locally
  otherwise. The controller device also calls setActiveForLockScreen so its lock screen controls
  the remote device.
- Remote command events (play/pause/next/prev/seek, +10/-10 jumps) are registered ONCE and dispatch
  through `remote/transport.ts` (section 6.3): on a controller they become cable commands; else
  engine calls. Handlers read latest actions through a ref.
- Audio session: playback category, active in background (plugin `enableBackgroundPlayback` already
  on). Interruption (phone call) -> engine pauses and publishes truth; never auto-resume on Android.

### 3.9 Volume, rate, sleep, persistence (FR-64/65)

Volume 0..1 -> `player.volume`. Rate slider 0.5..1.5, `shouldCorrectPitch: false` (deliberate pitch
shift). Sleep: minutes -> engine setTimeout that pauses + clears; endOfSong -> one-shot flag consumed
on ended. Persisted (kv-store, debounced 250 ms): rate, volume, separationEnabled, playbackMode
(`custom` restores as `original`), vocalVolume, instrumentalVolume, EQ bands (NOT eqEnabled), loop
mode. The queue is NEVER persisted locally: the server snapshot is the account queue (section 6.4).

### 3.10 Play recording (FR-62) - `player/recording.ts`

Accumulate forward `status` deltas in (0, 2) s; at `min(30, duration/2)` accumulated, POST
`/play_events { song_id }` fire-and-forget. Reset on song change and natural ended (repeat plays
count again). Never for `jam_song` entries; a transfer-in seed marks the seeded song already
recorded (origin device counted it).

---

## 4. Offline / downloads architecture

### 4.1 SQLite schema (`offline/db.ts`, db file `oms-music-<userId>.db`)

```sql
CREATE TABLE songs (
  song_id     TEXT PRIMARY KEY,          -- String(song.id): ONE id representation at this boundary
  json        TEXT NOT NULL,             -- full Song payload, stored up-front
  stored_at   INTEGER NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched',  -- 'unfetched' | 'none' | 'cached' (tri-state FR-81)
  lyrics_json TEXT
);
CREATE TABLE downloads (
  song_id   TEXT NOT NULL,
  kind      TEXT NOT NULL,               -- 'mixed' | 'mixed_original' | 'artwork' | 'vocal' | 'instrumental'
  node_id   TEXT NOT NULL,               -- fs node the bytes came from (repair compares against song json)
  filename  TEXT NOT NULL,               -- "<songId>_<kind>.<realExt>" (m4a/mp3/flac/jpg per source)
  local_uri TEXT,                        -- file:// once done
  size_bytes INTEGER NOT NULL DEFAULT 0, -- backfilled from file stat on completion
  status    TEXT NOT NULL,               -- 'queued' | 'downloading' | 'done' | 'error'
  error     TEXT,
  savable   TEXT,                        -- serialized DownloadTask.savable() for cross-launch re-attach
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (song_id, kind)
);
CREATE TABLE offline_collections (
  key TEXT PRIMARY KEY,                  -- '<playlistId>' or 'album:<artistSlug>:<album>'
  enabled_at INTEGER NOT NULL
);
```

Settings live in `expo-sqlite/kv-store`. Files live under a per-user app-support directory excluded
from cloud backup. `registry.ts` derives at boot: `nodeId -> localUri`, `songId -> coarse status`,
`compressedNodeId -> originalLocalUri` (the quality-upgrade map), artwork map for the image resolver.

### 4.2 Download engine (FR-83/84/85)

`download(song, opts)` per-song bundle, exactly the Capacitor design: refuse jam songs; WiFi gate at
enqueue (refuse with "Sem WiFi - download adiado.", never silently queue; allow when the probe
fails); write song JSON to `songs` first; best-effort lyrics fetch into the tri-state; enqueue kinds
`mixed` (compressed || original node), `mixed_original` (only when original differs from compressed),
`artwork` (compressed-first), `vocal`/`instrumental` when includeStems and ids exist. Dedup: enqueue
no-ops when that (songId, kind) is `done` or `downloading`.

Transfer mechanics: JS scheduler, 3 concurrent, over `File.createDownloadTask` with
`sessionType: 'background'` on iOS. Download URL is `/fs_nodes/:id/data?token=<token>` (redirect
following, rate-limit exempt, and no Authorization header so the presigned hop never sees double
auth). URLs are built at DEQUEUE time, not enqueue time, so queued items never age. On task create,
persist `savable()` into the row; on boot, `DownloadTask.fromSavable()` re-attaches every row still
`queued`/`downloading`; anything unresumable is re-enqueued (idempotent). Progress events update the
registry and bump ONE coarse version counter (throttled ~4 Hz) that `statusContext.tsx` exposes;
list rows read `getStatus`/`getProgress` synchronously (FR-82/86). Completion stats the file for
size_bytes. Storage header = native directory walk.

### 4.3 Keep-synced collections + repair (FR-87/88/89)

- `toggleOfflineCollection(key, on, songs)`: on -> add key + sequential `download()` per song
  (dedup makes re-toggle resume); off -> remove key + `remove()` per song not required by another
  offline collection.
- `useOfflineCollectionSync(key, songs)`: on every collection refetch while the key is enabled,
  download any song not yet done (newly added songs sync automatically).
- `repair.ts`: on boot-while-online and on every NetInfo reconnect: `retryFailures()` (re-issue
  download for errored songs) then `verifyAndRepair()` (walk `songs`, re-enqueue any missing kind,
  including stems newly available and `lyrics_state = 'unfetched'`). Idempotent via dedup. This
  pass is also the safety net for background completions lost to process death.
- `maxStorageBytes` (FR-94, P2): enforced at enqueue when non-zero; no cap UI until enforced.

### 4.4 Offline browsing + playback (FR-90/91)

- Playback ladder is section 3.4 step 3: local original -> local compressed -> network; stems same.
- `offlineResolvers.ts`: when `isOfflineNow()` (NetInfo), library/albums/artists/songs query fns fall
  back to resolvers derived from `songs` rows, grouping albums by the same `albumKey`; `ArtworkImage`
  consults the artwork registry first; lyrics hook falls back to `lyrics_json`; doomed network calls
  are skipped.

---

## 5. Auth flow (native)

### 5.1 Login / signup / reset (FR-7/8/11)

- Login: `POST /sessions { email, password }` with header
  `User-Agent: OMSMusic/<version> (<model>; <os> <osVersion>)` so the session name is sane. Store
  `token` in SecureStore; hydrate `auth/store`; then `GET /sessions/mine` + `GET /users/:id`.
- Signup: `create_start` -> OTP screen (6 digits, 15 min TTL, 5 attempts, resend respects 4/min +
  20/h) -> `create_end` (does NOT log in) -> immediate `POST /sessions` with the same credentials.
- Reset: `reset_password_start` (always 200) -> code + new password -> `reset_password_end` -> login.
- OAuth (FR-12, P1): `expo-web-browser` auth session to `/auth/<provider>?mode=signin`, intercept
  the navigation to `omelhorsite.pt/account/oauth/callback`, extract `ticket`/`error`, POST
  `/sessions/adopt` within the 2 min TTL. Passkeys (FR-13) out of scope v1 (no associated domains).

### 5.2 Session persistence + boot

Boot sequence in `_layout.tsx`: read token (SecureStore, cached in memory afterwards); no token ->
`(auth)` group. Token present -> render `(app)` behind a splash while `GET /sessions/mine` verifies;
success -> `GET /users/:id`, connect cable, start download repair; 401 -> wipe + `(auth)`. The HTTP
client attaches `Authorization: Bearer <token>` on every JSON request and appends `?token=` on media
URLs; the cookie jar is disabled (no stale `oms_session` shadowing a rotated token).

### 5.3 Logout (FR-10)

`DELETE /sessions/current` (id ignored server-side, always kills the caller); wipe token, zustand
stores, query cache, cable connection, download scheduler regardless of the response. SQLite files
stay on disk namespaced by user id (re-login as the same user finds the library intact).

### 5.4 401 handling without hammering the anon bucket (FR-5)

Invalid-token requests fall into the ANON 120/min per-IP bucket; a retry loop can 429 the whole NAT.
Therefore:

- react-query defaults: `retry: false`, no refetch-on-focus, staleTime 25 s. Every authed query is
  `enabled: authReady && ...` where `authReady` comes from `auth/guard.ts`.
- On ANY 401 from an authed endpoint (or fs_nodes 404 while believed-authed): `guard.verify()` runs
  ONE single-flight `GET /sessions/mine`. Still 401 -> flip `authReady = false` FIRST (parks every
  query, stops the cable, pauses download enqueues, silences the publisher), then wipe and show
  login. Transient -> resume. No caller ever retries on its own.
- 429 anywhere: honor `retry_after` exactly (a helper parks the affected query key until the
  deadline); never a retry storm (each 429 pages the owner on Discord).

---

## 6. Realtime layer

### 6.1 Cable client (`remote/cable.ts`)

Hand-rolled minimal ActionCable v1 client (~200 lines) instead of the installed
`@kesha-antonov/react-native-action-cable`: we need byte-stable identifier strings (the server
echoes the exact string; key order matters), welcome-gating, and deterministic resubscription. The
dependency stays as an escape hatch.

- Connect `wss://backend.omelhorsite.pt/cable?token=<token>`; token in the QUERY ONLY, and no
  Authorization header on the handshake (first candidate wins; a stale header would beat the param).
- Lifecycle: wait for `welcome` before any subscribe; sends before welcome are dropped by the
  server, so the client queues nothing and simply resubscribes its subscription map on every
  welcome. Reconnect backoff 1 s doubling to 30 s cap, reset on welcome. `ping` frames refresh a
  liveness timer; a silent socket (no frame for ~6 s beyond ping cadence) is proactively cycled.
- Subscriptions are objects `{ identifier: string (stable JSON), onMessage, onConfirm, onReject }`.
  `reject_subscription` is the per-channel auth failure signal (anonymous connects succeed).
- App state: on foreground -> if connected, per-channel wake hooks fire (snapshot + heartbeat); if
  dropped, reconnect immediately (skip backoff). On background, the socket is left alone (iOS will
  freeze it; the reconnect path heals on wake). All timers owned here so wake behavior is centralized.

### 6.2 PlaybackChannel presence + role machine (`remote/playbackSync.ts`, FR-105..112)

- Subscribe with per-LAUNCH `device_id` (uuid, [A-Za-z0-9-]), `device_label` like "iPhone de X".
  Heartbeat every 20 s; on every foreground: `request_snapshot` + `heartbeat` (server TTL 75 s,
  active grace 15 s).
- Role derivation from snapshots: `offline | no_active | active | controller`; `activating` and
  `blocked` are sub-states of active. On becoming controller: force-pause the engine AND clear its
  source. Exactly one audible device, always.
- Claims: `steal` adopts optimistically (takeover must play NOW); `if_none` stays pessimistic until
  confirmed, `claim_rejected` demotes. `setQueue` on a non-active device = takeover (steal + local
  play), never a command.
- Controller mode: mirror the snapshot; SLIM `state_changed` (no `queue_songs`) merges with the last
  full list; 1 Hz tick interpolation via rAF-equivalent, ticks older than 5 s fall back to snapshot
  position; ticks whose `song_id` differs from the snapshot song are DROPPED (string compare via
  `domain/ids.ts`); all transport actions become validated `command` sends; volume drag =
  `set_volume` on the active device; rate/mode/EQ/sleep greyed out locally.
- Active mode publishing: debounced 200 ms `state_changed` with song ids AS STRINGS, `paused:
  !playing`, live position, full listener settings; `position_tick` at 1 Hz while playing; server
  `error` message -> `request_snapshot` resync, never blind retry; respect clamps (queue 1000, rate
  0.25..4, EQ +-12).
- Command router (incoming `command` where `target_device_id` is us): play/pause/toggle/next/
  previous/seek/set_queue_index/set_queue_order/set_shuffle/set_loop_mode/set_volume/
  add_to_queue/play_next (id-only: resolve queue -> query cache -> `GET /songs/:id`)/
  remove_from_queue/reorder_queue -> engine actions; plus server-built `jam_add_song` and `next`
  routed to `jam/hostDuties.ts`.
- Transfer IN (activation flow): adopt sanitized quartet + loop + listener settings (rate, mode, EQ,
  separation, stem volumes) but NEVER volume; plant activation seed `{songId, position, paused}`
  (valid 5 s) consumed by the transition effect; mark seed song play-recorded; if transferring
  playing audio, enter `activating` and suppress publishes until the first audible status
  force-publishes truth + tick. Native has no autoplay policy, so `blocked` should be unreachable
  locally, but the handler stays: audio-session acquisition failure maps to
  `activation_blocked {}` and the picker hint, matching the protocol.
- Reconnect steal (FR-112): if the cable dropped while WE were active (audio kept playing), and the
  reconnect snapshot shows `active == null || active == us`, perform `claim_active {steal}` and
  force-publish full state + a tick. A WS blip never pauses local audio.

### 6.3 Remote-aware transport (`remote/transport.ts`)

The one dispatch layer every UI surface and the lock screen uses: given the role, each action either
executes on the engine (active / no_active, where play triggers an `if_none` claim per FR-108) or
becomes a cable command (controller). This is what makes lock-screen next on a controller advance
the remote device (FR-63).

### 6.4 Cold-start hydration (FR-108)

Role `no_active` + non-empty server snapshot + empty local queue: adopt sanitized snapshot (jam
proposals dropped + remap; permutation validated; index clamped), adopt loop + listener settings
(never volume), plant a `paused: true` activation seed at the snapshot position, load src, stay
paused. Play from idle: claim `if_none` pessimistically; on `claim_rejected` demote and silence.
`playFromIdle` re-resolves the current song when the source was cleared by controller mode.

### 6.5 Jams (`jam/`, FR-113..118)

- Lifecycle: `GET /jams` on app start resumes `current`; create -> immediately `claim_active
  {steal}` (a host with no active device is a silent jam); join via REST BEFORE subscribing
  JamChannel (rejection = jam gone, clear state); host leaving ENDS the jam, no handoff.
- Follower: `followerPlayer.ts` owns a SECOND dedicated AudioPlayer fed by `JamState.song.audio_url`;
  the main engine stays untouched and silent. Track identity by song id, never URL (presigned
  strings are server-cached 5 h and rotate). New song -> set source + pendingSeek to state.position
  applied on metadata. `position_tick`: host paused -> hard pause; else drift > 2.5 s -> seek to
  tick position, below -> ride. Local pause allowed; resume extrapolates the last tick
  (`tick.position + (now - receivedAt)`). Local volume only. Starting real local playback
  auto-leaves (1.5 s join grace). JamBar replaces the mini player while following.
- Proposal interception: while following with `queue_mode == "everyone"`, the engine interceptor
  turns "play" on an own-library song into `POST /jams/:id/propose`; nothing plays locally.
- Host duties: execute server-injected `jam_add_song` (insert after current, behind earlier
  proposals, FIFO) and `next`; play proposals via their presigned `audio_url` with proposer
  attribution; NEVER record plays, persist, download, separate, or fs-resolve jam songs; drop them
  from every snapshot adoption and publish (the server strips foreign ids anyway).
- Skip votes: tally UI from `skip_votes`; reset the local tally silently whenever the state song id
  changes; UI per skip_mode (hidden for non-hosts in host mode).

### 6.6 FriendListeningChannel + JobChannel + notifications

Friends feed (FR-119): snapshot + full-row `listening_update` replace by `user.id`; sort live rows
first then `updated_at` desc; rosters are subscribe-time -> resubscribe on foreground. JobChannel:
lyrics sync jobs (`{channel:"JobChannel", id, token?}`) + 10 s REST poll fallback where 404 during
polling means keep waiting. NotificationsChannel: `jam_invite` rendered as a link into the jam panel.

---

## 7. Shared contracts

### 7.1 API client (`api/`)

`client.ts` exports `request<T>(method, path, { params, body, formData, raw })`:

- Bearer header always (7-char strip server-side: the `Bearer ` prefix is mandatory); meaningful
  User-Agent app-wide.
- `params.ts` bracket-encodes GET payloads (`search[title]=x`, `modifiers[page]=1:100`, arrays as
  `k[]=v`) and rewrites `null` -> `"\b"` in params AND JSON bodies (FormData and WebAuthn exempt).
- Errors: parse bare-string bodies defensively into `ApiError { status, message, retryAfter? }`;
  429 carries `retry_after`; 304 resolves with the cached body (we avoid sending validators
  ourselves; see risk R8).
- Explicit web-bug avoidance encoded in `endpoints/artists.ts`: PATCH sends FLAT top-level keys
  (never nested `{artist:{...}}`), banner upload uses multipart field `banner`.
- Media URL builders in `endpoints/fsNodes.ts`: `dataUrl(nodeId)` (JSON resolve, playback only) and
  `dataStream(nodeId)` = `/fs_nodes/:id/data?token=` (images + downloads, rate-limit exempt).
- Pagination helpers: `pagedList` (explicit `N:SIZE`, 500 cap, short page = end) and
  `cursorLiked(before)` for liked songs.

### 7.2 Domain types (`domain/`)

Single `types.ts` for every payload shape (Song with jam extras, Blueprinter inheritance rules
respected: views ADD fields). `ids.ts` is the ONLY place string/number conversion happens: REST ids
are numbers (songs/artists/playlists/jams) or strings (users/sessions/fs_nodes); the cable speaks
strings for song ids and queue entries; sqlite stores TEXT. Helpers `formatArtists` (primaries
joined ", " + "(feat. X)"), `formatArtistsFull` (adds "(with D)", used by lock screen), artwork
fallback chains ending at the ONE shared placeholder photo (never letter tiles; initials avatar only
for pictureless artists in card grids).

### 7.3 Theme tokens (`theme/`)

`tokens.ts`: both shadcn HSL palettes (light `:root` + dark) converted to hex constants; monochrome
`primary`; music section accent `#4B1E6D`; liked purple gradient (violet-700 -> purple-700 ->
indigo-900, bleed `#7e22ce`); per-kind mix gradients (server `gradient` ignored); emerald for
Spotify/remote strip. `accent.ts`: average artwork color, saturate +20, brighten +50/-50 per theme,
BOTH variants cached per song id (LRU 100), stale-async guard, fallback `#FF5555`; hero variant
(sat -10, bright -60 dark / +40 light, fallback `#222222`). `provider.tsx`: light/dark/system with
persisted choice; gradient consumers re-style on theme flip without re-downloading bytes.

### 7.4 i18n (`i18n/`)

en (default), pt (PT-PT ONLY), lv; catalogs ported from the web as-is under `components.music.*`
(plus the app/auth keys we need). ICU interpolation via `use-intl` (the platform-agnostic core of
next-intl: same message syntax as the source catalogs; dependency requires user approval before
install). Mix titles render `t("components.music.mixLabels.title." + title_key, title_params)`,
NEVER the English fallback string; radios render their pre-baked Portuguese strings as-is. Locale
persisted in kv-store; device locale is the initial guess; time zone Europe/Lisbon for date labels.

---

## 8. Vocal separation playback modes, natively

- **v1 ships:** `original`, `instrumental`, `vocals` (FR-68) and the full separation lifecycle
  (FR-71). Instrumental/vocals are trivially "play a different file": the mode picks the stem fs
  node in the resolver (section 3.4), falling back to the plain mix when stem ids are missing. Mode
  switches capture position + play state, swap the source with pendingSeek, and resume: continuity
  guaranteed by the same transition machinery. Stems download alongside (includeStems), so offline
  mode switching works. Separation trigger is explicit (`POST /songs/:id/separate`); one shared 3 s
  react-query poll per song id of `GET /songs/:id/separation` that parks on "no job, no stems" and
  stops on ready/terminal; status projection idle/pending/processing/ready/failed with an elapsed
  m:ss counter; on ready, `patchQueueSong` injects the stem ids in place (cause "patch": never
  restarts the playing track; stale-queue reconciliation swaps to the stem file when mode wants it).
  `complete|failed` are the only terminal statuses (no "canceled"). Disabled for jam songs and on
  controllers.
- **v1 does NOT ship custom blend or EQ** (FR-69/70, both P2). expo-audio has no multi-source
  sample-synced mixing and no EQ, and a two-AudioPlayer JS blend cannot hold sample sync (clock
  drift between independent AVPlayers/ExoPlayers is audible as chorus/flange). Mechanism when it
  ships: a small custom Expo native module (`modules/expo-stem-mixer`) built on AVAudioEngine (two
  AVAudioPlayerNodes + per-node gain + 3-band biquad EQ, iOS) and Oboe or ExoPlayer
  audio-processor chain (Android), fed by the two downloaded/streamed stem files, scheduled on one
  hardware clock. This mirrors the web's AudioGraph and the earlier AVAudioEngine plan from the
  Capacitor attempt. The web's gesture/background restrictions do NOT apply natively, so `custom`
  may simply persist across songs once it exists (still never restored on relaunch, matching FR-65).
- **Wire compatibility now:** `playback_mode: "custom"` in adopted snapshots plays the plain mix
  locally (exactly the web's stems-missing fallback) while the cog shows "custom blend not available
  on this device"; publishes pass through the persisted `vocal_volume`, `instrumental_volume`,
  `eq_*` values untouched so other devices keep their settings; the mode wire value stays `custom`
  when adopted, we do not rewrite it.

---

## 9. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | expo-audio lock-screen/remote-command fidelity (Android 3-min background kill without setActiveForLockScreen; seek/jump command coverage; artwork loading with token URLs) | WP0 spike in the first dev build: scripted checklist (backgrounded 10 min playback both platforms, all lock-screen buttons, artwork). Escape hatch documented: @rntp/player v5 (paid license) behind the engine interface; the engine API is player-implementation-agnostic on purpose. |
| R2 | Rapid-skip races and stale presigned URLs corrupting playback | Generation token + loadingSongId + one-shot prefetch + requestedNodeId, all centralized in engine.ts; property tests on queue.ts; a soak test script that skips every 300 ms for 5 min. |
| R3 | iOS background downloads not surviving process termination (expo-file-system continues while suspended, not across kill) | Savables persisted per row + boot re-attach + verify-and-repair as the guaranteed healer (the Capacitor design's proven fallback). If unacceptable in practice, add @kesha-antonov/react-native-background-downloader (user approval required). |
| R4 | Stale-token retry loops burning the anon 120/min IP bucket (429s page the owner) | Single-flight guard.verify(), global authReady gate parks queries/cable/downloads before wiping; retry off globally; retry_after honored via query parking. |
| R5 | String-vs-number id drift (cable strings, REST numbers, sqlite TEXT) silently breaking tick matching, like-state, dedup | domain/ids.ts is the only conversion point; lint rule banning String(id)/Number(id) outside it; unit tests on tick song-match and snapshot adoption. |
| R6 | Cable reconnect edge cases (steal-on-reconnect vs a rival claim, slim merges after resubscribe, foreground wake with frozen timers) | All timers owned by cable.ts; wake hook = request_snapshot + heartbeat; reconnect steal only when snapshot shows nobody claimed; slim merge keeps last full queue_songs per identifier; scripted two-device test matrix in WP7. |
| R7 | Jam follower drift/UX (5 s stale snapshot position, tick extrapolation on resume, auto-leave grace) | Constants from the web (2.5 s MAX_DRIFT, 1.5 s join grace) kept verbatim; follower player isolated from the engine so bugs cannot leak into personal playback. |
| R8 | RN fetch conditional-request behavior (304 with empty body breaking list parsing) | client.ts strips validators by default (cache: no-store); if the native stack still surfaces 304, treat as "use previous data" via react-query structural sharing; verify in WP1 against /songs. |
| R9 | Library artwork request storms (500-row lists) hitting rate ceilings | Images use the rate-exempt /data?token= route; windowed lists (40 + incremental); expo-image disk cache keyed by node id URL stability. |
| R10 | Custom blend/EQ expectations from web users | Explicit cog messaging in v1; wire passthrough keeps other devices intact; native mixer module scheduled as WP11 with a defined seam (modes.ts). |

---

## 10. Cross-cutting behaviors worth pinning (quick reference)

- Lyrics: `GET /lyrics?song_id=` (200 with nulls = none; skeleton on slow first fetch; ~24 h client
  cache); LRC parser rules exactly (multi-timestamp fan-out, metadata/untimed skipped, empty timed
  lines = placeholder dot, sorted); frame-driven active line with index-change-only state updates;
  manual scroll suppresses follow 4 s; tap-to-seek; translation staleTime infinity + never auto-retry
  429/404; offline tri-state.
- Search: debounce 220 ms, 4 parallel `1:20` queries, MANDATORY client re-rank (backend LIKE returns
  alphabetical), top 3 per kind; recents max 6.
- Liked: `/liked_songs/ids` as the optimistic heart source of truth; unlike keyed by SONG id.
- Playlists: system (`source_kind != "manual"`) fully read-only including rename; reorder only when
  all pages loaded, sends the COMPLETE song-id array; membership pre-check before add.
- Home/queue rails: hidden-when-empty rules per FR-24..29; mini player padding so bars never cover
  list tails.
- Recent-services ping `POST /service_usages {service_id:"music"}` fire-and-forget on entry.

---

## 11. Work packages (dependency order, explicit file ownership)

Ownership is by directory; `[contract]` modules freeze after their WP lands. A WP may add files only
inside its owned paths. Order: WP0 -> WP1 -> (WP2, WP3) -> (WP4, WP5, WP6, WP7) -> (WP8, WP9, WP10)
-> (WP11, WP12). Parallel groups share no files.

- **WP0 - Player spike + risk burn-down.** Owns: `scratch/spike/` only (throwaway). Prove on dev
  builds: background playback 10+ min both platforms, setActiveForLockScreen metadata + artwork +
  every remote command, playbackStatusUpdate cadence, replace() behavior, rate without pitch
  correction, two simultaneous AudioPlayers (jam follower), FLAC local decode failure mode. Output:
  a findings note updating engine assumptions. Blocks WP3 sign-off, runs alongside WP1.
- **WP1 - Foundations.** Owns: `src/api/**`, `src/domain/**`, `src/i18n/**`, `src/theme/**`,
  `src/deepLinks/parse.ts`. HTTP client (sentinel, brackets, errors, 429/304), endpoints, query
  keys + client, domain types + ids + artist/artwork helpers, catalogs ported, theme tokens +
  accent extraction, deep link parser. FRs 1-6, 18-21 groundwork.
- **WP2 - Auth + shell.** Owns: `src/auth/**`, `src/app/**` (route files + layouts), `src/features/settings/app/**`,
  removal of template `src/components`/`src/constants`. Login/signup OTP/reset/OAuth, session boot,
  guard/authReady, logout, tab shell, modals wiring, theme/language settings screen. FRs 7-17
  (minus 13), 22.
- **WP3 - Player core.** Owns: `src/player/**`. Queue quartet + property tests, engine +
  transitions + gen tokens, resolver + presigned cache, prefetch, recovery ladder, recording, lock
  screen, volume/rate/sleep, persistence, store, seams in types.ts. FRs 54-67 (modes stubbed to
  original). The seam file `player/types.ts` freezes at the end of this WP.
- **WP4 - Browse screens + shared UI.** Owns: `src/ui/**` (except songMenu), `src/features/{home,search,library,liked,playlists,playlist,artistsHub,artist,album}/**`.
  Hero/ActionBar/SongTable/Tile/MiniPlayer visuals, all P0 browse screens, search rank, liked
  cursor paging, playlist CRUD/reorder/artwork. FRs 23-53.
- **WP5 - Now Playing, queue UI, lyrics, song menu.** Owns: `src/features/{nowPlaying,queuePanel,lyricsView}/**`,
  `src/ui/songMenu/**`, `src/lyrics/**`. Now Playing pager, queue screen + drag reorder, LRC
  parse/synced render/tap-seek/translation/sync job, canonical song actions. FRs 72-81, 125.
- **WP6 - Offline + downloads.** Owns: `src/offline/**`, `src/features/downloads/**`,
  `src/features/settings/downloads/**`. Sqlite schema, engine + savables, registries, status
  context, keep-synced collections, repair, wifi gate, offline resolvers, downloads screen +
  settings. Plugs into `player/types.ts` sourceHook. FRs 82-94.
- **WP7 - Cable + remote playback.** Owns: `src/remote/**`, `src/features/devices/**`,
  `src/ui/DevicePicker.tsx` (new file), controller strip component. Cable client, role machine,
  publisher/ticks/heartbeats, command router, hydration, transfer/takeover/steal, device picker.
  FRs 105-112, 63 routing. Consumes engine events + actions only.
- **WP8 - Jams + social.** Owns: `src/jam/**`, `src/social/**`, `src/features/{jamView,profile}/**`,
  JamBar + friends strip components inside those folders. Jam lifecycle, follower player, host
  duties, propose/skip/invites, friends feed, music profile. FRs 113-120, 29.
- **WP9 - Mixes, radios, imports, management.** Owns: `src/features/{mix,radio}/**`,
  `src/features/settings/{import,songs,artists,hub}/**`. Mix/radio screens + entry points, external
  search + import flows, Spotify sync, artist import, songs/artists management (flat PATCH, banner
  field). FRs 33 (external part), 34, 95-104, 121-123.
- **WP10 - Separation + playback modes.** Owns: `src/player/modes.ts`, `src/features/separation/**`
  (cog sections, status UI). Mode switching, separation lifecycle polling, patch-in-place, stems in
  the resolver + downloads glue (via existing seams). FRs 68, 71; custom/EQ wire passthrough.
- **WP11 - Stem mixer native module (P2, post-v1).** Owns: `modules/expo-stem-mixer/**`,
  `src/player/mixerBridge.ts`. AVAudioEngine/Oboe dual-stem mixer + 3-band EQ; custom blend UI
  enable. FRs 69, 70.
- **WP12 - Polish.** Owns: `src/features/{misc polish}`, remaining P2s: sticky titles, playing bars
  placement, deep-link song highlight, devices screen, storage cap enforcement, metadata modifier,
  recent-services ping if not landed. FRs 44, 67, 94, 124, 126, 14.

Definition of done for every WP touching playback: the two-device matrix (active/controller swap,
transfer mid-song, reconnect blip, rapid skip soak, jam host + follower) passes on iOS and Android
dev builds.
