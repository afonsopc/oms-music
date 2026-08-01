# Playback engine spec (web music feature of omelhorsite)

Audience: an engineer rebuilding the music playback core as a native React Native
(Expo) app for iOS and Android, talking to the SAME production backend at
`https://backend.omelhorsite.pt` with zero backend changes.

This is a description of how the shipping web client actually works, extracted
from the code (not from docs). Primary sources, all under
`/Users/afonsocoutinho/Documents/omelhorsite`:

- `frontend/components/music/MusicProvider.tsx` (the engine, ~2700 lines)
- `frontend/components/music/RemotePlaybackProvider.tsx` (device sync layer)
- `frontend/lib/vocalSeparation.ts` (AudioGraph: Web Audio stem mixer + EQ)
- `frontend/lib/audioEqualizer.ts` (3-band biquad EQ)
- `frontend/lib/queries/playback.ts` (wire types)
- `frontend/services/CableService.ts` (hand-rolled ActionCable client)
- `frontend/services/MusicService.ts` (Song model + REST calls)
- `frontend/services/StorageService.ts` (FsNode + data_url resolution)
- `frontend/services/BackendService.ts` (base URL + auth)
- `frontend/components/MusicPlayer/index.tsx`, `CogDropdown.tsx`
- `frontend/components/music/QueuePanel.tsx`, `QueueList.tsx`,
  `QueuePanelMobileBody.tsx`, `NowPlayingSheet.tsx`, `PlayingBars.tsx`,
  `DevicePicker.tsx`
- Backend: `backend/app/channels/playback_channel.rb`,
  `backend/app/controllers/fs_nodes_controller.rb`,
  `backend/app/controllers/play_events_controller.rb`,
  `backend/app/services/audio_compressor.rb`, `backend/config/routes.rb`

Conventions: all REST paths below are relative to `https://backend.omelhorsite.pt`.
The web SPA in production authenticates with a SameSite httpOnly cookie; a native
app cannot, and instead uses the JS token path that already exists: every REST
request carries `Authorization`-style bearer token (the request layer sends the
token from storage), and the WebSocket carries it as `/cable?token=<token>`.
`BackendService.ts` already special-cases Capacitor (`capacitor:` protocol) to
use the token path against the public backend, so token auth on native is a
first-class, supported mode, not a hack.

---

## 1. Architecture overview

Two nested React providers make up the engine:

```
RemotePlaybackProvider          <- WebSocket (ActionCable "PlaybackChannel")
  └── MusicProvider             <- owns the HTMLAudioElement + queue + modes
        └── UI (BottomBar, NowPlayingSheet, QueuePanel/QueueList, DevicePicker,
             CogDropdown, MusicPlayer, PlayingBars, ...)
```

Key design decisions you must replicate (or consciously map to native
equivalents):

- **One audio element** (`new Audio()`), owned by MusicProvider, held in a ref
  (`audioRef`). Everything (scrub bars, MediaSession, remote publishing) reads
  position from provider state, never from the element directly.
- **The queue is device-local while you are the active device**; the server
  keeps a per-account `PlaybackState` snapshot that (a) is the account-wide
  "continue where you left off" state, and (b) is what other devices
  (controllers) render.
- **Roles**: exactly one device may be "active" (owns audio output). All others
  are "controllers" (silent, mirror the snapshot, send commands). With nobody
  active, everyone is in `no_active` (renders the frozen snapshot, paused).
- **Split contexts**: actions context is identity-stable for the whole session
  (delegates through a ref), state context changes on every tick. Dispatch-only
  components never re-render from playback state.
- **All user-facing actions are "wrapped"**: on a controller they become cable
  commands; on the active device (or no_active) they execute locally. See
  section 10.

---

## 2. The Song object (what the queue holds)

`Song` (from `frontend/services/MusicService.ts`), relevant playback fields:

```ts
type Song = {
  id: number;
  title: string;
  album: string | null;
  artists?: SongArtistEntry[];        // role: "primary" | "featured" | "with"
  artist?: string | null;             // deprecated legacy string fallback
  duration: number;                   // seconds
  audio_fs_node_id: string;           // ORIGINAL audio file (any codec)
  compressed_audio_fs_node_id?: string; // AAC 192k m4a transcode (preferred)
  artwork_fs_node_id?: string;
  compressed_artwork_fs_node_id?: string;
  vocals_fs_node_id?: string | null;       // stem (mp3), null until separated
  instrumental_fs_node_id?: string | null; // stem (mp3), null until separated
  vocal_separation_started_at?: string | null;
  audio_codec: string | null;
  audio_bitrate_kbps: number | null;
  audio_sample_rate_hz: number | null;
  audio_channels: number | null;
  audio_lossless: boolean;
  // Jam-only (song proposed by another user into your queue):
  audio_url?: string | null;    // presigned URL, plays directly
  artwork_url?: string | null;
  artist_names?: string;
  jam_song?: boolean;
  jam_proposer?: { id: string; handle: string; name: string };
};
```

Artist display helpers: `formatArtists(song)` renders "A, B (feat. C)";
`formatArtistsFull(song)` also appends "(with D)" and is what MediaSession uses.

Artwork URL: `Song.artworkUrl(song)` =
`song.artwork_url` (jam) else `GET /fs_nodes/<compressed_artwork_fs_node_id>/data`
else `/fs_nodes/<artwork_fs_node_id>/data`, built via
`getAuthenticatedBackendUrl` which appends `?token=<token>` when a token exists
(native/dev). The `/data` route redirects to storage; images tolerate the
redirect, audio does not (below).

---

## 3. Audio URL resolution and streaming

### 3.1 Why the two-step resolve exists

