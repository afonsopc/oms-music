# oms-music native rebuild - shipping architecture (pragmatic lens)

Target: Expo SDK 57 app at /Users/afonsocoutinho/Documents/oms-music, full 126-FR parity against the unchanged production backend. This doc optimizes for one thing: 8-12 agents building in parallel without merge conflicts, with the minimal set of contracts frozen up front, and honest scoping of the three risky subsystems (remote playback, blend/EQ, background downloads).

Reading order for implementers: this doc, then SPEC.md for your FRs, then API.md for wire shapes, then your topic doc.

Conventions that bind every package:
- TypeScript strict. No em-dash character anywhere (code, strings, docs). Portuguese is PT-PT only.
- Song ids are `number` in REST, `string` on the cable and in SQLite. The branded types in `src/types/ids.ts` and the converters in `src/lib/ids.ts` are the only legal crossing points.
- Nobody edits files outside their package's ownership list (section 10). Contract changes go through the WP0 owner as an explicit PR-style change, never as a drive-by edit.

---

## 1. Directory layout under src/

The existing template files (`src/app/index.tsx`, `explore.tsx`, `src/components/*`, `src/hooks/*`, `src/constants/theme.ts`) get deleted or absorbed by WP3/WP0. Layout:

```
src/
  app/                      # expo-router route files. THIN: parse params, render a
                            # screen imported from src/features. Owned ONLY by WP3.
                            # Full tree in section 2.

  types/                    # WP0. Frozen domain types. Zero imports from elsewhere.
    ids.ts                  # SongId (number, REST), SongKey (string, storage/cable), FsNodeId, ...
    song.ts                 # Song, SongArtistEntry, SnapshotSong
    playlist.ts             # Playlist, PlaylistSong
    artist.ts               # Artist, ArtistOverview
    user.ts                 # User, Session, Relationship
    playback.ts             # QueueState quartet, LoopMode, PlaybackMode, PlaybackSnapshot,
                            # PlaybackDevice, cable message payload types
    jam.ts                  # Jam, JamState, jam channel payloads
    social.ts               # FriendListening, MusicProfile
    mixes.ts                # MixSummary, Radio
    lyrics.ts               # Lyrics, LrcLine, translation types
    imports.ts              # SongImport, ArtistImport, SpotifySync, DownloaderPreview
    downloads.ts            # DownloadKind, SongDownloadStatus, StoredDownload, DownloadSettings
    api.ts                  # ApiError, ListFilters, Page helpers

  contracts/                # WP0. Registration seams that decouple packages.
    localSource.ts          # LocalFileIndex: (songKey, kind) -> file uri | null.
                            #   Default impl returns null; WP8 registers the real one.
    offlineFallback.ts      # withOfflineFallback(primary, fallbackKey) + resolver registry.
                            #   WP1 wraps queries with it; WP8 registers resolvers.
    transport.ts            # TransportActions interface + provider. Default = local player
                            #   actions; WP9 swaps in the remote-aware decorator.
    playbackInterceptor.ts  # setPlaybackInterceptor seam (WP10 jam follower claims plays).
    songMenu.ts             # SongMenuItem model + context so every surface renders the
                            #   canonical menu (FR-74) from one registry.

  api/
    client.ts               # WP0. fetch wrapper: base URL, Bearer header, bracket
                            # encoding, null sentinel "\b" rewrite (FormData/WebAuthn
                            # exempt), bare-string error parsing, 401 single-flight
                            # hook, 429 retry_after surface, authed gate.
    queryClient.ts          # WP0. The one QueryClient + onlineManager/focusManager wiring.
    queryKeys.ts            # WP0. Every query key in the app, one namespace per resource.
    mediaUrl.ts             # WP0. imageUrl(nodeId) = /fs_nodes/:id/data?token=..., avatarUrl(userId).
    endpoints/              # WP1. One module per resource: songs.ts, playlists.ts,
                            # playlistSongs.ts, likedSongs.ts, playEvents.ts, artists.ts,
                            # sessions.ts, users.ts, lyrics.ts, mixes.ts, radios.ts,
                            # imports.ts, spotify.ts, artistImports.ts, jams.ts,
                            # fsNodes.ts, separation.ts, jobs.ts, relationships.ts
    queries/                # WP1. react-query hooks per resource, mirrored file names.

  auth/                     # WP3. Session zustand store, SecureStore token, bootstrap,
    session.ts              # single-flight authLost, logout, user-agent builder.
    oauth.ts                # ticket adoption; see section 5.

  player/                   # WP2. The engine. Non-React singleton + zustand mirror.
    queueOps.ts             # PURE functions over QueueState (property-testable, no IO)
    store.ts                # zustand: quartet, position, playing, buffering, modes, settings
    service.ts              # owns the expo-audio player; transitions, generation tokens
    urlResolver.ts          # presigned cache by fs node id + prefetch one-shots
    sourceResolver.ts       # local-first candidate ladder (uses contracts/localSource)
    recovery.ts             # failure ladder + failedSongIds set
    lockScreen.ts           # setActiveForLockScreen metadata + remote command routing
    playRecorder.ts         # forward-delta accumulator -> POST /play_events
    sleepTimer.ts
    settings.ts             # persisted listener settings (kv-store)
    accent.ts               # artwork average color, dual theme variants, LRU 100

  downloads/                # WP8. Engine + storage.
    db.ts                   # expo-sqlite schema + migrations (section 4)
    manager.ts              # queue, enqueue/dedupe, wifi gate, remove, storageUsage
    tasks.ts                # createDownloadTask lifecycle, savable persistence, re-attach
    status.ts               # in-memory status map + coarse version counter (FR-82 contract)
    repair.ts               # verify-and-repair + retryFailures + reconnect/boot triggers
    collections.ts          # offline collection set + keep-synced hook
    offlineLibrary.ts       # album/artist/song resolvers from dl_songs (registers into
                            # contracts/offlineFallback), offline image + lyrics resolvers

  cable/                    # WP9. CableClient interface + impl wrapping
    client.ts               # @kesha-antonov/react-native-action-cable (hand-rolled
    types.ts                # fallback lives behind the same interface)

  remote/                   # WP9. PlaybackChannel: presence, roles, snapshots.
    store.ts                # role machine, devices, lastFullQueueSongs, ticks
    channel.ts              # subscribe/heartbeat/foreground resync
    publisher.ts            # active-device state_changed (200ms debounce) + 1Hz ticks
    adoption.ts             # snapshot sanitise, hydration, activation seed, takeover
    actions.ts              # TransportActions decorator: command vs local

  jam/                      # WP10. JamProvider state, JamChannel handler,
    store.ts                # follower player (own AudioPlayer), host duties,
    channel.ts              # propose/skip-vote logic
    followerPlayer.ts
    hostDuties.ts

  social/                   # WP10. FriendListeningChannel store + hooks.
    listeningStore.ts

  separation/               # WP11. Poll service (3s shared), trigger/delete,
    service.ts              # status projection, patchQueueSong wiring

  i18n/                     # WP0 plumbing; catalogs ported from the web repo.
    index.ts                # t(), useT(), locale store (en default, pt = PT-PT, lv)
    icu.ts                  # {param} interpolation (ICU-lite)
    catalogs/en.json  pt.json  lv.json
    mixLabels.ts            # title_key/description_key rendering helper

  theme/                    # WP0.
    tokens.ts               # light + dark palettes (ported HSL sets), radius, spacing
    useTheme.ts             # light/dark/system store + hook
    gradients.ts            # mix kind gradients, liked purple, accent mixing rules

  lib/                      # WP0. Pure helpers, all unit-testable in node/bun.
    ids.ts                  # toSongKey(n): string, toSongId(s): number, normalize helpers
    format.ts               # duration mm:ss, tabular time, artist display joins
    rank.ts                 # rankByMatch reimplementation
    lrc.ts                  # LRC parser (FR-76 rules)
    listFilters.ts          # bracket-encoding builder for the list DSL
    deepLinks.ts            # web URL -> native route parser (FR-20)
    uuid.ts                 # per-launch device id generator [A-Za-z0-9-]{8,64}

  ui/                       # WP4. Shared visual kit, no data fetching inside.
    ArtworkImage.tsx        # expo-image + shared placeholder photo fallback + offline resolver
    Tile.tsx  SongRow.tsx  SongTable.tsx  Hero.tsx  ActionBar.tsx  StickyTitle.tsx
    FilterPills.tsx  Rail.tsx  PlayingBars.tsx  LikedArtwork.tsx  InitialsAvatar.tsx
    SongMenu.tsx            # renders contracts/songMenu items (one canonical menu)
    sheets/  buttons/  skeletons/

  features/                 # Screen bodies. One folder = one owner.
    auth/                   # WP3: Login, Signup(+OTP step), Reset
    shell/                  # WP3: tab bar, MiniPlayer pill, controller strip, JamBar slot
    home/                   # WP6
    search/                 # WP6
    library/                # WP6
    liked/                  # WP6
    playlists/              # WP7 (list + detail + dialogs)
    artists/                # WP7 (hub, roster, artist screen)
    album/                  # WP7
    mixes/                  # WP7
    radios/                 # WP7
    player/                 # WP5: NowPlaying, Queue screen, cog (rate/sleep/modes)
    lyrics/                 # WP5: synced view, translation, sync generation UI
    downloads/              # WP8: Downloads screen + download settings screen
    devices/                # WP9: DevicePicker sheet, Devices screen (P2)
    jam/                    # WP10: Jam panel/screen, invite flow
    profile/                # WP10: music profile + friends panel
    settings/               # WP11: hub, songs mgmt, artists mgmt, playback settings
    import/                 # WP11: file upload, URL import, Spotify sync, artist import
```

