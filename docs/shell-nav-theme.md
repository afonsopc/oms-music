# Music web app: shell, navigation, theming and i18n

Audience: engineers rebuilding the omelhorsite music feature as a native React Native (Expo) app for iOS/Android against the SAME production backend, `https://backend.omelhorsite.pt`, with zero backend changes. This document covers the app shell, route map, navigation model, theming/visual design language, and i18n. All facts below were read from the actual source at `/Users/afonsocoutinho/Documents/omelhorsite/frontend`.

---

## 1. High-level architecture

- Frontend: Next.js App Router, static export (`output: "export"`, `trailingSlash: true` in `next.config`). There is no server: the site is prerendered HTML served from Cloudflare Pages; ALL data is fetched client-side with TanStack Query + axios against `https://backend.omelhorsite.pt`.
- The music feature lives under the route `/{language}/music/...`. Every URL carries a locale prefix (next-intl `localePrefix` default = "always"), e.g. `/en/music/discover/`, `/pt/music/playlist/?id=12`.
- Global providers (in `components/Providers.tsx`, order matters):
  `NextIntlClientProvider > ThemeProvider (next-themes) > QueryClientProvider > NavBarProvider > RemotePlaybackProvider > MusicProvider > JamProvider > PageColorBlobProvider > UploadQueueProvider`.
  MusicProvider (audio engine, queue) is GLOBAL - music keeps playing when the user navigates to any other section of the site. In a native app that is your background audio service.
- TanStack QueryClient defaults: `refetchOnWindowFocus: false`, `retry: false`, `staleTime: 25s`. A single client instance for the app lifetime (rebuilding it caused refetch storms mistaken for logout).
- The whole site sits under a global top navbar (`NormalNavBar`, fixed height 59px) with: service logo shield (the music layout sets a music logo as "secondary shield"), locale changer, theme selector (light/dark/system), account menu. The music shell then fills `calc(100dvh - 59px)`. A native app does not need this chrome, but it explains screenshots.

### Music layout entry point

`app/[language]/music/layout.tsx` is tiny:

```tsx
const MusicLayout = ({ children }) => {
  const { setSecondaryShield, setLogoRedirectUrl } = useNavBar();
  const { setService } = usePageColorBlob();
  useEffect(() => {
    setSecondaryShield(musicLogo);   // music logo in the global navbar
    setLogoRedirectUrl("/");
    setService("music");             // sets the section accent color (see theming)
  }, [...]);
  return <MusicShell>{children}</MusicShell>;
};
```

Everything interesting is in `components/music/MusicShell.tsx`.

---

## 2. Route map

All paths below are relative to the locale prefix (`/en`, `/pt`, `/lv`). Because the site is a static export, dynamic segments are handled with two tricks that a native router does NOT need to copy, but must understand to map deep links:

1. Query-parameter routes: detail pages whose id is app-internal use `?id=` / `?slug=` instead of a path segment (so the static host needs no rewrite rule). If the param is missing, the page redirects to a list page.
2. Placeholder-shell routes: artist/album keep pretty path segments; the build prerenders one shell with segment `_` (`generateStaticParams` returns `[{ artist: "_" }]`) and the host rewrites every real URL to it. Params are then read client-side from `window.location.pathname` via `lib/useRouteParams.ts` (NOT `useParams()`, which would always return `_`).

