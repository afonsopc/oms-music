# Music app - every screen, what it shows, what it does

Audience: engineers rebuilding the omelhorsite web music feature as a native React Native (Expo) app against the SAME production backend (`https://backend.omelhorsite.pt`), zero backend changes. Everything below was read from the actual web frontend code (Next.js SPA) under `frontend/components/music/`, `frontend/components/MusicDropdown/`, `frontend/lib/queries/music.ts`, `frontend/services/MusicService.ts`, and the route files under `frontend/app/[language]/music/`.

All request/response shapes are as observed in `frontend/services/MusicService.ts` (typed client) and `frontend/lib/queries/music.ts` (React Query hooks). Never use an em-dash in anything you copy from here; the codebase bans it.

---

## 0. Route map (web URLs, so you know the navigation graph)

The web app is a locale-prefixed SPA (`/[language]/music/...`). All music pages render inside `MusicShell` (sidebar + bottom player bar + right rail; those are covered by other spec docs). The screens in scope here:

| Web route | Component | Notes |
|---|---|---|
| `/music/discover` | `Home` | The home/landing screen. There is NO `/music/page.tsx`; the shell links land on discover. |
| `/music/search?query=<q>` | `Search` | Full search results page. Query comes from the `query` search param. |
| `/music/artists` | `Artists` | Artist hub: spotlight, stats, shelves, A-Z roster. |
| `/music/artist/[artist]` | `ArtistView` | `[artist]` segment is an artist slug OR a URL-encoded display name (both resolve). |
| `/music/artist/[artist]/[album]` | `AlbumView` | `[album]` is the URL-encoded album name; the literal string `"null"` means "unknown album". |
| `/music/liked` | `LikedSongsView` | Liked songs collection. |
| `/music/playlists` | `Playlists` | Playlist list + create. |
| `/music/playlist?id=<id>` | `PlaylistView` | No `id` -> client redirect to `/music/playlists`. |
| `/music/mix?slug=<slug>` | `MixView` | No `slug` -> client redirect to `/music/discover`. |
| `/music/radio/artist?artist=<slugOrName>` | `RadioView kind="artist"` | No `artist` -> redirect to `/music/discover`. |
| `/music/radio/song?id=<songId>` | `RadioView kind="song"` | No `id` -> redirect to `/music/discover`. |
| `/music/settings/*` | settings screens | Out of scope for this doc. |
| (global navbar, any page) | `MusicDropdown` | Mini-player popover on the site navbar, outside the music shell. |

Deep-link detail used everywhere: navigating to an album page with a URL hash `#<encodeURIComponent(song.title)>` makes the matching `SongRow` highlight (ring + tint) and scroll into view (`scrollIntoView` smooth, centered). Search "top result" song clicks and song-title clicks use this.

---

## 1. Backend conventions shared by every screen

### 1.1 Base client
- Base URL: `https://backend.omelhorsite.pt` (`BACKEND_URL`); production uses cookie auth (`withCredentials: true`) plus optional `Authorization: Bearer <token>` from storage. Requests are plain axios.
- GET requests put the payload object into query params (axios bracket serialization: `search[title]=x`, `modifiers[page]=1:20`, `exact_search[artist]=Name`).
- NULL sentinel: the client transforms every `null` value in params/body to the string `"\b"` (backspace char). The backend's `crud_actions.rb` translates `"\b"` into a SQL `IS NULL` match. Example: songs with no album are fetched via `exact_search[album]="\b"`. A React Native client must reproduce this or unknown-album screens will list the entire library.

### 1.2 List filters (all `index` endpoints)
```
{
  search:       { <col>: <partial term> }   // LIKE %term% match, case-insensitive
  exact_search: { <col>: <exact value> }    // equality (or IS NULL via "\b")
  modifiers: {
    page:   "N:SIZE"      // e.g. "1:20". Mostly 1-based; Search.tsx sends "0:20" and it works, backend clamps
    order:  "col:asc" | "col:desc"
    random: true          // random ordering (used for Home recommendations)
  }
}
```
- Songs/albums endpoints additionally accept `artist_role: "primary" | "featured" | "with"` alongside `exact_search[artist]=<name>`: restricts to songs where the named artist has that role.
- Server caps every listing at 500 rows per request. Long collections must page.

### 1.3 Artwork / image URLs
- FsNode-backed images (song artwork, playlist artwork, uploaded artist images) are served by `GET /fs_nodes/:id/data` (authenticated; the web builds `FsNode.dataUrl(id)`). For media elements that cannot carry cookies through a redirect there is `GET /fs_nodes/:id/data_url` returning `{ url }` to storage directly.
- `Song.artworkUrl(song)`: `artwork_url` (jam-injected presigned URL) > `compressed_artwork_fs_node_id` > `artwork_fs_node_id` > undefined.
- `Playlist.artworkUrl(playlist)`: `artwork_fs_node_id` or undefined.
- `Artist.artworkUrl(artist, size)`: `compressed_image_fs_node_id` > `image_fs_node_id` > Deezer `picture_medium|big|xl` (order depends on `size` hint `"sm"`/`"lg"`) > `picture` > `gallery_image_urls[0]` > `fallback_artwork_fs_node_id` > `external_image_url` > null. ALWAYS pass `"sm"` for grid avatars; the `"lg"` 1000px Deezer render in a grid costs tens of MB.
- `Artist.bannerUrl(artist)`: `compressed_banner_fs_node_id` > `banner_fs_node_id` > `picture_xl` > `picture_big` > `external_image_url` > `artworkUrl` fallback.

### 1.4 Core resource shapes (fields actually consumed by the screens)

`Song` (GET /songs):
```
{
  id: number, title: string, album: string | null,
  artist?: string | null,                 // DEPRECATED legacy display string
  artists?: [{ id, name, slug, role: "primary"|"featured"|"with", position,
               image_fs_node_id?, compressed_image_fs_node_id? }],
  duration: number (seconds), track_number, disc_number, year, position,
  audio_fs_node_id: string, compressed_audio_fs_node_id?: string,
  artwork_fs_node_id?: string, compressed_artwork_fs_node_id?: string,
  vocals_fs_node_id?: string|null, instrumental_fs_node_id?: string|null,
  vocal_separation_started_at?: string|null,   // ISO; non-null = separation in flight
  source_kind: "upload"|"yt_dlp"|"spotify_sync", source_provider, source_url, source_id,
  audio_codec, audio_bitrate_kbps, audio_sample_rate_hz, audio_channels,
  audio_lossless: boolean, audio_filesize_bytes,
  created_at, updated_at,
  // jam-only (ephemeral, never persisted):
  artwork_url?: string|null, audio_url?: string|null, artist_names?: string,
  jam_song?: boolean, jam_proposer?: { id, handle, name }
}
```
Artist display line helper (`formatArtists`): primary names joined by ", ", then `(feat. X, Y)` for featured. `"with"` credits only appear in the credits dialog. Fallback to legacy `song.artist` when `artists` is empty.

