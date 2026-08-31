# SPEC.md - Master build spec: omelhorsite Music, native rebuild (React Native / Expo, iOS + Android)

Target: a native app that talks to the EXISTING production backend `https://backend.omelhorsite.pt` with zero backend changes. Stack decisions are in STACK.md (Expo SDK 57, expo-audio with background playback, expo-file-system downloads, expo-sqlite, expo-secure-store, TanStack Query + zustand, hand-rolled or forked ActionCable client). API contract is in API.md. Priorities:

- P0 = core: auth, browse, search, playback, queue, liked, playlists, lyrics, downloads/offline, settings.
- P1 = social, jams, mixes, radios, remote playback, import.
- P2 = nice-to-have polish.

All Portuguese strings are European Portuguese (PT-PT). Never use the em-dash character anywhere in code or copy.

---

## Design language

The brand to match (read from the shipping web client):

- **Monochrome primary.** `primary` is NOT a brand color: near-black on light theme, near-white on dark. Active pills, liked hearts, play FABs, and active toggles are all primary (black-on-white / white-on-black). Full shadcn-style HSL token set for light and dark exists in the web `globals.css`; port both palettes plus a "system" theme option.
- **Color comes from artwork and fixed gradients, not tokens.** Per-song accent = average color of the artwork (saturate +20; brighten +50 light / -50 dark; cache per song id, LRU 100; fallback `#FF5555`). Player bar and now-playing surfaces sit on a vertical gradient of that accent mixed toward white (light theme) or black (dark theme). Hero headers derive an accent from the artwork/backdrop (saturation -10, brightness -60 dark / +40 light, fallback `#222222`).
- **Fixed identity colors:** music section accent deep purple `#4B1E6D`. Liked Songs = violet-700 -> purple-700 -> indigo-900 gradient tile with a centered white heart, page accent `#7e22ce` (also used for the Spotify liked-mirror playlist). Spotify-sync markers and the remote-playback "Playing on X" strip are emerald. Mix tiles have hardcoded per-kind gradients (top_artist rose/fuchsia/indigo, repeat_rewind amber/orange/rose, time_capsule emerald/teal/cyan, discoveries sky/blue/violet); the server `gradient` field is deliberately ignored.
- **Typography:** Inter for body; OMS Wide (weight 900, our own face, scripts/generate-oms-wide.py) and Cantarell as display faces. Hero titles are huge black-weight; section headers `text-2xl` bold tight; kind labels tiny uppercase; time labels tabular numerals. Mix "stamp" text is black-weight uppercase white, size stepped down by text length (<=8 chars largest, <=14, <=22, else smallest).
- **Shape:** base radius 8px; cards/tiles slightly rounded; pills and play buttons fully round; mobile mini-player pill rounded-xl with blur and heavy shadow.
- **Layout patterns:** collection screens = Hero (36dvh; artist hero 42dvh full-bleed photo) -> ActionBar (56px round primary play FAB + ghost icon buttons: shuffle, radio, like, add, offline toggle, overflow) -> song table. Home = filter pills -> top-tile grid -> rails (horizontal carousels of 176px tiles, circles for artists). Sticky title bar fades in when the hero scrolls away.
- **Empty artwork ALWAYS falls back to one shared placeholder photo**, never a letter tile or icon (exception: pictureless artists may use the deterministic initials avatar in card grids).
- **i18n:** exactly en (default), pt (PT-PT), lv. One ICU-style JSON catalog per locale; music strings under `components.music.<Component>.<key>`. Mix titles/descriptions render from `title_key` + `title_params` through the catalog, never the English fallback strings.

---

## 1. Cross-cutting HTTP/data layer

- **FR-1 (P0) Bearer token transport.** Every JSON request carries `Authorization: Bearer <token>` from SecureStore. AC: server-side parse strips exactly 7 chars, so the `Bearer ` prefix is always present; requests without a token are never sent to authed endpoints.
- **FR-2 (P0) Token on media URLs.** URLs handed to players/downloaders/images append `?token=<token>`; avatars (`/users/:id/picture`) need no token. AC: artwork and audio load while the app is authenticated; anonymous fs_node fetches 404 and are treated as auth loss, not missing files.
- **FR-3 (P0) Null sentinel.** Outgoing params/bodies rewrite `null` to the literal `"\b"` string (FormData exempt; WebAuthn payloads exempt). AC: the unknown-album screen (`exact_search[album]="\b"`) lists only null-album songs, not the whole library.
- **FR-4 (P0) List filter DSL.** Bracket-encoded `search`/`exact_search`/`modifiers[page]=N:SIZE`/`modifiers[order]`/`modifiers[random]` with explicit pages everywhere (hard 500 cap). AC: no listing relies on getting more than 500 rows in one call; unknown filter keys (server 400) never ship.
- **FR-5 (P0) Error and status handling.** Bare-JSON-string error bodies parsed defensively; 401 from `/sessions/mine` clears the token and shows login; 429 honors `retry_after` with no retry storm; 304 handled transparently. AC: a stale token never produces a retry loop (invalid tokens count against the anonymous per-IP bucket).
- **FR-6 (P0) Query cache discipline.** One query-client instance for the app lifetime; staleTime ~25s; no refetch-on-focus; retry off by default; onlineManager wired to NetInfo. AC: navigating between screens does not refetch storms or audibly interrupt playback.