| Route | Kind | Renders | Notes |
|---|---|---|---|
| `/music/discover` | static | `Home` | The home page: filter pills + top tiles + rails |
| `/music/liked` | static | `LikedSongsView` | Liked songs collection |
| `/music/artists` | static | `Artists` | Artist gallery page |
| `/music/artist` | redirect | - | Client-redirects to `/music/artist/null` |
| `/music/artist/[artist]` | placeholder shell | `ArtistView` | `[artist]` is the artist slug, or URL-encoded name as fallback; literal `"null"` means "no artist" |
| `/music/artist/[artist]/[album]` | placeholder shell | `AlbumView` | album name URL-encoded in the path |
| `/music/playlists` | static | `Playlists` | Playlist grid |
| `/music/playlist?id=<number>` | query param | `PlaylistDetail` | no/invalid id redirects to `/music/playlists` |
| `/music/mix?slug=<string>` | query param | `MixDetail` | no slug redirects to `/music/discover` |
| `/music/radio/song?id=<number>` | query param | `SongRadio` | no id redirects to `/music/discover` |
| `/music/radio/artist?artist=<string>` | query param | `ArtistRadio` | no artist redirects to `/music/discover` |
| `/music/search?query=<string>` | query param | `Search` | full search results page |
| `/music/settings` | static | `ImportPage` | settings default = Import sub-page |
| `/music/settings/import` | static | `ImportPage` | wrapped in `<div className="p-5">` |
| `/music/settings/songs` | static | `SongsPage` | song library management table |
| `/music/settings/artists` | static | `ArtistsPage` | artist management table |
| `/music/settings/playback` | static | `PlaybackPage` | playback settings |

Sidebar also links to `/music/album/<artist>/<name>` for library album rows (encoded artist name + album name). Note the search input and Home build album links as `/music/artist/<artistSlugOrEncodedName>/<encodedAlbumName>`.

For a native app: use a normal navigator; the query-param vs path distinction only matters for parsing shared web links.

---

## 3. The shell (MusicShell)

Desktop layout is a Spotify-like 3-column + bottom bar arrangement; mobile collapses to content + floating mini player + sheets.

```
+--------------------------------------------------------------+
| global navbar (59px, site-wide)                               |
+----------+-+---------------------------------+---------------+
| Sidebar  |d| content column (scrolls)        | Queue rail    |
| (nav +   |r|                                 | (tabs: queue, |
| library) |a|                                 | lyrics,       |
|          |g|                                 | friends)      |
+----------+-+---------------------------------+---------------+
| BottomBar (88px desktop) OR JamBar when following a jam       |
+--------------------------------------------------------------+
```

### 3.1 Sidebar (components/music/Sidebar.tsx)

- Desktop (`md` breakpoint, >= 768px): always visible, resizable via a 4px drag handle. Widths: default 224, min 180, max 400. Dragging below 130px snaps into a one-column "compact" icon rail of 68px, which is the floor - the sidebar can never be fully hidden. No widths between 68 and 180 exist. Double-click on the handle resets to expanded 224. Handle is keyboard accessible (Left/Right = +-16px, Enter toggles mode).
- Mobile (< md): the sidebar is a left Sheet (drawer) opened by a floating round button (`PanelLeftOpen` icon) at top-left of the content, `absolute left-3 top-3`, `md:hidden`. The sheet suppresses auto focus so the keyboard does not pop.
- Persistence (localStorage): `music-sidebar-width` (px int), `music-sidebar-mode` (`"expanded" | "compact"`; legacy value `"hidden"` is migrated to `"compact"`).
- Content, top block (bordered): global search field (see 3.4), then nav items:
  - Discover (`Compass` icon) -> `discover`
  - Liked Songs (`Heart`) -> `liked`
  - Artists (`UserStar`) -> `artists`
  - Settings (`Cog`) - collapsible group with children: Import (`settings/import`), Songs (`settings/songs`), Artists (`settings/artists`), Playback (`settings/playback`). Group auto-expands when the active route is inside it. In compact mode the group opens as a right-side dropdown flyout.
  - Active state: `bg-muted text-foreground` on the row; matching is `pathname === /music/<slug>` or `startsWith(/music/<slug>/)`.
