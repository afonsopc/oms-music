# 01 - Boot, seams, screens, shell

One device. Fresh install for the first section, then a signed-in account with music.

## Boot seams (WORKPLAN WP12.1)

- [ ] The Metro log shows one `[boot] ok  ...` line per seam and NO `MISS` line:
      transport, downloads, downloadStatusProvider, separationService, playbackChannel,
      castButton + controllerStrip, jam, song menu slots, notice host.
- [ ] `[boot]` lines appear before the first screen paints (wireup runs from the root
      layout's side-effect import).
- [ ] Kill and relaunch with a valid token: the app lands on Home with no login flash
      (SessionGate holds the splash until the session resolves).
- [ ] Airplane mode + relaunch: still lands authed (offline boot keeps the token) and the
      downloaded library browses.

## Auth (FR-7..12)

- [ ] Email + password sign in; a wrong password shows the inline invalid-credentials
      message and no toast storm.
- [ ] Signup: email -> 6-digit code (resend countdown runs) -> name/password -> auto sign
      in.
- [ ] Reset password start + end.
- [ ] "Continue with GitHub" opens the WebView, the provider round trip ends on
      `omelhorsite.pt/account/oauth/callback`, the sheet closes by itself and the app is
      signed in (ticket adopted within its 2 min TTL).
- [ ] A denied GitHub authorization shows the mapped error string, not a raw code.
- [ ] Spotify sign-in on a non-allowlisted account shows the "not allowed to use Spotify"
      string.
- [ ] No Google button (DESIGN 16.4) and no passkey button (FR-13 deferred).
- [ ] Logout returns to login and a relaunch stays logged out.

## The 28 screens (FR-15)

Walk every route and confirm real content, never a placeholder:

- [ ] Tabs: Home, Search, Library, Downloads.
- [ ] Liked, Playlists, Playlist detail, Artists hub, Artists roster, Artist, Album,
      Mix detail, Artist radio, Song radio, Profile, Jam.
- [ ] Player modal pager: Now Playing -> Queue -> Lyrics -> Friends (swipe both ways).
- [ ] Settings: hub, Import (4 tabs), Songs, Artists, Playback, Downloads, Devices.

## Shell and visuals

- [ ] MiniPlayer pill is visible on every screen with a song loaded; 40 px artwork,
      title/artists, cast button, play/pause, 2 px progress line; tap opens the player.
- [ ] Scroll every list to its end: the last row is fully readable above the pill
      (FR-16 bottom padding), on tab screens AND pushed screens.
- [ ] Missing artwork always shows the shared placeholder photo, never a letter tile or an
      icon (FR-21). Check: a song without artwork, a playlist without artwork, an artist
      without an image, the Now Playing screen, the lock screen.
- [ ] Theme rows: light / dark / system restyle immediately; artwork-derived gradients flip
      variant without a visible re-download.
- [ ] Language rows: en / pt / lv relabel the whole UI including mix titles; radio titles
      stay in their pre-baked Portuguese.
- [ ] Portuguese copy is European Portuguese everywhere (no "você", no gerund forms like
      "está carregando", no Brazilian vocabulary).

## Deep links (FR-20)

- [ ] `bun e2e/deeplinks.ts ios` (or `android`) and watch each expectation.
- [ ] On Android the https rows open the app through the disambiguation dialog.
- [ ] On iOS only the `omsmusic://` rows are expected to open (no AASA, DESIGN 16.5).