## 2. Auth and account (screens: Login, Signup, Reset)

- **FR-7 (P0) Email+password login.** `POST /sessions`, store `token` in SecureStore, send a meaningful User-Agent so the session name is sane. AC: valid credentials land on Home with the session visible in the account's device list under a recognizable name.
- **FR-8 (P0) Signup with email OTP.** `create_start` -> 6-digit code entry (15 min TTL, 5 attempts) -> `create_end` -> immediate `POST /sessions` (create_end does NOT log in). AC: a new account reaches Home without re-entering credentials.
- **FR-9 (P0) Session bootstrap.** On launch with a stored token: `GET /sessions/mine` then `GET /users/:id`. AC: 401 wipes the token and shows login; success renders the account (handle, avatar via `/users/:id/picture`, `allowed_to_use_spotify`, `share_listening`).
- **FR-10 (P0) Logout.** `DELETE /sessions/<any id>` (the server always kills the calling session) then wipe token/local caches; failures still wipe. AC: after logout the app shows login and no authed request fires.
- **FR-11 (P1) Password reset.** `reset_password_start` / `reset_password_end` flow (anti-enumeration: always 200 on start). AC: user can set a new password from the login screen and sign in.
- **FR-12 (P1) OAuth sign-in (Google, GitHub, Spotify).** Open `/auth/<provider>?mode=signin` in an auth browser session, intercept the redirect to `omelhorsite.pt/account/oauth/callback`, extract `ticket` (2 min TTL) or `error`, `POST /sessions/adopt`. AC: a Google account signs in without typing a password; error codes map to messages.
- **FR-13 (P2) Passkey login.** Blocked on associated-domains/asset-links for omelhorsite.pt which do not exist yet; contract is `/webauthn_credentials/authentication_options` + `/authentication` with verbatim payloads. AC (when unblocked): passkey signs in on both platforms.
- **FR-14 (P2) Devices screen.** List `GET /sessions`, rename via `PATCH /sessions/:id` (note: server cannot actually revoke OTHER sessions; `DELETE` always kills the caller). AC: current device renameable; no fake "revoke other device" button.

## 3. App shell, navigation, theming, i18n

- **FR-15 (P0) Navigation graph.** Tabs/stacks covering: Home, Search, Library (playlists/artists/albums), Liked, Playlist, Artist, Album, Mix, Radio, Downloads, Settings (+sub-pages), Now Playing, Queue, Lyrics, Jam, Profile. AC: every web route in the map has a native destination.
- **FR-16 (P0) Mini player.** Persistent floating pill above the tab bar when a song is loaded: 40px artwork, title/artists, cast button (P1), play/pause, 2px progress line; tap opens Now Playing. AC: visible on every screen, never covers list tails (content bottom padding).
- **FR-17 (P0) Now Playing sheet.** Full-screen: artwork, title/artist links, scrub bar with tabular time labels, shuffle/prev/play/next/loop (cycle None -> All -> One), volume, like heart, overflow menu, tabs or pages for Queue and Lyrics (Friends P1). AC: all transport controls work and reflect engine state live.
- **FR-18 (P0) Theming.** Light/dark/system selection with the two token palettes; every artwork-derived gradient computes both theme variants (mix toward white in light, black in dark). AC: theme flips restyle gradients without re-downloading artwork (dual-variant cache).
- **FR-19 (P0) i18n.** en/pt-PT/lv catalogs ported as-is; ICU interpolation; mix/radio label rules honored (mixes from keys, radios pre-baked Portuguese strings rendered as-is). AC: switching language relabels the whole music UI including mix titles.
- **FR-20 (P1) Deep links.** Parse incoming web URLs: locale prefix, `?id=`/`?slug=` detail routes, `/music/artist/<artist>/<album>` AND `/music/album/<artist>/<album>` forms, artist segment = slug or URL-encoded name, literal `"null"` album segment. AC: a shared web playlist/album/artist link opens the right native screen.
- **FR-21 (P0) Artwork fallback.** Shared placeholder photo for all missing artwork. AC: no icon/letter tiles anywhere artwork is expected.
- **FR-22 (P2) Recent-services ping.** `POST /service_usages { service_id: "music" }` on entry. AC: fire-and-forget, no UI.

## 4. Home (Discover)

- **FR-23 (P0) Filter pills.** `all | playlists | albums | artists`, animated primary capsule, local state only. AC: pills show/hide sections without refetching.
- **FR-24 (P0) Top tiles.** Up to 8 recently played albums (`/play_events/recent?group_by=album&limit=8`), falling back to the first 8 playlists when no history; hidden when both empty. AC: tiles navigate to album/playlist; handles `artist` being an Artist object OR a bare string.
- **FR-25 (P1) "Made for you" rail.** Mix tiles (see FR-116). AC: hidden when loaded-and-empty.
- **FR-26 (P0) "Recommendations today" rail.** `GET /songs/albums?modifiers[random]=true&modifiers[page]=1:10`. AC: 10 random album tiles, title falls back to "unknown album" i18n.
- **FR-27 (P0) "Your playlists" rail.** `GET /playlists?modifiers[page]=1:20` with a Show-all link. AC: navigates to playlist screens.
- **FR-28 (P0) "Your artists" rail.** `GET /play_events/top?scope=artist&since=30d&limit=10`, circular tiles; hidden when empty. AC: navigates to artist screens.
- **FR-29 (P1) Friends listening strip.** Live rows from FriendListeningChannel (FR-129). AC: strip appears only on filter=all and only with live friends.