`Artist` (GET /artists): `{ id, name, canonical_name?, slug, user_id, songs_count?, image_fs_node_id?, compressed_image_fs_node_id?, banner_fs_node_id?, compressed_banner_fs_node_id?, mbid?, lastfm_listeners?, lastfm_playcount?, bio_html?, external_image_url?, similar?, picture/picture_small/medium/big/xl?, fallback_artwork_fs_node_id?, gallery_image_urls?, created_at, updated_at }`. The by-id/slug show endpoint returns the extended view (bio + gallery included).

`Playlist`: `{ id, name, user_id, artwork_fs_node_id?, source_kind: "manual"|"imported"|"spotify_sync"|string, source_provider, source_url, source_external_id, synced_at, created_at, updated_at }`.
- `Playlist.isSystem(p)`: `source_kind != null && source_kind !== "manual"` (Spotify-synced, read-only).
- `Playlist.isLikedMirror(p)`: system AND `source_external_id === "liked"` (renders the purple heart artwork, see 9.1).

`PlaylistSong`: `{ id, playlist_id, song_id, position, created_at, updated_at, song: Song }`. `id` is the join-row id; removal targets it, not the song id.

`LikedSong`: `{ user_id, song_id, liked_at, song: Song }`.

---

## 2. Shared building blocks (used by nearly every screen)

### 2.1 Hero (collection/artist header)
`Hero({ kind, title, subtitle, meta, image, backdrop, artworkSlot, accentColor })`
- `kind: "playlist" | "album" | "artist" | "mix" | "radio"` (used for the localized label fallback).
- Artist mode with a `backdrop` URL: full-bleed background photo, min-height 42dvh, gradient overlay bottom-up in the accent color, huge black-weight title over it.
- Artist mode without backdrop: circular avatar (or deterministic `ArtistInitialsAvatar`, see 2.6) + title.
- All other kinds: 36dvh (28dvh desktop) header with a square artwork (224px desktop / 128px mobile) on the left (or a custom `artworkSlot` node, e.g. the editable playlist artwork or gradient mix stamp), uppercase small `subtitle`, giant `title`, and a `meta` row (dot-separated counts etc.).
- Page accent color: if `accentColor` given, use it directly (mixes, liked songs, radios with no photo); otherwise sample the average color of `backdrop || image` (fast-average-color with saturation -10, brightness -60 dark theme / +40 light) and paint a vertical gradient from it to transparent behind the header.

### 2.2 StickyTitle
A zero-height sticky bar under the hero. A 1px sentinel sits at the hero bottom; when it scrolls out of view the bar fades in: blurred `bg-background/80` strip with the collection title (and optional leading node). Present on ArtistView, AlbumView/MediaCollectionView, LikedSongsView, MixView, RadioView.

### 2.3 ActionBar
Horizontal control row under the hero. Buttons render only when the handler is passed:
- Play (big filled circular primary button; Pause icon if `isPlayingThisCollection`)
- Shuffle (ghost)
- Start radio (ghost, Radio icon)
- Like (ghost Heart, `liked` fills it) - not wired on the collection screens in scope
- Add (ghost Plus with `addLabel` tooltip) - used by RadioView "save as playlist"
- Offline toggle (Download icon; when `isOffline` shows CloudCheck in primary color). One button doubles as "download all + keep synced" and "remove download".
- "More" ellipsis DropdownMenu when `menuItems` slot is given (playlist delete/copy).
- `rightSlot` for extra controls (not used by the screens in scope).

### 2.4 SongTable + SongRow (the one track list everywhere)
`SongTable({ songs, columns, addedAt, playCounts, onPlay(song, index), rowExtraActions?(song), onReorder?(from,to), showHeader })`
- Columns enum: `"index" | "title" | "album" | "addedAt" | "duration"`. On mobile (`useIsMobile`) `album` and `addedAt` are dropped automatically; the title cell already shows the artist line underneath.
- Optional header row: `#`, Title, Album, Added-at, Plays (only when `playCounts` map is non-empty), clock icon for duration, trailing spacer for the ellipsis (56px when reorder enabled, else 32px).
- Reorder: when `onReorder` given, rows become dnd-kit sortables restricted to the vertical axis with a grip handle (GripVertical) next to the ellipsis; drop calls `onReorder(fromVisualIndex, toVisualIndex)`.

`SongRow` per-row anatomy and interactions:
- Index cell: shows `index + 1`; if the row is the currently playing song, animated `PlayingBars` instead (primary color, paused when audio paused). On hover, becomes a play/pause button.
- 40px artwork thumb: click = play/pause overlay.
- Title: desktop click = navigate to the album page WITH the `#title` highlight hash; mobile just shows text (tap anywhere on the row plays). Current song's title tinted primary.
- Artist line: comma-separated clickable primary artists (navigate to `/music/artist/<slug>`), then `feat.` links for featured. Legacy fallback: single button with `song.artist`. Mobile: plain text.
- Vocal-separation badge: when `vocal_separation_started_at` set, a pill with a pulsing AudioWaveform icon + elapsed time (md+ only).
- Download badge (native app concept, web no-ops through `DownloadStatusContext`): CircleCheck (done), pulsing Download + percent (downloading/queued), red Download (error), nothing (idle).
- Album cell: click navigates to the album page (no hash).
- addedAt cell: `toLocaleDateString` of the ISO string from the `addedAt` map.
- playCount cell: plain number (Popular list on ArtistView).
- Duration: `m:ss`.
- Row activation: desktop double-click plays; mobile single tap plays.
- Ellipsis button (always visible on touch, hover-reveal on desktop) opens the actions dropdown; right-click / long-press opens an identical ContextMenu. Both render the SAME `useSongActions` list (section 12).