The naive URL `GET /fs_nodes/:id/data` (route exists) 302-redirects to object
storage (MinIO at `https://minio.omelhorsite.pt`, S3 API, presigned URLs). In a
browser a credentialed media request cannot survive that cross-origin redirect
(Origin becomes `null`, storage answers `Access-Control-Allow-Origin: *`, which
is illegal with credentials; without credentials the backend 404s because the
node is invisible to an anonymous caller). So the web client resolves first:

```
GET /fs_nodes/:id/data_url        (authenticated)
=> 200 { "url": "https://minio.omelhorsite.pt/omelhorsite-production/...?X-Amz-..." }
```

The returned URL is a presigned S3 GET, valid for **6 hours**
(`FsNodesController::MEDIA_URL_EXPIRY = 6.hours`; the backend comment explains
the browser re-requests the object on seeks/resumes, so short-lived URLs die
mid-listen). The audio element then loads the presigned URL **directly from
storage, anonymously** (`crossOrigin = "anonymous"` on web - the signature in
the URL is the credential).

For a native app this exact flow works unchanged: call `data_url` with the
bearer token, feed the presigned URL to the native player. Every resolve mints
a DIFFERENT presigned URL, so never cache by URL - cache by fs node id.

**A retry wrapper matters**: the web client resolves with
`tryManyTimes(() => FsNode.resolveDataUrl(id), 2)` (2 attempts total).

### 3.2 Which fs node is played (variant selection)

Per song and per playback mode (`reloadSrc` in MusicProvider):

```
if song.audio_url                       -> play it directly (jam proposal;
                                           the other user's nodes are not
                                           resolvable by your session)
else:
  mode == "instrumental" -> song.instrumental_fs_node_id  (fallback below if null)
  mode == "vocals"       -> song.vocals_fs_node_id        (fallback below if null)
  otherwise (original / custom / stem id missing):
    song.compressed_audio_fs_node_id || song.audio_fs_node_id
```

So: **compressed variant is preferred whenever it exists**; the original is the
fallback. "custom" mode also plays the original/compressed file on the element
(muted, as the timing clock) - see section 7.

### 3.3 Codecs and container facts

- Compressed variant: **AAC 192 kbps in an .m4a (audio/mp4) container**, made by
  `AudioCompressor` with ffmpeg `-c:a aac -b:a 192k -movflags +faststart`.
  Faststart means the moov atom is at the head, so playback can start from the
  first HTTP Range chunk.
- Original variant: whatever the user uploaded / yt-dlp produced (`audio_codec`,
  `audio_lossless` etc. on the Song describe it; the library holds many codecs
  including lossless).
- Stems (vocals / instrumental): **MP3** (`audio/mpeg`), filenames like
  `"<base> (Vocals).mp3"` (see `vocal_separation_proxy_job.rb`).

### 3.4 Range / "slice" behavior

Streaming is plain HTTP against MinIO's presigned URL; MinIO supports standard
`Range` requests and that is all the client needs (the browser's media stack
issues Range requests on its own; a native player does too). The "slice"
caching mentioned in infra notes is an nginx `slice`-module cache on the server
side, transparent to clients; do not build anything for it. Just make sure your
native HTTP stack sends normal Range headers and follows no redirects on the
presigned URL (there are none).

### 3.5 Prefetch of the next track

`maybePrefetchNext` runs from `timeupdate` when `duration - currentTime <= 30`
(and is skipped when: controller role, LoopMode.One, no upcoming entry, upcoming
is a jam song, or the upcoming song already failed):

- Resolves the upcoming song's `data_url` for the same variant-selection rule as
  3.2 and stashes `{ songId, nodeId, url, resolvedAt }` in a ref.
- A prefetched URL is honoured only if `songId` AND `nodeId` match what the
  transition wants and it is younger than `PREFETCHED_URL_TTL_MS = 5 min`.
- It is consumed **one-shot** (cleared on use): a stream error that re-resolves
  the same song must mint a genuinely fresh URL, not replay the cached one.
- In custom mode with a connected AudioGraph it additionally warms the decoded
  stem buffer cache for the upcoming song (`graph.prefetchStems`).
- In-flight guard: only one prefetch per song id at a time.

### 3.6 Failure handling and recovery

Two failure paths, both funnelled to `markSongFailedAndAdvance(songId)`:

1. **URL resolve failed** (both attempts): mark and advance.
2. **Element `error` event** (`handleStreamError`) - typically a presigned URL
   that expired mid-stream, or a 404:
   - First failure for this song id: remember `currentTime` as a pending seek,
     re-resolve the URL (fresh, not prefetched), reload, and resume if the song
     was meant to be audible (`playing || !el.paused || intendedPlayRef`).
   - Second failure for the same song id: mark and advance.

`markSongFailedAndAdvance`:
- adds the song id to a session-scoped `failedSongIds` set,
- toasts "song unavailable, skipped" at most every 3 s,
- advances `queueIndex` (+1, wrapping to 0 only under LoopMode.All),
- **stops the auto-advance chain if the next entry is also in the failed set**
  (prevents an infinite skip loop through a dead queue).
- A song that later fires `playing` (audibly plays) is removed from the failed
  set ("proven good again").

Also note `AbortError` (src swap killed a pending play) and
`NotSupportedError` are swallowed by `play()`; `NotAllowedError` means autoplay
policy refused (see section 11.7 for the blocked flow).

### 3.7 Race protection on transitions

Every transition bumps `transitionGenRef`; async follow-ups (URL resolve
completion, delayed `play()`) compare their captured generation and bail if a
newer transition happened. Additionally `loadingSongIdRef` guards the resolve
itself: a late `data_url` answer for a song the user already skipped is
dropped instead of yanking the element back. Reproduce both guards; rapid
skipping is the most common way to break a playback engine.

Seeks issued before metadata is loaded are dropped by browsers, so a target
position (activation seed, stream-error resume, mode switch) is stored in
`pendingSeekRef` and applied in the `loadedmetadata` handler.

---

## 4. Queue model

### 4.1 The quartet