Rule that makes parallelism work: `src/app` route files are written once by WP3 and import screens by convention (`features/<domain>/<Screen>.tsx` default exports). A feature agent never edits `src/app`; WP3 creates every route up front pointing at a placeholder that renders "not built yet", so later work is purely inside `features/<domain>`.

---

## 2. Navigation tree (expo-router, all 28 screens)

Root `_layout.tsx` (WP3): providers in order QueryClientProvider > ThemeProvider > I18nProvider > SessionGate > CableProvider (no-op until WP9) > PlayerBootstrap > gesture root. SessionGate switches between the `(auth)` and `(main)` groups on session status.

```
src/app/
  _layout.tsx
  (auth)/
    login.tsx                        # 1  Login (email+password, OAuth buttons P1)
    signup.tsx                       # 2  Signup (email/name/password -> OTP step inline)
    reset.tsx                        # 3  Password reset (start + end steps)
  (main)/
    _layout.tsx                      # tabs + MiniPlayer overlay + controller strip/JamBar
    (tabs)/
      home/index.tsx                 # 4  Home (Discover)
      search/index.tsx               # 5  Search (suggestions + full results, one screen)
      library/
        index.tsx                    # 6  Library (pills: playlists/artists/albums)
        liked.tsx                    # 7  Liked songs
        playlists.tsx                # 8  Playlists list (+create dialog)
        playlist/[id].tsx            # 9  Playlist detail
        artists.tsx                  # 10 Artists hub (overview + roster)
        artist/[artist].tsx          # 11 Artist screen (slug or encoded name)
        album/[artist]/[album].tsx   # 12 Album ("null" segment = unknown album)
        mix/[slug].tsx               # 13 Mix detail
        radio/artist/[slug].tsx      # 14 Artist radio
        radio/song/[id].tsx          # 15 Song radio
      downloads/index.tsx            # 16 Downloads screen
    player.tsx                       # 17 Now Playing (full-screen modal; pager hosts 18/19)
    queue.tsx                        # 18 Queue (page of the Now Playing pager, also routable)
    lyrics.tsx                       # 19 Lyrics (same pager; friends tab P1 lives here too)
    jam.tsx                          # 20 Jam panel (members, rules, votes, invites)
    profile/[handle].tsx             # 21 Music profile
    settings/
      index.tsx                      # 22 Settings hub (+theme/language app prefs)
      import.tsx                     # 23 Import (tabs: files, URL, Spotify, artist)
      songs.tsx                      # 24 Songs management
      artists.tsx                    # 25 Artists management
      playback.tsx                   # 26 Playback settings (share_listening)
      downloads.tsx                  # 27 Download settings (wifiOnly, stems, only-downloaded)
      devices.tsx                    # 28 Devices (P2: list + rename current)
```