## 5. Search

- **FR-30 (P0) Search suggestions.** Debounce 220ms; 4 parallel queries at `page 1:20` (songs by title, artists by name, albums, playlists); re-rank client-side (`rankByMatch` semantics: backend LIKE returns alphabetical order, ranking is mandatory); show top 3 per kind. AC: "carlos" surfaces "Carlos Paiao" above alphabetically-earlier weak matches.
- **FR-31 (P0) Recent searches.** Persisted list, max 6, removable per row, shown on focus with empty query. AC: submitting a search stores the term; tapping a recent re-runs it.
- **FR-32 (P0) Suggestion activation.** Song row = replace queue with just that song and play; artist/album/playlist rows navigate. AC: exact web semantics.
- **FR-33 (P0) Full results screen.** Pills `all | songs | playlists | albums | artists`; top-result card (priority: direct artist hit > first song > first album > first playlist > derived artist); songs section plays with queue = whole ranked list at tapped index; artists section merges resource hits with derived name strings (Deezer picture lookup per derived card); album and playlist grids. AC: empty/loading/no-results states match; zero local hits still shows external results.
- **FR-34 (P1) External results + import.** `GET /music/external_search?q=&kind=track`; rows with source badge and Import button; import via `POST /song_imports` (URL mode for youtube/soundcloud, search mode for spotify/itunes/bandcamp with isrc), poll 1.5s, progress bar, dedupe-terminal handling, invalidate library lists on complete. AC: an external Spotify track lands in the library with correct metadata and artwork.

## 6. Library, Artists, Albums

- **FR-35 (P0) Library tab.** Playlist/artist/album lists with filter pills (default `playlists`, queries gated per active pill), local substring filter, `page 1:500`, artists ordered name:asc, windowed rendering (40 rows + incremental). Playlist rows show Spotify badge / liked-mirror purple heart; artist rows circular. AC: a 500-artist library does not fire 500 artwork requests on mount.
- **FR-36 (P0) Artists hub overview.** `GET /artists/overview`: spotlight banner (play/shuffle/radio with lazy spotlight-songs query), 4 stat tiles, shelves (heavy rotation, similar-to-seed, neglected); shelves with zero entries render nothing. AC: matches the shapes incl. `heavy_rotation_window` label switch.
- **FR-37 (P0) Artists roster.** Infinite scroll 60/page, sort toggle (name:asc / created_at:desc restarts the query), debounced server search replaces the grid while filtering. AC: end-of-list = short page; loading/error/empty states.
- **FR-38 (P0) Artist screen.** Resolve by slug-or-name (`GET /artists/:idOrSlug`, 404 falls back to raw segment as display name); hero with banner/photo/initials fallback chain; meta line (listeners, albums, songs). AC: cold artists may be slower (server lazily refreshes external metadata); loading skeletons shown.
- **FR-39 (P0) Artist popular list.** Top 5 by `/play_events/top?scope=song&artist=&since=all`, play-count column; fallback = first 5 songs; row play sets queue = ALL primary songs at the matching index. AC: next/prev from a popular row walk the full catalog.
- **FR-40 (P0) Discography + appears-on.** Album grids from `/songs/albums` with `artist_role=primary` and `featured`. AC: album tiles navigate with slug preference and encoded names.
- **FR-41 (P0) Featured-on song list.** Songs with `artist_role=featured`; play sets queue = featured list. AC: section hidden when empty.
- **FR-42 (P2) About section.** Sanitized `bio_html` + attribution + gallery slideshow (auto-advance 6s, pause on touch). AC: renders only when bio or gallery exists.
- **FR-43 (P0) Album screen.** Songs via `exact_search[album]` (or `"\b"` for unknown album), NOT artist-filtered server-side; client narrows to the context artist when resolvable, falls back to all matches; majority-vote primary artist for the header link; meta = artist, year, count, duration; play/shuffle. AC: an album opened from a featured artist's page still shows every track.
- **FR-44 (P2) Deep-link song highlight.** Album screen can receive a target song (web `#title` hash equivalent): highlight + scroll into view. AC: search top-result song tap lands highlighted.

## 7. Liked songs

- **FR-45 (P0) Liked collection.** Cursor-paged `GET /liked_songs?limit=100&before=<liked_at>`; purple hero; play/shuffle; columns incl. addedAt = liked_at; infinite scroll. AC: liking mid-scroll does not shift pages (cursor, not offset).
- **FR-46 (P0) Like toggle everywhere.** `GET /liked_songs/ids` as the optimistic source of truth; `POST /liked_songs {song_id}` / `DELETE /liked_songs/:song_id` (keyed by SONG id). AC: heart state consistent across rows, player bar, and now playing; optimistic with rollback.

## 8. Playlists