Queue state is ONE atomic unit (never update the pieces independently):

```ts
type QueueState = {
  queue: Song[];        // storage order, append-only-ish backing array
  queueOrder: number[]; // permutation of indices into queue; THE visible order
  queueIndex: number;   // position within queueOrder (NOT within queue)
  shuffle: boolean;
};
currentSong = queue[queueOrder[queueIndex]]
```

Invariants: `queueOrder` is always a permutation of `0..queue.length-1`;
`queueIndex` is always within `queueOrder`. A ref
(`queueStateRef`) is the synchronous source of truth so bursts of operations in
one handler compose; React state mirrors it for rendering.

The imperative rule: **every operation owns its splice**. Nothing rebuilds
`queueOrder` reactively from `shuffle`.

### 4.2 Operations (exact semantics)

- `setQueue(songs)` (replace): new `queueOrder` = identity, or a full shuffle of
  identity when shuffle is ON; `queueIndex = 0`. Views then call
  `setQueueIndex` to pick the starting song. IMPORTANT: on a controller or with
  nobody active, `setQueue` is a **takeover** - it claims activeness with mode
  "steal" and plays locally (Spotify-style "start playback on this device").
- `setQueueIndex(i)` - jump the cursor (a controller sends `set_queue_index`).
- `setShuffle(on)` - the ONLY reshuffle point:
  - ON: current song is moved to the front (`queueOrder = [currentIdx,
    ...shuffle(rest)]`, `queueIndex = 0`).
  - OFF: `queueOrder = identity`, `queueIndex = currentIdx` (cursor follows the
    current song back to its natural position).
  - Toggling to the same value is a no-op. Empty queue just flips the flag.
- `addToQueue(song)` - append to `queue` AND to the END of `queueOrder`.
- `playNext(song)` - append to `queue`, splice its index into `queueOrder` at
  `queueIndex + 1`.
- `reorderQueue(fromVisible, toVisible)` - operates on VISIBLE indices
  (positions in `queueOrder`); moves the entry and fixes `queueIndex`:
  - moved the current row: index follows it to `toVisible`;
  - moved from before to at/after the cursor: index -= 1;
  - moved from after to at/before the cursor: index += 1.
- `removeFromQueue(visibleIndex)` - refuses to remove the currently playing row
  (`visibleIndex === queueIndex` is a no-op; the UI disables the X on the
  active row). Removes from `queueOrder`, removes the backing `queue` entry,
  then REMAPS every order entry `> removedSongIdx` down by one, and decrements
  `queueIndex` if the removed visible row was before it.
- Jam injection (`jam_add_song` command, server-built payload only): proposal
  lands right after the current song but BEHIND any queued proposals already
  waiting (FIFO of proposals before the host's own queue resumes).

### 4.3 History / previous

There is no separate history stack. "Previous" is Spotify-style:

- If `currentTime > 3s` OR (first entry and LoopMode.None): seek to 0 (restart).
- Else `queueIndex - 1`; below 0 wraps to the last entry only under
  LoopMode.All (otherwise clamps to 0). If the wrap lands on the same entry
  (single-song queue) it restarts instead.

### 4.4 Next / ended / loop modes

`LoopMode` enum, wire values `"none" | "one" | "all"` (default **All**):

- `next()`: `queueIndex + 1`; past the end wraps to 0 under All, otherwise
  clamps at the last entry. If the computed index equals the current one
  (single-song queue under All), it restarts the element and plays (a state
  no-op would dead-end).
- `ended` event: reset the listen accumulator; under LoopMode.One seek to 0 and
  play again (repeat-one is handled here, NOT via the element's `loop`
  attribute, so `ended` keeps firing - required for the end-of-song sleep timer
  to work under repeat-one); otherwise `next()`.

### 4.5 Autoplay rules per transition cause

The song-transition effect distinguishes WHY the current song changed:

| Cause | Loads src | Autoplays |
|---|---|---|
| User-driven transition (click, next/prev, queue ops) | yes | **yes** |
| Cold-start hydration from server snapshot | yes | **no** (paused, seeked to snapshot position) |
| Playback transfer to this device (activation seed) | yes | honours the remote `paused` flag; seeks to remote position |
| Role-only effect re-run, same song id | no | no (must not restart) |
| Jam interceptor consumed the transition | no (element paused + src cleared) | no |

A registered "playback interceptor" (`setPlaybackInterceptor`) lets the jam
follower claim user-driven transitions: return true and the click becomes a jam
proposal, nothing plays locally.

Queue entries can be **patched in place** (`patchQueueSong`) with fresh stem
node ids when a separation finishes - the transition effect is keyed on
`song?.id`, not object identity, precisely so such patches never restart the
playing track. Keep that property.

---

## 5. Volume, seek, rate, sleep timer

- **Volume** `0..1`, clamped. Applied to `audio.volume` normally; when the Web
  Audio graph is connected the graph's gain chain is the single volume
  authority and the element's volume is pinned at 1 (double-attenuation bug
  otherwise). Volume is THE ONE shared device-output setting over remote sync:
  a controller's volume drag sends `set_volume` and changes the ACTIVE device's
  output; but a takeover never adopts the snapshot volume as its own.
- **Seek**: sets `el.currentTime`, wrapped in a 3-attempt retry. Scrub bars
  bind to provider `position`/`duration` state (updated at 4 Hz from
  `timeupdate`, plus immediately on `loadedmetadata`/`seeked`) and call
  `actions.seek` - never the element.
- **Playback rate**: slider range 0.5-1.5 in the cog UI (server clamps
  persisted values to 0.25-4.0), `preservesPitch = false` on the element
  (deliberate: rate change shifts pitch, like a turntable). Applied to the
  element or, when connected, through the graph (which also sets the rate on
  both stem buffer sources).