### 2.5 Tile / HomeCarousel / RailSection / RailEmpty
- `Tile({ href, title, subtitle, artwork, gradient, shape: "square"|"circle", onPlay })`: 176px-wide card, square (albums/playlists) or circular (artists) image, hover-scale, optional floating play button appearing on hover. Missing artwork falls through to the shared placeholder photo inside the `Image` component (do NOT branch to an icon).
- `HomeCarousel({ title, viewAllHref, children })`: horizontal embla carousel with a bold section title, chevron prev/next buttons (desktop only, disabled at the ends) and an optional uppercase "Show all" link.
- `RailSection({ label, children })`: standard vertical section wrapper for right-rail tab bodies (px-2 inset + muted label).
- `RailEmpty({ icon, text, action? })`: the single empty-state look for rail bodies: centered icon, muted text, optional secondary CTA button.

### 2.6 ArtistCard + ArtistInitialsAvatar
- `ArtistCard({ artist? , artistName? })`: circular avatar (max 160px) + centered name; click navigates to `/music/artist/<slug || encodeURIComponent(name)>`. With a full `Artist` resource it uses `Artist.artworkUrl(artist, "sm")`; with only a name string it calls `GET /songs/artist_pictures?name=` (Deezer lookup, `picture_medium` preferred) and shows a skeleton while loading.
- `ArtistInitialsAvatar({ name })`: deterministic fallback: up to 2 initials on an `hsl(hash(name), 45%, 42%)` disc, so pictureless artists remain distinguishable.

### 2.7 AlbumCard (search page only)
Small 112x160 outline button: 64px artwork (via `FsNode.dataUrl(artworkFsNodeId)`), 2-line album name. Click navigates to `/music/artist/<encodeURIComponent(artist || "null")>/<encodeURIComponent(album || "null")>`.

### 2.8 MixTile + mixLabels
- `MixKind` enum: `"top_artist" | "repeat_rewind" | "time_capsule" | "discoveries"`.
- `MixSummary` (GET /music_mixes): `{ slug, kind, title, description, title_key, title_params, description_key, description_params, seed, artist: Artist | null, gradient }`. Titles/descriptions MUST be rendered client-side from `title_key`+`title_params` via i18n (`components.music.mixLabels.title.<kind>`); `title`/`description` are English fallbacks only. Ignore the server `gradient` string; the client keeps a literal Tailwind map per kind:
  - top_artist: rose-600 -> fuchsia-600 -> indigo-700, icon Sparkles, accent `#c026d3`
  - repeat_rewind: amber-500 -> orange-600 -> rose-700, icon Music, accent `#ea580c`
  - time_capsule: emerald-500 -> teal-600 -> cyan-700, icon Clock, accent `#0d9488`
  - discoveries: sky-500 -> blue-600 -> violet-700, icon Compass, accent `#2563eb`
- Tile: 176px card, gradient square with the artist photo (`Artist.artworkUrl(mix.artist)`) under a dark top+bottom overlay, kind icon top-left, and a big uppercase "stamp" text sized down by length (`text-3xl` <= 8 chars, `2xl` <= 14, `xl` <= 22, else `base`). Stamp text: artist name for `top_artist`, `<seed>s` (e.g. "2010s") for `time_capsule`, else the title. Below: title + 2-line description. Click -> `/music/mix?slug=<slug>`.

### 2.9 LikedArtwork
Purple gradient tile (violet-700 -> purple-700 -> indigo-900) with a filled white Heart at 1/3 size. Accent constant `LIKED_ACCENT = "#7e22ce"`. Used by BOTH the local Liked Songs view and any Spotify "liked" mirror playlist so they read as the same surface.

---

## 3. Home screen (`/music/discover`, component `Home`)

### Data sources (5 parallel queries)
1. `GET /play_events/recent?group_by=album&limit=8` -> `RecentlyPlayedAlbum[]`: `{ album: string|null, artist: Artist | string | null, artwork_fs_node_id: string|null, last_played_at }`.
2. `GET /music_mixes` -> `MixSummary[]`.
3. `GET /playlists?modifiers[page]=1:20` -> `Playlist[]`.
4. `GET /songs/albums?modifiers[random]=true&modifiers[page]=1:10` -> album groupings `{ name, artist, artist_slug, artwork_fs_node_id }[]` (random 10 = "recommendations").
5. `GET /play_events/top?scope=artist&since=30d&limit=10` -> `TopArtist[]`: `{ artist: Artist | string, play_count }`.

Note: `artist` on the play_events endpoints can be a full `Artist` object (current backend) OR a bare string (legacy). Use the helpers: `artistDisplayName(a)` and `artistRouteSegment(a)` (slug if object, else `encodeURIComponent(name)`).

### Layout, top to bottom (filter = "all")
1. **Filter pills** (`HomeFilterPills`): `all | playlists | albums | artists`, animated primary pill on the active one. Local state only; selecting a pill hides/shows the sections below (no refetch).
2. **Top tiles grid** (`HomeTopTiles`, only when filter = all): up to 8 wide 64px-tall tiles (1/2/3/4 columns responsive) of recently played albums: artwork square + truncated title + hover play button (play handler currently not wired on Home; tiles navigate). Link target: `/music/artist/<artistRouteSegment>/<encodeURIComponent(album || "null")>`. Fallback when the user has NO play history: first 8 playlists (`/music/playlist?id=`). Loading: 8 skeleton bars. If both empty: section hidden entirely.
3. **Friends listening strip** (`FriendsListeningStrip`, filter = all) - social feature, separate spec.
4. **"Made for you" carousel** (filter = all): `MixTile` per mix. Shown while loading (6 square skeletons) or when at least one mix exists; hidden when loaded-and-empty.
5. **"Today's recommendations" carousel** (filter all or albums): `Tile` per random album, title = album name (fallback i18n "unknown album"), subtitle = artist display name, artwork via `FsNode.dataUrl(artwork_fs_node_id)`. Links like top tiles.
6. **"Your playlists" carousel** (filter all or playlists): `Tile` per playlist, subtitle = localized "Playlist", "Show all" -> `/music/playlists`.
7. **"Your artists" carousel** (filter all or artists, only when top artists exist): circular `Tile` per top artist -> `/music/artist/<segment>`, "Show all" -> `/music/artists`.

### Interactions / empty states
- Everything is navigation; no queue mutations happen on Home itself (top-tile onPlay exists in the tile component API but Home does not pass it).
- Empty states: sections silently collapse (no dedicated empty message on Home).

---

## 4. Search input (`MusicSearchInput`, lives in the shell top bar / rail)

