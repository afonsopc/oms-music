# design-product.md - oms-music native app architecture (product-completeness lens)

Target: React Native app in `/Users/afonsocoutinho/Documents/oms-music` (Expo SDK 57, expo-router, TypeScript strict, reactCompiler on) rebuilding the omelhorsite music web app with full parity of all 126 FRs against the unchanged production backend `https://backend.omelhorsite.pt`. Companion docs: SPEC.md (FRs), API.md (wire contract), STACK.md (package decisions), plus the 9 topic docs.

Non-negotiables inherited from the specs, restated once so every work package respects them:

- expo-audio is the player. Shuffle/repeat in JS. `setActiveForLockScreen` on every song change (Android kills background audio in ~3 min without it).
- Web client conventions reproduced exactly: `"\b"` null sentinel, bare-string error bodies, `?token=` on media URLs, presigned-URL lifecycle (cache by fs-node id, never by URL), string song ids on the cable vs numeric in REST.
- Do NOT copy the two known web bugs: artist PATCH is FLAT top-level (not nested `{artist:{...}}`), banner upload field is `banner` (not `image`).
- i18n: en (default), pt (European Portuguese ONLY), lv. Catalog keys mirror the web (`components.music.<Component>.<key>`); mix titles render from `title_key` + `title_params`, never the English fallback.
- State split: react-query = server data; zustand = player/session/UI; expo-sqlite = offline library + download queue; expo-secure-store = token.
- Never use the em-dash character anywhere. Plain hyphens only.

---

## 1. Directory layout under src/

Designed so multiple agents can work in parallel without touching the same files. Rule zero: **route files under `src/app/` are thin one-screen wrappers created once by the shell work package (WP-2) and never edited again**; all screen logic lives in `src/features/<screen>/`, all shared visuals in `src/ui/`, all wire logic in `src/api/`, `src/cable/`, `src/player/`, `src/offline/`. Cross-package imports flow downward only: `features -> (ui, api, player, offline, cable, i18n, lib)`; `player/offline/cable -> (api, lib)`; nothing imports from `features`.

```
src/
  app/                          # expo-router routes. THIN WRAPPERS ONLY. Owned by WP-2.
    _layout.tsx                 # providers: Theme, QueryClient, I18n, SessionGate, PlayerHost, CableHost
    (auth)/
      _layout.tsx
      login.tsx
      signup.tsx
      reset-password.tsx
    (main)/
      _layout.tsx               # Stack + persistent overlay host (MiniPlayer, JamBar, toasts)
      (tabs)/
        _layout.tsx             # 3 tabs: home, search, library
        home.tsx
        search.tsx
        library.tsx
      liked.tsx
      playlists.tsx
      playlist/[id].tsx
      artists.tsx
      artist/[artist]/index.tsx
      artist/[artist]/[album].tsx      # album detail; album segment "null" = unknown album
      mix/[slug].tsx
      radio/artist/[artist].tsx
      radio/song/[id].tsx
      downloads.tsx
      profile/[handle].tsx
      settings/
        index.tsx               # hub (incl. theme + language rows)
        import.tsx
        songs.tsx
        artists.tsx
        playback.tsx
        downloads.tsx
        devices.tsx
    (player)/                   # full-screen modal group (slides over (main))
      _layout.tsx               # swipeable pager / top segmented control
      now-playing.tsx
      queue.tsx
      lyrics.tsx
    jam.tsx                     # jam panel (modal)
    friends.tsx                 # friends listening panel (modal)

  api/                          # Owned by WP-1 (client, contracts) and per-domain files by feature WPs as listed in section 12
    client.ts                   # fetch wrapper: bearer header, "\b" sentinel, bracket params, error parse, 401/429/304
    queryClient.ts              # single QueryClient, staleTime 25s, retry off, no refetch-on-focus, onlineManager<-NetInfo
    keys.ts                     # central react-query key factory (one file so keys never collide)
    media.ts                    # fs-node URL builders: artworkUri(nodeId), avatarUri(userId), dataUrlResolve(nodeId)
    contracts/
      song.ts artist.ts playlist.ts user.ts session.ts jam.ts playback.ts
      mixes.ts radios.ts lyrics.ts imports.ts spotify.ts common.ts
    queries/                    # react-query hooks per domain (files listed per WP in section 12)
      songs.ts albums.ts artists.ts playlists.ts playlistSongs.ts likedSongs.ts
      playEvents.ts mixes.ts radios.ts lyrics.ts separation.ts search.ts
      externalSearch.ts songImports.ts playlistImports.ts spotifySyncs.ts
      artistImports.ts users.ts sessions.ts jams.ts relationships.ts jobs.ts

  auth/                         # WP-2
    tokenStore.ts               # SecureStore read/write, in-memory mirror
    sessionStore.ts             # zustand: {status, session, user}; bootstrap; logout
    oauth.ts                    # provider flow via WebView interception + /sessions/adopt
    userAgent.ts                # meaningful UA string for session naming

  cable/                        # WP-8
    client.ts                   # hand-rolled ActionCable v1 client (welcome gate, backoff 1..30s, resubscribe)
    channels/
      playback.ts jam.ts friends.ts job.ts notifications.ts
    ids.ts                      # string<->number song id normalization at the cable boundary

  player/                       # WP-4 core; remote/ by WP-8; jam/ by WP-9
    store.ts                    # zustand: queue quartet, position, playing, loop, shuffle, rate, volume, modes, sleep
    queueOps.ts                 # pure functions: setQueue/setShuffle/addToQueue/playNext/reorder/remove (property-testable)
    service.ts                  # PlayerService singleton over expo-audio AudioPlayer
    sourceResolver.ts           # local-first ladder + presigned resolve + prefetch cache (by node id)
    recovery.ts                 # failure ladder, failed-song set
    playRecorder.ts             # forward-delta accumulator -> POST /play_events
    lockScreen.ts               # setActiveForLockScreen metadata + remote command handlers
    sleepTimer.ts
    modes.ts                    # playback mode selection (original/instrumental/vocals[/custom])
    separationWatcher.ts        # shared 3s poll + queue patch-in-place
    accentColor.ts              # artwork average color, dual-theme LRU 100
    persistence.ts              # kv-store persistence of listener settings (FR-65)
    actions.ts                  # THE remote-aware action layer every UI surface calls
    remote/                     # WP-8
      roleStore.ts publisher.ts controller.ts hydration.ts transfer.ts deviceStore.ts
    jam/                        # WP-9
      jamStore.ts follower.ts hostDuties.ts interceptor.ts

  offline/                      # WP-7
    db.ts                       # expo-sqlite open + migrations
    schema.sql.ts
    downloadManager.ts          # enqueue/dedup/remove, WiFi gate, task re-attach
    downloadQueue.ts            # 3-concurrent JS queue over File.createDownloadTask
    statusStore.ts              # zustand + version counter; sync getStatus/getProgress
    collections.ts              # offline collection set + keep-synced hook
    repair.ts                   # retryFailures + verifyAndRepair (boot + reconnect)
    settings.ts                 # wifiOnly/includeStems/showOnlyDownloaded (+ dormant maxStorageBytes)
    resolvers/
      library.ts image.ts lyrics.ts   # offline fallbacks wired into api/queries via withOfflineFallback
    context.tsx                 # DownloadStatusContext contract (FR-82)

  ui/                           # WP-1 theme; WP-3 components
    theme/
      tokens.ts                 # light+dark HSL palettes (ported from globals.css), radius, spacing
      ThemeProvider.tsx         # light/dark/system, persisted
      gradients.ts              # mixToward(black|white) helpers, hero/player gradient builders
      fixed.ts                  # MUSIC_ACCENT #4B1E6D, LIKED_ACCENT #7e22ce, mix/radio kind gradient+accent maps
      typography.ts             # Inter, OMS Wide, Cantarell registration + text styles
    components/
      Screen.tsx Hero.tsx StickyTitle.tsx ActionBar.tsx
      SongTable.tsx SongRow.tsx PlayingBars.tsx
      Tile.tsx Rail.tsx TopTileGrid.tsx FilterPills.tsx
      ArtistCard.tsx ArtistInitialsAvatar.tsx AlbumCard.tsx MixTile.tsx LikedArtwork.tsx
      Artwork.tsx               # expo-image wrapper: token param, offline resolver, shared placeholder photo
      ContextMenu.tsx BottomSheet.tsx Dialog.tsx ConfirmDialog.tsx Toast.tsx
      EmptyState.tsx ErrorState.tsx Skeletons.tsx SearchInput.tsx SectionHeader.tsx
      ProgressBar.tsx Slider.tsx Badge.tsx
    songMenu/
      useSongActions.tsx        # THE canonical song action list (FR-74)
      SongCreditsDialog.tsx AddToPlaylistDialog.tsx

  features/                     # screen logic; one folder per screen (owners in section 12)
    auth/ home/ search/ library/ liked/ playlists/ playlist/ artists/ artist/
    album/ mix/ radio/ downloads/ settings/ import/ nowPlaying/ queue/ lyrics/
    jam/ friends/ profile/ shell/     # shell/ = MiniPlayer, JamBar, tab bar, DevicePicker

  i18n/                         # WP-1
    index.ts                    # t(), useT(), locale store (persisted), ICU-subset interpolation
    catalogs/en.json pt.json lv.json   # ported from web, music namespaces + auth/common additions
    mixLabels.ts                # title_key/description_key rendering helper

  lib/                          # WP-1
    rankByMatch.ts formatArtists.ts artistArtwork.ts artistRoute.ts
    duration.ts dates.ts ids.ts deepLinks.ts recentSearches.ts kv.ts
```