- Content, library block ("Your Library" header with `ListMusic` icon, plus button opens CreatePlaylistDialog, collapse toggle):
  - Filter pills: All / Playlists / Artists / Albums (type `FilterMode = "all" | "playlists" | "artists" | "albums"`). Default is `playlists` (not "all") to avoid building the full merged list on mount. Active pill has an animated sliding `bg-primary` background (framer-motion `layoutId`).
  - A small local search (magnifier expands into an input) filters the loaded rows client-side by name/subtitle substring.
  - Data: only the queries for the visible kind run (`enabled` flag). Page modifier `page: "1:500"` - the backend clamps any listing to 500 rows, so 500 is the true ceiling. Artists are ordered `order: "name:asc"`.
  - Rendering is windowed client-side: 40 rows initially, +40 whenever a sentinel row scrolls into view (IntersectionObserver, rootMargin 200px). This avoids mounting 500 artwork requests at once.
  - Row model (`LibraryItem`): `{ key, href, name, subtitle, artwork?, initial, kind: "playlist"|"artist"|"album", system?, liked? }`.
    - Playlist rows: href `/music/playlist?id=<id>`; subtitle "Playlist" or "Playlist • Synced from Spotify" for system playlists (`source_kind != null && != "manual"`); Spotify-synced rows get a small emerald `IconBrandSpotify` badge; the Spotify liked-mirror playlist (`source_external_id === "liked"`) renders the purple-heart `LikedArtwork` tile instead of an image.
    - Artist rows: circular artwork; href `/music/artist/<slug || encodeURIComponent(name)>`; artwork preference: `compressed_image_fs_node_id` else `image_fs_node_id` (as `/fs_nodes/<id>/data?token=`) else `picture_medium || picture || external_image_url`.
    - Album rows: href `/music/album/<encArtist>/<encName>`; subtitle "Album • <artist>"; artwork from `artwork_fs_node_id`.
  - Missing artwork falls back to a shared placeholder photo (see 6.6), never an icon.

### 3.2 Queue rail (QueuePanel)

- Right-side rail with three tabs: `type QueueTab = "queue" | "lyrics" | "friends"`.
- Open state and active tab persist in localStorage: `music-rail-open` (`"1" | "0"`), `music-rail-tab`. Rail width persists under `music-rail-width` (via `useResizablePanel`).
- Starts closed; auto-opens ONCE when the first song starts playing, but only if the user has never explicitly chosen an open state (their persisted choice always wins).
- Widths: default 320 (>= 1024px "lg") / 280 (md), min 260/220, max 520; the content column keeps a min of 420 (lg) / 320 (md). If minimums cannot share the row, the rail snaps closed instead of squeezing. Tabs switch to a compact presentation below 300px rail width.
- Below md the rail aside is UNMOUNTED (not hidden) - the mobile NowPlayingSheet owns queue/lyrics there; unmounting stops LyricsView's rAF loop.
- Toggling from the BottomBar: pressing the icon of the currently open tab closes the rail; pressing another switches tabs and opens it.

### 3.3 BottomBar (components/music/BottomBar.tsx)

Rendered only when a song is loaded. When the user is FOLLOWING a jam (`useJam().following`), the whole BottomBar is replaced by `JamBar` instead.