- **FR-47 (P0) Playlist list + create.** `GET /playlists`; create dialog `POST /playlists { name }`; empty state with create CTA. AC: new playlist appears without manual refresh.
- **FR-48 (P0) Playlist detail.** `GET /playlists/:id` + infinite `GET /playlist_songs?exact_search[playlist_id]=&modifiers[page]=N:100&modifiers[order]=position:asc`; meta with total duration; play/shuffle set queue to loaded songs. AC: playlists over 500 tracks fully paginate.
- **FR-49 (P0) Add to playlist dialog.** Non-system playlists only; membership pre-check via `GET /playlist_songs?exact_search[song_id]=`; toggle add (`POST /playlist_songs`) / remove (`DELETE /playlist_songs/<joinRowId>`); inline "new playlist" creation that also adds the song. AC: duplicates show a check instead of bouncing off the uniqueness 400.
- **FR-50 (P0) Row removal + reorder (manual playlists).** Remove by join-row id with optimistic update; drag reorder enabled ONLY when all pages are loaded, sends the COMPLETE song-id array to `POST /playlists/:id/reorder`, optimistic with rollback. AC: reordering a partially loaded playlist is impossible.
- **FR-51 (P0) Artwork change.** Pick image -> square crop -> JPEG <= ~2MB -> `POST /playlists/:id/upload_artwork` (multipart `artwork`). AC: new artwork shows after upload; system playlists have no artwork control.
- **FR-52 (P0) Delete / copy.** Destructive delete with confirm (`DELETE /playlists/:id`); `POST /playlists/:id/copy` (works on system playlists, navigates to the copy). AC: delete navigates back to the list.
- **FR-53 (P0) System playlist rules.** `source_kind != "manual"` = read-only: no rename, no artwork, no add/remove/reorder (server rejects ALL of these including rename, verified in `Playlist#updatable_by?`); show "Synced from Spotify" subtitle + last-synced badge and offer Copy. Liked mirror (`source_external_id == "liked"`) always draws the purple heart artwork. AC: no editing affordance ever appears on a system playlist.

## 9. Playback engine

- **FR-54 (P0) Native audio core.** expo-audio single player with `enableBackgroundPlayback`; `setActiveForLockScreen` with metadata on every song change (Android stops background audio after ~3 min without it). AC: audio continues in background/locked on both platforms with lock-screen artwork and controls.
- **FR-55 (P0) URL resolution.** Never point the player at `/fs_nodes/:id/data`; resolve `GET /fs_nodes/:id/data_url` (2 attempts) and play the presigned URL (6h TTL); cache by fs node id, never by URL. AC: every resolve mints a fresh URL; stale URLs are re-resolved, not replayed.
- **FR-56 (P0) Variant selection.** Jam `audio_url` if present; else mode-driven stem node (instrumental/vocals with fallback); else `compressed_audio_fs_node_id || audio_fs_node_id`. AC: compressed preferred whenever it exists.
- **FR-57 (P0) Queue model.** The quartet `{queue, queueOrder, queueIndex, shuffle}` as one atomic unit with exact operation semantics: setQueue (identity or full-shuffle order; takeover steal when not active), setQueueIndex, setShuffle (only reshuffle point; ON moves current to front, OFF returns to natural position), addToQueue, playNext, reorderQueue (visible indices, cursor fixups), removeFromQueue (refuses current row, remaps order entries). AC: property tests over the invariants (order is a permutation; index within order) pass for every operation.
- **FR-58 (P0) Loop and transport semantics.** Loop modes none/one/all (default all); repeat-one implemented on the `ended` event, never a native loop flag; previous = restart if position > 3s else index-1 with wrap only under All; next wraps under All, restarts on single-song queues. AC: end-of-song sleep timer fires under repeat-one.
- **FR-59 (P0) Transition safety.** Generation token + loading-song-id guard on every transition; pending seeks applied after metadata loads; autoplay decided by transition cause (user action = play; cold hydration = paused seek; transfer = honor remote flag; same-song patches never restart). AC: rapid skipping never plays the wrong track or double-plays.
- **FR-60 (P0) Prefetch.** Resolve the upcoming song's URL when <= 30s remain (skip when: controller, LoopOne, jam song next, next already failed); honor only on songId+nodeId match within 5 min; one-shot consumption. AC: track transitions are gapless-ish on good networks; a failed song re-resolves fresh.
- **FR-61 (P0) Failure recovery.** Stream error: first failure re-resolves fresh URL, restores position, resumes if intended; second failure marks failed and advances; failed-set stops runaway skip chains; audible playback clears the mark; throttled "song unavailable" toast. AC: an expired URL mid-song recovers in place.
- **FR-62 (P0) Play recording.** Accumulate forward `timeupdate` deltas in (0,2)s; record `POST /play_events {song_id}` at `min(30s, duration/2)`; reset on song change and on natural end; never for jam songs or transferred-in seeds; fire-and-forget. AC: scrubbing does not inflate plays; server dedupes 30s repeats anyway.
- **FR-63 (P0) Remote commands / media session.** Lock-screen and hardware handlers for play/pause/seek/seekfwd(+10)/seekback(-10)/next/prev that route through the remote-aware action layer (commands when controller). AC: lock-screen next on a controller device advances the active device.
- **FR-64 (P0) Volume / seek / rate / sleep.** Volume 0..1; seek with retry; rate slider 0.5-1.5 with pitch shifting (no pitch preservation, deliberate); sleep timer minutes (5/10/15/30/60) or end-of-song, not persisted. AC: rate persists across restarts; sleep timer pauses and clears.
- **FR-65 (P0) Playback preference persistence.** Persist: rate, volume, separation enabled, playback mode (custom restores as original), stem volumes, EQ bands (not eqEnabled), loop mode. Queue itself is NOT persisted locally (server snapshot is the account queue). AC: relaunch restores listener settings; queue comes from hydration (FR-97) or empty.
- **FR-66 (P0) Artwork accent extraction.** Average color per song with light/dark variants cached per song id (LRU 100), guard against stale async results. AC: gradients update on song change without re-downloading bytes.
- **FR-67 (P2) Playing bars.** 4-bar level meter with non-harmonic animation durations, frozen at 1/3 height when paused. AC: shown in queue rows / index cells for the current song.