---

## 2. Navigation tree (expo-router) - all 28 screens

Root `_layout.tsx` renders providers and a Stack with three groups. `SessionGate` redirects: no token or 401 bootstrap -> `(auth)`; else `(main)`.

Tab model: 3 tabs (Home, Search, Library), Spotify-style. Everything else is pushed onto the `(main)` stack ABOVE the tabs; the persistent overlay host in `(main)/_layout.tsx` renders the MiniPlayer (or JamBar while following a jam) on top of every screen, and every scrollable screen adds bottom padding (FR-16). The `(player)` group presents as a full-screen modal with a swipeable pager across Now Playing / Queue / Lyrics (FR-17 allows tabs or pages).

The 28 screens, with route, purpose, and FR anchors:

| # | Screen | Route | FRs |
|---|---|---|---|
| 1 | Login | `(auth)/login` | FR-7, FR-11 entry, FR-12, FR-13(P2) |
| 2 | Signup (OTP) | `(auth)/signup` | FR-8 |
| 3 | Reset password | `(auth)/reset-password` | FR-11 |
| 4 | Home (Discover) | `(main)/(tabs)/home` | FR-23..29 |
| 5 | Search (suggestions + full results) | `(main)/(tabs)/search` | FR-30..34 |
| 6 | Library | `(main)/(tabs)/library` | FR-35 |
| 7 | Liked songs | `(main)/liked` | FR-45..46 |
| 8 | Playlists list | `(main)/playlists` | FR-47 |
| 9 | Playlist detail | `(main)/playlist/[id]` | FR-48..53, FR-87 |
| 10 | Artists hub | `(main)/artists` | FR-36..37 |
| 11 | Artist | `(main)/artist/[artist]` | FR-38..42, FR-123 |
| 12 | Album | `(main)/artist/[artist]/[album]` | FR-43..44, FR-87 |
| 13 | Mix detail | `(main)/mix/[slug]` | FR-121 |
| 14 | Artist radio | `(main)/radio/artist/[artist]` | FR-122..123 |
| 15 | Song radio | `(main)/radio/song/[id]` | FR-122..123 |
| 16 | Downloads | `(main)/downloads` | FR-92 |
| 17 | Profile (music profile) | `(main)/profile/[handle]` | FR-120 |
| 18 | Settings hub (+ theme, language) | `(main)/settings` | FR-95, FR-18, FR-19 |
| 19 | Settings: Import | `(main)/settings/import` | FR-99..104 |
| 20 | Settings: Songs | `(main)/settings/songs` | FR-96, FR-126(P2) |
| 21 | Settings: Artists | `(main)/settings/artists` | FR-97 |
| 22 | Settings: Playback | `(main)/settings/playback` | FR-98 |
| 23 | Settings: Downloads | `(main)/settings/downloads` | FR-93..94 |
| 24 | Settings: Devices | `(main)/settings/devices` | FR-14(P2) |
| 25 | Now Playing | `(player)/now-playing` | FR-17, FR-63..70 |
| 26 | Queue | `(player)/queue` | FR-72..73 |
| 27 | Lyrics | `(player)/lyrics` | FR-75..81 |
| 28 | Jam panel | `jam` (modal) | FR-113..118 |

Plus one modal not counted as a screen by the web map: `friends` (fuller friends-listening panel, FR-119; the Home strip links to it). DevicePicker (FR-111) and all dialogs (create playlist, add-to-playlist, credits, confirm delete, import confirm) are bottom sheets, not routes.

Deep links (FR-20, `lib/deepLinks.ts`): the root layout registers a Linking handler that parses incoming `omelhorsite.pt` URLs: strip locale prefix (`/en|/pt|/lv`), map `/music/discover|liked|artists|playlists|search` to tabs/stack, `?id=` and `?slug=` detail params, BOTH `/music/artist/<a>/<al>` and `/music/album/<a>/<al>` forms to screen 12, artist segment = slug or URL-encoded name, literal `"null"` album segment preserved. The `omsmusic://` scheme mirrors the same paths.

### 2.1 Per-screen data, pagination, menus, empty states

Every screen below states: queries (with page shapes), interactions, and states. All lists that can exceed 500 rows MUST paginate (server hard cap). All artwork goes through `ui/components/Artwork.tsx` (shared placeholder photo fallback, FR-21; offline resolver aware). Every song list row uses `SongRow` + `useSongActions` so the canonical menu (FR-74) is identical everywhere; long-press opens the same menu as the trailing ellipsis.