Desktop (md+): fixed footer, height 88px, `bg-background/85 backdrop-blur-xl`, with a `MusicGradient` tinted by the current artwork color at 60% opacity behind everything. 3-column grid `[minmax(180px,1fr) minmax(0,2fr) minmax(180px,1fr)]`:
- Left: 48px artwork (links to the album page), title (link to album), artists line (link to artist page), heart like-toggle, ellipsis overflow menu (same action list as SongRow context menu, via `useSongActions`). Right-click on this area also opens the menu (plain native `onContextMenu`, deliberately not Radix ContextMenu - nesting it with the dropdown crashed React #185).
- Center (max-w 722px): shuffle, previous, round play/pause (foreground-colored circle, spinner while buffering), next, loop (cycles None -> All -> One; `Repeat1` icon for One; primary color when active); below it the scrub bar with tabular-numeral time labels (current left, duration right).
- Right: Jam button (radio icon, member-count badge when a jam has > 1 member), DevicePicker (cast), Friends / Lyrics / Queue rail toggles (primary color when their tab is open), settings cog (playback rate, vocal separation, EQ, sleep timer...), mute toggle + volume slider (slider only >= lg, 96px wide).
- Remote playback: when this device is a "controller" (audio owned elsewhere), an emerald strip (`bg-emerald-600`, 24px) sits flush on top of the bar: "Playing on {device}"; tapping opens the device picker. When autoplay policy blocked local activation, the play button is replaced by a "Play here" pill.
- Artist/album links prefer the Phase 4 primary artist slug: `song.artists.find(a => a.role === "primary")?.slug || song.artists[0]?.slug || encodeURIComponent(song.artist)`.

Mobile (< md): floating mini-player pill, `fixed inset-x-2 bottom-2`, height 64px, rounded-xl, `bg-card/95 backdrop-blur` with border and heavy shadow; artwork 40px, title + artists, cast button, play/pause; a 2px progress line along the bottom edge. Tapping the pill opens `NowPlayingSheet` (full-screen now playing). The controller strip renders as a rounded emerald tab attached above the pill.

When either the bar or a jam is active, scrollable content gets `pb-[80px] md:pb-[96px]` so the bar never covers list tails.

### 3.4 Global search (MusicSearchInput, in the sidebar)

- Rounded-full input, `bg-secondary`, placeholder "What do you want to play?" (i18n `components.music.TopBar.searchMusic`; there is no top bar anymore - search moved into the sidebar to give heroes full height). In compact rail mode a search icon expands the sidebar and focuses the field.
- Debounce 220ms. Runs 4 parallel list queries with `page: "1:20"` (fetch 20 candidates per kind, rank client-side with `rankByMatch`, show top 3 per kind): songs by `search[title]`, artists by `search[name]`, albums by `search[album]`, playlists by `search[name]`.
- Dropdown result rows: 40px artwork (circle for artists), title + "Kind • detail" subtitle. Selecting: song -> plays immediately (`setQueue([song]); setQueueIndex(0)`); artist/album/playlist -> navigate. Footer "See all results" and Enter submit to `/music/search?query=...`.
- Recent searches (shown when the field is focused and empty): localStorage `oms.music.recent-searches.v1`, max 6, removable per-row.

### 3.5 Keyboard shortcuts (desktop web)

Window-level capture listener, Spotify-style, active whenever a song exists: Space = play/pause, ArrowLeft/Right = seek -/+5s, ArrowUp/Down = volume +-0.05. Suppressed while focus is in `input, textarea, select, [contenteditable], menus, dialogs`. (MusicShell currently registers this twice - a capture-phase hijack plus an older bubble listener; functionally one behavior. Irrelevant for native.)

---

## 4. i18n

Stack: `next-intl`. Config lives in `frontend/i18n/` + `frontend/config.ts`.

- Languages (`config.ts`): exactly three, in this order:
  - `en` English (default locale - it is `languages[0]`)
  - `pt` Portugues (EUROPEAN Portuguese - PT-PT, never Brazilian; this is a hard project rule)
  - `lv` Latviesu (Latvian)
- Message catalogs: `frontend/languages/en.json`, `pt.json`, `lv.json`. One big JSON per locale with identical key trees. Top-level namespaces: `websiteName, app, components, lib, queries, games, seo, countries`.
- Music strings live under `components.music.<ComponentName>.<key>`, e.g. `components.music.Sidebar.libraryTitle`, `components.music.BottomBar.playingOn` (ICU message with `{device}` param). Components call `useTranslations("components.music.Sidebar")` etc. The full list of music namespaces: ActionBar, AddToPlaylistDialog, AlbumView, AlbumViewer, AlbumsViewer, ArtistCard, ArtistMultiSelect, ArtistView, Artists, BottomBar, ChangePlaylistArtwork, CreatePlaylistDialog, DevicePicker, Discover, ExternalResults, FriendActivityPanel, FriendsListeningStrip, Hero, Home, HomeTopTiles, JamBar, JamPanel, JamProvider, LibraryControls, LibraryTab, LibraryViewer, LikedSongsView, LyricsView, MediaCollectionView, MixView, MusicProvider, MusicSearchInput, NowPlayingSheet, PlaylistView, Playlists, QueuePanel, RadioView, RemotePlayback, Search, SearchTab, Settings, Sidebar, Song, SongCard, SongCreditsDialog, SongRow, SongTable, Songs, Tile, TopBar, mixLabels.
- Time zone is hardcoded `Europe/Lisbon` in the request config and passed to the client provider.
- Invalid/missing locale falls back to the default locale (`en`).
- Locale switching: `router.replace(pathname, { locale })` via next-intl navigation wrappers (`frontend/i18n/navigation.ts` exports locale-aware `Link, redirect, usePathname, useRouter, getPathname`; `frontend/navigation.ts` re-exports them). All in-app hrefs are written WITHOUT the locale prefix (`/music/discover`) and the wrapper injects it.
- Server-localized content pattern (IMPORTANT for native): mixes come from the backend with `title` / `description` as English fallback strings PLUS `title_key` / `title_params` / `description_key` / `description_params`. The client renders `t("components.music.mixLabels.title." + title_key, title_params)` so mix names follow the UI language. A native app must replicate this key+params rendering, not display the raw `title`.
- Practical advice for RN: copy the three JSON catalogs as-is and use an ICU-capable i18n lib (the strings use `{param}` interpolation and are already organized per component).

---

## 5. Theming

### 5.1 Mechanism

- `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`. The user can pick light / dark / system from the navbar. Dark mode = `.dark` class on `<html>`; Tailwind `darkMode: ["class"]`.
- Design tokens are shadcn/ui-style HSL CSS variables in `app/[language]/globals.css`, consumed via Tailwind (`bg-background`, `text-muted-foreground`, etc.).

Light (`:root`), values are HSL `H S% L%`:

```
--background: 0 0% 100%          --foreground: 240 10% 3.9%
--card: 0 0% 100%                --card-foreground: 240 10% 3.9%
--popover: 0 0% 100%             --popover-foreground: 240 10% 3.9%
--primary: 240 5.9% 10%          --primary-foreground: 0 0% 98%
--secondary: 240 4.8% 95.9%      --secondary-foreground: 240 5.9% 10%
--muted: 240 4.8% 90.9%          --muted-foreground: 240 3.8% 46.1%
--accent: 240 4.8% 95.9%         --accent-foreground: 240 5.9% 10%
--destructive: 0 84.2% 60.2%     --destructive-foreground: 0 0% 98%
--success: 83 100% 24%           --success-foreground: 0 0% 98%
--border: 240 5.9% 90%           --input: 240 5.9% 90%
--ring: 240 10% 3.9%             --radius: 0.5rem
```

Dark (`.dark`):

```
--background: 240 10% 3.9%       --foreground: 0 0% 98%
--card: 240 10% 3.9%             --popover: 240 10% 3.9%
--primary: 0 0% 98%              --primary-foreground: 240 5.9% 10%
--secondary: 240 3.7% 15.9%      --secondary-foreground: 0 0% 98%
--muted: 240 3.7% 20.9%          --muted-foreground: 240 5% 64.9%
--accent: 240 3.7% 15.9%         --destructive: 0 62.8% 30.6%
--success: 83 44% 44%            --border/--input: 240 3.7% 15.9%
--ring: 240 4.9% 83.9%
```

Note: `primary` is NOT a brand color - it is near-black in light mode and near-white in dark mode (monochrome accent). Active pills, liked hearts, the play FAB, and active rail toggles are all `primary`, i.e. black-on-white / white-on-black. Color comes from artwork-derived gradients and the fixed gradient palettes below, not from the token set.

### 5.2 Section accent and gradients

- Each site section has a fixed accent (`lib/page_color_blob.ts` `serviceColors`); music is `#4B1E6D` (deep purple). The music layout calls `setService("music")`, which drives a decorative color blob in the global chrome. It is the closest thing to a "music brand color".
- `MusicGradient` (components/music/MusicGradient.tsx): the tint behind the bottom bar and the mobile mini player. Given a `backgroundColor` (the current song's artwork average color, computed client-side and cached per song in MusicProvider, default `#000000`), it renders a vertical `linear-gradient` of two `color-mix(in oklab, <color> N%, black|white)` stops with `saturate-200`:
  - dark theme: mixes toward black, 50% at top -> 25% at bottom;
  - light theme: mixes toward white, 30% -> 15%.
- Hero gradient: `Hero` derives an accent by average-coloring the artwork (`getImageAverageColor`, with saturation -10 and brightness -60 in dark / +40 in light), or uses a caller-provided `accentColor` for imageless surfaces. Non-artist heroes: `linear-gradient(to bottom, <color>, transparent)` over the header. Artist heroes: full-bleed backdrop photo with `linear-gradient(to top, color 0%, color(cc alpha) 25%, transparent 90%)`. Fallback color `#222222`.
- Liked Songs identity (`LikedArtwork.tsx`): purple gradient tile `bg-gradient-to-br from-violet-700 via-purple-700 to-indigo-900` with a centered white heart; page-bleed accent `#7e22ce` (purple-700). Used both for local Liked Songs and the Spotify liked-mirror playlist.
- Mix tile gradients, fixed per mix kind (`MixTile.tsx KIND_GRADIENT`):
  - `top_artist`: rose-600 -> fuchsia-600 -> indigo-700 (icon: Sparkles)
  - `repeat_rewind`: amber-500 -> orange-600 -> rose-700 (icon: Music)
  - `time_capsule`: emerald-500 -> teal-600 -> cyan-700 (icon: Clock)
  - `discoveries`: sky-500 -> blue-600 -> violet-700 (icon: Compass)
  When artist artwork exists it is layered over the gradient with a dark scrim `from-black/60 via-black/20 to-black/75` (dark at BOTH ends, so the white icon stays visible over light portraits).
- Spotify-sync markers use emerald (`text-emerald-500` badge, `bg-emerald-600` remote-playback strip).

### 5.3 Typography

- Body: Inter (Google font), applied on `<body>`.
- Display faces available as CSS vars: OMS Wide (`--font-oms-wide`, weight 900, local TTF) and Cantarell variable (`--font-cantarell`). Tailwind `font-omswide` / `font-cantarell`.
- Music page conventions: hero titles `text-3xl ... md:text-6xl lg:text-7xl font-black leading-tight`; rail/section headers `text-2xl font-bold tracking-tight`; kind labels above hero titles `text-xs font-semibold uppercase tracking-wide text-foreground/80`; tile titles `font-semibold` with `text-xs text-muted-foreground` subtitles; time labels `tabular-nums text-[11px] text-muted-foreground`; mix tile stamp: `font-black uppercase leading-none tracking-tight text-white`, size stepped by text length (<= 8 chars `text-3xl`, <= 14 `text-2xl`, <= 22 `text-xl`, else `text-base`).
- Radius: base `--radius: 0.5rem`; cards/tiles `rounded-md`, pills and play buttons `rounded-full`, mobile mini player `rounded-xl`.

### 5.4 Layout patterns (the design language to reproduce)

- Home (Discover) page, `p-6`, vertical `gap-8`: filter pills row -> "top tiles" grid -> friends listening strip -> horizontal rails.
- Filter pills (HomeFilterPills + sidebar pills): rounded-full buttons; the active one has an animated spring-sliding `bg-primary` capsule behind `text-primary-foreground` (framer-motion shared `layoutId`); inactive: plain text with `hover:bg-foreground/10` (home) or `bg-secondary` (sidebar). Enum order: `all, playlists, albums, artists`.
- Top tiles (HomeTopTiles): responsive grid 1/2/3/4 cols (`sm:2 lg:3 xl:4`), max 8 items; each is a 64px-tall horizontal card, `bg-foreground/5 hover:bg-foreground/10`, square 64px artwork on the left, bold truncated title, play FAB sliding in on hover. Content: recently played albums, falling back to the user's playlists if no history.
- Rails (HomeCarousel): section header (title left; round chevron paging buttons `bg-foreground/10` md+; optional uppercase "SHOW ALL" link) above an Embla carousel (`dragFree`, `align: start`), `gap-4`. Home rails: "Made for you" (mix tiles), "Recommendations for today" (random albums), "Your playlists" (viewAll -> /music/playlists), "Your artists" (top artists last 30d, circle tiles, viewAll -> /music/artists).
- Tiles (Tile.tsx): fixed width `w-44` (176px), padding 3, `rounded-md`, `hover:bg-foreground/5`; square artwork (circle for artists) with `shadow-md`, image scales 1.05 on hover; hover-reveal round play FAB bottom-right (`bg-primary`); title + optional subtitle below. Skeletons: `size-44` squares while loading.
- Collection pages (playlist/album/artist/mix/radio/liked): Hero (min-h 36dvh, 28dvh at md; artist hero 42dvh with photo backdrop) -> ActionBar -> song table. `StickyTitle` renders a zero-height sticky bar that fades in (`bg-background/80 backdrop-blur shadow-sm`) once a hero-bottom sentinel scrolls off screen, showing a leading action (e.g. play) + bold title.
- ActionBar: left cluster = 56px round primary play/pause FAB (`shadow-lg`, hover scale 1.05) then ghost icon buttons: shuffle, start radio, like (heart, `text-primary` + filled when liked), add (plus), download/offline toggle (`Download` / filled `CloudCheck`, primary when on), overflow ellipsis dropdown; right slot for view toggles (e.g. list/compact).
- Song tables (SongTable): default columns `["index", "title", "album", "addedAt", "duration"]`; below md the `album` and `addedAt` columns are dropped (artist still shows inside the title cell). Optional drag-to-reorder with dnd-kit (grip handle) on playlists. Rows share one context menu / actions list (`useSongActions`) with the BottomBar overflow menu.
- Empty artwork ALWAYS falls back to one shared placeholder photo (`assets/fallbackPhoto.jpg`) via the shared `Image` wrapper - never a letter tile or icon, so missing art looks identical everywhere.
- Scrollbars: content areas use a discreet overlay scrollbar (`less-obvious-scrollbar` utility); horizontal rails hide theirs.

---

## 6. Backend contract used by the shell (base `https://backend.omelhorsite.pt`)

Auth: web uses an httpOnly SameSite=lax session cookie (`withCredentials`); native (the existing Capacitor build) and dev keep a bearer token in storage and send `Authorization: Bearer <token>`; media/artwork URLs append `?token=<token>` when a token exists (`getAuthenticatedBackendUrl`). An Expo app is not same-site, so it MUST use the token flow, exactly like Capacitor does today (`isCookieAuth()` is false when `capacitor:` protocol / non-same-site host).

List-endpoint filter serialization (axios default bracket params on GET):
`?search[title]=x&modifiers[page]=1:20&modifiers[order]=name:asc&modifiers[random]=true&exact_search[...]=...`
- `modifiers[page]` format is `"<page>:<perPage>"` (e.g. `1:500`); listings are clamped server-side to 500 rows.
- `null` values are transmitted as the literal backspace character `"\b"` (the API's "explicit null" sentinel; see `transformNulls`).

Endpoints the shell/nav surfaces call (all GET unless noted):

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /playlists` | sidebar library, home rail, search | list playlists (`search[name]`, page) |
| `GET /artists` | sidebar library, search | list artists (`search[name]`, `modifiers[order]=name:asc`) |
| `GET /songs` | search dropdown | list songs (`search[title]`) |
| `GET /songs/albums` | sidebar library, search | distinct albums: `{ name, artist, artist_slug, artwork_fs_node_id }[]` |
| `GET /music_mixes` | home "Made for you" | `MixSummary[]`: `{ slug, kind, title, description, title_key, title_params, description_key, description_params, seed, artist, gradient }`; `kind` enum: `top_artist | repeat_rewind | time_capsule | discoveries` (server `gradient` field is IGNORED by the client; kind-keyed local gradients are used) |
| `GET /play_events/recent?group_by=album&limit=8` | home top tiles | recently played albums |
| `GET /play_events/top?scope=artist&since=30d&limit=10` | home "Your artists" | top artists |
| `GET /liked_songs/ids` | BottomBar heart state | array of liked song ids |
| `POST /liked_songs` body `{ song_id }` / `DELETE /liked_songs/:songId` | BottomBar heart | like/unlike |
| `GET /fs_nodes/:id/data?token=<token>` | every artwork | raw image bytes (redirects to storage; use `GET /fs_nodes/:id/data_url` -> `{ url }` when a redirect-following-with-auth is a problem) |
| `GET /music_radios/song/:id`, `GET /music_radios/artist/:name` | radio pages | build radio |
| `GET /artists/:idOrSlug` | artist page | artist detail (id, slug or name) |
| `GET /music_mixes/:slug` | mix page | mix with songs |

Artwork URL resolution order (client-side helpers): Song: `artwork_url` (external) else `compressed_artwork_fs_node_id` else `artwork_fs_node_id` via `/fs_nodes/:id/data`. Playlist: `artwork_fs_node_id` or the purple heart for liked-mirror. Artist: `compressed_image_fs_node_id`, `image_fs_node_id`, Deezer `picture_medium`/`picture`, `external_image_url`, `fallback_artwork_fs_node_id`.

---

## 7. Client-side persistence keys (localStorage)

| Key | Values | Meaning |
|---|---|---|
| `music-sidebar-width` | px int | expanded sidebar width (clamped 180..400 on load) |
| `music-sidebar-mode` | `expanded` / `compact` | sidebar mode (`hidden` legacy -> compact) |
| `music-rail-open` | `1` / `0` | queue rail open |
| `music-rail-tab` | `queue` / `lyrics` / `friends` | active rail tab |
| `music-rail-width` | px int | rail width |
| `oms.music.recent-searches.v1` | JSON string[] | recent searches, max 6 |
| `token` | string | bearer token (native/dev); also appended to artwork URLs |
| `authed` | `"1"` | non-sensitive "signed in" hint (cookie web) |

---

## 8. Gotchas for a native rebuild

1. `primary` is monochrome (black/white per theme), not a brand color. The purple `#4B1E6D` is the music section accent; the liked-songs purple is a separate fixed gradient (`violet-700/purple-700/indigo-900`, bleed `#7e22ce`). Do not invent a single "brand purple" token.
2. Mix titles/descriptions must be rendered from `title_key` + `title_params` through the i18n catalog (`components.music.mixLabels.*`); the `title` string from the API is an English-only fallback. The API's `gradient` field is deliberately ignored - gradients are hardcoded per `kind` in the client.
3. Locale prefix is always present in web URLs (`/pt/music/...`). Deep links / shares must be parsed accordingly; `pt` is European Portuguese.
4. Static-export quirks (placeholder `_` shells, `?id=` detail routes, `useRouteParams` reading `window.location`) are web workarounds; do NOT carry them into native routing, but keep the URL shapes in mind for handling incoming web links, including both `/music/album/<artist>/<album>` (sidebar) and `/music/artist/<artist>/<album>` (everything else) forms for albums.
5. Sidebar library queries are gated by the active filter pill (`enabled`); "All" is intentionally NOT the default because it loads playlists + artists + albums (up to 500 each). Replicate the laziness and the 40-row incremental rendering or a big library will hammer the artwork endpoint.
6. The rail auto-open happens once, on first playback, and ONLY if the user never expressed a preference; the persisted preference always wins.
7. Artwork requests are authenticated: `/fs_nodes/:id/data` needs the token query param (native) and 404s for anonymous callers; the media variant redirects cross-origin to storage, which breaks credentialed requests - use `/fs_nodes/:id/data_url` to resolve a direct URL where needed.
8. Liked state in the player bar comes from `GET /liked_songs/ids` (an id array), not from a flag on the song object.
9. When following a jam, the player bar is replaced by the JamBar and local transport controls are ceded; when this device is a remote-playback controller, an emerald "Playing on X" strip appears and local-only settings are disabled.
10. `staleTime` 25s, `retry: false`, no refetch-on-focus: the UI tolerates slightly stale lists; aggressive refetching caused audible interruptions historically.
11. The backend transmits explicit nulls in filters as the `"\b"` character; if you port the request layer, keep `transformNulls` semantics.
12. The theme has three states (light/dark/system) and every artwork-derived gradient recomputes with different mix targets per theme (toward white in light, toward black in dark) - port both variants, not just dark.