## 10. Playback modes and vocal separation

- **FR-68 (P1) Instrumental / vocals modes.** Play the stem FILE itself (mp3) with fallback to the plain mix when stems missing; mode switch preserves position and play state; stale-queue reconciliation swaps to the stem file when ids land later. AC: switching modes mid-song continues from the same position.
- **FR-69 (P2) Custom blend mode.** Native dual-source sample-synced mixer (stems with independent vocal/instrumental gains 0..1) with the plain file as fallback; wire value `custom` in snapshots either way. AC: blend sliders act live without desync; never restored on relaunch.
- **FR-70 (P2) 3-band EQ.** low/mid/high +-12dB (lowshelf 120Hz, peaking 1kHz, highshelf 8kHz); bands persist, enabled flag does not. AC: flat EQ has zero audio-path overhead.
- **FR-71 (P1) Separation lifecycle.** Explicit trigger `POST /songs/:id/separate` (optional model_id); shared 3s status poll of `GET /songs/:id/separation` that parks on "no job, no stems" and stops on ready/terminal; status projection idle/pending/processing/ready/failed with elapsed timer; on ready PATCH the queue entry in place (no restart); `DELETE /songs/:id/separation` removes stems. AC: separation completes without interrupting the currently playing track; menu item disabled/relabelled while processing.

## 11. Queue UI and song actions

- **FR-72 (P0) Queue screen.** Renders visible order (`queueOrder.map(i => queue[i])`); tap current row toggles play, other rows jump; remove disabled on the active row; jam proposals show proposer attribution. AC: all callbacks use visible indices.
- **FR-73 (P0) Queue drag reorder.** Long-press drag calls `reorderQueue(from, to)` with cursor fixups. AC: reorder during playback never changes the audible song.
- **FR-74 (P0) Canonical song menu.** One shared action list everywhere (rows, player, now playing): Play/Pause, Like/Unlike, Play next, Add to queue, Open album, Open artist, View credits (grouped by role), Add to playlist, surface extras (e.g. Remove from playlist), Start radio (P1), Propose to jam (P1, only while following with queue_mode everyone), Separate vocals (P1, only when stems absent; disabled with elapsed label while processing), Download / Remove download (native). AC: menu contents and conditions identical across surfaces.

## 12. Lyrics

- **FR-75 (P0) Lyrics fetch + display.** `GET /lyrics?song_id=` (200 with nulls = no lyrics, show empty state; first fetch can take seconds, show skeleton; client cache ~24h); attribution footer; plain-only fallback rendering (static lines). AC: no aggressive retry (server negative-caches misses 24h).
- **FR-76 (P0) LRC parsing.** Exact rules: `[mm:ss.xx]` regex, multiple timestamps per line fan out, metadata tags and untimed lines skipped, empty timed lines render a placeholder dot, sorted ascending. AC: parser unit tests cover all four rules.
- **FR-77 (P0) Synced rendering.** Frame-driven active line = last line with time <= position (state updates only on index change); active line emphasized; auto-center scroll; manual scroll suppresses follow for 4s with a "back to current line" pill; index resets on song change; frame loop stops when the lyrics view is not visible. AC: no 60fps re-render churn; battery-safe when hidden.
- **FR-78 (P0) Tap-to-seek.** Tapping a synced line seeks and resumes auto-follow. AC: works on placeholder-dot lines too.
- **FR-79 (P1) Translation.** 7 targets (pt en es fr de it lv), persisted target per device defaulting to UI locale; `GET /lyrics/translation` with staleTime infinity, never auto-retry 429/404; synced alignment by `time.toFixed(2)` key, plain by line index; identical lines suppressed; original drops to secondary line. AC: 429 shows the limit message inline; toggle-off keeps the stored target.
- **FR-80 (P1) Sync generation.** For plain-only lyrics: `POST /lyrics/sync` -> await job via JobChannel + 10s REST poll fallback (404 during poll = keep waiting) -> refetch lyrics on complete; button disabled with spinner while running; caps 10/h. AC: success switches to the timed view with the "+ sync gerada" attribution.
- **FR-81 (P0) Offline lyrics.** Lyrics stored with downloads (tri-state: undefined = never fetched, null = confirmed none, value = cached); lyrics resolver falls back to the local record when offline. AC: downloaded songs show lyrics in airplane mode; "no lyrics" is never refetched forever.