**1 Login.** `POST /sessions` with meaningful User-Agent; store token; OAuth buttons (Google/GitHub/Spotify) open `oauth.ts` flow; links to signup/reset. Errors: bare-string 401 shown inline; 429 shows retry-after countdown. Passkey button hidden in v1 (FR-13 blocked on associated domains).

**2 Signup.** Step 1 email -> `create_start` (409 "already registered" inline); step 2 six-digit code + name + password -> `create_end` -> immediate `POST /sessions` (create_end does NOT log in); 404 "Invalid Verification" inline; resend respects 4/min + 20/h caps with a disabled-with-countdown button.

**3 Reset.** `reset_password_start` (always 200, anti-enumeration copy) -> code + new password -> `reset_password_end` -> back to login prefilled.

**4 Home.** 5 parallel queries: recent albums (`/play_events/recent?group_by=album&limit=8`), mixes (`/music_mixes`), playlists (`1:20`), random albums (`/songs/albums?modifiers[random]=true&modifiers[page]=1:10`), top artists (`/play_events/top?scope=artist&since=30d&limit=10`). Layout: filter pills (all/playlists/albums/artists, local state, animated primary capsule) -> top tiles (8 recent albums, fallback first 8 playlists, hidden when both empty) -> friends strip (filter=all, live rows only, links to `friends` modal) -> "Made for you" rail (MixTiles; hidden when loaded-and-empty; skeletons while loading) -> "Recommendations today" rail (title falls back to unknown-album i18n) -> "Your playlists" rail (Show all -> playlists) -> "Your artists" rail (circles, hidden when empty). `artist` on play_events is polymorphic (Artist object OR string): use `artistDisplayName`/`artistRouteSegment` from lib. Empty sections silently collapse. Fires `POST /service_usages {service_id:"music"}` once on first mount (FR-22, fire-and-forget).

**5 Search.** One screen, two modes. Input mode (empty submit): recents list (max 6, kv-persisted, per-row remove) and, while typing (debounce 220ms), 4 parallel `1:20` queries re-ranked by `rankByMatch` (mandatory: backend LIKE returns alphabetical), top 3 per kind; song row = replace queue with just that song and play; others navigate. Submitted mode: pills all/songs/playlists/albums/artists; top-result card (priority: direct artist hit > first song > first album > first playlist > derived artist; songs get a floating play FAB playing just that song); songs section queue = whole ranked list at tapped index; artists section merges resource hits with derived name strings (per-card Deezer `artist_pictures` lookup); album/playlist grids; external results section always at the bottom (`/music/external_search?kind=track`, min 2 chars, source badges, Import button -> `POST /song_imports` URL mode for youtube/soundcloud, search mode + isrc for spotify/itunes/bandcamp; poll 1.5s; `deduped:true` is already terminal; complete invalidates library lists). States: empty-query hint; loading line; "No results for q" still renders external results.

**6 Library.** Pills playlists (default) / artists / albums; only the active pill's query runs (`enabled` gating): playlists `1:500`, artists `1:500` `name:asc`, albums via `/songs/albums`. Local substring filter over loaded rows. Windowed rendering 40 rows + 40 per sentinel (a 500-artist library must not fire 500 artwork requests). Playlist rows: Spotify badge for system, purple LikedArtwork for liked mirror; artist rows circular. Header quick links row: Liked, Downloads, Settings; plus button -> CreatePlaylistDialog. Empty states per pill with create CTA on playlists.

**7 Liked.** Cursor-paged infinite `GET /liked_songs?limit=100&before=<liked_at>` (never offset); purple LikedArtwork hero, accent `#7e22ce`; ActionBar Play/Shuffle; columns index/title/album/addedAt(liked_at)/duration (album+addedAt dropped on narrow); infinite sentinel. States: skeletons / error line / "no liked songs yet".

**8 Playlists.** `GET /playlists`; header + Create button -> dialog (`POST /playlists {name}`, Enter submits, invalidate + toast); rows navigate. Empty: hint + "Create your first playlist".

**9 Playlist.** `GET /playlists/:id` + infinite `GET /playlist_songs?exact_search[playlist_id]=&modifiers[page]=N:100&modifiers[order]=position:asc`. Three flavors (FR-53): manual (artwork change via crop -> JPEG <=2MB -> multipart `artwork`; row extra action Remove by JOIN-ROW id, optimistic; drag reorder ONLY when all pages loaded, sends COMPLETE song-id array to `/reorder`, optimistic w/ rollback; overflow: Delete w/ confirm -> back to list, Copy); system (read-only, "Synced from Spotify" subtitle, last-synced badge, Copy only); liked mirror (purple heart artwork always). Meta: N songs + total duration. ActionBar: play/shuffle/offline toggle (keep-synced, FR-87, collectionId = playlist id). `showOnlyDownloaded` filters rows to done and suppresses reorder with a distinct empty state.

**10 Artists hub.** `GET /artists/overview` (staleTime 10 min): spotlight banner (bannerUrl backdrop, fallback fuchsia/violet/indigo gradient; Play = lazy spotlight-songs query `exact_search[artist]&artist_role=primary`, Shuffle, Radio); 4 stat tiles (minutes played label switches on `heavy_rotation_window`); shelves heavy-rotation ("Most played" when window=all) / similar-to-seed / neglected, zero-entry shelves render nothing. "All artists": infinite roster `N:60`, sort toggle name:asc / created_at:desc (restart query), debounced 250ms server search replaces the grid while filtering. States: 12 circle skeletons / error / "no artists" vs "no artists for filter".

**11 Artist.** Resolve `GET /artists/:idOrSlug` (retry false; 404 -> raw segment as display name). Queries: primary albums + featured albums (`/songs/albums` + `artist_role`), all primary songs, featured songs, top 5 (`/play_events/top?scope=song&artist=&since=all&limit=5`), `artist_pictures` only when no cached image, `artist_metadata/:name` for listeners/bio. Hero: banner chain backdrop (42dvh full bleed) else avatar/initials; meta "N listeners • X albums • Y songs". ActionBar: Play (queue = ALL primary songs), Shuffle, Radio. Popular: top-5 with play counts (fallback first 5), row play looks the song up in the FULL list so next/prev walk the catalog. Discography grid; "Participates in" grid; "Featured on" table (queue = featured list); About (sanitized bio + gallery slideshow, 6s auto-advance, pause on touch) only when content exists (FR-42 P2). Cold artists slow (server lazily refreshes metadata): skeletons.

**12 Album.** Artist segment resolved against roster for context narrowing; songs via `exact_search[album]=<name|"\b">` (NOT artist-filtered server-side); client narrows to context artist, falls back to all matches; majority-vote primary artist for header link; meta artist/year/count/duration; columns index/title/duration; offline toggle key `album:<artistSlug>:<album>` (lowercased). Optional highlight param (FR-44 P2): scroll to + ring the target song. Empty: "no songs in this album".