- Debounced 220ms. Rounded input with leading Search icon and a clear (X) button when non-empty.
- **Recents dropdown** (focused + empty query): up to 6 recent search terms from localStorage key `oms.music.recent-searches.v1`, each row: Clock icon + term (click = submit search) + hover X to forget. Header label "recent".
- **Suggestions dropdown** (non-empty query): four parallel queries, each `modifiers[page]=1:20` candidates, re-ranked client-side by `rankByMatch` (the backend LIKE-matches and returns alphabetical order, which buries good matches), then top 3 PER KIND shown in order songs, artists, albums, playlists:
  - `GET /songs?search[title]=<q>` -> row: artwork, title, "Song • artists"
  - `GET /artists?search[name]=<q>` -> circular avatar, name, "Artist"
  - `GET /songs/albums?search[album]=<q>` -> artwork, name, "Album • artist"
  - `GET /playlists?search[name]=<q>` -> artwork, name, "Playlist"
- Row activation: song = REPLACE queue with just that song and play it (`setQueue([song]); setQueueIndex(0)`); artist/album/playlist = navigate (artist by `slug || encoded name`; album by `artist_slug || encoded artist || "null"` + encoded name; playlist by id).
- Keyboard: ArrowUp/Down cycles highlight (wraps), Enter picks highlighted or submits full search, Escape closes.
- Footer row "See all results for <q>" and plain Enter both push `/music/search?query=<q>` and store the term in recents.
- States: "loading" row while queries in flight and empty; "no results" row when settled empty.

---

## 5. Search results screen (`/music/search?query=`, component `Search`)

### Data sources
Same four list queries as the input but `modifiers[page]=0:20`, enabled only when the trimmed query is non-empty, all re-ranked with `rankByMatch`. Plus:
- Derived artists list: direct `/artists` hits FIRST (keeping their slugs), then unique artist name strings harvested from matched songs (`song.artist`) and albums (`album.artist`), deduped case-insensitively, re-ranked.
- `GET /songs/artist_pictures?name=` for the top-result avatar when the top artist has no resource.
- External search section (section 6).

### Layout
1. **Filter pills**: `all | songs | playlists | albums | artists` (horizontal scroll on mobile, animated active pill). Filter is local; it changes which sections render and how the top result is picked.
2. **filter = all**: two-column grid (stacks on mobile):
   - **"Top result" card**: min-height 260px card with 96px image (circle for artist), 2-line bold title, kind badge pill (Song/Artist/Album/Playlist) + subtitle (artists / album artist). Selection priority: any direct artist hit > first song > first album > first playlist > first derived artist. With a kind filter active, the first item of that kind wins. Click behavior: song -> album page with `#title` highlight hash; artist -> artist page; album -> album page; playlist -> playlist page. Songs additionally show a floating primary play button that plays JUST that song (`setQueue([song])`).
   - **"Songs"**: first 4 songs as `SongRow` with columns `["title","duration"]`; play = `setQueue(rankedSongs); setQueueIndex(i)` (whole ranked result list is the queue).
3. **filter = songs**: full ranked song list, columns `["index","title","album","duration"]`, same queue semantics.
4. **Artists section** (all/artists): wrap of `ArtistCard`s; resource-backed cards pass the `Artist`, derived ones pass just the name (triggers the Deezer picture lookup per card).
5. **Albums section** (all/albums): wrap of `AlbumCard`s.
6. **Playlists section** (all/playlists): responsive grid (2-5 cols) of playlist tiles (artwork + name + "Playlist" label) navigating to the playlist page.
7. **External results** (always at the bottom, section 6).

### States
- Empty query: single muted line ("type something" copy).
- Loading with zero local hits: "loading" line.
- Zero local hits after load: "No results for <q>" + still renders `ExternalResults` so Spotify/YouTube matches are reachable.

---

## 6. External results (`ExternalResults`, embedded in Search)

- `GET /music/external_search?q=<q>&kind=track` (min 2 chars, 5 min staleTime) -> `{ tracks: ExternalTrack[], albums: [], artists: [] }` where `ExternalTrack = { source: "spotify"|"youtube"|"soundcloud"|"bandcamp"|"itunes", kind: "track", source_id, source_url, title, artist, album, duration_ms, isrc, artwork_url }`.
- Section header (uppercase muted "from the internet" style label) with a small spinner while fetching. Empty after load: muted "nothing found" line.
- Each row: 40px artwork, title, "artist · album", source badge (md+), external-link icon to `source_url` (new tab), and an **Import** ghost button.
- Import flow (per row, keyed by `source_id`):
  1. `POST /song_imports` with body: for youtube/soundcloud `{ source_url }` (direct download); for spotify/itunes/bandcamp `{ search_artist, search_title, search_album?, isrc? }` (server-side search cascade). Always also: `source_provider`, `source_id`, `override_title`, `override_artist`, `override_album`, `artwork_url`, `expected_duration_s`. Response: `{ id, song_id, state }`.
  2. Poll `GET /song_imports/<id>` every 1500ms up to 5 minutes -> `{ state, progress_pct: number|null (0..1), error_message }`.
  3. While importing: 24px progress bar + percent instead of the button. `state === "complete"`: green check, invalidate songs/artists/albums lists, success toast. `state === "failed"`: error toast with `error_message`, button returns. Timeout: silently restore the button.

---

## 7. Artists hub (`/music/artists`, component `Artists`)

### Data sources
1. `GET /artists/overview` (staleTime 10 min; server caches 1h) -> `ArtistsOverview`:
```
{
  stats: { artists, songs, new_artists, seconds_played },
  heavy_rotation_window: "30d" | "all",
  spotlight: { artist: Artist, songs_count, albums_count, play_count } | null,
  heavy_rotation: [{ artist, play_count }],
  similar: { seed: Artist, artists: Artist[] } | null,
  neglected: [{ artist, songs_count }]
}
```
2. Infinite roster: `GET /artists?modifiers[page]=<n>:60&modifiers[order]=<name:asc | created_at:desc>` (page size 60; next page while a full page returns).
3. Server-side roster search (only while the filter box has text, debounced 250ms): `GET /artists?search[name]=<term>&modifiers[page]=1:60&modifiers[order]=name:asc`.
4. Spotlight tracks (lazy, only when a spotlight exists): `GET /songs?exact_search[artist]=<spotlightName>&artist_role=primary`.