## 13. Downloads and offline

- **FR-82 (P0) Download status contract.** Reimplement `DownloadStatusContext`: sync `getStatus`/`getProgress` per song, one coarse subscribe channel, optional `downloadMany`, `isOfflineCollection`/`toggleOfflineCollection`, `showOnlyDownloaded`. AC: shared list rows read status synchronously without per-row subscriptions.
- **FR-83 (P0) Per-song download bundle.** Up to five files keyed `(songId, kind)`: `mixed` (compressed preferred), `mixed_original` (only when distinct, quality upgrade), `artwork`, `vocal`/`instrumental` (when includeStems and ids exist), plus the full Song JSON stored up-front and best-effort lyrics. Jam songs excluded entirely. AC: status shown to the UI is the `mixed` kind only.
- **FR-84 (P0) Background transfer engine.** Downloads via `/fs_nodes/:id/data?token=` (redirect-following; beware forwarding the Authorization header onto presigned S3 URLs) or the data_url two-step; iOS background session; PERSISTED task map so completions after process death re-attach (the old Capacitor design lost them and relied on repair); files under an app-support dir excluded from cloud backup, real extensions preferred. AC: kill the app mid-download, relaunch, downloads complete or resume without user action.
- **FR-85 (P0) Download state persistence.** SQLite records per `(songId, kind)`: filename, source URL key, local path/URL, sibling URL for originals, size, timestamps; registries for audio/original/artwork lookups; song ids normalized to ONE representation (string) at the storage boundary. AC: state survives relaunch; storage usage from a native directory walk.
- **FR-86 (P0) Row badges + menu items.** Check when done, pulsing icon + percent while queued/downloading, error icon on failure; mobile menu: Download / "Downloading N%" (disabled) / Remove download. AC: progress updates are throttled (single coarse version counter).
- **FR-87 (P0) Offline collections.** Playlists (numeric id) and albums (`album:<artistSlug>:<album>` composite key) toggleable offline; enabling downloads every song (sequential, dedup-resumable); disabling removes downloads; collection refetches auto-download newly added songs; ActionBar offline toggle prefers keep-synced semantics. AC: adding a song to an offline playlist downloads it on next open.
- **FR-88 (P0) WiFi-only gate.** Enforced at enqueue time (refuse, do not silently queue); allow when probe fails. AC: enabling wifiOnly on cellular refuses new downloads with a clear message.
- **FR-89 (P0) Repair and retry.** On reconnect and on boot-while-online: retry errored songs and run verify-and-repair (re-enqueue any missing kind incl. lyrics-undefined); idempotent via dedup. AC: a library downloaded before stems shipped gains stems automatically.
- **FR-90 (P0) Offline playback ladder.** Player source resolution: local original file -> local compressed file -> network URL; first accepted by the decoder wins; stems resolve locally the same way. AC: FLAC masters play when the OS decodes them, silently fall back otherwise; airplane-mode playback works.
- **FR-91 (P0) Offline library browsing.** When offline, library/albums/artists/songs queries fall back to resolvers derived from downloaded song records (same album grouping key as the backend); offline image resolver serves local artwork; global offline flag skips doomed network calls. AC: airplane mode still browses and plays the downloaded library with artwork.
- **FR-92 (P0) Downloads screen.** Header with count + storage bytes + offline pill; in-flight section with percentages; downloaded list (tap = play the downloaded list as queue; per-row delete); empty state instructions. Copy in PT-PT for the pt locale. AC: matches the Capacitor page behavior.
- **FR-93 (P0) Download settings.** wifiOnly (default off), includeStems (default on, ~2x storage note), showOnlyDownloaded filter (collection screens filter to done and suppress reorder). AC: settings persist; only-downloaded empty state is distinct.
- **FR-94 (P2) Storage cap.** `maxStorageBytes` enforcement (the old design defined but never enforced it); do not surface a cap UI unless enforced. AC: exceeding the cap blocks new enqueues with an explanation.

## 14. Settings area

- **FR-95 (P0) Settings hub.** Entries: Import (P1 flows), Songs, Artists, Playback, plus native-only Downloads settings and app prefs (theme, language). AC: navigable from the library/shell.
- **FR-96 (P1) Songs management.** Infinite `/songs` at 500/page with load-more and `<loaded>+` total; client filters (title/artist/album substring, origin, quality, codec) with parallel server search folding in beyond loaded pages; multi-select bulk delete with confirm; edit dialog (multipart PATCH: title, album, year, position, artwork file; artist chips emitting `artist_names[]` + ALWAYS `featured_artist_names[]` with a single empty string when none, or the legacy title heuristic kicks in); stems controls embedded. AC: editing artists never silently reparses "feat." out of titles.
- **FR-97 (P1) Artists management.** Table over `/artists`; rename via `PATCH /artists/:id` with FLAT top-level body (the web's nested `{artist:{...}}` does not match the backend permit); image upload field `image`; banner upload field `banner` (the web's `image` field 400s); delete refused while songs reference the artist. AC: rename re-slugs server-side and the UI follows.
- **FR-98 (P0) Playback settings.** share_listening toggle (read from account, default true when absent; write via multipart `PATCH /users/:id`). AC: toggling off hides the user's song from friends within the documented channel semantics.