- **Sleep timer**: `number` minutes (5/10/15/30/60 in the UI) or `"endOfSong"`
  or null. Minutes: a `setTimeout` pauses and resets the timer to null.
  endOfSong: a one-shot `ended` listener pauses. Both toast. Not persisted, not
  synced.

---

## 6. Playback modes and vocal separation (OMSVS)

### 6.1 The four modes

```ts
type PlaybackMode = "original" | "instrumental" | "vocals" | "custom";
```

- `original` - the plain mix (compressed or original file).
- `instrumental` / `vocals` - the bare element plays the STEM FILE ITSELF
  (mp3). No Web Audio involved; on iOS Safari this keeps background playback
  working. If the song has no stem ids yet, it falls back to the plain mix.
- `custom` - the ONLY mode that attaches the Web Audio graph: the element keeps
  playing the plain mix but muted (as the timing reference), while both stems
  are fetched, decoded to AudioBuffers, and played via AudioBufferSourceNodes
  with independent vocal/instrumental gain sliders (`vocalVolume`,
  `instrumentalVolume`, both 0..1).

Mode switching keeps continuity: capture `currentTime` and playing state, swap
the element src to the right file (pendingSeek + resume). Switching away from
custom disables stems and, if EQ is flat, releases the graph entirely (see 7).
Dragging a blend slider while not in custom IS the gesture that switches to
custom. Turning the separation toggle off returns mode to `original`.

`custom` deliberately does NOT survive a reload (persisted parse maps it to
`original`): the graph may only attach on a user gesture.

### 6.2 Fetching stems (custom mode)

Stems are fetched through the same authenticated resolve path as the main
audio: `GET /fs_nodes/<stem_id>/data_url` on a buffer-cache miss only. The
AudioGraph keeps a small LRU (`MAX_CACHED_BUFFERS = 4`) of decoded
AudioBuffers keyed by fs node id, with in-flight Promise sharing, because every
resolve mints a different presigned URL (an AudioBuffer is ~21 MB per minute
per channel - keep any native cache bounded too). Loading state
(`stemsLoading`) keeps the original audible until both buffers are decoded; the
mute and the source start happen in the same tick (click-free swap). Failure
(`stemsFailed`) keeps the original playing, toasts, and offers a retry
(`retryStems`). A generation token (`stemsGenRef`) drops stale async results
after a song change or mode switch.

### 6.3 Separation lifecycle (OMSVS = "O Melhor Site Vocal Separator", BS-Roformer)

Status endpoint (polled through one shared TanStack query per song, 3 s
interval, so every watcher in the app dedupes into one poll):

```
GET /songs/:id/separation
=> {
  stems_ready: boolean,
  vocals_fs_node_id: string | null,
  instrumental_fs_node_id: string | null,
  progress_percent: number | null,
  job: {  // generic Job record or null
    id, job_type, payload,
    status: "pending" | "processing" | "complete" | "failed" | "canceled",
    progress: number, started_at, finished_at, result, error, ...
  } | null
}
```

Polling stops when `stems_ready`, when there is no job, or when the job status
is terminal (`complete | failed | canceled`). The provider additionally "parks"
the query when the answer is "no job and no stems" (`sepIdleSettled`) so an
idle song is not polled forever; it un-parks on song change, on toggling the
feature, and after triggering a separation.

Trigger (explicit user action only - the toggle never auto-starts):

```
POST /songs/:id/separate            body: { model_id?: string } (optional)
=> Job record
```

Delete stems:

```
DELETE /songs/:id/separation
```

