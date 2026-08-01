# WORKPLAN.md - Implementation work packages for oms-music

Twelve packages, one agent each. Rules:

- A file has exactly ONE owner. Shared files (client, types, contracts, keys, theme, i18n,
  db schema) belong to WP1 and freeze after review; post-freeze changes go through the WP1
  owner as explicit change requests.
- `src/app/**` route files are created once by WP2 as one-line wrappers
  (`export { default } from "@/features/<domain>";`) and never edited by feature packages.
  WP2 also scaffolds every `features/<domain>/index.tsx` placeholder (inline "not built
  yet", zero imports); ownership of each folder then belongs exclusively to the listed WP.
- `src/boot/wireup.ts` is scaffolded as an inert no-op by WP1 during repo setup and is
  owned exclusively by WP12 afterwards; WP1 never touches it again.
- Subsystems integrate through the seams in `src/contracts` (DESIGN.md section 13), each
  with an inert default, so packages land in any order within their wave.
- Every package: TypeScript strict must pass (`bunx tsc --noEmit`), bun tests for owned pure
  logic, no em-dash anywhere, PT-PT for all Portuguese strings, new i18n keys in en+pt+lv in
  the same commit.

Waves: Wave 1 = WP1 alone. Wave 2 = WP2, WP3, WP4 in parallel. Wave 3 = WP5, WP6, WP7, WP8,
WP9, WP11 in parallel. Wave 4 = WP10, WP12.

```
WP1 ──┬── WP2 ──┬── WP5, WP6, WP11
      ├── WP3 ──┼── WP7
      ├── WP4 ──┘   WP8 (needs WP4 for its screens; engine work starts right after WP1)
      └────────── WP3 ── WP9 ── WP10 ── WP12 (needs all)
```

---

## WP1 - Foundation: contracts, api client, domain, theme, i18n, db, auth services

**Owns:** `src/domain/**`, `src/contracts/**`, `src/api/**` (client, params, errors,
queryClient, queryKeys, mediaUrl, endpoints/**, queries/**), `src/auth/**`, `src/db/**`,
`src/i18n/**`, `src/theme/**`, `src/lib/**`, root config (app.json plugins, tsconfig paths,
babel), the shared placeholder artwork asset, initial scaffold of `src/boot/wireup.ts`
(then handed to WP12).

**Depends on:** nothing.

**Tasks:**
1. HTTP client per DESIGN 5: bearer attachment (FR-1), `?token=` media URL builders +
   avatar exception (FR-2), deep `"\b"` null sentinel with FormData/raw exemptions (FR-3),
   bracket-encoded list DSL with explicit pages and the 500 cap (FR-4), bare-string error
   parsing + 429 retry_after parking + 304 keep-previous (FR-5), single QueryClient with
   NetInfo/AppState wiring, staleTime 25s, retry off (FR-6).
2. `auth/guard.ts` single-flight 401/fs-404 verification + global authReady gate; token
   store (SecureStore + sync mirror); session zustand store; boot sequence, logout wipe,
   userAgent builder (service halves of FR-5, FR-7, FR-9, FR-10).
3. All typed endpoint modules and react-query hooks for every resource in API.md,
   including cursor pagination for liked (FR-45 data), infinite queries for
   playlist_songs/artists/songs, `withOfflineFallback` wrapping on songs/albums/artists/
   playlists/liked/lyrics query fns (inert until WP8 registers resolvers).
4. Domain types verbatim from DESIGN 4 with branded ids and the single conversion point;
   format/artwork/albumKey/rank helpers; `lib/deepLinks.ts` parser covering locale prefix,
   `?id=`/`?slug=`, both album URL forms, literal "null" album (FR-20 parser half);
   `lib/uuid.ts` per-launch device id; `lib/recentSearches.ts` (max 6, kv).
5. Theme: both palettes ported from web globals.css, fixed identity colors, mix/radio kind
   gradients, gradient mixing rules, accent extraction with dual-variant LRU 100 (FR-18
   tokens, FR-66), typography registration (Inter, Druk Wide Super, Cantarell).
6. i18n: three catalogs ported as-is (`components.music.*` preserved), ICU-lite
   interpolation audited against actual catalog usage, locale store, `mixLabels.ts`
   (FR-19 plumbing).
7. SQLite: per-user open, migrations runner, the frozen DDL from DESIGN 9.1, kv facade.
8. Contract seams (DESIGN 13) with inert defaults, including the full frozen song-menu
   slot order (FR-74 contract half).
9. bun test harness + all pure-logic tests listed in DESIGN 17 that belong to WP1 files
   (sentinel encoder, brackets, rank, deepLinks, ids, albumKey, key-tree equality).

**Acceptance:** `bunx tsc --noEmit` clean; bun tests green; a scripted smoke (bun) against
production: login -> `GET /sessions/mine` -> `GET /songs?modifiers[page]=1:5` ->
`exact_search[album]="\b"` returns only null-album songs; 401 path parks queries without a
retry storm (verified with a garbage token against localhost); i18n key trees equal across
en/pt/lv.

---

## WP2 - App shell, navigation, auth screens

**Owns:** `src/app/**` (all route files + layouts), `src/features/auth/**`,
`src/features/shell/**` (tab bar, overlay host, MiniPlayer pill body, JamBar slot,
controller strip slot), deletion of template files, scaffolding of all
`features/<domain>/index.tsx` placeholders.

**Depends on:** WP1.

**Tasks:**
1. Root `_layout.tsx` provider stack per DESIGN 2 + SessionGate (FR-9 UI half) + side-effect
   import of `boot/wireup.ts`.
2. The full 28-screen route tree from DESIGN 2 as thin wrappers + the P2 devices route;
   `(player)` modal pager host; `(main)` overlay host with bottom-padding convention
   (FR-15, FR-16 shell).
3. Login, Signup (OTP step with resend countdown), Reset screens wired to WP1 auth
   services (FR-7, FR-8, FR-11); OAuth buttons behind the WebView flow (FR-12; requires
   react-native-webview install approval; buttons hidden until approved); passkey button
   absent (FR-13 deferred).
4. Logout action (FR-10). Deep-link registration: `omsmusic://` scheme + Android https
   intent filter, feeding `lib/deepLinks.ts` results into router navigation (FR-20).
5. MiniPlayer pill: 40px artwork, title/artists, cast button slot, play/pause, 2px progress
   line, tap opens `(player)` (FR-16), reading only the player store and transport contract.
6. `POST /service_usages { service_id: "music" }` fire-and-forget on first authed mount
   (FR-22).

**Acceptance:** app boots to login when anon, to tabs when authed; every route in DESIGN 2
navigates to its placeholder; kill/relaunch with a valid token lands authed without
flicker; a pasted `https://omelhorsite.pt/pt/music/artist/x/y` URL (via scheme in dev)
opens the album placeholder with correct params; MiniPlayer visible on every screen with
list tails readable.

---

## WP3 - Player engine core

**Owns:** `src/player/**`.

**Depends on:** WP1. Day-1 device spike gates the package (DESIGN 17).

**Tasks:**
1. Spike: verify expo-audio remote-command events, background survival, lock-screen
   artwork, status cadence, dual players, FLAC decode failure; write findings; if remote
   commands are not surfaced, escalate (config-plugin patch or @rntp/player v5 decision).
2. `queueOps.ts` with the exact FR-57 semantics + `sanitizeSnapshot` + `insertJamProposal`
   + property tests (order permutation, index validity, remove/reorder never change the
   audible song).
3. Engine per DESIGN 7.3/8.1: single AudioPlayer, transition generations, loadingSongId,
   requestedNodeId, pendingSeek, transition causes and autoplay rules (FR-59), takeover
   delegation through the transport seam.
4. Presigned resolver (5-min reuse, in-flight dedupe, 2 attempts, fresh bypass) + source
   ladder over contracts/localSource + prefetch one-shot (FR-55, FR-56, FR-60, FR-90
   ladder).
5. Recovery ladder + failedSongKeys + throttled toast (FR-61).
6. Ended/loop/previous semantics (FR-58); volume/seek-retry/rate(no pitch)/sleep timer
   (FR-64); listener-settings persistence, custom-restores-as-original (FR-65).
7. Play recording accumulator (FR-62) with jam/transfer-seed guards.
8. Lock screen metadata + remote-command routing through contracts/transport (FR-54,
   FR-63 local half); interruption handling.
9. Playback modes original/instrumental/vocals with stems fallback and mode-switch
   continuity (FR-68 engine half); `patchQueueSong` stale-queue reconciliation; custom mode
   plays plain mix with wire passthrough (FR-69/70 v1 behavior per DESIGN 16).
10. Zustand store mirror with 4 Hz position slice (FR-6 no-interrupt discipline).

**Acceptance:** property tests + unit tests green in CI with FakeAudioPlayer; on both dev
builds: 10+ min backgrounded playback with working lock-screen controls and artwork;
repeat-one fires ended each cycle; rapid-skip soak (300 ms x 5 min) never plays a stale
track or double-plays; an artificially expired presigned URL recovers in place; scrub does
not fire play_events, 30 s of listening does.

---

## WP4 - UI kit

**Owns:** `src/ui/**`.

**Depends on:** WP1.

**Tasks:**
1. `ArtworkImage` (expo-image, `imageUrl()` token param, offline-resolver hook via
   contracts, shared placeholder photo fallback - never letter tiles; FR-21).
2. Hero (36dvh; artist 42dvh full-bleed) + ActionBar (56px primary play FAB + ghost
   buttons) + StickyTitle (fade-in blurred bar with leading play action; FR-124) + layout
   patterns from SPEC design language.
3. SongTable/SongRow (windowed 40 + incremental, index/title/album/addedAt/duration
   columns with narrow-drop, badges: like heart, download states, jam proposer), drag
   handles for reorder surfaces.
4. Tile/Rail/FilterPills (animated primary capsule)/TopTileGrid/ArtistCard (circular)/
   InitialsAvatar (deterministic, artists-in-grids only)/AlbumCard/MixTile (kind gradient +
   stamp text stepping + artist overlay)/LikedArtwork (purple gradient + white heart).
5. PlayingBars (4 bars, non-harmonic durations, frozen at 1/3 when paused; FR-67).
6. `SongMenu.tsx` renderer over the contracts/songMenu registry + credits dialog grouped
   by role (FR-74 render half, FR-125) + AddToPlaylistDialog shell + confirm dialogs +
   bottom sheets + skeletons + empty/error states.

**Acceptance:** a storybook-style gallery route (dev-only) renders every component in light
and dark with correct tokens; SongRow reads download status synchronously via the contract
without per-row subscriptions; menu renders only registered slots; artwork fallback shows
the placeholder photo, never an icon.

---

## WP5 - Browse screens: Home, Search, Library, Liked

**Owns:** `src/features/home/**`, `src/features/search/**`, `src/features/library/**`,
`src/features/liked/**`.

**Depends on:** WP1, WP2, WP4 (playback via the transport contract; runtime needs WP3).

**Tasks:**
1. Home per SPEC 4: filter pills (FR-23), top tiles with playlist fallback and polymorphic
   `artist` handling (FR-24), "Made for you" rail hidden-when-empty (FR-25), random albums
   rail with unknown-album i18n (FR-26), playlists rail + Show all (FR-27), artists rail
   (FR-28), friends strip slot mounting `features/friends` content when registered (FR-29
   placement).
2. Search per SPEC 5: 220 ms debounce, 4 parallel 1:20 queries, mandatory rankByMatch
   re-rank, top 3 per kind (FR-30); recents max 6 with per-row remove (FR-31); activation
   semantics (song = queue of one and play; others navigate) (FR-32); full results with
   pills, top-result priority, songs queue = ranked list at index, derived-artist cards
   with Deezer picture lookup, album/playlist grids, empty states with external results
   still shown (FR-33).
3. External search + import rows (FR-34): source badges, Import button (URL mode for
   youtube/soundcloud; search mode + isrc for spotify/itunes/bandcamp), 1.5 s poll,
   deduped-terminal handling, library invalidation on complete.
4. Library tab (FR-35): pills gating queries (`enabled`), playlists 1:500 / artists 1:500
   name:asc / albums via /songs/albums, local substring filter, windowed rendering,
   Spotify badge + liked-mirror heart, quick links row (Liked, Downloads, Settings).
5. Liked (FR-45): cursor-paged infinite list, purple hero + `#7e22ce` accent, play/shuffle,
   addedAt = liked_at. Like toggle everywhere via `/liked_songs/ids` optimistic set with
   rollback, DELETE keyed by SONG id (FR-46).

**Acceptance:** "carlos" ranks "Carlos Paiao" above alphabetically-earlier weak matches
(unit test on the query fn + rank); a 500-artist library mounts without an artwork request
storm (windowing verified); liking mid-scroll never shifts liked pages; all rails collapse
when empty; heart state consistent across rows and MiniPlayer.

---

## WP6 - Collection screens: Playlists, Artists, Album, Mixes, Radios

**Owns:** `src/features/playlists/**`, `src/features/playlist/**`,
`src/features/artists/**`, `src/features/artist/**`, `src/features/album/**`,
`src/features/mixes/**`, `src/features/radios/**`.

**Depends on:** WP1, WP2, WP4.

**Tasks:**
1. Playlists list + create dialog (FR-47). Playlist detail (FR-48): meta + infinite
   position-ordered pages of 100; play/shuffle on loaded songs.
2. Add-to-playlist dialog behavior (FR-49): non-system only, membership pre-check,
   toggle add/remove by join-row id, inline create-and-add (dialog shell from WP4).
3. Row removal + drag reorder ONLY when fully loaded, COMPLETE song-id array to /reorder,
   optimistic with rollback (FR-50); artwork crop -> JPEG <=2MB -> multipart upload
   (FR-51); delete with confirm + copy incl. system playlists (FR-52); system playlist
   read-only rules + Spotify subtitle + liked-mirror artwork (FR-53).
4. Artists hub overview (FR-36): spotlight banner with lazy songs query, stat tiles with
   `heavy_rotation_window` label switch, shelves hidden when empty. Roster screen (FR-37):
   infinite 60/page, sort toggle restarting the query, debounced server search.
5. Artist screen (FR-38): slug-or-name resolve with 404 fallback display, hero chain,
   meta line; popular top-5 with full-catalog queue mapping (FR-39); discography +
   appears-on grids (FR-40); featured-on list (FR-41); About with sanitized bio + gallery
   slideshow 6 s (FR-42, P2).
6. Album screen (FR-43): `exact_search[album]` (or `"\b"`), client narrowing to context
   artist with fallback to all matches, majority-vote header artist, meta, play/shuffle;
   deep-link song highlight + scroll (FR-44, P2); offline toggle key via albumKey.
7. Mixes (FR-121): list + detail via URL-encoded slug, titles STRICTLY from title_key
   through i18n, kind gradients + stamp rules, artist overlay, 404-on-rotated-slug ->
   refetch list + home. Radios (FR-122): artist/song radios, pre-baked PT strings as-is,
   seed handling, save-as-playlist via `POST /playlists { name, song_ids }`; entry points
   wiring on artist ActionBar and song menu Start-radio slot (FR-123).

**Acceptance:** an album opened from a featured artist still lists every track; reorder is
impossible on a partially loaded playlist; no editing affordance ever appears on a system
playlist (including rename); mix titles switch language with the locale; radio save
navigates to the frozen playlist copy; unknown-album screen lists only null-album songs.

---

## WP7 - Player UI: Now Playing, Queue, Lyrics

**Owns:** `src/features/player/**`, `src/features/lyrics/**`, `src/lyrics/**`.

**Depends on:** WP2, WP3, WP4 (separation actions via the WP11 service interface, frozen in
WP1 types; the cog compiles against it before WP11 lands).

**Tasks:**
1. Now Playing (FR-17): artwork on dual-variant accent gradient, title/artist links
   (dismiss + navigate), scrub with tabular labels, shuffle/prev/play/next/loop cycle
   None -> All -> One, volume, like heart, overflow = canonical menu, cast button ->
   DevicePicker sheet slot, jam button; controller strip states + interpolated position
   when controlling (reads remote store via transport contract).
2. Cog sheet: rate 0.5-1.5, sleep timer, mode select (Original/Instrumental/Vocals +
   custom-unavailable note per DESIGN 16), separation status with elapsed timer + trigger/
   delete via the separation service interface, EQ section hidden in v1 (FR-64/68 UI).
3. Queue screen (FR-72): visible-order rendering, tap current toggles / other jumps,
   remove disabled on active row, jam proposer attribution; long-press drag ->
   `reorderQueue(fromVisible, toVisible)` (FR-73). All callbacks use VISIBLE indices.
4. LRC parser in `src/lyrics/lrc.ts` with the four exact FR-76 rules + unit tests.
5. Lyrics screen (FR-75): fetch with skeleton-on-slow-first, 200-with-nulls empty state,
   ~24 h client cache, attribution footer, plain fallback; synced rendering frame-driven
   with index-change-only state updates, auto-center, 4 s manual-scroll grace with
   back-to-current pill, frame loop stopped when hidden (FR-77); tap-to-seek incl.
   placeholder dots (FR-78).
6. Translation (FR-79): 7 targets, persisted per device defaulting to UI locale,
   staleTime Infinity, never auto-retry 429/404, alignment by `time.toFixed(2)` /
   line index, identical-line suppression, original as secondary line, inline 429 message.
7. Sync generation (FR-80): POST /lyrics/sync -> JobChannel + 10 s poll fallback
   (404 = keep waiting) -> refetch; disabled with spinner; 10/h cap respected.
8. Offline lyrics read path via the contracts resolver (FR-81 read half).

**Acceptance:** LRC unit tests cover multi-timestamp fan-out, metadata/untimed skipping,
placeholder dots, sorting; no 60 fps re-render churn (active-line state changes only on
index change, verified with a render counter in dev); transport controls reflect engine
state live; loop cycle order exact; translation of a 429 shows the limit inline and never
retries.

---

## WP8 - Downloads and offline

**Owns:** `src/downloads/**`, `src/features/downloads/**` (Downloads screen + the download
settings screen body used by route 28).

**Depends on:** WP1, WP4 (WP3 for end-to-end playback of local files; engine integration is
via contracts/localSource, so engine and downloads develop in parallel).

**Tasks:**
1. Manager + tasks per DESIGN 9.2 over the frozen DDL: bundle kinds (FR-83), enqueue-time
   WiFi gate with i18n refusal (FR-88), dequeue-time `/data?token=` URLs, savable
   persistence + boot re-attach (FR-84), state persistence + string song_key normalization
   (FR-85), per-user directory with backup exclusion and real extensions.
2. Status map + coarse version counter implementing DownloadStatusApi exactly (FR-82);
   row badge states + song-menu slot registration Download / Downloading N% / Remove
   (FR-86, FR-74 slot).
3. Collections keep-synced + auto-sync hook + ActionBar toggle semantics (FR-87).
4. Repair: retryFailures + verifyAndRepair on boot-while-online and reconnect, incl.
   stems-gained and lyrics-unfetched re-enqueue (FR-89); lyrics stored with downloads
   (FR-81 write half).
5. LocalFileIndex registration (FR-90 integration) + offline library/image/lyrics
   resolvers + isOfflineNow gating registered into contracts/offlineFallback (FR-91).
6. Downloads screen (FR-92): count + storage bytes (directory walk) + offline pill,
   in-flight section with percentages, downloaded list (tap = play downloaded list as
   queue), per-row delete, PT-PT copy. Download settings screen (FR-93): wifiOnly default
   off, includeStems default on with ~2x note, showOnlyDownloaded (collection filtering +
   reorder suppression consumed by WP6 via the context).
7. FR-94 intentionally absent (DESIGN 16.6).

**Acceptance:** kill the app mid-download, relaunch: downloads complete or re-enqueue
without user action; airplane mode browses and plays the downloaded library with artwork
and lyrics; enabling wifiOnly on cellular refuses with a message and queues nothing; a
library downloaded with stems disabled gains stems after enabling + reconnect (repair);
status reads are sync and progress updates are coarse (no per-row re-render storm).

---

## WP9 - Cable client and remote playback

**Owns:** `src/cable/**`, `src/remote/**`, `src/features/devices/**` (DevicePicker sheet
body + the P2 devices settings screen).

**Depends on:** WP1, WP3. Day-1 framing spike against production.

**Tasks:**
1. Hand-rolled CableClient per DESIGN 10.1 (frozen interface), with the spike verifying
   identifier echo, welcome gating, query-only token, backoff, rejection semantics
   (FR-105).
2. PlaybackChannel presence: per-launch device_id + label subscribe, 20 s heartbeat,
   foreground wake = request_snapshot + heartbeat (FR-106).
3. Role machine incl. force-pause + clear source on controller (FR-107); claims
   (if_none pessimistic / steal optimistic) and takeover-steal on setQueue (FR-111 half).
4. Cold-start hydration (FR-108): sanitized adoption, listener settings never volume,
   paused activation seed, playFromIdle claim flow.
5. Controller mode (FR-109): snapshot mirror, slim-merge with last full queue_songs
   (unit-tested), 1 Hz interpolation + 5 s staleness + song-id mismatch drop, validated
   command sends, set_volume drag, greyed local-only settings.
6. Active publishing (FR-110): 200 ms debounce, string ids, 1 Hz ticks, error -> resync,
   server clamps respected.
7. Command router executing the full vocabulary, jam commands forwarded to the jam seam.
8. Transfer flow (FR-111): adoption, activating publish suppression until first audible
   status, activation_blocked mapping, DevicePicker (self "Play here", online targets,
   disabled offline recents, needs-interaction hint).
9. Reconnect steal (FR-112): steal + force-publish when the drop happened while active and
   nobody claimed. Transport decorator registration so lock-screen next on a controller
   advances the active device (FR-63 remote half).
10. Devices screen (FR-14, P2): sessions list + rename current, no fake revoke.

**Acceptance:** two-device matrix on dev builds: exactly one audible device at all times;
controller UI tracks the active device within ~1 s; mid-song transfer resumes on the target
within the same second of audio; a forced WS blip while active never pauses local audio and
re-establishes activeness; slim-merge unit tests green; lock-screen next on a controller
advances the remote device.

---

## WP10 - Jams and social

**Owns:** `src/jam/**`, `src/social/**`, `src/features/jam/**`, `src/features/profile/**`,
`src/features/friends/**` (friends pager page + Home strip content + JamBar body).

**Depends on:** WP3, WP4, WP9.

**Tasks:**
1. Jam lifecycle (FR-113): create -> claim_active steal, join-before-subscribe, resume from
   `GET /jams` on start, leave/end semantics with host warning, rules PATCH.
2. JamChannel handling (FR-114): snapshot, state_changed, ticks with drift correction
   (2.5 s hard-seek), members/jam_updated/song_proposed/skip_votes/skipped/ended,
   rejection = clear state.
3. Follower player (FR-115): second AudioPlayer on `audio_url`, identity by song id,
   pending seek, local pause/volume, tick extrapolation on resume, auto-leave on local
   playback with 1.5 s grace; JamBar replacing MiniPlayer.
4. Host duties (FR-116): jam_add_song FIFO insertion + next execution, proposal playback
   with attribution, never record/persist/download/separate (verify all three guards).
5. Propose + skip votes (FR-117): interceptor registration (queue_mode everyone), vote UI
   per skip_mode, silent tally reset on track change. Invites (FR-118): accepted-friends
   sheet, jam_invite notification -> link (NotificationsChannel handling in social/).
6. FriendListeningChannel store (FR-119): snapshot + full-row replace, live-first sort,
   foreground resubscribe; Home strip content + friends pager page.
7. Music profile screen (FR-120): visible:false private state, top-artists image pick
   order, presigned media used as-is (never resolve foreign fs nodes).

**Acceptance:** host + follower devices: a member proposal audibly enters the host queue in
FIFO order with attribution; follower stays within 2.5 s drift and pauses with the host;
follower starting local playback auto-leaves after grace; a friend pressing play appears in
the strip within ~1 s; sharing-off friends show presence without the song; jam songs never
appear in downloads, play_events, or persisted snapshots.

---

## WP11 - Settings, import flows, separation service

**Owns:** `src/features/settings/**`, `src/features/import/**`, `src/separation/**`.

**Depends on:** WP1, WP2, WP4 (WP3 for patchQueueSong effects at runtime; Spotify link
WebView reuses WP2's oauth module).

**Tasks:**
1. Settings hub (FR-95) incl. theme light/dark/system + language rows (FR-18/19 UI).
2. Separation service (FR-71): shared 3 s poll parking on no-job-no-stems, projection with
   elapsed timer, trigger/delete, `patchQueueSong` on ready, song-menu slot registration
   ("Separate vocals" / disabled-with-elapsed); terminal = complete|failed only.
3. Songs management (FR-96): infinite 500/page + `<loaded>+` total, client filters +
   parallel server search fold-in, bulk delete with confirm, edit dialog (multipart PATCH;
   artist chips emitting `artist_names[]` + ALWAYS `featured_artist_names[]` with a single
   empty string when none), embedded stems controls; metadata modifier tool row (FR-126,
   P2: pick file -> form -> POST -> share/save returned binary, 50 MB cap, track_number
   dropped note).
4. Artists management (FR-97): table, FLAT top-level PATCH rename, image field `image`,
   banner field `banner`, delete with in-use refusal surfaced.
5. Playback settings (FR-98): share_listening from account (default true when absent),
   multipart `PATCH /users/:id` write.
6. File upload import (FR-99): audio-only multi-pick, sync `POST /songs/import` per file
   with long timeout, concurrency 3, aggregate toasts, global import-busy flag; folder
   resume tracker (FR-100, P2) in kv with warning card.
7. URL import (FR-101): preview with inline error taxonomy (Spotify refusal, SSRF, 502
   text, 60/h), confirm sheet with per-track edits + artwork picker (artwork_search or
   upload -> artwork_url/artwork_data_b64) + target selector, sequential song_imports with
   positions; progress polling 1.5 s, progress_pct 0..1, deduped-terminal, error_message
   display (FR-102).
8. Spotify sync (FR-103): gated on `allowed_to_use_spotify` (hide tab AND expect 403),
   link via `/auth/link/spotify?token=`, status/preview/settings/trigger, 1.5 s poll while
   running, per-playlist rows, destructive warnings, stale >2h shown failed.
9. Artist import (FR-104): linked-identity requirement, debounced roster+spotify search,
   album multiselect, recents polling with progress rows, Spotify error classification.

**Acceptance:** editing artists never reparses "feat." out of titles (the
featured_artist_names key is always present - request-shape unit test); artist rename
round-trips (flat body verified against prod); banner upload succeeds with field `banner`;
a YouTube playlist URL becomes an ordered playlist with artwork; Spotify tab invisible for
non-allowlisted accounts; separation completes without interrupting playback and the menu
item relabels while processing.

---

## WP12 - Integration, wiring, polish

**Owns:** `src/boot/**` (wireup.ts), `e2e/**` (scripted device checklists), release config.

**Depends on:** all of WP2..WP11.

**Tasks:**
1. Fill `boot/wireup.ts`: import every subsystem `register.ts` (downloads, remote, jam,
   social, separation) in dependency-safe order; verify each seam has its real
   implementation at boot in dev (assert + log).
2. Cross-cutting QA sweeps: bottom padding under MiniPlayer on every scrollable screen
   (FR-16 AC); shared placeholder artwork audit (FR-21 AC); PT-PT copy review of every
   catalog addition; em-dash grep gate (CI); key-tree equality gate.
3. Deep-link end-to-end pass over the full FR-20 matrix (both album forms, slug vs encoded
   name, literal "null", ?id=/?slug=, locale prefixes).
4. The two-device playback matrix (DESIGN 17) executed and recorded on iOS + Android dev
   builds; rapid-skip soak; jam host+follower session; airplane-mode session.
5. Rate-limit conformance sweep: poll cadences (separation 3 s, imports/sync 1.5 s, jobs
   10 s fallback), lyrics translation/sync caps, no retry storms (charles/mitm session
   counting requests).
6. Performance pass: Home mount query count, library windowing, position-slice re-render
   isolation, accent-cache hit rate.
7. Release: EAS build profiles, app icons/splash, versioning, store metadata (PT-PT +
   EN), TestFlight/internal track upload.

**Acceptance:** dev-build boot log shows every seam registered; full 28-screen manual pass
with no placeholder screens left; both device matrices recorded green; CI (tsc + bun tests
+ em-dash and key-tree gates) green on the release commit.

---

## FR coverage map

- WP1: FR-1..6, 18/19 (foundations), 20 (parser), 21 (helper), 45/46 (data), 66.
- WP2: FR-7..12 (screens/flows), 15, 16 (shell), 20 (registration), 22.
- WP3: FR-54..65, 67 (data), 68 (engine), 63 (local), 69/70 (v1 wire behavior).
- WP4: FR-21 (render), 67 (render), 74 (renderer), 124, 125.
- WP5: FR-23..35, 45/46 (UI).
- WP6: FR-36..44, 47..53, 121..123.
- WP7: FR-17, 63/64 (UI), 72/73, 75..81 (read).
- WP8: FR-81 (write), 82..93 (94 deferred), 74 (download slot).
- WP9: FR-14, 63 (remote), 105..112.
- WP10: FR-29, 113..120.
- WP11: FR-71, 95..104, 126, 18/19 (UI), 68 (UI).
- WP12: integration ACs across all; no new FRs.
- Deferred per DESIGN 16: FR-13 (passkeys), FR-69/70 (audio path), FR-94 (enforcement),
  Google-in-WebView portion of FR-12, verified https links portion of FR-20.