### Layout
1. **ArtistSpotlight** (when `overview.spotlight`): full-bleed rounded banner (min 34dvh) with `Artist.bannerUrl` backdrop (fallback: fuchsia/violet/indigo gradient), uppercase "spotlight" label, giant clickable artist name (-> artist page), meta line "X songs • Y albums • Z plays" (plays only if > 0), and three buttons: white circular Play (queue = spotlight songs, index 0, shuffle off), ghost Shuffle (shuffle on, random start index), ghost Radio (-> `/music/radio/artist?artist=<slug>`). Play/Shuffle show a loading state while the songs query runs. Loading overview: 34dvh skeleton.
2. **Stat tiles** (2x2 mobile, 4 across): total artists, total songs, new artists, minutes played (`seconds_played / 60` rounded) with a window label ("this month" when `heavy_rotation_window === "30d"`, else "all time").
3. **Shelves** (`ArtistShelf` = HomeCarousel of ArtistCards with optional captions; a shelf with zero entries renders nothing):
   - "Heavy rotation" (title switches to "Most played" when window = all): heavy_rotation entries, caption "N plays".
   - "Similar to <seed.name>" (only when `overview.similar`): similar artists, no caption.
   - "Neglected" shelf: artists you have not played, caption "N songs".
4. **"All artists" section**: header with total count; controls row: search input (magnifier icon) + sort toggle pill group (`alphabetical` = `name:asc` / `recently added` = `created_at:desc`; switching sort restarts the infinite query).
5. **Roster grid**: 2-6 columns responsive of `ArtistCard`s. While filtering, the grid shows ONLY the server search results (no infinite scroll). Otherwise infinite scroll via an IntersectionObserver sentinel div at the bottom (spinner while fetching next page).

### States
- Roster loading (or search loading while filtering): 12 circular skeletons.
- Roster error: destructive "error loading artists" line.
- Empty: "no artists for filter" (filtering) vs "no artists found".

---

## 8. Artist screen (`/music/artist/[artist]`, component `ArtistView`)

### Data sources (all after slug resolution)
1. `GET /artists/<idOrSlug>` (`useArtistBySlugQuery`, retry: false, staleTime 5 min). Backend matches numeric id, slug, or canonical name. Returns the EXTENDED view: base Artist + `bio_html` + `gallery_image_urls` + `similar`. On 404 the raw URL segment is used as the display name (legacy name URLs still label the page).
2. `GET /songs/albums?exact_search[artist]=<name>&artist_role=primary` -> discography albums.
3. `GET /songs/albums?exact_search[artist]=<name>&artist_role=featured` -> "appears on" albums.
4. `GET /songs?exact_search[artist]=<name>&artist_role=primary` -> all songs (play-all source).
5. `GET /songs?exact_search[artist]=<name>&artist_role=featured` -> featured songs.
6. `GET /songs/artist_pictures?name=<name>` - ONLY when the resource has no uploaded/cached image (`image_fs_node_id`, `compressed_image_fs_node_id`, `picture` all empty). Lazily populates Deezer pictures server-side.
7. `GET /artist_metadata/<encodeURIComponent(name)>` -> `{ name, mbid, lastfm_listeners, lastfm_playcount, bio_html, image_url, similar: [{name, match}] }` (Last.fm shim; 1h staleTime).
8. `GET /play_events/top?scope=song&artist=<name>&since=all&limit=5` -> `TopSong[] = [{ song, play_count }]`.

### Layout
1. **Hero** (kind artist): backdrop = `Artist.bannerUrl(resource)` > Deezer `picture_xl`/`picture_big` > `metadata.image_url`. Avatar fallback (no backdrop): `Artist.artworkUrl` > `picture_medium`/`picture` > `metadata.image_url` > initials avatar. Meta: "N listeners •" (only when lastfm_listeners set, formatted with locale separators) "X albums • Y songs".
2. **StickyTitle** with the artist name.
3. **ActionBar**: Play (queue = all primary songs from index 0, shuffle off), Shuffle (shuffle on, random index), Start radio (-> `/music/radio/artist?artist=<slug || name>`). Buttons only render when there are songs.
4. **"Popular"** (when top songs exist): `SongTable` columns `["index","title","duration"]`, `showHeader=false`, with a per-row `playCounts` map. Fallback when no play history: first 5 of all songs. Row play looks the song up in the FULL song list and plays from there (queue = all songs), so next/prev walk the whole catalog; a top song missing from the full list is a no-op.
5. **"Discography"** grid (2-5 cols) of album `Tile`s -> `/music/artist/<album.artist_slug || artist.slug || encoded name>/<encoded album name || "null">`. Empty: "no albums found" muted line.
6. **"Participates in"** (featured albums, only when non-empty): same grid, subtitle = the album's own artist.
7. **"Featured on"** (featured songs, only when non-empty): `SongTable` (no header, index/title/duration); play sets queue = featured songs at that index.
8. **"About"** (when `metadata.bio_html` or gallery images exist):
   - `ArtistGallery` (when `gallery_image_urls` non-empty): 16:9 crossfading slideshow, auto-advance 6s, paused on hover/touch, chevron prev/next, dot indicators. Plain `<img>` tags (arbitrary Wikimedia hosts).
   - Bio rendered as HTML (`bio_html` is sanitized server-side; allowlist a/i/em/strong/p/br) + small attribution line.

### States
- Loading (artist resolving, albums loading, or pictures loading pre-resource): 42dvh hero skeleton + bar skeleton.
- Albums query error: destructive "error loading albums".

---

## 9. Album screen (`/music/artist/[artist]/[album]`, component `AlbumView`)

Thin wrapper over the shared `MediaCollectionView` (section 9.1).