## 15. Import (all P1, screen: Settings > Import)

- **FR-99 (P1) File upload import.** Multi-file picker, audio-only filter, `POST /songs/import` multipart per file (synchronous, up to tens of seconds for lossless; long timeout), concurrency 3, aggregate toasts, global import-busy flag shared across surfaces. AC: a folder of mp3s lands with tags, artwork, and artists parsed.
- **FR-100 (P2) Folder import resume.** Per-folder tracker (success/failed file lists) persisted; skip already-imported files on retry; incomplete-import warning card with retry/ignore/dismiss. AC: re-importing a folder is incremental.
- **FR-101 (P1) URL import.** `POST /playlist_imports/preview { url }` (spinner, inline errors: Spotify-URL refusal message, SSRF refusal, 502 upstream text; 60/h cap); confirm modal with per-track title/artist/album edits, artwork picker (`POST /tools_downloader/artwork_search` or upload -> `artwork_url` / `artwork_data_b64`), target selector (new playlist / existing / library only); sequential `POST /song_imports` with incrementing positions. AC: a YouTube playlist URL becomes a playlist with correct order and artwork.
- **FR-102 (P1) Import progress.** Poll `GET /song_imports/:id` at 1.5s while pending/processing; `progress_pct` is 0..1; `deduped: true` responses are already terminal (no polling); failed shows `error_message`. AC: per-track state icons in the modal sidebar.
- **FR-103 (P1) Spotify sync.** Gated by `allowed_to_use_spotify` (hide the tab AND expect 403s); link account via in-app browser to `/auth/link/spotify?token=`; status/preview/settings/trigger endpoints; poll status 1.5s while running; per-playlist progress rows; destructive warnings (deselecting deletes local copies, disabling liked-sync deletes the mirror); stale running > 2h shows as failed. AC: enabled playlists appear as read-only system playlists after a sync.
- **FR-104 (P1) Artist import.** Requires linked Spotify identity (NOT the allowlist flag); debounced `GET /artist_imports/search` (roster + spotify columns), album multiselect from `GET /artist_imports/albums`, `POST /artist_imports`, recents list polling 1.5s while queued/running with progress rows; Spotify error classification (connect / relink / upstream retry / generic). AC: a full discography import shows live album-level progress.

## 16. Remote playback and devices (all P1)

- **FR-105 (P1) Cable connection.** `wss://backend.omelhorsite.pt/cable?token=`; ActionCable v1 framing; wait for welcome, resubscribe all on reconnect, backoff 1s..30s; subscription rejections are the auth failure signal (anonymous connects succeed). AC: token in the query param only (a stale header would win over it).
- **FR-106 (P1) PlaybackChannel presence.** Subscribe with per-launch `device_id` (8-64 chars, [A-Za-z0-9-]) + `device_label`; heartbeat every 20s (server TTL 75s); request_snapshot + heartbeat on every app foreground. AC: the device shows online in pickers and friends' feeds while the app runs.
- **FR-107 (P1) Role state machine.** offline / no_active / active / controller derived from snapshots; on becoming controller force-pause and clear the local source; blocked/activating as active sub-states. AC: exactly one audible device at any time.
- **FR-108 (P1) Cold-start hydration.** With role no_active, non-empty server snapshot, empty local queue: adopt the sanitized snapshot (drop jam proposals with index/order remap, validate permutation, clamp index), plant a paused activation seed, adopt loop + listener settings (never volume); play claims `if_none` (pessimistic; claim_rejected demotes). AC: "continue where you left off" resumes at the right song and position, paused.
- **FR-109 (P1) Controller mode.** Mirror snapshot; slim `state_changed` merges with the last full `queue_songs` list; 1Hz tick interpolation with 5s staleness fallback and song-id mismatch dropping; all transport actions become validated `command` sends; volume drag = set_volume on the active device; local-only settings greyed out. AC: controlling from a second device feels live within ~1s.
- **FR-110 (P1) Active mode publishing.** Debounced (200ms) `state_changed` with full listener settings and string song ids; `position_tick` at 1Hz while playing; handle server `error` messages by request_snapshot resync; respect server clamps (queue 1000, rate 0.25-4, EQ +-12). AC: another device's UI matches this device within a tick.
- **FR-111 (P1) Transfer and takeover.** Device picker (self "Play here", online targets, offline recents disabled, needs-interaction hint on activation_blocked); transfer target adoption per the activation flow (adopt queue + settings, honor paused, suppress publishes until first audible timeupdate, blocked flow on autoplay refusal); `setQueue` on a non-active device = steal takeover playing locally. AC: mid-song transfer resumes on the target within the same second of audio.
- **FR-112 (P2) Reconnect steal + handoff.** If the cable dropped while active and nobody claimed meanwhile, steal on reconnect and force-publish truth. AC: a WS blip never pauses local audio.

## 17. Jams (all P1)