Non-screen surfaces: DevicePicker and SongMenu are bottom sheets (components, not routes); signup OTP is a step inside screen 2; the friends listening strip is embedded in Home.

Deep links (FR-20): `lib/deepLinks.ts` maps `https://omelhorsite.pt/{locale}/music/...` (both `/artist/x/y` and `/album/x/y` album forms, `?id=`/`?slug=` detail routes, literal `"null"` album) onto this tree. Registered in app.json `intentFilters`/`associatedDomains` are NOT available yet; v1 handles links via `Linking.getInitialURL` for the custom scheme and defers universal links (same blocker as passkeys).

Album/artist routes pass the context artist via params so FR-43 client-side narrowing works. Every list screen adds bottom padding for the MiniPlayer (FR-16).

---

## 3. Player service (WP2)

The most load-bearing package. Design goals: every queue rule from FR-57..61 lives in pure functions; the expo-audio surface is quarantined in `service.ts` so everything else tests without a device.

### 3.1 Structure

- `queueOps.ts`: `setQueue`, `setQueueIndex`, `setShuffle`, `addToQueue`, `playNext`, `reorderQueue`, `removeFromQueue`, `sanitizeSnapshot` (drop jam proposals, remap order, validate permutation, clamp index), `nextIndex`, `previousIndex`. All `(QueueState, args) -> QueueState`, no IO. Property tests: order is always a permutation, index always valid, remove refuses current row, reorder cursor fixups.
- `store.ts` (zustand): `{ queue quartet, currentSong, position, duration, playing, buffering, loopMode, rate, volume, playbackMode, separationEnabled, stemVolumes, eqBands, sleepTimer, failedSongIds }` plus actions that delegate to the service. Split selectors so transport buttons do not re-render on position ticks; position updates at 4 Hz max.
- `service.ts`: singleton created at app boot (not in React). Owns exactly one `createAudioPlayer()` instance for the life of the app, swaps sources per track. Subscribes to `playbackStatusUpdate`; on `didJustFinish` runs the ended handler (repeat-one seek-to-0-and-play, else next). DAY-1 SPIKE: verify the exact expo-audio event names and that lock-screen remote commands (play/pause/next/prev/seek) are surfaced as JS events; this is the highest-priority unknown in the whole plan (see risks).

### 3.2 Presigned URL cache (`urlResolver.ts`)

```ts
resolve(nodeId: FsNodeId, opts?: { fresh?: boolean }): Promise<string>
```
- Cache `Map<FsNodeId, { url, resolvedAt }>`, TTL 5h (under the 6h presign), in-flight promise dedupe, 2 attempts total. `fresh: true` bypasses cache (error recovery path). Cache is keyed by node id, NEVER by URL.
- Prefetch slot: `{ songKey, nodeId, url, resolvedAt }`, honored only on songKey+nodeId match, younger than 5 min, consumed one-shot. Triggered from status updates when `duration - position <= 30` and not (controller role, LoopOne, next is jam song, next in failedSongIds).

### 3.3 Source resolution (`sourceResolver.ts`)

Per song + mode, produce an ordered candidate list; try each until the player accepts:

1. Jam `audio_url` (plays directly, no resolve).
2. Stem file for instrumental/vocals mode (local stem file first, then presigned stem node), falling back to the plain mix when stem ids are null.
3. Local ORIGINAL file (`LocalFileIndex.get(songKey, "mixed_original")`).
4. Local compressed file (`"mixed"`).
5. Network: `resolve(compressed_audio_fs_node_id || audio_fs_node_id)`.

Local candidates that the OS decoder rejects (load error within ~1s of source set with zero progress) fall through to the next candidate silently (FR-90). The LocalFileIndex comes from `contracts/localSource.ts`; until WP8 lands it returns null and everything streams.

### 3.4 Transitions and generation tokens

- `transitionGen` counter + `loadingSongId`: every transition bumps the generation; async continuations (resolve completion, delayed play) compare and bail. A late data_url answer for a skipped song is dropped.
- `pendingSeek` applied on the first status update that reports a real duration (metadata loaded), then cleared.
- Transition causes decide autoplay exactly per FR-59's table: user action plays; cold hydration loads paused + seeks; transfer honors the remote paused flag; same-song patches (`patchQueueSong` after separation) never reload because the effect keys on song id + wanted node id (`requestedNode` ref), not object identity.