Provider-level status projection (drives the cog UI):
`omsvsStatus: "idle" | "pending" | "processing" | "ready" | "failed"`,
`omsvsProgress` (percent), `omsvsError`, `omsvsStartedAt` (job `started_at`,
used to render a live elapsed m:ss counter, "more honest than a fake
percentage"). 5xx / RuntimeError message text is replaced by a generic
"separation service down" string.

When status flips to ready, the provider PATCHES the queue entry in place with
the fresh `vocals_fs_node_id`/`instrumental_fs_node_id` (and clears
`vocal_separation_started_at`), then, if mode is custom, hooks the stems up.
There is also a **stale-queue reconciliation** effect: if the element loaded
the plain mix because the queue entry had no stem ids yet (persisted/hydrated
queue, separation finished later) and mode is instrumental/vocals, it swaps to
the stem file once ids land, preserving position and play state -
`requestedNodeRef` (which node the element was last pointed at) is how it tells
"already on the right file" from "loaded the original because the entry was
stale".

The separation status query is disabled entirely for jam songs and on
controllers.

---

## 7. The AudioGraph (Web Audio) and the iOS background rule

Graph topology (`lib/vocalSeparation.ts` + `lib/audioEqualizer.ts`):

```
mainAudio -> mediaElementSource -> mainGain ─┐
vocalsBuffer -> vocalSrc -> vocalGain ───────┼-> eq.in -> eq.out -> masterGain -> destination
instBuffer   -> instSrc  -> instGain ────────┘

EQ chain: lowshelf 120 Hz -> peaking 1 kHz Q=1 -> highshelf 8 kHz, each
gain clamped to [-12, +12] dB (EQ_RANGE).
```

- Stems ON: `mainGain = 0` (element muted but still the clock),
  `masterGain = masterVolume`. Stems OFF: `mainGain = masterVolume`,
  `masterGain = 1`, sources torn down.
- Stem AudioBufferSourceNodes are one-shot: recreated on every play/seek, both
  started at the same `ctx.currentTime` with offset = `mainAudio.currentTime`
  (sample-accurate sync; three separate audio elements do NOT sync on Safari).
  The element's `play`/`pause`/`seeking` events drive source lifecycle.
- Defensive `ctx.resume()` in three places (connect while already playing,
  after enableStems, on main play) - a suspended context routes audio into
  silence.

**The iOS Safari rule that shapes everything**: once
`createMediaElementSource` runs on an element, that element can no longer play
in the background / locked screen (the AudioContext clock pauses with the
page). Therefore:

- The graph is NEVER attached at boot; only lazily on a user gesture, and only
  for features that need it: custom blend mode, or any non-flat EQ band.
- The EQ enable toggle shows a consent dialog (per session, `eqEnabled` is
  deliberately NOT persisted) before first attach.
- `createMediaElementSource` is one-shot per element, so the "off-ramp" back to
  background-capable playback is a BRAND-NEW element:
  `rebuildAudioElement(reloadSameSrc)` carries over src/position/rate/paused,
  re-wires all listeners (handlers reach state through refs so a rebuilt
  element behaves identically), and disposes the graph.
  `maybeReleaseAudioGraph` runs it when custom mode is off and all EQ bands are
  flat (leaving custom mode, resetting/disabling EQ).

**For React Native**: none of this Web Audio machinery ports directly. What you
must reproduce functionally: (a) instrumental/vocals modes are just "play a
different file", trivial; (b) custom blend needs a native dual-source
sample-synced mixer (e.g. AVAudioEngine with two player nodes on iOS) fed by
the two stem files, with per-stem gain, a 3-band EQ, and the plain file as
fallback; (c) the "attach only on gesture / background playback" constraint is
a web-only workaround - native audio engines keep background playback, so the
mode may simply persist. Keep the same wire values for `playback_mode` in the
snapshot (`original|instrumental|vocals|custom`) either way.

---

## 8. Play recording (listen analytics)

A play event is recorded once the user has actually LISTENED to
`min(30s, duration/2)` of the song, accumulated from `timeupdate` deltas with
these rules:

- Only forward deltas in `(0, 2)` seconds count (seeks and src swaps do not).
- The accumulator resets when the song id changes, and on natural `ended` (so
  a repeat play under Loop One/All counts again).
- Jam songs never record.
- On a transfer TO this device, the seeded song is marked already-recorded (the
  device it came from counted it) - no double count.

Endpoint:

```
POST /play_events        body: { song_id: <int> }
=> 201 PlayEvent  |  200 { "deduped": true }
```

The server ALSO dedupes: same user + song within 30 s
(`PlayEvent::DEDUPE_WINDOW`) answers `{ deduped: true }`. Fire-and-forget:
never surface failures to the user.

---

## 9. Media session (lock screen / hardware keys)

- Handlers registered ONCE for: `play`, `pause`, `seekto` (uses
  `details.seekTime`), `seekbackward` (-10 s), `seekforward` (+10 s),
  `previoustrack`, `nexttrack`. They read the LATEST remote-aware actions
  through a ref, so on a controller the lock screen buttons dispatch cable
  commands instead of poking the silent local element.
- Metadata: a FRESH `MediaMetadata` per song (in-place mutation is ignored by
  some Safari versions) with `title`, `artist = formatArtistsFull(song) || ""`,
  `album || ""`, artwork array from `Song.artworkUrl`. Metadata follows the
  song the user is HEARING ABOUT: snapshot song on a controller, local song
  otherwise.
- `setPositionState({ duration, position: min(currentTime, duration),
  playbackRate })` on `loadedmetadata`, `seeked`, `ratechange` (guarded for
  finite duration > 0).

RN mapping: expo-av / react-native-track-player's now-playing-info +
remote-command APIs; replicate the "route through the remote layer when
controller" behaviour.

---

## 10. Remote playback / device casting protocol

Transport: **ActionCable over a raw WebSocket** (the web client speaks the
ActionCable v1 protocol by hand in `CableService.ts` - no library).

### 10.1 Connection

```
WS  wss://backend.omelhorsite.pt/cable?token=<token>
```

(Cookie web omits a useful token; native MUST pass the bearer token in the
query string.) ActionCable framing:

- Server: `{"type":"welcome"}`, `{"type":"ping"}`,
  `{"type":"confirm_subscription","identifier":...}`,
  `{"type":"reject_subscription",...}`, `{"type":"disconnect"}`, or
  `{"identifier":"...","message":{...}}` for stream payloads.
- Client: `{"command":"subscribe","identifier":"<json string>"}` and
  `{"command":"message","identifier":"...","data":"<json string with {action, ...}>"}`.

Subscribe identifier (JSON-stringified, key order as produced):

```json
{"channel":"PlaybackChannel","device_id":"<tab_uuid>","device_label":"Chrome - macOS","predecessor":"<old_tab_uuid, optional>"}
```

- `device_id` is a fresh per-boot opaque token matching
  `/\A[A-Za-z0-9-]{8,64}\z/` (crypto.randomUUID on web). NEVER persist it
  across app launches on the web (tab duplication); on native, one per app
  launch is the equivalent. The server composes the REAL device id as
  `"<session_id>:<tab_uuid>"` - impersonating another session's device is
  impossible by construction. That composed id is what appears everywhere on
  the wire (`your_device_id`, `active_device_id`, device list ids).
- `device_label` is a free-form hint, sliced to 80 chars server-side; a second
  device of the same session gets an ordinal suffix "(2)".
- `predecessor` is the reload handoff (10.6).

Reconnect: exponential backoff 1 s doubling to max 30 s; on `welcome` the
client resubscribes everything. `perform` before `welcome` is silently dropped
(the provider relies on this - no ready guards on sends).

### 10.2 Roles (client-derived)

```
offline    - logged out, or no snapshot ever received
no_active  - connected, active_device_id == null (UI renders snapshot, paused)
active     - active_device_id == your_device_id (owns audio, publishes)
controller - someone else is active (audio element SILENT and src cleared;
             UI mirrors the snapshot; actions become commands)
```

On becoming controller the provider force-pauses and clears the element src.
`blocked` and `activating` are client sub-states of `active` (10.7), cleared on
any demotion.

### 10.3 Server -> client messages (the `message` payloads)

- `snapshot` (on subscribe and on `request_snapshot`):
  ```json
  { "type":"snapshot", "v":2,
    "state": <PlaybackSnapshot>,
    "devices":[ <PlaybackDevice>... ],
    "active_device_id": "...|null",
    "your_device_id": "...",
    "active_session_id": "...", "your_session_id": "..." }   // v1 shim fields
  ```
- `state_changed`: `{ "type":"state_changed", "state": <PlaybackSnapshot>,
  "active_device_id":..., "from_device_id":..., "from_session_id":... }`.
  **Slim variant**: `state.queue_songs` is OMITTED whenever the queue itself
  did not change - the client must keep the last full `queue_songs` list it
  received and merge. (The full song blueprints are the heavy part.)
- `position_tick`: `{ "type":"position_tick", "position": <float>, "paused":
  <bool>, "song_id": "<id>|null", "server_time": <ms epoch>,
  "from_device_id":... }` at ~1 Hz from the active device.
- `devices_changed`: `{ "type":"devices_changed", "devices":[...],
  "active_device_id":... }` - sent on subscribes/unsubscribes.
- `command`: `{ "type":"command", "command":"<name>", "args":{...},
  "target_device_id":..., "from_device_id":... }`. Broadcast to everyone; ONLY
  the device whose id equals `target_device_id` executes it.
- `claim_rejected`: `{ "type":"claim_rejected", "active_device_id":... }` -
  you lost an if_none race; adopt the winner and demote.
- `no_active_device`: a command went into the void; adopt `active = null` and
  tell the user.
- `activation_blocked`: `{ "type":"activation_blocked", "device_id":... }` -
  the named device needs a user tap to start audio (autoplay policy). Held
  until the next state change; DevicePicker shows a "needs interaction" hint.
- `error`: `{ "type":"error", "action":"...", "reason":"..." }` - the server
  rejected/clamped one of your sends. Client logs and performs
  `request_snapshot` to resync.

### 10.4 PlaybackSnapshot (the `state` object)

```ts
type PlaybackSnapshot = {
  v?: number;
  active_device_id: string | null;
  song_id: string | null;          // NOTE: string on the wire
  position: number;                // seconds
  paused: boolean;
  queue: string[];                 // song ids as strings, storage order
  queue_index: number;
  queue_order: number[];
  loop_mode: "none" | "one" | "all";
  shuffle: boolean;
  volume: number;                  // active device's output volume
  // Listener settings: travel with the ACCOUNT (adopted on takeover);
  // volume above is NOT adopted on takeover.
  playback_rate?: number;
  playback_mode?: "original" | "instrumental" | "vocals" | "custom";
  eq_low?: number; eq_mid?: number; eq_high?: number;   // dB
  eq_enabled?: boolean;
  separation_enabled?: boolean;
  vocal_volume?: number; instrumental_volume?: number;
  queue_songs: Song[];             // full blueprints; may be omitted on slim
};
```

`PlaybackDevice`: `{ id, label, name?, device_type, description?,
last_used_at?/last_seen_at, online }`. Offline entries are recently-used
sessions (7-day window) with no online device; they are display-only (transfer
requires an ONLINE device). Self is computed client-side by id - there is no
`is_self` on the wire.

### 10.5 Client -> server actions (`perform(action, data)`)

- `heartbeat` `{}` - every **20 s** while connected; registry rows expire
  after `ONLINE_TTL = 75 s` (20 s chosen because hidden-tab timers get
  throttled to ~1/min and 60 < 75).
- `request_snapshot` `{}` - fresh snapshot on demand. The web client fires it
  (plus a heartbeat) on every visibility -> visible transition (the iOS wake
  contract: timers and ticks were frozen). Do the same on native
  foregrounding.
- `claim_active` `{ mode: "if_none" | "steal" }`
  - `if_none`: race-safe compare-and-set; loser receives `claim_rejected`.
    Client stays pessimistic (doesn't adopt activeness until confirmed).
  - `steal`: unconditional, last writer wins. Client adopts activeness
    OPTIMISTICALLY (a takeover must play NOW, not after the round trip).
- `transfer` `{ target_device_id }` - point activeness at any ONLINE device
  (including yourself; self-transfer is treated as a steal). Server answers
  `error: device_offline` if the target's registry row is gone/stale.
- `command` `{ command, args }` - controller -> active device. Full payload
  capped at 8 KB. Vocabulary and server-side validation (anything else is
  rejected before broadcast):

  | command | args |
  |---|---|
  | `play`, `pause`, `toggle`, `next`, `previous` | `{}` |
  | `seek` | `{ time: number >= 0 }` |
  | `set_queue_index` | `{ index: int >= 0 }` |
  | `set_queue_order` | `{ order: int[] (each >= 0, len <= 1000) }` |
  | `set_shuffle` | `{ shuffle: bool }` |
  | `set_loop_mode` | `{ mode: "none"\|"one"\|"all" }` |
  | `set_volume` | `{ volume: 0.0..1.0 }` |
  | `add_to_queue`, `play_next` | `{ song_id: "<digits>" }` (id ONLY; the active device resolves it: queue first, then client caches, then `GET /songs/:id`) |
  | `remove_from_queue` | `{ visible_index: int >= 0 }` |
  | `reorder_queue` | `{ from: int, to: int }` |

  `jam_add_song` is server-built only (JamsController injects it); a client can
  never forge it. If no device is active the sender alone gets
  `no_active_device`.
- `state_changed` `{ payload: Partial<snapshot fields> }` - active device
  only (`error: not_active_device` otherwise). The web client publishes
  debounced (200 ms) on any change of: song, queue quartet, loop, volume,
  playing, rate, mode, EQ, separation flags, stem volumes; payload carries
  song ids AS STRINGS, `paused: !playing`, live `position`, and the listener
  settings. Server clamps everything (queue capped at `MAX_QUEUE = 1000`
  entries with a `queue_truncated` error notice, rate 0.25-4.0, EQ +-12,
  volumes 0-1, queue_index clamped into the queue, order filtered to valid
  indices) and VALIDATES song ids (your own songs, plus current jam-proposal
  allowlist when you host a jam; unknown ids are stripped and the
  queue/order/index remapped).
- `position_tick` `{ position, paused, song_id }` - active device only, 1 Hz
  while playing. Server persists position/paused to the DB at most every 5 s,
  rebroadcasts every tick with `server_time`.
- `activation_blocked` `{}` - active device only; fans out the blocked toast.

### 10.6 Presence, reaping, reload handoff

- Registry row per device, kept alive by heartbeats; `reap_stale` deletes rows
  older than 75 s whenever a device list is serialized.
- Clean unsubscribe of the ACTIVE device does NOT clear activeness
  immediately: a 15 s grace job (`Playback::ReapActiveJob`) runs, so a WS blip
  or an iOS app switch (row re-created under the same device id) is a no-op;
  only a real departure pauses playback (active pointer cleared,
  `paused: true`).
- Crashed sockets: a stale-but-present row named by the active pointer is
  lazily cleared (paused) when any client asks for a snapshot/device list.
- Reload handoff (web-specific but instructive): the dying page stashes its
  tab uuid in sessionStorage (30 s expiry); the new subscription passes it as
  `predecessor`, the server deletes the ghost row and MOVES activeness to the
  new device id with `paused: true` (the reload stopped the audio, the state
  must say so).
- Reconnect steal: if the cable dropped WHILE this device was active, audio
  kept playing locally; on the reconnect snapshot, if nobody else claimed
  meanwhile (`active == null || active == you`), the client performs
  `claim_active {mode:"steal"}`, adopts activeness, and immediately
  force-publishes full state + a tick so nobody sits on a stale paused
  snapshot.

### 10.7 Activation (transfer/claim) flow on the receiving device

When this device becomes active (role transition into `"active"`) and it was
NOT a local takeover (`setQueue` steal) or a self-initiated if_none claim:

1. Adopt the snapshot queue quartet wholesale, adopt `loop_mode`, adopt the
   listener settings (`playback_rate`, `playback_mode`, EQ bands + enabled,
   `separation_enabled`, stem volumes) - but NOT `volume`.
2. Plant an "activation seed" `{ songId, position, paused }`; the song
   transition effect consumes it (valid 5 s) to seek to the remote position
   and honour the remote paused flag instead of blind-autoplaying.
3. Mark the seeded song's listen accumulator as already recorded.
4. If the transfer was of PLAYING audio: enter `activating` (spinner state) and
   suppress state publishes until the FIRST audible `timeupdate`
   force-publishes full truth + a tick. If `play()` throws `NotAllowedError`
   in that window, flip to `blocked`, perform `activation_blocked` (every
   device shows "needs a tap on <device>"), and DO NOT publish the phantom
   `paused: true`.
5. A later successful local `play()` under the blocked overlay is the user's
   gesture: clear blocked, publish resumed truth on the next timeupdate.

Snapshot sanitisation on adoption (`sanitiseQueueState`): jam proposals are
DROPPED (their presigned URLs never survive a session) with order/index
remapped around them; the order must be a valid permutation or it falls back
to identity; the index is clamped.

### 10.8 Controller position interpolation

Controllers render `tick.position + (now - tick.receivedAt)/1000` via
requestAnimationFrame while un-paused; a tick older than `STALE_TICK_MS = 5 s`
(frozen tab, quiet active device) falls back to the frozen snapshot position.
Ticks whose `song_id` differs from the current snapshot's `song_id` are DROPPED
(prevents the previous track's position flashing across a transition).
`controllerPaused` folds in tick freshness and is fresher than the snapshot
between state broadcasts. Controller `duration` comes from
`song.duration` metadata (the controller has no element loaded).

### 10.9 What is local vs shared

Device-LOCAL, never sent as commands (greyed out in the cog on a controller):
EQ bands/enabled, playback rate, playback mode, stem volumes, sleep timer.
They DO however ride `state_changed` publishes as "listener settings" so a
device switch keeps them (adopted on takeover and cold-start hydration).
Shared/remote-controllable: play/pause/toggle/seek/next/previous, the whole
queue quartet, loop mode, shuffle, and volume (active device's output).

---

## 11. Idle-account hydration ("continue where you left off")

On cold start with role `no_active`, a non-empty server snapshot, and an empty
local queue: adopt the sanitised snapshot as the local queue, plant a
`paused: true` activation seed at the snapshot position, adopt loop mode and
listener settings. The transition effect then LOADS the src but does not play.
Pressing play with nobody active claims `if_none` and resumes locally right
away (optimistic; a `claim_rejected` demotes to controller and silences).
`playFromIdle` covers the "element was silenced while another device played"
case: with no real src, re-resolve the current song, seek to the snapshot
position, then play.

---

## 12. Persistence map

localStorage (all via a debounced-250 ms persisted-state hook, flushed on
unload; parse errors fall back to defaults):

| Key | Type / values | Default | Notes |
|---|---|---|---|
| `music-playback-rate` | float string | 1 | |
| `music-volume` | float string 0..1 | 1 | local output volume |
| `music-separation-enabled` | "true"/"false" | false | exposes the separation UI |
| `music-playback-mode` | `original\|instrumental\|vocals` | original | `custom` is NEVER restored (maps to original) |
| `music-vocal-volume` | float 0..1 | 1 | custom blend |
| `music-instrumental-volume` | float 0..1 | 1 | custom blend |
| `music-equalizer-low` / `-mid` / `-high` | float dB -12..12 | 0 | bands persist; `eqEnabled` does NOT |
| `music-loop-mode` | `none\|one\|all` | all | |
| `music-rail-width` | px | 320/280 | desktop queue rail width (UI only) |
| `token` | string | - | bearer token (native/dev); cookie web leaves unset |
| `authed` | "1" | - | logged-in hint for cookie web |

Deleted on boot (dead keys from before the server-side account queue; do not
reintroduce): `music-queue-state`, `music-queue`, `music-queue-order`,
`music-queue-index`, `music-remote-sync-enabled`.

sessionStorage: `music-prev-tab` (reload handoff stash `{uuid, t}`, 30 s TTL,
consumed on first read), `oauth_pending`, `legacy-token-purged`.

**The queue itself is NOT persisted client-side.** The server `PlaybackState`
row (written via `state_changed` publishes, position persisted at most every
5 s from ticks) IS the account queue; idle devices hydrate from the snapshot.

Website settings blob (separate mechanism): `musicPlayerDiskMode`
(`vinyl|full|cd`, the standalone MusicPlayer artwork spinner - cosmetic).

---

## 13. Artwork accent color

Per song: draw the artwork, compute the average color, then
`saturate(+20)` and `brighten(+50)` for light theme / `brighten(-50)` for dark;
both variants cached per song id (LRU cap 100) so theme flips and revisits do
not re-download bytes. Errors fall back to `#FF5555`. Exposed as
`artworkColor`; used for gradients behind the player/sheet. A process-id guard
drops stale async results after rapid song changes.

---

## 14. Misc UI contracts worth knowing

- `PlayingBars`: the "now playing" level meter - up to 4 bars, animation
  durations 0.9/1.3/1.1/1.5 s with negative delays, deliberately non-harmonic
  so they never sync; bars freeze at 1/3 height when paused.
- `QueueList` renders `queueOrder.map(i => queue[i])` (visible order) and all
  its callbacks use VISIBLE indices. Row tap: same row toggles play, other row
  `setQueueIndex(i)`. Drag-reorder calls `reorderQueue(from, to)`. Remove is
  disabled on the active row.
- `DevicePicker`: hidden while `role === "offline"`; "Play here" =
  `transferTo(yourDeviceId)`, disabled when already active; online others are
  transfer targets; offline recents are disabled rows. Trigger tint: gray when
  no active device, primary when you are active, green when remote-active.
- `NowPlayingSheet` loop button cycles None -> All -> One -> None.
- `CogDropdown` on a controller greys out rate/separation/EQ sections
  (`localSettingsDisabled`) but leaves volume and sleep timer live.
- Buffering state: `waiting`/`stalled` set it, `canplay`/`playing`/`emptied`
  clear it; controllers always expose `buffering: false`.

---

## 15. Endpoint quick reference

REST (all relative to `https://backend.omelhorsite.pt`, bearer token auth on
native):

```
GET    /fs_nodes/:id/data_url        -> { url }  (presigned MinIO GET, 6 h TTL)
GET    /fs_nodes/:id/data            -> 302 to storage (images only; not audio)
GET    /songs                        -> Song[] (list filters)
GET    /songs/:id                    -> Song
POST   /songs/:id/separate           -> Job          (body { model_id? })
GET    /songs/:id/separation         -> separation status (poll 3 s)
DELETE /songs/:id/separation         -> destroy stems
POST   /play_events                  -> PlayEvent | { deduped: true }  (body { song_id })
GET    /liked_songs/ids              -> number[]     (like state in the player UI)
POST   /liked_songs                  -> like         (body { song_id })
DELETE /liked_songs/:song_id         -> unlike
```

WebSocket:

```
wss://backend.omelhorsite.pt/cable?token=<token>
subscribe: {"channel":"PlaybackChannel","device_id":"<uuid>","device_label":"...","predecessor":"..."}
actions: heartbeat | request_snapshot | claim_active | transfer | command
       | state_changed | position_tick | activation_blocked
```

---

## 16. Re-implementation gotchas (read before writing code)

1. **Never point a player at `/fs_nodes/:id/data`** for audio - resolve
   `data_url` first and play the presigned URL. Presigned URLs differ on every
   resolve: cache by fs node id, never by URL, and treat a prefetched URL as
   one-shot with a 5 min freshness window.
2. **queueIndex indexes queueOrder, not queue.** Every queue mutation must fix
   the cursor exactly as in section 4.2, and `removeFromQueue` must remap all
   order entries above the removed backing index.
3. **`song_id` and `queue` entries are STRINGS on the cable**, numbers in REST.
   Convert consistently or the tick song-match check (10.8) silently fails.
4. **Slim `state_changed` omits `queue_songs`** - merge with the last full list
   or your controller UI empties on every pause.
5. The server VALIDATES published song ids and clamps everything; on an `error`
   message resync with `request_snapshot`, don't retry blindly.
6. Steal claims are optimistic, if_none claims are pessimistic. `setQueue` on a
   non-active device is a takeover (steal + play locally), NOT a command.
7. Repeat-one must be implemented on `ended`, not with a native loop flag, or
   end-of-song sleep timers and listen-accumulator resets break.
8. Guard every transition with a generation token AND a loading-song-id check;
   rapid skips are the main race source. Apply seeks after metadata loads.
9. Record plays from accumulated forward listening time
   (`min(30, duration/2)`), never at transition start; the server dedupes
   within 30 s anyway; never record jam songs or transferred-in songs.
10. Heartbeat every 20 s, refresh snapshot + heartbeat on app foreground; the
    server reaps at 75 s and the active-device grace is 15 s.
11. Queue entries get patched in place when separation finishes - key your
    "should I reload the source" logic on song id + wanted node id
    (`requestedNodeRef` equivalent), not on object identity.
12. Jam proposals (`jam_song: true`) carry presigned `audio_url`s that die with
    the session: drop them when adopting any snapshot, never persist them,
    never record plays for them, and never try to resolve their fs nodes.