- **FR-113 (P1) Jam lifecycle.** Create (`POST /jams`, then claim active with steal - a host with no active device is a silent jam), join (friend-of-a-member rule; join BEFORE subscribing), leave (host leaving ENDS the jam; no handoff), end, rules PATCH (queue_mode everyone/host, skip_mode majority/host/anyone); one jam at a time enforced server-side. AC: `GET /jams` on app start resumes an in-progress jam.
- **FR-114 (P1) JamChannel following.** Receive-only channel; snapshot on subscribe (position may be ~5s stale); state_changed / position_tick / members_changed / jam_updated / song_proposed / skip_votes / skipped / ended handling; rejection = jam gone, clear state. AC: followers stay within 2.5s drift (hard-seek beyond it), pause when host pauses, extrapolate ticks on local resume.
- **FR-115 (P1) Follower player.** Dedicated player fed by presigned `audio_url`; track identity by song id, never URL; pending seek on metadata; local pause allowed; local volume; starting real local playback auto-leaves (1.5s join grace). AC: a follower hears the host's audio without touching their own queue.
- **FR-116 (P1) Host duties.** Execute server-injected `jam_add_song` (FIFO insert after current, behind earlier proposals) and `next` commands; play proposals via their presigned URLs with proposer attribution; never record plays, persist, download, or separate jam songs; JamBar replaces the player bar while following. AC: a member proposal audibly enters the host queue in order.
- **FR-117 (P1) Propose + skip vote.** Propose own songs only (interception: while following with queue_mode everyone, "play" on a library song becomes a proposal); `POST /jams/:id/skip_vote` with `{skipped, count, needed}` display; tallies reset silently on track change; host vote always skips. AC: vote UI matches skip_mode (hidden for non-hosts in host mode).
- **FR-118 (P1) Invites.** Invite accepted friends (`GET /relationships` filter friend+accepted); arrives as a `jam_invite` notification; invitees find the jam in `GET /jams` joinable. AC: invite flow completes without any accept-API (there is none).

## 18. Social (all P1)

- **FR-119 (P1) Friends listening feed.** FriendListeningChannel snapshot + full-row `listening_update` replaces; sort live rows first then updated_at desc; rosters are subscribe-time (resubscribe on foreground); strip on Home + a fuller panel. AC: a friend pressing play appears within a second; sharing-off friends show presence without the song.
- **FR-120 (P1) Music profile.** `GET /users/:idOrHandle/music_profile`; `{visible:false}` renders nothing (a 200, not an error); visible: now playing row, top artists (image pick order: image_url > picture_big > picture_xl > picture_medium > picture > external_image_url), top songs, recent, plays_30d; all media presigned. AC: private and empty profiles are indistinguishable.

## 19. Mixes and radios (all P1)

- **FR-121 (P1) Mixes.** `GET /music_mixes` list + `GET /music_mixes/:slug` (URL-encode; slugs contain `:`); titles/descriptions from `title_key`/`description_key` + params via i18n; kind gradients and stamp text rules client-owned; artist photo overlay with dark scrim for top_artist; detail = hero + play/shuffle + table; 404 on rotated slug = refetch the list. AC: server-cached 24h; no fake refresh UX.
- **FR-122 (P1) Radios.** `GET /music_radios/artist/:slug` and `/song/:id` (404 when unbuildable, not empty); pre-baked Portuguese titles rendered as-is; song radio's `songs[0]` is the seed; detail with play/shuffle/save-as-playlist (`POST /playlists { name, song_ids }` then navigate); backdrops from Deezer pictures / seed artwork; kind accent fallbacks. AC: server-cached 7 days per seed; save freezes the batch.
- **FR-123 (P1) Radio entry points.** Artist page/spotlight ActionBar radio button; song menu "Start radio". AC: missing params fall back to Home.

## 20. Misc polish

- **FR-124 (P2) Sticky titles.** Collection screens fade in a blurred title bar once the hero scrolls off. AC: includes a leading play action.
- **FR-125 (P2) Song credits dialog.** Artists grouped primary/featured/with ordered by position. AC: only rendered when `song.artists` non-empty.
- **FR-126 (P2) Metadata modifier tool.** Local-file tag editor via `POST /songs/metadata_modifier` returning the modified binary (50MB cap; `track_number` silently dropped server-side). AC: optional; not part of the library flows.

Total features: 126 (FR-1 .. FR-126). P0: 77, P1: 35, P2: 14.

---

## Known contradictions resolved against code

1. System playlist rename: REJECTED server-side (`Playlist#updatable_by?` = owner AND not system). The api-music.md note claiming rename works is wrong. Delete IS allowed (ownership only).
2. Session cookie name is `oms_session` (`Session::COOKIE_NAME`); irrelevant to the native client, which must use bearer tokens.
3. Artist PATCH takes FLAT top-level keys and banner upload requires multipart field `banner`; the current web client deviates on both (its calls no-op/400) - follow the backend, not the web.
4. VocalSeparation status enum has NO `canceled` value (the web checks for one defensively); treat `complete|failed` as terminal.
5. `POST /songs/clean` is a dead route; `GET /songs/artists` ignores all filters; do not implement against either.

## Build-order suggestion

1. HTTP layer + auth + shell/theme/i18n (FR-1..22).
2. Browse: Home, Library, Artists, Album, Liked, Playlists, Search (FR-23..53).
3. Playback engine + queue + song menu + lyrics (FR-54..81, minus P1/P2 stems extras).
4. Downloads/offline (FR-82..94).
5. Settings + P1 waves: remote playback, jams, social, mixes/radios, import, stems.