### 3.5 Error recovery ladder (`recovery.ts`)

1. Stream/load error, first strike for this songKey: capture position as pendingSeek, `resolve(nodeId, { fresh: true })`, reload, resume if intended-playing.
2. Second strike: add to `failedSongIds`, throttled toast (3s), advance (+1, wrap only under LoopAll). If the NEXT entry is also failed, stop the chain.
3. A song that later plays audibly is removed from the failed set.
4. URL resolve failure (both attempts) = strike 2 directly.

### 3.6 Repeat/transport semantics

- Loop none/one/all, default all. Repeat-one implemented ONLY in the ended handler (never a native loop flag) so the accumulator resets and end-of-song sleep timers fire.
- previous(): position > 3s = restart, else index-1 with wrap only under All; single-entry wrap restarts.
- next(): +1, wrap under All, single-entry restart-and-play.

### 3.7 Lock screen (`lockScreen.ts`)

- On every current-song change: `player.setActiveForLockScreen(true, { title, artist: formatArtistsFull(song), album, artworkUrl })`. Artwork prefers the local downloaded artwork file, else `/fs_nodes/:id/data?token=`. MANDATORY on Android (background dies at ~3 min otherwise).
- Remote command events route through `contracts/transport.ts` TransportActions, so once WP9 lands, a controller's lock screen next() sends a cable command instead of touching the silent local player. Seek fwd/back are +10/-10.
- Metadata follows the song the user is hearing about: snapshot song when controller, local song otherwise.

### 3.8 Play recording, sleep, rate, persistence

- `playRecorder.ts`: accumulate forward status deltas in (0,2)s; fire `POST /play_events` at `min(30, duration/2)`; reset on song change and natural end; never jam songs or transferred-in seeds; fire-and-forget.
- Sleep timer: minutes via setTimeout or endOfSong via one-shot ended hook; not persisted.
- Persisted (kv-store, debounced): rate, volume, separationEnabled, playbackMode (custom restores as original), stem volumes, EQ bands (not eqEnabled), loopMode. The QUEUE is never persisted locally; hydration comes from the server snapshot (WP9) or empty.

---

## 4. Downloads and offline (WP8)

Smallest honest version: expo-file-system download tasks with persisted savables + a verify-and-repair pass that is the single self-healing mechanism. No extra native downloader dependency in v1 (would need install approval anyway). iOS uses `sessionType: 'background'` (survives suspension, not termination); Android downloads run while the app lives. Termination on either platform is healed by repair-on-next-launch, which the old Capacitor design already proved is the part that actually matters.

### 4.1 SQLite schema (`downloads/db.ts`, database `oms-music.db`)

```sql
CREATE TABLE dl_songs (
  song_key    TEXT PRIMARY KEY,          -- String(song.id), the ONE storage representation
  song_json   TEXT NOT NULL,             -- full Song payload, stored before any bytes
  stored_at   INTEGER NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched'
              CHECK (lyrics_state IN ('unfetched','none','cached')),  -- FR-81 tri-state
  lyrics_json TEXT
);
CREATE TABLE dl_files (
  song_key    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN
              ('mixed','mixed_original','artwork','vocal','instrumental')),
  status      TEXT NOT NULL CHECK (status IN ('queued','downloading','done','error')),
  progress    REAL NOT NULL DEFAULT 0,
  local_path  TEXT,                      -- absolute path incl. real extension
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (song_key, kind)
);
CREATE TABLE dl_tasks (                  -- persisted task map: heals process death
  task_key    TEXT PRIMARY KEY,          -- "<song_key>::<kind>"
  savable     TEXT NOT NULL,             -- DownloadTask.savable() JSON
  source_url  TEXT NOT NULL,             -- the /fs_nodes/:id/data?token= URL
  created_at  INTEGER NOT NULL
);
CREATE TABLE offline_collections (
  key         TEXT PRIMARY KEY,          -- "<playlistId>" or "album:<artistSlug>:<album>"
  added_at    INTEGER NOT NULL
);
```

Settings (wifiOnly=false, includeStems=true, showOnlyDownloaded=false, ownerUserId) live in `expo-sqlite/kv-store`. `maxStorageBytes` (FR-94, P2) is only surfaced if enforced; v1 does not.

### 4.2 Download queue (`manager.ts` + `tasks.ts`)