### Data sources
1. `GET /artists` (unfiltered roster) - used ONLY to resolve the `[artist]` URL segment (slug match first, then case-insensitive name) into a context Artist for disambiguation.
2. `GET /songs?exact_search[album]=<album or "\b">&modifiers[page]=0:200`. The `"\b"` sentinel handles the "unknown album" (`/null`) page: only songs with NULL album, not the whole library. NOT filtered by artist on the server (visiting an album from a featured artist's page must still show every track).

### Derived client-side
- `songs`: if a context artist resolved, prefer the subset whose `artists` include that artist (primary or any role); if the subset is empty, fall back to all matches.
- `albumPrimary`: the most frequent primary artist across the songs (majority vote) - used for the header link, which may differ from the context artist.
- Meta row: primary artist name as a link to their page (or "unknown artist"), `• year` (first song with a year), `• N songs, M min Ss` total duration.
- Hero image: artwork of the first song. Subtitle: localized "Album" label. `collectionId` for the offline toggle: `album:<artistSlug lowercased>:<album lowercased>` (deterministic across refreshes).
- Columns: `["index","title","duration"]`. Play: queue = album songs, shuffle off; Shuffle: shuffle on + random index.

### 9.1 MediaCollectionView (shared by Album + Playlist)
`MediaCollectionView({ kind: "album"|"playlist", title, subtitle, meta, image | artworkSlot, accentColor, songs, isLoading, isError, errorMessage, emptyMessage, columns, addedAt, menuItems, rowExtraActions, onReorder, onPlay(index), onShuffle, onStartRadio, hasMore, isLoadingMore, onLoadMore, collectionId })`
- Renders Hero + StickyTitle + ActionBar + SongTable + optional infinite-scroll sentinel.
- Offline/downloads plumbing (native-app oriented; web defaults no-op): if the ambient `DownloadStatusContext` exposes `toggleOfflineCollection` AND `collectionId` is set, the ActionBar shows the offline toggle (pressing marks the collection offline = downloads every song + subscribes to sync; pressing again removes). Otherwise falls back to a one-shot `bulkDownload(songs)` if the context provides it; else no button.
- "Show only downloaded" global filter (from context): narrows visible rows to `status === "done"` live as downloads finish; while active, reorder is suppressed (visual indexes would lie) and the empty state switches to a dedicated "nothing downloaded here" message.
- States: loading = hero + bar + table skeletons; error = destructive `errorMessage`; empty = muted `emptyMessage`.

---

## 10. Liked songs screen (`/music/liked`, component `LikedSongsView`)

- Data: cursor-paged infinite query `GET /liked_songs?limit=100[&before=<liked_at of last row>]` -> `LikedSong[]`. Cursor (not offset) so liking mid-scroll does not shift pages. Next page while a full page (100) returns.
- Hero: kind playlist, purple `LikedArtwork` tile as `artworkSlot`, accent `#7e22ce`, subtitle = localized "Playlist", title = "Liked songs", meta = "N songs" (count of loaded rows).
- ActionBar: Play (queue = liked songs in order) and Shuffle. No radio, no offline toggle here (plain SongTable, not MediaCollectionView).
- Table columns `["index","title","album","addedAt","duration"]` with `addedAt` = `liked_at` per song.
- Infinite scroll sentinel + spinner at the bottom.
- States: skeletons while loading; destructive line on error; centered muted "no liked songs yet" when empty.
- Like state everywhere else comes from `GET /liked_songs/ids` -> `number[]` (30s staleTime) with optimistic add/remove on `POST /liked_songs {song_id}` / `DELETE /liked_songs/<song_id>`.

---

## 11. Playlists

### 11.1 List screen (`/music/playlists`, component `Playlists`)
- Data: `GET /playlists` (unfiltered).
- Header: "Playlists" + primary "Create" button (Plus) opening `CreatePlaylistDialog`.
- Body: vertical list of full-width outline rows: 96px artwork, bold name, "▶" glyph on the right. Click -> `/music/playlist?id=<id>`.
- States: "loading" text; destructive error text; empty = centered hint + outline "Create your first playlist" button.

### 11.2 CreatePlaylistDialog
Modal with a single name input (Enter submits), Cancel + Create (disabled until non-blank, loading spinner while pending). `POST /playlists { name }` -> invalidates the playlists list + success toast. Note the create endpoint also accepts optional `artwork_fs_node_id` and `song_ids` (used by RadioView save).

### 11.3 Playlist screen (`/music/playlist?id=<id>`, component `PlaylistView`)
Built on `MediaCollectionView` (9.1).

Data:
- `GET /playlists/<id>` -> Playlist.
- Infinite tracks: `GET /playlist_songs?exact_search[playlist_id]=<id>&modifiers[page]=<n>:100&modifiers[order]=position:asc` (page size 100; the backend clamps listings at 500 so paging is mandatory for long playlists). Rows are `PlaylistSong` (join rows with embedded `song`).

Derived: `songs` = page-flattened `ps.song`; `addedAt` map from `ps.created_at`; `playlistSongIds` map song_id -> join-row id (needed for removal).

Three flavors:
- **Manual playlist** (`source_kind === "manual"`): subtitle "Playlist"; artwork slot = `ChangePlaylistArtwork` (11.4, click-to-replace with crop); rows get an extra action "Remove from playlist" (Trash icon) -> `DELETE /playlist_songs/<playlistSongId>` (optimistic removal from the loaded pages, rollback on error, toasts); drag-reorder enabled ONLY once every page is loaded (`!hasNextPage`), a drop rebuilds the full song-id array and calls `POST /playlists/<id>/reorder { song_ids }` (optimistic page rewrite, rollback on error); overflow menu has destructive "Delete playlist" (confirm() prompt, `DELETE /playlists/<id>`, navigate to `/music/playlists`).
- **System playlist** (Spotify-synced): subtitle = Spotify icon + "Synced from Spotify"; static artwork image; NO per-row remove, NO reorder, NO artwork change; meta additionally shows a "Last synced <localeDate>" badge from `synced_at`; overflow menu offers "Copy to editable playlist" -> `POST /playlists/<id>/copy` then navigate to the copy.
- **Liked mirror** (system + `source_external_id === "liked"`): artwork slot = the purple `LikedArtwork`, accent `#7e22ce`, ignores the stored cover.

Common: meta = "N song(s) • H h M min" total duration; columns `["index","title","album","addedAt","duration"]`; play/shuffle set the queue to the loaded songs; ActionBar offline toggle keyed by playlist id; infinite scroll sentinel.

Artwork upload: `POST /playlists/<id>/upload_artwork` multipart field `artwork` (JPEG file produced by the crop dialog).

### 11.4 ChangePlaylistArtwork
Artwork square with hover overlay "Change artwork"; an invisible file input accepts `image/*`. On pick: validates it is an image (toasts), computes a compression ratio to target <= 2MB, opens a crop dialog (`ImageCrop`, square, output JPEG `artwork.jpg`), uploads via the callback, toasts progress/success/failure, revokes the blob URL.

### 11.5 AddToPlaylistDialog (opened from song actions everywhere)
- Data: `GET /playlists` filtered client-side to NON-system playlists only; `GET /playlist_songs?exact_search[song_id]=<songId>` (while open) to know which playlists already contain the song.
- Rows: artwork + name + trailing Check (already added) or Plus. Clicking toggles: if present -> `DELETE /playlist_songs/<joinRowId>` (dialog stays open); if absent -> `POST /playlist_songs { playlist_id, song_id }` then the dialog closes. Duplicates are prevented by showing the check instead of letting the add bounce off the backend uniqueness 400.
- Top row: "New playlist" button flips into an inline name input + Create; creates the playlist, adds the song, closes.
- States: loading text, error text, "no playlists" text.

---

## 12. Mix screen (`/music/mix?slug=`, component `MixView`)

- Data: `GET /music_mixes/<encodeURIComponent(slug)>` -> `Mix = MixSummary & { songs: Song[] }`.
- Hero: kind mix, subtitle "Mix", localized title from `title_key`; artwork slot = the kind gradient square with the artist photo overlay (same resolver as the tile: `Artist.artworkUrl(mix.artist)`) and the uppercase stamp text; accent: derived from the artist image when present (top_artist mixes), else the kind accent hex (see 2.8). Meta: localized description + "N songs".
- ActionBar: Play (queue = mix songs, index) + Shuffle. No save, no radio.
- SongTable columns `["index","title","album","duration"]`.
- States: skeletons while loading; destructive "error loading mix" on error/missing.
- Mixes are recomputed server-side; the slug is stable per kind/seed.

---

## 13. Radio screens (`/music/radio/artist?artist=`, `/music/radio/song?id=`, component `RadioView`)

- Data: `GET /music_radios/artist/<encodeURIComponent(artistSlugOrName)>` or `GET /music_radios/song/<songId>` (staleTime 5 min) -> `Radio = { slug, kind: "artist"|"song", title, description, seed, gradient, songs: Song[] }`. Song radios unshift the seed track as `songs[0]`. The payload is EPHEMERAL: regenerated per visit.
- Backdrop: artist radio = Deezer pictures of the artist (`GET /songs/artist_pictures?name=`; xl > big > medium); song radio = seed song artwork.
- Hero: kind radio, subtitle "Radio", `radio.title`; artwork slot = kind gradient square (artist: rose/fuchsia/indigo, song: amber/orange/rose; ignore the server `gradient` string) with the backdrop photo under a dark gradient and a Radio icon; accent from the backdrop when present else the kind hex (artist `#c026d3`, song `#ea580c`). Meta: description + "N songs" + small attribution note.
- ActionBar: Play, Shuffle, and Plus "Save as playlist": `POST /playlists { name: radio.title, song_ids: songs.map(id) }`, success toast, navigate to the new playlist; error toast on failure. Button hidden while the create is pending.
- SongTable columns `["index","title","album","duration"]`.
- States: skeletons; destructive "error loading radio".

---

## 14. Song context menus

### 14.1 useSongActions (THE canonical song menu)
Used identically by: SongRow's ellipsis dropdown, SongRow's right-click/long-press context menu, the BottomBar's menus, and the NowPlaying sheet overflow. Order and conditions (separators marked):

1. **Play / Pause** (Play/Pause icon). Label flips when this row IS the current song and playing. Rows pass their own `onPlay`; player surfaces omit it so the item toggles the current song.
2. **Like / Unlike** (Heart, filled when liked). Liked state from `GET /liked_songs/ids`; optimistic `POST /liked_songs` / `DELETE /liked_songs/<songId>`.
3. --- **Play next** (ListStart): `playNext(song)` on the local queue.
4. **Add to queue** (ListPlus): `addToQueue(song)`.
5. --- **Open album** (Disc): `/music/artist/<primaryArtistSlug(song)>/<encoded album || "null">`.
6. **Open artist** (User): `/music/artist/<primary slug>`.
7. **View credits** (Users) - only when `song.artists` non-empty. Opens `SongCreditsDialog`: artists grouped by role in order primary, featured, with; each group ordered by `position`; groups with no members hidden.
8. --- **Add to playlist** (Library): opens `AddToPlaylistDialog` (11.5).
9. **(collection extras)**: items injected by the surface, e.g. "Remove from playlist" on playlist rows.
10. **Start radio** (Radio): navigate `/music/radio/song?id=<songId>`.
11. **Propose to jam** (Radio icon) - only while following a jam whose `queue_mode === "everyone"` and the song is not itself a jam song: `jam.proposeSong(song.id)`.
12. **Separate vocals** (AudioWaveform) - only when stems are NOT ready (`vocals_fs_node_id` && `instrumental_fs_node_id` not both set). Disabled while processing; label becomes "Separating <elapsed>" using `vocal_separation_started_at`. Fires `POST /songs/<id>/separate` (optional `{ model_id }`), toasts start/failure. A watcher hook polls `GET /songs/<id>/separation` every 3s while `vocal_separation_started_at` is set -> `{ stems_ready, vocals_fs_node_id, instrumental_fs_node_id, progress_percent, job: { status: "complete"|"failed"|"canceled"|..., error } }`; on terminal state it toasts once and invalidates song lists.

The hook also returns `dialogs` (the AddToPlaylist + Credits dialog nodes) which the surface must render alongside the menu.

### 14.2 SongCard (legacy row used by pre-refactor surfaces)
Simpler card row: index, 48px artwork with hover play overlay, title (click -> album page + highlight hash), artist link, separation elapsed pill, duration, ellipsis dropdown with ONLY two items: "Add to playlist" and conditional "Separate vocals" (same rules as above). Mobile (<= 420px width): tapping the card body plays. New code should use SongRow instead.

### 14.3 MusicDropdown (global navbar mini player)
Trigger: navbar icon button; a spinning Disc3 while playing, a Music note otherwise. Popover content, top to bottom:
1. Ambient `MusicGradient` tinted with the current song's `artworkColor` (average color extracted by the provider).
2. If a song is loaded and its audio src resolved: the full `MusicPlayer` widget (52-wide layout) with: artwork + title + artists (title links to `/music` and closes the popover), seek bar, prev/play-pause/next, volume slider, like heart (same liked ids/mutations as 14.1), and a cog submenu exposing playback rate, volume, and the vocal-separation stack: enable/disable separation, playback mode (vocals/instrumental balance modes), per-stem vocal and instrumental volume sliders, live separation status (`omsvsStatus`/progress/error/startedAt), stems loading/failed + retry, "Separate vocals" trigger, and "Delete stems" -> `DELETE /songs/<id>/separation` (toasts success/error). `stemsReady` is true when the audio graph reports ready OR both stem node ids exist on the song.
3. If a song exists but the src has not resolved yet: skeleton placeholder (circle art + text bars + control dots).
4. If nothing is playing: centered Music icon + "no song playing" text.
5. "Up next" row (only when a next song exists in the queue order): ListMusic icon + next title, truncated.
6. Footer item "Open music page" -> `/music`.

---

## 15. Endpoint reference (copy-paste)

Library and search:
- `GET /songs` (ListFilters + `artist_role`) -> `Song[]` (max 500/page)
- `GET /songs/<id>` -> `Song`
- `GET /songs/albums` (ListFilters + `artist_role`) -> `[{ name, artist, artist_slug, artwork_fs_node_id }]`
- `GET /songs/artists` (ListFilters) -> `string[]` (legacy names)
- `GET /songs/artist_pictures?name=<artist>` -> `{ pictures: [{ picture, picture_small, picture_medium, picture_big, picture_xl }] }`
- `GET /music/external_search?q=<q>&kind=track|album|artist|any` -> `{ tracks, albums, artists }`
- `POST /song_imports` (see section 6 body) -> `{ id, song_id, state }`
- `GET /song_imports/<id>` -> `{ state, progress_pct, error_message }`

Artists:
- `GET /artists` (ListFilters) -> `Artist[]`
- `GET /artists/overview` -> `ArtistsOverview`
- `GET /artists/<idOrSlugOrName>` -> extended `Artist` (bio + gallery)
- `GET /artist_metadata/<name>` -> `ArtistMetadata` (Last.fm shim)
- `PATCH /artists/<id>` body `{ artist: { name?, gallery_image_urls? } }`
- `DELETE /artists/<id>`; `POST /artists/<id>/upload_image` and `/upload_banner` (multipart `image`)

Playlists:
- `GET /playlists` / `GET /playlists/<id>` / `POST /playlists { name, artwork_fs_node_id?, song_ids? }`
- `PATCH /playlists/<id> { name, artwork_fs_node_id? }` / `DELETE /playlists/<id>`
- `POST /playlists/<id>/reorder { song_ids: number[] }`
- `POST /playlists/<id>/upload_artwork` (multipart `artwork`)
- `POST /playlists/<id>/copy` -> new `Playlist`
- `GET /playlist_songs` (ListFilters; e.g. `exact_search[playlist_id]`, `exact_search[song_id]`, order `position:asc`) -> `PlaylistSong[]`
- `POST /playlist_songs { playlist_id, song_id }` / `DELETE /playlist_songs/<joinRowId>`

Likes and plays:
- `GET /liked_songs?limit=&before=<liked_at cursor>` -> `LikedSong[]`
- `GET /liked_songs/ids` -> `number[]`
- `POST /liked_songs { song_id }` / `DELETE /liked_songs/<song_id>`
- `POST /play_events { song_id }` -> `PlayEvent | { deduped: true }` (fire and forget, never toast)
- `GET /play_events/recent?group_by=song|album&limit=` -> `RecentlyPlayedSong[] | RecentlyPlayedAlbum[]`
- `GET /play_events/top?scope=song|album|artist&since=7d|30d|90d|all&artist=&limit=` -> `TopSong[] | TopAlbum[] | TopArtist[]`

Mixes and radios:
- `GET /music_mixes` -> `MixSummary[]`
- `GET /music_mixes/<slug>` -> `Mix` (with `songs`)
- `GET /music_radios/artist/<artistSlugOrName>` -> `Radio`
- `GET /music_radios/song/<songId>` -> `Radio`

Vocal separation and lyrics (menu/dropdown surfaces):
- `POST /songs/<id>/separate` (optional `{ model_id }`) -> Job
- `GET /songs/<id>/separation` -> `{ stems_ready, vocals_fs_node_id, instrumental_fs_node_id, progress_percent, job }`
- `DELETE /songs/<id>/separation`
- `GET /lyrics?song_id=` -> `{ synced, plain, attribution }`; `GET /lyrics/translation?song_id=&target=`; `POST /lyrics/sync { song_id }`

Assets:
- `GET /fs_nodes/<id>/data` (authenticated image/audio bytes; redirects to storage)
- `GET /fs_nodes/<id>/data_url` -> `{ url }` (for media elements that cannot follow the authed redirect)

---

## 16. Reimplementation gotchas (things the web code learned the hard way)

1. **`"\b"` null sentinel**: every `null` in request params becomes the literal backspace string. Unknown-album pages depend on `exact_search[album]="\b"`; forgetting this lists the entire library.
2. **Client-side re-ranking is mandatory**: `/songs`, `/artists`, `/songs/albums`, `/playlists` search with `LIKE '%term%'` and return alphabetical order. Fetch 20 candidates and re-rank locally (`rankByMatch`), otherwise "carlos" surfaces "Agrupamento Escolas D. Carlos I" above "Carlos Paião".
3. **500-row hard cap on every listing**: playlists over 500 tracks silently truncate unless you page (`playlist_songs` at 100/page, songs at 500/page, artists at 60/page, liked songs cursor at 100/page).
4. **Liked songs page by cursor** (`before=<liked_at>`), not offset; offset pages shift when the user likes something mid-scroll.
5. **Playlist reorder only when fully loaded**: reordering a partially loaded infinite list against the server's full list scrambles the tail. Also send the COMPLETE `song_ids` array to `/playlists/<id>/reorder`. Removal targets the `playlist_songs` join-row id, not the song id.
6. **Artist URL segment is polymorphic**: `/artists/<x>` resolves id, slug, or canonical name; keep the 404 fallback that treats the raw segment as a display name so legacy encoded-name URLs still work.
7. **Mix/radio gradients and titles**: ignore the backend `gradient` field (client keeps its own kind -> gradient map) and render mix titles/descriptions from `title_key`/`description_key` + params through i18n, not the English `title` string.
8. **Artist image sizes matter**: always request the "sm" Deezer render for grids; only heroes use xl/big. Deezer pictures are lazily backfilled, so only call `/songs/artist_pictures` when the Artist resource has no uploaded/cached image.
9. **play_events payloads are polymorphic**: `artist` may be a full `Artist` object or a bare string; use `artistDisplayName`/`artistRouteSegment` style normalization.
10. **System playlists are read-only** (`source_kind !== "manual"`): no rename/delete/reorder/row-removal/artwork change; offer "copy to editable" instead. The Spotify liked mirror (`source_external_id === "liked"`) always draws the purple heart artwork regardless of any stored cover.
11. **AddToPlaylist must pre-check membership** via `GET /playlist_songs?exact_search[song_id]=` or adds bounce off the uniqueness 400.
12. **Separation state needs both signals**: offer "Separate vocals" only when the stem node ids are absent; while `vocal_separation_started_at` is set poll `/songs/<id>/separation` (3s) and treat `stems_ready` OR live audio-graph readiness as done; previous-run stems can still be attached while a regeneration runs.
