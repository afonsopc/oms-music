# 03 - Downloads, repair, offline

One device with cellular data and a WiFi network available.

## Downloading (FR-83..88)

- [ ] Song menu shows "Download"; while running it shows "Downloading N%" (disabled);
      when done it shows "Remove download".
- [ ] Row badges follow the same three states without the list stuttering (status reads
      are synchronous, progress updates are coarse).
- [ ] Download a whole playlist and a whole album; the Downloads tab counts them and shows
      the storage total.
- [ ] Enable "WiFi only" in download settings, switch to cellular and try to download:
      a refusal notice appears and NOTHING is queued.
- [ ] With "include stems" on, a separated song downloads its vocals and instrumental too
      (roughly double the bytes).
- [ ] Kill the app mid-download and relaunch: transfers resume or re-enqueue with no user
      action.

## Repair (FR-89)

- [ ] Turn "include stems" on for a library that was downloaded without them, then
      reconnect: the missing stems are fetched by the repair pass.
- [ ] Delete a file from the app container (or clear one row) and reconnect: the row is
      re-enqueued rather than left broken.
- [ ] Lyrics arrive with downloads and are readable offline.

## Offline (FR-91)

Airplane mode, app killed and relaunched:

- [ ] The app lands authed and Home renders from the offline library.
- [ ] Library, playlists, albums, artists and Liked list the downloaded content only.
- [ ] Artwork shows (local files), and never a network spinner loop.
- [ ] Playing a downloaded song works, including from the Downloads tab (the tap plays the
      downloaded list as the queue).
- [ ] Lyrics of a downloaded song render offline; a song without stored lyrics shows the
      empty state, not an error.
- [ ] No retry storm: with the proxy from checklist 05, an offline session issues no
      repeating failed requests.
- [ ] Back online: the library heals (repair pass) and normal queries resume.

## Collections (FR-87)

- [ ] The ActionBar toggle on a playlist/album marks it kept in sync; adding a song to that
      playlist downloads the new song automatically.
- [ ] Turning the toggle off removes the collection's files (and only those).
- [ ] "Show only downloaded" filters the collection screens and suppresses reordering.