- `download(song, opts)`: refuse jam songs; wifi gate AT ENQUEUE (netinfo probe; refuse with clear PT-PT message, allow if probe fails); write `dl_songs` row immediately (so the Downloads screen renders pre-bytes); best-effort lyrics fetch into the row; enqueue kinds: `mixed` (compressed || original node), `mixed_original` (only when ids differ), `artwork` (compressed-first), `vocal`/`instrumental` when includeStems and ids exist.
- Source URL: `/fs_nodes/:id/data?token=<token>` with NO Authorization header (redirect-following; presigned S3 rejects double auth). This URL never expires, unlike a presigned URL, so paused/resumed background tasks re-follow a fresh redirect.
- Concurrency 3. `enqueueOne` dedupes on existing done/downloading status (idempotency is what makes repair and keep-synced trivial).
- Files: `<documentDir>/downloads/<song_key>_<kind>.<ext>` with real extensions (m4a, mp3, jpg, and the original's own extension); directory excluded from backup.
- Every enqueue persists the task savable in `dl_tasks`; on boot, `DownloadTask.fromSavable()` re-attaches; unresumable savables are dropped and the kind re-enqueued by repair.
- Progress events update `dl_files.progress` + the in-memory status map, then bump one coarse version counter (throttled ~200ms) - the FR-82 contract exactly: `getStatus`/`getProgress` are sync reads, one subscribe channel, UI keys off the `mixed` kind only.

### 4.3 Keep-synced, repair, offline browsing

- `collections.ts`: toggling offline adds/removes the key and sequentially downloads/removes each song; `useOfflineCollectionSync(key, songs)` runs on every collection query success and enqueues missing songs (dedup makes it free).
- `repair.ts`: on boot-while-online and on reconnect: retry errored songs, then verify-and-repair every `dl_songs` row (file exists per expected kind incl. stems-if-enabled, lyrics when `unfetched`); re-enqueue what is missing. This one pass covers: process-death losses, pre-stems libraries, quality upgrades, partial collection toggles.
- `offlineLibrary.ts`: registers resolvers into `contracts/offlineFallback` - albums grouped by the backend's (album, lead-artist-slug) key, artists derived from song_json, songs listed from dl_songs; offline image resolver for ArtworkImage; offline lyrics resolver. A global `isOfflineNow` flag (netinfo) makes wrapped queries skip doomed network calls.
- Logout: player queue and query cache are wiped; downloaded files persist keyed to `ownerUserId`; if a DIFFERENT account logs in, purge the download store first (open issue to confirm).

---

## 5. Auth for native (WP3)

- Token in SecureStore (`oms.token`). `auth/session.ts` zustand store: `status: 'booting' | 'anon' | 'authed'`, `user`, in-memory token mirror (SecureStore reads are async; the client needs sync access).
- Boot: read token; none = anon (login screen). Present = `GET /sessions/mine` then `GET /users/:id`; 401 wipes and goes anon; network failure keeps the token and enters authed-offline (downloads still browse/play; FR-91).
- Login: `POST /sessions` with a meaningful User-Agent header (`oms-music/<ver> (<Device.modelName>; <os>)`) so the session name is sane; store token; bootstrap.
- Signup: `create_start` -> OTP entry (6 digits, 15 min, 5 attempts) -> `create_end` -> immediate `POST /sessions` (create_end does not log in) -> Home. Reset: `reset_password_start`/`_end` from the login screen, always-200 on start.
- Logout: `DELETE /sessions/0` best-effort (server kills the caller regardless), then wipe token, clear query cache, disconnect cable, reset player. Failures still wipe.
- 401 discipline (protects the anon 120/min/IP bucket, which invalid tokens fall into):
  1. react-query retry is off globally; nothing auto-retries a 401.
  2. `client.ts` has a single-flight `authLost()`: the first 401 flips the session store to anon; concurrent 401s are coalesced; queries are gated with `enabled: status === 'authed'` via a shared hook, so the flip stops the fleet.
  3. When status is anon, the client REFUSES authed requests locally (throws before network). Media URLs stop rendering (ArtworkImage subscribes to session status).
  4. fs_node 404s are NOT treated as auth loss on their own (they are also "wrong user/missing"); only a 401 from JSON endpoints or `/sessions/mine` is.
- OAuth (P1): backend redirects to `https://omelhorsite.pt/account/oauth/callback?ticket=...` and native cannot intercept an https URL without associated domains (which do not exist; same blocker as passkeys). Two viable paths, neither touching the backend: (a) add a forwarder on the WEB callback page that, when `?native=1` was carried through state, bounces to `omsmusic://oauth?ticket=...`; (b) ship associated domains later and use openAuthSessionAsync directly. v1 ships email+password and OTP signup; OAuth lands behind path (a) once the web page tweak is approved. `POST /sessions/adopt` handling (2 min ticket TTL, error code mapping) is built regardless.
- Passkeys (FR-13) stay blocked; devices screen (FR-14, P2) renames the current session only.

---

## 6. Realtime layer (WP9 + WP10)

### 6.1 CableClient (`cable/client.ts`)

Own interface: `connect(token)`, `disconnect()`, `subscribe(params, handlers): { perform, unsubscribe }`, connection state events. First implementation wraps `@kesha-antonov/react-native-action-cable`; if it misbehaves on any of the contract points below, hand-roll (~200 lines) behind the same interface, consumers untouched. Contract points to verify in a spike:
- Token ONLY in the URL query (`wss://backend.omelhorsite.pt/cable?token=`), never a stale Authorization header (first candidate wins on the handshake).
- Wait for `welcome` before subscribing; pre-welcome sends are dropped silently (callers rely on it).
- Identifier is a JSON-encoded string echoed verbatim; key order must be stable per subscription.
- Reconnect backoff 1s doubling to 30s; on welcome, resubscribe everything.
- `reject_subscription` is the per-channel auth failure signal (anonymous connects succeed).

Lifecycle: connect when authed, disconnect on logout. On AppState -> active: heartbeat + `request_snapshot` on PlaybackChannel and resubscribe FriendListeningChannel (rosters are subscribe-time).

### 6.2 Remote playback (PlaybackChannel), phased

Phase A (with WP9, the "active side"): subscribe with per-launch device_id + label; heartbeat 20s; role machine offline/no_active/active/controller from snapshots; publisher (200ms debounced `state_changed` with STRING song ids + full listener settings, 1Hz `position_tick` while playing, server `error` -> `request_snapshot` resync); cold-start hydration (sanitize snapshot, adopt quartet + loop + listener settings, never volume, paused activation seed, play claims `if_none` pessimistically, `claim_rejected` demotes); takeover (`setQueue` on non-active device = `claim_active steal` + play locally, optimistic).

Phase B (still WP9, after A): controller mode - mirror snapshot, merge slim `state_changed` with the last full `queue_songs`, transport actions become validated `command` sends, volume drag = `set_volume`; position interpolation via a 1-second interval (`tick.position + elapsed`, 5s staleness fallback, drop ticks whose song_id mismatches) - a 1s interval is honest at phone scale, no rAF loop; transfer flow with adoption + `activating` publish suppression until first audible progress + `activation_blocked` handling; DevicePicker sheet (self "Play here", online targets, disabled offline recents, needs-interaction hint).

Deferred (P2, cut from v1 if needed): reconnect-steal (FR-112) and the predecessor handoff (a web-reload artifact; native process death has no dying-page stash - repair path is just hydration).

Command execution on the active device: implement the full vocabulary (play/pause/toggle/next/previous/seek/set_queue_index/set_queue_order/set_shuffle/set_loop_mode/set_volume/add_to_queue/play_next/remove_from_queue/reorder_queue) by mapping onto local player actions; `add_to_queue`/`play_next` resolve the id from queue, then query cache, then `GET /songs/:id`. `jam_add_song` is accepted only as a server-built command.

### 6.3 Jams (WP10)

- REST lifecycle per FR-113 (join BEFORE subscribing; host leaving ends the jam; `GET /jams` on app start resumes).
- `JamChannel` is receive-only; follower mode: dedicated second `createAudioPlayer` fed by presigned `audio_url`, identity by song id, pending seek on metadata, hard-seek beyond 2.5s drift, pause with host, extrapolate ticks locally; JamBar replaces the MiniPlayer while following; starting real local playback auto-leaves (1.5s grace).
- Host duties: execute `jam_add_song` (FIFO after current, behind earlier proposals) and `next`; proposals play via their presigned URLs; never record/persist/download/separate jam songs (enforced in playRecorder, downloads manager, and snapshot sanitizer - three independent guards already in those packages).
- Propose interception via `contracts/playbackInterceptor.ts`: while following with queue_mode everyone, "play" on an own library song becomes `POST /jams/:id/propose`.

### 6.4 Friend presence (WP10)

`FriendListeningChannel` snapshot + full-row `listening_update` replace keyed by user.id; live rows first then updated_at desc; resubscribe on foreground. Feeds the Home strip, the friends tab in Now Playing, and profile now-playing rows.

---

## 7. Shared contracts (WP0, frozen before parallel work starts)

1. **API client** (`api/client.ts`): `request<T>({ method, path, params, body, multipart, auth })`. Implements bracket encoding (`lib/listFilters.ts`), deep null -> `"\b"` rewrite (skip FormData and an explicit `raw: true` used by WebAuthn later), Bearer header, bare-string/array error parsing into `ApiError { status, message, retryAfter }`, 401 single-flight hook, authed gate. RN fetch does no conditional GETs, so 304/ETag needs no code. No retries anywhere; react-query owns staleness (25s, no focus refetch, retry off, onlineManager on netinfo).
2. **Query keys** (`api/queryKeys.ts`): the complete key namespace written up front (songs, playlists, playlistSongs, liked, likedIds, playEvents, artists, artistOverview, mixes, radios, lyrics, translation, separation, jams, imports, spotify, profile, sessions...). Invalidation targets are part of the frozen contract so WP6/7/11 do not invent colliding keys.
3. **Domain types** (`src/types/*`): ported from API.md verbatim, with `SongId`/`SongKey` branded types. The cable payload types encode the string-id rule at compile time.
4. **Registration seams** (`src/contracts/*`): LocalFileIndex, offline fallback registry, TransportActions provider, playback interceptor, SongMenu item registry. Each ships with an inert default so every package builds and runs before its counterpart exists. This is the mechanism that lets WP2/WP8/WP9/WP10 proceed in any order.
5. **Theme tokens** (`theme/tokens.ts`): both HSL palettes as TS constants, radius 8, the fixed identity colors (music purple `#4B1E6D`, liked `#7e22ce` + gradient, emerald markers, mix kind gradients), accent mixing rules (artwork accent saturate +20, brighten +-50; hero -10/-60 dark/+40 light; fallbacks `#FF5555`/`#222222`). `useTheme()` resolves light/dark/system.
6. **i18n** (`src/i18n`): the three catalogs copied from the web repo (keys under `components.music.*` preserved; pt is PT-PT); `t(key, params)` with ICU-lite `{param}` interpolation (audit catalogs for plural/select during port; add only what is used); locale store persisted, default system-or-en; `mixLabels.ts` renders `title_key` + `title_params` (never the English fallback strings); radios render their pre-baked Portuguese strings as-is.
7. **Testing baseline**: bun test (built-in, no install) over `lib/*`, `player/queueOps`, snapshot sanitizer, slim-merge, LRC parser, null-sentinel encoder, rank, deep links, id converters. Service classes take injected fakes (FakeAudioPlayer, FakeCable, in-memory sqlite) so protocol logic runs in CI without devices.

Freeze protocol: WP0 lands, one review pass, then `types/`, `contracts/`, `queryKeys.ts`, `client.ts` are change-controlled (single owner merges edits others request). Everything else is package-private.

---

## 8. Vocal separation playback modes, natively

- **instrumental / vocals (FR-68, P1): ships in v1.** They are just "play a different file": `sourceResolver` picks the stem node (local stem file first), falls back to the plain mix when ids are null; mode switch captures position + playing and swaps source with a pendingSeek; stale-queue reconciliation compares the requested node against the wanted node when stem ids land later and swaps in place.
- **Separation lifecycle (FR-71, P1): ships in v1** (`src/separation`): explicit `POST /songs/:id/separate`, one shared 3s poll per song that parks on "no job, no stems", stops on ready/terminal; status projection idle/pending/processing/ready/failed with elapsed timer; on ready, `player.patchQueueSong(id, stems)` in place (no restart); DELETE removes stems; menu item states per FR-74. Disabled for jam songs and controllers.
- **Custom blend + EQ (FR-69/70, both P2): do NOT ship in v1's audio path.** expo-audio has no dual-source sample-synced playback and no EQ; two JS-driven players drift audibly and cannot be corrected without phasing artifacts. Faking it would be dishonest. v1 behavior:
  - Blend sliders and the EQ panel are hidden (not greyed) on native.
  - Snapshot compatibility is preserved: adopted `vocal_volume`, `instrumental_volume`, `eq_*` values are stored and re-published untouched, so a native device in the middle never wipes another device's settings. `playback_mode: "custom"` arriving in a snapshot plays as `original` locally (exactly what the web does on reload) while republishing whatever mode the user actually selects here.
  - EQ bands persist per FR-65 (they are just numbers in settings storage).
- **The v2 mechanism** (post-launch, aligns with the existing memory decision for a custom AVAudioEngine plugin): one Expo local module, `modules/oms-audio-mixer`, iOS AVAudioEngine (two AVAudioPlayerNodes scheduled on the same render clock + AVAudioUnitEQ 3 bands), Android ExoPlayer/Media3 (two players on one Timeline clock or an AudioProcessor mixer + DynamicsProcessing EQ). It slots in behind `sourceResolver` as an alternative playback backend for custom mode only; the rest of the engine is untouched. Not scheduled in the v1 packages.

---

## 9. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | expo-audio lock-screen remote command events (next/prev/seek) may be incomplete or differently named than assumed | Lock screen transport broken = P0 failure | WP2 day-1 spike on a dev build, both platforms. Fallback: patch expo-audio via config plugin / minimal local native module exposing MPRemoteCommandCenter + MediaSession callbacks. Escape hatch of record: @rntp/player v5 (paid) |
| 2 | Android ~3 min background kill | Silent playback death | `setActiveForLockScreen` on EVERY song change from day 1; foreground-service config in the plugin verified in the same spike |
| 3 | Downloads across process death | Broken offline promise | Persisted savables + boot re-attach + verify-and-repair as the universal healer; repair is idempotent by dedupe. Accepted: Android downloads pause with the process and resume on relaunch (v1). Upgrade path: @kesha-antonov/react-native-background-downloader (needs install approval) |
| 4 | Cable lib does not honor the framing contract (identifier echo, welcome gating, query-only token) | Remote playback + jams flaky | CableClient interface from day 1; spike the lib in WP9's first task; hand-rolled client is ~200 lines and drops in behind the interface |
| 5 | OAuth interception impossible without applinks | FR-12 blocked | Ship email+OTP first; web callback forwarder to `omsmusic://` scheme (frontend-only change) as the unblock; adopt-ticket code built regardless |
| 6 | Rapid-skip races and string/number id drift | Wrong track plays; cable desync | Generation tokens + loadingSongId are in the engine core, not bolted on; branded id types make drift a compile error; property tests on queueOps |
| 7 | Presigned URL expiry mid-listen or during long pause | Mid-song failure | Recovery ladder strike 1 re-resolves fresh + restores position; downloads use the non-expiring `/data?token=` URL |
| 8 | 500-row lists x artwork = jank/request storms | Library unusable | Gated queries per active pill, windowed FlatList (initialNumToRender 40), expo-image caching, small artwork variants. If FlatList is not enough, propose @shopify/flash-list (install approval needed) |
| 9 | Rate limits during dev/test (429 pages the owner via Discord) | Noise + lockouts | retry off globally, 401 gate, poll cadences exactly per spec, dev against localhost:1143 where possible |
| 10 | Blend/EQ user expectations from web parity | Perceived regression | Hidden UI + explicit release note; v2 native mixer module planned; wire passthrough keeps cross-device settings safe |
| 11 | Jam follower drift on flaky networks | Audible desync | 2.5s hard-seek rule + tick extrapolation, both cheap; follower is a separate player so main engine unaffected |
| 12 | reactCompiler experiment interactions with zustand selectors | Subtle re-render bugs | Keep selectors pure and stable; position updates isolated in a leaf store slice; can disable the experiment without API changes |

---

## 10. Work packages (12), ownership, and dependency order

Every package lists the ONLY paths it may write. `src/app` belongs to WP3 exclusively. Contract-frozen paths (WP0's) accept post-freeze changes only through the WP0 owner.

**WP0 - contracts and foundation** (first, solo, then frozen)
Owns: `src/types/**`, `src/contracts/**`, `src/api/client.ts`, `src/api/queryClient.ts`, `src/api/queryKeys.ts`, `src/api/mediaUrl.ts`, `src/lib/**`, `src/theme/**`, `src/i18n/**`, root config touches (app.json plugins, tsconfig paths).
Delivers: everything in section 7 + inert contract defaults + bun test harness. FRs: 1-6 (client half), 18-19 (tokens/catalogs), 21 helper.

**WP1 - API endpoints and query hooks** (after WP0)
Owns: `src/api/endpoints/**`, `src/api/queries/**`.
Typed endpoint modules for every resource in API.md; react-query hooks using the frozen keys; offline-fallback wrapping via `contracts/offlineFallback`; cursor pagination for liked; infinite queries for playlist_songs/artists/songs. FRs: 4, 6, 45-46 (data half), plus the data layer for every screen.

**WP2 - player engine** (after WP0; day-1 native spike)
Owns: `src/player/**`.
Section 3 in full: queueOps + property tests, service, urlResolver, sourceResolver, recovery, lockScreen, playRecorder, sleepTimer, settings, accent. FRs: 54-67 (66 shared with theme), minus remote-aware routing (WP9 decorates).

**WP3 - shell, auth, navigation** (after WP0)
Owns: `src/app/**`, `src/auth/**`, `src/features/auth/**`, `src/features/shell/**`.
Root providers, the full route tree (all 28 routes stubbed on day 1), SessionGate, login/signup-OTP/reset screens, logout, MiniPlayer pill + controller-strip/JamBar slots, deep-link wiring, theme/language app prefs surface (hub screen body is WP11's). FRs: 7-11, 15-16 (pill shell), 20, 22.

**WP4 - UI kit** (after WP0; parallel with WP1-3)
Owns: `src/ui/**`.
ArtworkImage (placeholder-photo fallback + offline resolver hook), SongRow (badges, menu trigger), SongTable (windowed, reorder), Tile, Hero (accent gradients), ActionBar, StickyTitle, FilterPills, Rail, PlayingBars, LikedArtwork, InitialsAvatar, SongMenu renderer over `contracts/songMenu`, sheets/skeletons. FRs: 21, 67, 74 (render half), 124.

**WP5 - player UI and lyrics** (after WP2 + WP4)
Owns: `src/features/player/**`, `src/features/lyrics/**`.
Now Playing pager (transport, scrub, volume, loop cycle, like heart, cog: rate/sleep/modes), Queue screen (visible-order rendering, drag reorder, jam attribution), lyrics fetch/display/LRC render (frame loop stops when hidden), tap-to-seek, translation, sync generation, offline lyrics read path. FRs: 17, 63-64 (UI half), 72-73, 75-81.

**WP6 - browse screens** (after WP1 + WP4)
Owns: `src/features/home/**`, `src/features/search/**`, `src/features/library/**`, `src/features/liked/**`.
Home (pills, top tiles, rails, friends-strip slot), Search (debounce, rank, recents, activation semantics, external results + import triggers calling WP11's import service via its query hooks), Library tab (gated pills, windowing), Liked (cursor paging, hero). FRs: 23-35, 45-46 (UI half).

**WP7 - collection screens** (after WP1 + WP4)
Owns: `src/features/playlists/**`, `src/features/artists/**`, `src/features/album/**`, `src/features/mixes/**`, `src/features/radios/**`.
Artists hub/roster/detail (popular, discography, appears-on, about), Album (exact_search + "\b", narrowing, highlight), Playlists list/detail (create, add-dialog, reorder-when-fully-loaded, artwork upload, copy/delete, system rules), Mix detail (title_key rendering, kind gradients, stamp text), Radios (+save-as-playlist, entry points). FRs: 36-44, 47-53, 121-123, 125.

**WP8 - downloads and offline** (after WP0; integrates via contracts, so parallel with WP5-7)
Owns: `src/downloads/**`, `src/features/downloads/**`.
Section 4 in full + Downloads screen + download settings screen + registration of LocalFileIndex/offline resolvers + song-menu download items via the registry. FRs: 82-94.

**WP9 - cable and remote playback** (after WP2; cable spike first)
Owns: `src/cable/**`, `src/remote/**`, `src/features/devices/**`.
CableClient, PlaybackChannel presence/heartbeat, role machine, publisher, hydration/adoption/takeover (Phase A), then controller + transfer + DevicePicker (Phase B), TransportActions decorator registration, devices screen (P2). FRs: 105-111 (112 deferred).

**WP10 - jams and social** (after WP9)
Owns: `src/jam/**`, `src/social/**`, `src/features/jam/**`, `src/features/profile/**`.
Jam lifecycle/channel/follower player/host duties/propose+skip/invites, JamBar body, FriendListeningChannel store, Home strip content, friends tab content, music profile screen. FRs: 29, 113-120.

**WP11 - settings, import, separation** (after WP1)
Owns: `src/features/settings/**`, `src/features/import/**`, `src/separation/**`.
Settings hub body, songs management (bulk edit with `featured_artist_names[]` rule), artists management (FLAT PATCH, `banner` field - the two web bugs NOT copied), playback settings (share_listening), file/URL imports with progress polling, Spotify sync, artist import, separation service + menu integration. FRs: 68 (mode plumbing shared with WP2), 71, 95-104, 126 (P2).

### Dependency graph

```
WP0 ──┬── WP1 ──┬────────────── WP6, WP7, WP11
      ├── WP2 ──┼── WP5
      ├── WP3 ──┤
      ├── WP4 ──┘
      ├── WP8   (contracts only; UI bits land when WP4 exists)
      └── WP2 ── WP9 ── WP10
```

Suggested waves: Wave 1 = WP0 alone. Wave 2 = WP1, WP2, WP3, WP4, WP8-engine in parallel (5 agents). Wave 3 = WP5, WP6, WP7, WP9, WP8-UI, WP11 (6 agents). Wave 4 = WP10 + Phase B of WP9 + integration hardening. The two native spikes (expo-audio remote commands in WP2; cable lib framing in WP9) run at the START of their packages because their outcomes pick between the primary design and the named fallback, not because the design depends on them.

### Stub-then-fill map (what runs before its counterpart exists)

- Player streams everything until WP8 registers LocalFileIndex.
- All transport is local until WP9 registers the remote decorator.
- Home renders without the friends strip until WP10 registers it.
- Song menu grows items as packages register them (download, radio, propose, separate).
- Every route exists from WP3 day 1; screens fill in per wave.