**13 Mix.** `GET /music_mixes/:slug` (URL-encode, contains `:`). Hero: kind gradient square + artist photo overlay + stamp text (size stepped by length), localized title/description from keys; accent = artist-image-derived for top_artist else kind accent. Play/Shuffle; table index/title/album/duration. 404 (rotated slug) -> refetch list, navigate home with toast. No refresh UX (server-cached 24h).

**14/15 Radios.** `GET /music_radios/artist/:slug` / `/song/:id` (staleTime 5 min); 404 = "could not build" error state, not empty. Pre-baked Portuguese title/description rendered as-is. Backdrop: Deezer artist pictures (xl>big>medium) or seed artwork; kind gradients client-owned. ActionBar: Play, Shuffle, Save-as-playlist (`POST /playlists {name, song_ids}` -> navigate; hidden while pending). Song radio: `songs[0]` is the seed.

**16 Downloads.** Header: count + storage bytes (native directory walk) + offline pill. "A transferir" section: in-flight `mixed` tasks with percent. Downloaded list: tap = play whole downloaded list as queue; per-row delete. Empty state instructs (song menu Download / collection toggle). All copy PT-PT under the pt locale.

**17 Profile.** `GET /users/:idOrHandle/music_profile`. `{visible:false}` renders the private/empty state (indistinguishable). Visible: now-playing row (live-ish), top artists (image pick order per FR-120), top songs, recent, plays_30d stat. All media presigned URLs used as-is (never resolve another user's fs nodes).

**18 Settings hub.** Rows: Import, Songs, Artists, Playback, Downloads, Devices + app prefs inline: Theme (light/dark/system) and Language (en/pt/lv) selectors.

**19 Import.** 4 tabs: Files (multi-file picker audio-only, concurrency 3, per-file sync `POST /songs/import` with long timeout, aggregate toasts, global import-busy flag, folder resume tracker in sqlite kv per FR-100 P2); URL (`POST /playlist_imports/preview` -> confirm sheet with per-track title/artist/album edits + ArtworkPicker (`artwork_search` or upload -> `artwork_url`/`artwork_data_b64`) + target selector new/existing/library -> sequential `POST /song_imports` with positions; inline errors incl. Spotify-URL refusal verbatim; poll 1.5s; per-track state icons); Spotify (tab hidden unless `allowed_to_use_spotify`; link via in-app browser `/auth/link/spotify?token=`; status/preview/settings/trigger; poll 1.5s while running; per-playlist progress rows; destructive warnings on deselect/disable-liked; stale running >2h shows failed); Artist (needs linked Spotify identity; debounced search roster+spotify columns, album multiselect, recents list polling 1.5s with progress rows; error classification connect/relink/upstream-retry/generic).

**20 Settings: Songs.** Infinite `/songs` at `N:500`, "load more", total `<loaded>+`. Client filters (title/artist/album substring, origin, quality, codec) + parallel server search folding in beyond loaded pages. Multi-select bulk delete with confirm. Edit dialog: multipart PATCH title/album/year/position/artwork; artist chips emitting `artist_names[]` and ALWAYS `featured_artist_names[]` (single empty string when none). Stems controls embedded (separate/status/delete). FR-126 (P2) metadata modifier tool lives here as a row ("Edit tags of a local file"): pick file -> form -> `POST /songs/metadata_modifier` -> share/save the returned binary.

**21 Settings: Artists.** Table over `/artists` (client filter + paging). Rename via FLAT `PATCH /artists/:id {name}`; image upload field `image`; banner upload field `banner`; delete (server refuses while songs reference; surface the error).

**22 Settings: Playback.** share_listening switch (read from account, default true when absent; write multipart `PATCH /users/:id`).

**23 Settings: Downloads.** wifiOnly (default off), includeStems (default on, "~2x storage" note), showOnlyDownloaded. No storage-cap UI unless enforcement ships (FR-94 P2).

**24 Settings: Devices.** `GET /sessions` list; rename current via `PATCH /sessions/:id`; NO revoke-other button (server always kills the caller); logout button here and on the hub.

**25 Now Playing.** Full-screen: artwork on accent gradient (dual theme variants), title/artist links (dismiss + navigate), scrub bar (tabular numerals), shuffle/prev/play-pause(+buffering spinner)/next/loop (None->All->One cycle), volume slider, like heart (from `/liked_songs/ids`), overflow = canonical menu, cast button (DevicePicker sheet), jam button, cog sheet (rate 0.5-1.5, separation toggle + mode select + status with elapsed timer + delete stems, EQ section per section 8, sleep timer). Controller mode: emerald "Playing on X" strip; local-only settings greyed; position interpolated at 1Hz ticks with 5s staleness fallback. Blocked activation: "Play here" pill.

**26 Queue.** Visible order render (`queueOrder.map(i => queue[i])`); current row shows PlayingBars (frozen at 1/3 when paused); tap current toggles, other jumps; remove disabled on active row; long-press drag -> `reorderQueue(fromVisible, toVisible)`; jam proposals show proposer attribution. All callbacks use VISIBLE indices.

**27 Lyrics.** `GET /lyrics?song_id=` (skeleton on first slow fetch; 200-with-nulls = empty state; client cache 24h; offline fallback to stored record). LRC parser per FR-76 exact rules (unit tested). Synced view: frame-driven active line (state updates only on index change; loop stops when screen not visible), auto-center scroll, 4s manual-scroll grace with "back to current line" pill, tap-to-seek (works on placeholder dots). Plain-only: static lines + "generate sync" button (`POST /lyrics/sync` -> JobChannel + 10s poll fallback, 404-during-poll = keep waiting; disabled with spinner; 10/h cap). Translation menu: 7 targets, persisted per device (default UI locale), staleTime Infinity, never auto-retry 429/404; synced alignment by `time.toFixed(2)`, plain by index; identical lines suppressed; original drops to secondary line; 429 -> inline limit message. Attribution footer.

**28 Jam.** Current jam state: members list (host badge), rules (host-editable: queue_mode everyone/host, skip_mode majority/host/anyone via `PATCH /jams/:id`), invite sheet (accepted friends from `/relationships`), skip-vote UI matching skip_mode (`{skipped, count, needed}` display; hidden for non-hosts in host mode), leave/end buttons (host leaving ENDS, warn). Joinable jams list from `GET /jams` (also surfaced on app start when `current` exists = auto-resume). Jam invites arrive via NotificationsChannel (`jam_invite`) -> toast linking here.

---

## 3. Player service over expo-audio (WP-4; broad-brush, contracts precise)

One `PlayerService` singleton owning a single `AudioPlayer` (created with `createAudioPlayer`, background playback enabled via the plugin). We do NOT use `AudioPlaylist`: presigned-URL rotation, the failure ladder, repeat-one-on-ended, and jam/remote interception all require JS-owned transitions. UI reads only from `player/store.ts` (position updated at ~4Hz from status events); nothing touches the player directly except `service.ts`.

- **Queue model.** The quartet `{queue, queueOrder, queueIndex, shuffle}` lives in the zustand store, mutated ONLY through `queueOps.ts` pure functions implementing FR-57 semantics verbatim (setQueue identity-or-shuffled + takeover steal on non-active; setShuffle as the only reshuffle point, ON moves current to front, OFF returns to natural position; playNext splices at cursor+1; removeFromQueue refuses current row and remaps backing indices; reorderQueue with cursor fixups). Invariants (order is a permutation; index in range) enforced with dev assertions and property tests. A synchronous ref mirror lets bursts compose. Queue is NOT persisted locally; hydration comes from the server snapshot (FR-108).
- **Transitions.** `transitionGen` counter + `loadingSongId` guard on every song change; a pending-seek slot applied when the player reports its first loaded status; autoplay decided by transition cause (user action = play; cold hydration = paused seek; transfer = honor remote paused; same-song patch = never restart, keyed on song id + wanted node id, not object identity). A registered playback interceptor lets the jam follower convert user "play" into proposals.
- **Source resolution (local-file-first).** `sourceResolver.resolve(song, mode)`: (1) jam `audio_url` verbatim; (2) mode stem node (instrumental/vocals) with fallback to mix when null; (3) `compressed_audio_fs_node_id || audio_fs_node_id`. For the chosen node: local original file -> local compressed file -> network. Network = `GET /fs_nodes/:id/data_url` (2 attempts) and hand the presigned URL to expo-audio; NEVER `/data` for audio. Local file candidates that the OS decoder rejects (player error immediately after load) fall through to the next rung.
- **Presigned cache by node id.** `Map<nodeId, {url, resolvedAt, songId}>` written only by the prefetcher; consumed one-shot when songId+nodeId match and age < 5 min; error-path re-resolves always mint fresh URLs. Prefetch triggers when remaining <= 30s (skipped when: controller, LoopOne, next is jam song, next already failed).
- **Error recovery ladder.** Player error event: first failure for a song id -> remember position, re-resolve fresh, reload, restore position, resume if intended; second failure -> add to session failed-set, toast (throttled 3s) and advance; advance chain stops if the next entry is also failed; an audible `playing` clears the mark.
- **Repeat-one on ended.** The status listener's didJustFinish path: reset play accumulator; LoopOne -> seek 0 + play (never a native loop flag, keeps end-of-song sleep timer working); else `next()` (wrap under All; single-song queue restarts).
- **Lock screen.** `lockScreen.ts` calls `player.setActiveForLockScreen(true, metadata)` on EVERY song change (fresh metadata object: title, artist = formatArtistsFull, album, artwork = local file URI when downloaded else `/fs_nodes/:id/data?token=`), and updates elapsed/rate on seek/rate change. Remote command handlers (play/pause/seekto/+10/-10/next/prev) route through `player/actions.ts` so a controller device sends cable commands instead of poking the silent local player (FR-63).
- **Play recording.** Forward status deltas in (0,2)s accumulate; at `min(30s, duration/2)` fire `POST /play_events` (fire-and-forget); reset on song change and natural end; never for jam songs or transfer-seeded songs.
- **Misc.** Volume 0..1; seek with 3-attempt retry; rate 0.5-1.5 with `shouldCorrectPitch=false`; sleep timer minutes or endOfSong (one-shot ended listener), not persisted. `persistence.ts` stores rate, volume, separation enabled, mode (custom restores as original), stem volumes, EQ bands (not eqEnabled), loop mode in kv-store.
- **Accent color.** `accentColor.ts` downsamples artwork via expo-image / small canvas-free pixel read, computes average, saturate +20, brighten +/-50 per theme, LRU 100 dual-variant per song id, stale-async guard, fallback `#FF5555`.

---

## 4. Offline / downloads (WP-7)

SQLite (expo-sqlite, WAL) schema:

```sql
CREATE TABLE downloads (
  song_id TEXT NOT NULL,            -- ALWAYS string at the storage boundary
  kind TEXT NOT NULL,               -- mixed | mixed_original | artwork | vocal | instrumental
  status TEXT NOT NULL,             -- queued | downloading | done | error
  node_id TEXT NOT NULL,            -- fs node the file came from (repair key)
  sibling_node_id TEXT,             -- mixed_original only: the compressed node it upgrades
  filename TEXT NOT NULL,           -- <songId>_<kind>.<realExt>
  local_uri TEXT,                   -- file:// when done
  size_bytes INTEGER DEFAULT 0,
  task_savable TEXT,                -- serialized DownloadTask.savable() for re-attach
  error TEXT, created_at INTEGER, downloaded_at INTEGER,
  PRIMARY KEY (song_id, kind));
CREATE TABLE offline_songs (
  song_id TEXT PRIMARY KEY, song_json TEXT NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched',  -- unfetched | none | cached
  lyrics_json TEXT, stored_at INTEGER);
CREATE TABLE offline_collections (
  key TEXT PRIMARY KEY,             -- '<playlistId>' | 'album:<artistSlug>:<album>' (lowercased)
  kind TEXT NOT NULL, added_at INTEGER);
```

- **Bundle per song (FR-83).** `mixed` (compressed preferred), `mixed_original` when distinct, `artwork`, `vocal`/`instrumental` when includeStems and ids exist; Song JSON stored up-front; lyrics best-effort with tri-state. Jam songs excluded entirely. UI status reads the `mixed` kind only.
- **Transfer engine (FR-84).** `downloadQueue.ts`: 3-concurrent JS queue over `File.createDownloadTask` against `/fs_nodes/:id/data?token=` (redirect-following, rate-limit exempt; the task must NOT forward an Authorization header onto the presigned S3 hop, so auth rides the query param only). iOS `sessionType: 'background'`. Savables persisted in the row; on boot, `DownloadTask.fromSavable` re-attaches in-flight tasks; anything unresumable is re-enqueued (idempotent dedup). Files under an app-support `music-downloads/` dir with real extensions, excluded from cloud backup.
- **Status contract (FR-82).** `offline/context.tsx` implements `DownloadStatusContext` verbatim: sync `getStatus`/`getProgress` from an in-memory Map hydrated from sqlite, one coarse version-counter subscribe, `downloadMany`, `isOfflineCollection`/`toggleOfflineCollection`, `showOnlyDownloaded`. Progress notifications throttled through the single counter.
- **Collections + keep-synced (FR-87).** Toggle downloads every song sequentially (dedup-resumable); disable removes; `useOfflineCollectionSync(collectionKey, songs)` re-downloads newly added songs on every refetch of a marked collection. ActionBar toggle = keep-synced semantics.
- **WiFi gate (FR-88).** Enforced at enqueue: on cellular with wifiOnly, refuse with a clear PT-PT/i18n message (never silently queue); allow when the probe fails.
- **Repair (FR-89).** On boot-while-online and on NetInfo reconnect: retry errored songs and verify-and-repair (re-enqueue any missing kind incl. `lyrics_state = 'unfetched'`); dedup makes it idempotent; this also heals post-death completions the task map missed.
- **Quality ladder (FR-90).** Handled in `player/sourceResolver.ts`: local original -> local compressed -> network; first accepted by the decoder wins; stems resolve locally the same way.
- **Offline browsing (FR-91).** `resolvers/library.ts` derives songs/albums/artists from `offline_songs` (album grouping key = backend's album + lead-artist compound); `resolvers/image.ts` serves local artwork URIs to `Artwork.tsx`; a global `isOfflineNow` flag (NetInfo) makes `withOfflineFallback(primary, fallback)` skip doomed network calls. Wired into `api/queries` for songs/albums/artists/playlists/liked so airplane mode browses and plays with artwork.

---

## 5. Auth flow (WP-2)

- **Login.** `POST /sessions {email, password}` with User-Agent `OMSMusic/<version> (<Device.modelName>; <os> <ver>)` so the session gets a sane name; store `token` in SecureStore + in-memory mirror; fetch `/sessions/mine` -> `/users/:id`; land on Home.
- **Signup.** `create_start` -> OTP screen (15 min TTL, 5 attempts) -> `create_end` -> immediate `POST /sessions` -> Home.
- **Bootstrap.** On launch with a stored token: `GET /sessions/mine` then `GET /users/:id`; 401 wipes the token and routes to `(auth)`. The account payload gates Spotify UI (`allowed_to_use_spotify`) and playback settings (`share_listening`).
- **401 without hammering the anon bucket.** Invalid tokens count against the per-IP 120/min bucket, so: (a) `client.ts` refuses to send authed requests when no token is present; (b) on ANY 401, a single-flight latch runs one `/sessions/mine` probe; if it 401s, the session store flips to logged-out, the QueryClient is paused (all queries gated on `status === 'authed'` via a default `enabled` guard in the key factory hooks), the cable disconnects, downloads pause, and the token is wiped. No automatic retries on 401 anywhere; 429 honors `retry_after` exactly once with no storm.
- **Logout.** `DELETE /sessions/<anything>` (server kills the caller), then wipe token + query cache + player + cable state even if the call fails. Offline library persists (downloads are device data) but is gated behind login again.
- **OAuth (FR-12, P1).** No custom-scheme redirect exists server-side; callback is hardcoded to `https://omelhorsite.pt/account/oauth/callback`. Native flow: render `/auth/<provider>?mode=signin` in a WebView with `onShouldStartLoadWithRequest` interception of the callback URL, extract `ticket` (2 min TTL) or `error` (map codes to i18n messages), `POST /sessions/adopt {ticket}` -> token. Requires adding `react-native-webview` (needs user approval; expo-web-browser cannot intercept an https redirect without associated domains). Spotify account LINKING reuses the same WebView against `/auth/link/spotify?token=`.
- **Passkeys (FR-13, P2).** Out of v1; blocked on AASA/assetlinks for omelhorsite.pt. Contract stub kept in `auth/` with the verbatim-payload rule documented (bypass the null-sentinel rewrite).
- **Cookie jar.** The fetch stack must not persist `oms_session` cookies; RN fetch does not by default; nothing else to do.

---

## 6. Realtime layer (WP-8 core, WP-9 jams/social)

- **Client.** `cable/client.ts` is a small hand-rolled ActionCable v1 client (the installed @kesha-antonov lib remains an escape hatch, but hand-rolling guarantees the identifier is a stable JSON-encoded string the server echoes byte-for-byte). Lifecycle: connect `wss://backend.omelhorsite.pt/cable?token=<token>` (token in query ONLY, no Authorization header on the handshake); wait for `welcome` before any subscribe; sends before welcome are dropped by design; ping watchdog; reconnect backoff 1s doubling to 30s; on welcome resubscribe every registered channel. Subscription rejection = the auth failure signal (anonymous connects succeed). AppState foreground -> `request_snapshot` + `heartbeat` on PlaybackChannel and resubscribe FriendListeningChannel (rosters are subscribe-time).
- **Id normalization.** `cable/ids.ts`: song ids and queue entries are STRINGS on the wire, numbers in REST; conversion happens exactly once at the channel boundary.
- **PlaybackChannel (FR-105..112).** Subscribe with per-launch `device_id` (uuid, [A-Za-z0-9-]) + `device_label` ("Musica - iPhone de X"). Heartbeat every 20s (TTL 75s). `roleStore` derives offline/no_active/active/controller from snapshots; becoming controller force-pauses and clears the local source. Active mode: `publisher.ts` debounces 200ms `state_changed` (string ids, full listener settings) + 1Hz `position_tick` while playing; server `error` -> `request_snapshot` resync; respect clamps (queue 1000, rate 0.25-4, EQ +-12). Controller mode: mirror snapshot; merge slim `state_changed` with the last full `queue_songs`; 1Hz tick interpolation with 5s staleness fallback and song-id mismatch dropping; transport actions become validated `command` sends; volume drag = `set_volume` on the active device. Cold-start hydration (FR-108): role no_active + non-empty snapshot + empty local queue -> adopt sanitized snapshot (drop jam proposals with order/index remap, validate permutation, clamp index), paused activation seed, adopt loop + listener settings (never volume); play claims `if_none` pessimistically (claim_rejected demotes). Transfer/takeover per FR-111; reconnect steal (FR-112) when the cable dropped while active and nobody claimed.
- **JamChannel (FR-113..118).** Join via REST BEFORE subscribing; receive-only. `follower.ts` runs a dedicated second AudioPlayer fed by presigned `audio_url` (track identity by song id, never URL), drift correction (extrapolate ticks; hard-seek beyond 2.5s), pause-with-host, local pause/volume allowed, 1.5s join grace before "local playback auto-leaves". `hostDuties.ts` executes server-built `jam_add_song` (FIFO after current, behind earlier proposals) and `next` commands; jam songs never record plays, persist, download, or separate. `interceptor.ts`: while following with queue_mode everyone, "play" on a library song becomes `POST /jams/:id/propose`. JamBar replaces the MiniPlayer while following.
- **FriendListeningChannel (FR-119).** Snapshot + full-row `listening_update` replace keyed by user id; sort live-first then updated_at desc; feeds the Home strip and the friends modal; sharing-off friends show presence without the song.
- **JobChannel + NotificationsChannel.** JobChannel for lyrics sync (snapshot + change pushes; done when finished_at set; paired with a 10s REST poll where 404 = keep waiting). NotificationsChannel only for `jam_invite` -> toast + jam screen link.

---

## 7. Shared contracts

- **API client (`api/client.ts`).** `request<T>(method, path, {params, body, multipart, timeoutMs})`: bearer header always (`Bearer <token>`); bracket-encodes params (`search[x]`, `exact_search[x]`, `modifiers[page]=N:SIZE`, arrays as `k[]=`); rewrites `null` -> `"\b"` recursively in params and JSON bodies (FormData exempt; a `raw: true` flag exempts WebAuthn later); parses bare-string/array/object error bodies into a typed `ApiError {status, message, retryAfter?}`; 304 treated as success passthrough; 429 surfaces retryAfter; 401 triggers the single-flight session probe. Media never goes through this client.
- **Media (`api/media.ts`).** `artworkUri(nodeId)` and audio download URLs = `/fs_nodes/:id/data?token=` (rate-limit exempt); `avatarUri(userId)` = `/users/:id/picture` (no token); `resolveDataUrl(nodeId)` = the JSON two-step for playback (counts against the ceiling, so only the player uses it).
- **Domain types (`api/contracts/`).** One module per resource mirroring API.md exactly (Song with `artists: SongArtistEntry[]`, jam-only fields optional; Playlist with `isSystem`/`isLikedMirror` helpers; Artist with the image fallback chain helper inputs; PlaybackSnapshot; Jam/JamState; Mix/Radio; SongImport/ArtistImport/SpotifyStatus; Lyrics). Id types: string for users/sessions/fs_nodes/separations, number for songs/artists/playlists/etc.; `CableSongId = string` branded type at the cable boundary.
- **Query keys (`api/keys.ts`).** Central factory (`keys.songs.list(filters)`, `keys.likedIds`, ...) so invalidation (imports invalidate songs/albums/artists/playlists; like toggles patch `likedIds`) is coordinated and no two WPs invent colliding keys.
- **Theme tokens (`ui/theme/`).** Both HSL palettes ported from web globals.css into TS objects; `useTheme()` returns resolved colors + scheme; `gradients.ts` implements the artwork-accent mixes (dark: toward black 50%->25%; light: toward white 30%->15%; hero: sat -10, bright -60/+40, fallback `#222222`); `fixed.ts` owns MUSIC_ACCENT `#4B1E6D`, LIKED_ACCENT `#7e22ce`, emerald markers, and the mix/radio kind gradient + accent + icon maps (server `gradient` field deliberately ignored). Typography styles for hero/section/kind-label/tabular-time/stamp (stamp size stepped <=8/<=14/<=22/else).
- **i18n (`i18n/`).** Three catalogs ported as-is from the web (music namespaces under `components.music.*`) plus new native namespaces (`native.downloads`, `native.auth`, `native.settings` etc.) added in all three locales in the same commit (a CI check compares key trees). `t(key, params)` implements ICU-subset interpolation ({param}, simple plural/select) with fallback to en. `mixLabels.ts` renders `title_key`/`title_params` through the catalog; radios render their pre-baked Portuguese strings as-is. Locale persisted in kv-store; default = device locale mapped into {en, pt, lv} else en.

---

## 8. Vocal separation playback modes natively

- **Instrumental / vocals (FR-68, ships v1).** These are just "play a different file": `modes.ts` picks the stem node, `sourceResolver` applies the local-first ladder, mode switches capture position + play state and re-load with a pending seek. Stems missing -> plain mix fallback; when `separationWatcher` patches fresh stem ids into the queue entry, the stale-queue reconciliation swaps to the stem file preserving position (keyed on requested node id).
- **Separation lifecycle (FR-71, ships v1).** Explicit `POST /songs/:id/separate`; one shared 3s poll of `GET /songs/:id/separation` per song (parks on "no job, no stems"; stops on ready/terminal); projection idle/pending/processing/ready/failed with a live elapsed timer; on ready patch the queue entry in place (no restart); `DELETE /songs/:id/separation` removes stems. Menu item conditions per FR-74.
- **Custom blend + 3-band EQ (FR-69/70, P2): NOT in v1.** expo-audio has no sample-synced dual playback and no EQ nodes; two JS-started AudioPlayers WILL drift audibly. Decision: v1 hides the blend sliders and EQ section behind the mode UI showing only Original/Instrumental/Vocals; when adopting a snapshot whose `playback_mode` is `custom`, play `original` locally and publish `original` (honest truth; other devices reconcile). The persistence keys for stem volumes and EQ bands are still stored/round-tripped in listener settings so nothing is lost across devices. The v1.1 mechanism is a small custom Expo module ("oms-audio-mixer"): AVAudioEngine with two AVAudioPlayerNodes + AVAudioUnitEQ on iOS, ExoPlayer/AudioTrack mixer + DynamicsProcessing EQ on Android, exposing load(stemA, stemB)/play/seek/gains/eqBands and reusing the same `player/actions.ts` surface. Flat EQ must bypass the processing path entirely (FR-70 AC).

---

## 9. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | expo-audio behaviour gaps (ended-event fidelity in background, transition gaps, lock-screen artwork on Android) | Core playback quality | WP-4 is the FIRST vertical to reach devices; a device test checklist (background 10+ min both platforms, locked-screen next/prev, repeat-one, kill/relaunch) gates everything downstream; @rntp/player v5 documented as the paid escape hatch |
| 2 | Android background death without `setActiveForLockScreen` / OEM battery killers | Silent playback stops | Call setActiveForLockScreen on every song change without exception; test on a real OEM Android; document battery-settings guidance in-app |
| 3 | Presigned URL expiry (6h) mid-listen, on resume-from-suspend, or on stale prefetch | Stream errors | Recovery ladder re-resolves fresh; prefetch one-shot + 5 min TTL; downloads use `/data?token=` so long transfers never hold a presigned URL |
| 4 | Rate limits: stale-token loops hit the anon 120/min IP bucket; `data_url` counts against the ceiling | Whole-NAT 429s, owner paged via Discord | Single-flight 401 latch + query gating (section 5); audio-only use of data_url; artwork + downloads on exempt endpoints; retry off by default |
| 5 | Downloads across process death (STACK: iOS background session survives suspension, not termination) | Broken offline promise | Persisted savables + re-attach on boot + verify-and-repair as the safety net; if reality disappoints, add @kesha-antonov/react-native-background-downloader (requires user approval) |
| 6 | OAuth interception needs react-native-webview (not installed; no custom-scheme redirect server-side) | FR-12 blocked | Ship email+password first (P0); request approval for webview in WP-2; passkeys stay P2/blocked |
| 7 | Custom blend/EQ needs a native module | FR-69/70 slip | Deferred by design (section 8); wire values still honored so cross-device state is coherent |
| 8 | Cable id type mismatches (string vs number) and slim-snapshot merges | Controller UI corruption | Branded types + single conversion point (`cable/ids.ts`); merge-with-last-full-queue unit tests; `error` -> request_snapshot resync |
| 9 | i18n drift between three catalogs / missed PT-PT review | Broken mix titles, mixed-language UI | Key-tree equality CI check; all new strings land in en+pt+lv in one commit; PT strings reviewed as European Portuguese |
| 10 | 500-row cap + missed pagination on long libraries/playlists | Silent truncation | Every list in section 2.1 names its page shape; code review checklist item; playlist reorder disabled until fully loaded (FR-50) |

---

## 10. FR coverage map (nothing homeless)

FR-1..6 api/client + queryClient (WP-1). FR-7..14 auth screens + sessionStore + settings/devices (WP-2, screen 24 in WP-10). FR-15..22 shell, MiniPlayer, theming, i18n, deep links, service ping (WP-2/WP-1; NowPlaying itself WP-6). FR-23..29 home (WP-5; friends strip data WP-9). FR-30..34 search + external import (WP-5, import pipeline shared with WP-10). FR-35..44 library/artists/artist/album (WP-5). FR-45..46 liked + like toggle (WP-5; heart in player WP-6). FR-47..53 playlists (WP-5). FR-54..67 player engine (WP-4; playing bars WP-3; media session FR-63 in WP-4 with WP-8 routing). FR-68..71 modes + separation (WP-4 + section 8; menu wiring WP-3). FR-72..74 queue UI + canonical menu (WP-6/WP-3). FR-75..81 lyrics (WP-6). FR-82..94 downloads/offline (WP-7). FR-95..98 settings (WP-10). FR-99..104 import (WP-10). FR-105..112 remote playback (WP-8). FR-113..118 jams (WP-9). FR-119..120 social (WP-9). FR-121..123 mixes/radios (WP-10 screens, MixTile WP-3). FR-124 StickyTitle (WP-3). FR-125 credits dialog (WP-3). FR-126 metadata modifier (WP-10, settings/songs).

---

## 11. Known-contradiction guardrails (from SPEC)

1. System playlist rename is server-rejected: never render a rename affordance.
2. Native uses bearer tokens only; ignore the `oms_session` cookie.
3. Artist PATCH flat top-level; banner field `banner`.
4. Separation status has NO `canceled`; `complete|failed` are terminal.
5. `POST /songs/clean` dead; `GET /songs/artists` ignores filters; never call.

---

## 12. Work packages (10), file ownership, dependency order

Rule: a file has exactly one owning WP. `src/app/` route files are created by WP-2 as one-line wrappers (`export { default } from "@/features/home"`) and are never edited by feature WPs. `api/queries/*` files are split by owner as listed. `api/keys.ts` is WP-1-owned; additions go through it via small PRs.

**WP-1 Foundations.** Owns: `api/client.ts`, `api/queryClient.ts`, `api/keys.ts`, `api/media.ts`, `api/contracts/**`, `i18n/**`, `ui/theme/**`, `lib/**`. Delivers the HTTP layer (sentinel, brackets, errors, 401/429/304), query client + NetInfo wiring, all domain types, theme tokens + gradients + typography, catalogs ported, utils (rankByMatch, formatArtists, artist artwork/route helpers, deep-link parser, kv). Depends on: nothing.

**WP-2 Auth + shell + navigation.** Owns: `src/app/**` (ALL route files + layouts), `auth/**`, `features/auth/**`, `features/shell/**` (tab bar, overlay host, MiniPlayer shell, JamBar shell, DevicePicker shell as placeholders wired later). Delivers login/signup/reset, session bootstrap/logout, 401 latch integration, deep-link registration, the 28-screen scaffold with placeholder bodies. Depends on: WP-1.

**WP-3 Design system.** Owns: `ui/components/**`, `ui/songMenu/**`. Delivers Hero/StickyTitle/ActionBar/SongTable/SongRow/PlayingBars/Tile/Rail/FilterPills/ArtistCard/MixTile/LikedArtwork/Artwork/menus/sheets/dialogs/empty-error-skeleton states/useSongActions + credits + add-to-playlist dialogs (menu items call `player/actions.ts` and DownloadStatusContext through injected interfaces so WP-3 does not depend on WP-4/7 landing first). Depends on: WP-1.

**WP-4 Player engine core.** Owns: `player/*` except `remote/` and `jam/`. Delivers queue ops + property tests, PlayerService, source resolver + prefetch, recovery ladder, lock screen + remote commands, play recorder, modes + separation watcher, accent color, persistence, sleep/rate/volume, `player/actions.ts` (local paths; remote hooks stubbed). Depends on: WP-1. Gate: device test checklist (risk 1).

**WP-5 Browse screens.** Owns: `features/{home,search,library,liked,playlists,playlist,artists,artist,album}/**`, `api/queries/{songs,albums,artists,playlists,playlistSongs,likedSongs,playEvents,search,externalSearch}.ts`. Delivers screens 4-12 per section 2.1 incl. pagination, dialogs, empty states, external-search import rows. Depends on: WP-1, WP-2, WP-3 (WP-4 for actual playback, but screens compile against the actions interface).

**WP-6 Player UI + lyrics.** Owns: `features/{nowPlaying,queue,lyrics}/**`, real MiniPlayer body in `features/shell/MiniPlayer.tsx` (file pre-assigned to WP-6), `api/queries/{lyrics,separation,jobs}.ts`. Delivers screens 25-27, LRC parser + tests, translation, sync generation, cog sheet. Depends on: WP-3, WP-4.

**WP-7 Downloads/offline.** Owns: `offline/**`, `features/downloads/**`. Delivers sqlite schema, download manager/queue, status context, collections + keep-synced, repair, offline resolvers wired into WP-5 queries via `withOfflineFallback`, Downloads screen, download settings store (screen 23 UI is WP-10 but reads this store). Depends on: WP-1, WP-4 (source ladder integration point).

**WP-8 Cable + remote playback.** Owns: `cable/**`, `player/remote/**`, `features/shell/DevicePicker.tsx` body. Delivers the cable client, PlaybackChannel, roles, publisher/controller, hydration, transfer/takeover/reconnect-steal, device picker. Depends on: WP-4.

**WP-9 Jams + social.** Owns: `player/jam/**`, `features/{jam,friends,profile}/**`, `api/queries/{jams,relationships,users}.ts`, `cable/channels/{jam,friends,notifications}.ts` implementations, JamBar body. Delivers screens 17 and 28, friends strip/panel, follower player, host duties, propose/skip/invite. Depends on: WP-8.

**WP-10 Mixes/radios + settings + import.** Owns: `features/{mix,radio,settings,import}/**`, `api/queries/{mixes,radios,songImports,playlistImports,spotifySyncs,artistImports,sessions}.ts`. Delivers screens 13-15 and 18-24, all import flows, Spotify sync, artist import, devices screen, metadata modifier tool. Depends on: WP-1, WP-2, WP-3 (WP-5 conventions; spotify link flow reuses WP-2 oauth WebView).

Dependency order (parallel lanes):

```
WP-1 ─┬─ WP-2 ─┬─ WP-5 ──┐
      ├─ WP-3 ─┤          ├─ WP-10
      └─ WP-4 ─┼─ WP-6    │
               ├─ WP-7    │
               └─ WP-8 ── WP-9
```

Suggested waves: (1) WP-1; (2) WP-2 + WP-3 + WP-4; (3) WP-5 + WP-6 + WP-7 + WP-8; (4) WP-9 + WP-10. P0 complete after wave 3; P1 complete after wave 4.
