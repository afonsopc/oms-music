# Downloads and Offline Listening

Spec for rebuilding the omelhorsite music downloads / offline feature as a native React Native (Expo) app for iOS and Android, talking to the existing production backend at `https://backend.omelhorsite.pt` with zero backend changes.

Sources read (all paths relative to repo root `/Users/afonsocoutinho/Documents/omelhorsite`):

- `frontend/components/music/DownloadStatusContext.tsx` (shared UI contract)
- `frontend/components/music/SongRow.tsx`, `frontend/components/music/MediaCollectionView.tsx` (UI touch points)
- `frontend/components/MusicPlayer/index.tsx`, `frontend/components/MusicPlayer/CogDropdown.tsx` (web download buttons)
- `frontend/services/MusicService.ts`, `frontend/services/StorageService.ts`, `frontend/services/BackendService.ts`
- `frontend/lib/offline-image-resolver.ts`, `frontend/lib/offline-lyrics-resolver.ts`, `frontend/lib/offline-library-resolver.ts`
- `apps/music-ios/lib/downloads.ts`, `db.ts`, `download-settings.ts`, `DownloadStatusProvider.tsx`, `offline-playlists.ts`, `DownloadsPage.tsx`, `network.ts`, `native-audio-shim.ts`, `native-plugins.ts`, `install-offline-library.ts`, `useSongActionsMobile.tsx`
- `apps/music-ios/ios/App/App/plugins/BackgroundDownloader/BackgroundDownloader.swift` and `.m`
- `apps/music-ios/README.md`, `apps/music-ios/scripts/add-native-plugins.rb`
- `backend/app/controllers/fs_nodes_controller.rb`, `backend/app/services/audio_compressor.rb` (endpoint and format ground truth)

---

## 1. The big picture

There are two very different worlds in this repo:

1. **The web app (production, omelhorsite.pt)** has NO offline mode. There is no service worker, no Cache Storage, no IndexedDB audio cache. "Download" on the web means "save the audio file to disk via a plain `<a download>` link". The shared UI components are written so that offline features light up only when a provider fills in `DownloadStatusContext`; on the web the context keeps its inert default and all download UI (badges, bulk-download button, offline toggle, only-downloaded filter) simply disappears.

2. **The abandoned-but-working Capacitor iOS attempt (`apps/music-ios/`)** implements the full offline story: per-song and per-collection downloads, background transfers via a custom Swift `URLSession backgroundConfiguration` plugin, an IndexedDB metadata database, offline artwork/lyrics/library resolvers, WiFi-only gating, auto-repair on reconnect, and a quality auto-upgrade scheme (compressed copy always + lossless original when distinct). This is the design you should port to React Native.

Everything the offline feature needs from the backend already exists. The backend does not know the concept of "download"; it just serves files by fs node id. All offline state lives on the device.

---

## 2. What can be downloaded

Per song, the Capacitor attempt downloads up to five binary files plus two JSON records:

| Item | Source field on `Song` | Kind tag | Required? |
|---|---|---|---|
| Mixed audio, compressed (AAC/M4A) | `compressed_audio_fs_node_id`, falling back to `audio_fs_node_id` | `mixed` | Yes; the guaranteed-playable copy |
| Mixed audio, original master (FLAC/WAV/ALAC/whatever was uploaded) | `audio_fs_node_id`, only when different from the compressed id | `mixed_original` | Auto-fetched for quality upgrade |
| Artwork (compressed preferred) | `compressed_artwork_fs_node_id`, falling back to `artwork_fs_node_id` | `artwork` | Fetched when present |
| Vocal stem | `vocals_fs_node_id` | `vocal` | Only when `includeStems` setting is on (default ON) and the stem exists |
| Instrumental stem | `instrumental_fs_node_id` | `instrumental` | Same condition as vocal |
| Song metadata (full `Song` JSON) | from the songs API | stored in IDB `songs` store | Yes, stored up-front before audio lands |
| Lyrics JSON | `GET /lyrics?song_id=` | stored on the IDB song record | Fetched best-effort, failures swallowed |

Collections: "playlists" (numeric id) and "albums" (composite key `album:<artist_slug>:<album_name>`) can be marked as offline collections. That is purely a client-side set of ids persisted in device preferences; enabling it downloads every song in the collection and future refetches auto-download newly added songs.

Not downloadable: jam proposal songs (`jam_song: true`). They carry ephemeral presigned `audio_url` / `artwork_url` fields instead of fs node ids and are never persisted.

---

## 3. Backend endpoints (copy-pasteable)

Base URL: `https://backend.omelhorsite.pt`

### 3.1 Auth model

- Native clients authenticate with a bearer token. The Capacitor app reads it from `localStorage.getItem("token")` (persisted at login by `persistSessionToken`) and sends it two ways at once:
  - `Authorization: Bearer <token>` header on download requests, and
  - `?token=<token>` query param, because `FsNode.dataUrl()` is built by `getAuthenticatedBackendUrl(route)` in `frontend/services/BackendService.ts`, which appends the token as a query parameter when one exists in storage.
- The production web build uses an httpOnly SameSite cookie instead and has NO token in localStorage. Your RN app must obtain and persist the raw token like the Capacitor build does (the backend accepts Bearer header or `token` query param; the header is read first).

### 3.2 File bytes

`GET /fs_nodes/:id/data` (optionally `?token=<bearer token>`)

- Defined in `backend/app/controllers/fs_nodes_controller.rb#data`.
- Responds `302 redirect` to a presigned object-storage URL (`https://minio.omelhorsite.pt/omelhorsite-production/...` with S3 `X-Amz-*` query signature). If Active Storage cannot build a URL it falls back to streaming the bytes inline with `Content-Disposition: attachment`.
- Auth resolves the node from the caller's session; an anonymous caller gets 404, not 401.
- This is the URL the Capacitor DownloadManager hands to the native downloader; iOS `URLSession` follows the redirect transparently.

`GET /fs_nodes/:id/data_url`

- Returns `{"url": "<presigned storage URL>"}` as JSON.
- The presigned URL is valid for **6 hours** (`MEDIA_URL_EXPIRY = 6.hours`).
- Exists because browser media elements cannot authenticate across the `/data` redirect (CORS: after the hop the browser sends `Origin: null`, storage answers `Allow-Origin: *`, which is illegal with credentials). The web MusicProvider uses this two-step for playback. For a native HTTP client either endpoint works; `/data` with the token is what the old download pipeline used.

### 3.3 Metadata

- `GET /songs` and `GET /songs/:id` return `Song` objects (see `frontend/services/MusicService.ts` for the full type). The fields that matter for downloads:
  - `id: number`, `title`, `album`, `duration` (seconds), `artists: SongArtistEntry[]` (role enum `"primary" | "featured" | "with"`)
  - `audio_fs_node_id: string` (uuid), `compressed_audio_fs_node_id?: string`
  - `artwork_fs_node_id?: string`, `compressed_artwork_fs_node_id?: string`
  - `vocals_fs_node_id?: string | null`, `instrumental_fs_node_id?: string | null`
  - `audio_codec`, `audio_bitrate_kbps`, `audio_sample_rate_hz`, `audio_channels`, `audio_lossless: boolean`, `audio_filesize_bytes` (useful for pre-flight size estimates)
  - `jam_song?: boolean`, `audio_url?`, `artwork_url?` (ephemeral presigned; do not download)
- `GET /playlists`, `GET /playlists/:id`, `GET /playlist_songs` (filterable; each row embeds `song`) for collection contents.
- `GET /liked_songs` (cursor param `before`), `GET /liked_songs/ids` for the liked collection.
- `GET /lyrics?song_id=<id>` returns `{"synced": string | null, "plain": string | null, "attribution": string}`. `synced` is LRC-style timestamped text.

### 3.4 File formats

- **Compressed audio**: produced server-side by `AudioCompressor`: ffmpeg `-c:a aac -b:a 192k -vn -movflags +faststart`, container `m4a`, `content_type: audio/mp4`, metadata stripped. This decodes everywhere (iOS AVAudioFile, Android, ExoPlayer, browsers).
- **Original audio**: whatever the user uploaded or yt-dlp produced (`audio_codec` on the Song tells you: flac, wav, alac, opus, mp3...). iOS may refuse some containers, hence the fallback ladder (section 6.4).
- **Stems**: produced by the vocal separation pipeline; audio files served the same way by fs node id.
- **Artwork**: image files (typically jpeg/png, compressed variant around or under 100 KB).
- The Capacitor attempt stores every file under the extension-less name `<songId>_<kind>.bin`; players are fed `file://` URLs and sniff the container, so the extension never mattered. You may prefer real extensions in RN (see gotchas).

---

## 4. The shared UI contract: `DownloadStatusContext`

`frontend/components/music/DownloadStatusContext.tsx` is the seam between shared music UI and platform download engines. Reimplement this contract in RN and all the porting decisions in the shared components carry over.

```ts
export type SongDownloadStatus = "idle" | "queued" | "downloading" | "done" | "error";

export type DownloadStatusContextValue = {
  getStatus: (songId: number | string) => SongDownloadStatus;   // sync, cheap
  getProgress: (songId: number | string) => number;              // 0..1
  downloadMany?: (songs: Song[]) => Promise<void> | void;        // undefined => hide bulk UI (web)
  subscribe: (listener: () => void) => () => void;               // one coarse "something changed" channel
  isOfflineCollection?: (id: string | number) => boolean;
  toggleOfflineCollection?: (id: string | number, on: boolean, songs: Song[]) => Promise<void>;
  showOnlyDownloaded?: boolean;                                  // global filter flag
};
```

Design notes baked into the file:

- `getStatus`/`getProgress` are pure synchronous reads so a list row does not pay for a subscription per row.
- `useDownloadStatusVersion()` subscribes once per consumer and fires on ANY status change; rows re-render coarsely but cheaply.
- The default context value returns `"idle"`, progress 0, and leaves all optional members undefined; that is exactly what the web ships.

Consumers in the shared frontend:

- `SongRow.tsx` renders a badge next to the title: check icon when `done`, pulsing download icon plus `Math.round(progress * 100)%` while `downloading`/`queued`, error-colored icon on `error`, nothing when `idle`.
- `MediaCollectionView.tsx` (playlist/album/liked screens):
  - a single ActionBar button that prefers `toggleOfflineCollection` (persistent keep-synced semantics) and falls back to one-shot `downloadMany`; a code comment records the product decision that sync-toggle is the only sensible behavior and one-shot bulk download was retired,
  - applies `showOnlyDownloaded` by filtering the song array to `getStatus(id) === "done"` before rendering (and disables manual reorder while filtered).
- `useSongActionsMobile.tsx` (mobile-only wrapper around the shared song context menu) appends a `Download` item (disabled and relabelled `Downloading... N%` while in flight) or a `Remove download` item when already downloaded.

Web-only download affordances (unrelated to offline): `MusicPlayer/index.tsx` and `CogDropdown.tsx` render a plain `<Link href={audio.src} download target="_blank">` button when `showDownload` is set (used by the storage `NodeViewer`, not the music page); the music page cog exposes the same save-to-disk link.

---

## 5. How the web/PWA stores audio: it does not

To be explicit, because a naive reimplementation might look for one:

- No service worker is registered anywhere in `frontend/` (the only `caches.` hits are vendored browser games under `public/`).
- Playback always streams: `MusicProvider` resolves `FsNode.resolveDataUrl(compressed_audio_fs_node_id || audio_fs_node_id)` per track (with a prefetch cache for the next queue item, TTL-guarded) and assigns the presigned URL to an `HTMLAudioElement`.
- Institutional memory (MEMORY.md) records the earlier investigation: a PWA gives no audio improvement on iOS, which is why the native app path exists at all.

So the RN app is not migrating any web cache format; it owns offline storage entirely.

---

## 6. The Capacitor attempt in detail (the design to port)

### 6.1 Component map

```
DownloadStatusProvider (React context adapter)
        |
   DownloadManager (singleton, lib/downloads.ts)  <-- state machine + orchestration
        |               |                |
  BackgroundDownloader  IndexedDB "oms-music"   registries (Maps)
  (Swift URLSession     stores: downloads,      - downloadIndex: audio url -> file:// url
   plugin)              songs, cache, meta      - imageRegistry: artwork url -> webview-servable url
                                                - artworkFileRegistry: artwork url -> file:// url
                                                - audioOriginalRegistry: compressed url -> file:// original
```

Plus three pluggable resolver seams that live in the shared frontend so web pays zero cost:

- `offline-image-resolver.ts`: `<Image>` consults `resolveOfflineImage(url)`; mobile registers a resolver backed by `imageRegistry`; `notifyOfflineImageResolverChanged()` re-renders all images when new artwork lands.
- `offline-lyrics-resolver.ts`: lyrics query hook falls back to `resolveOfflineLyrics(songId)` which reads the IDB song record.
- `offline-library-resolver.ts`: `withOfflineFallback(primary, fallback)` wraps the React Query fetchers; `install-offline-library.ts` registers `listAlbums`/`listArtists`/`listSongs` resolvers that derive albums (grouped by album + primary-artist slug, the same compound key the backend uses) and artists from the downloaded songs in IDB. It also holds a global `isOfflineNow()` flag so the code skips doomed network round trips when already known offline.

### 6.2 Status model

Fine-grained internal status (per `<songId>::<kind>` key):

```ts
type DownloadStatus =
  | { state: "idle" }
  | { state: "queued"; taskId: number }
  | { state: "downloading"; taskId: number; progress: number }  // progress 0..1
  | { state: "done"; localUrl: string; bytes: number }
  | { state: "error"; error: string };
```

The UI only ever reads the `mixed` kind: a song is "downloaded" iff its `mixed` entry is `done`. Other kinds (artwork, stems, original) ride along invisibly.

Persistent record (IDB `downloads` store, key `"<songId>::<kind>"`):

```ts
type StoredDownload = {
  songId: string;
  filename: string;      // "<songId>_<kind>.bin"
  url: string;           // backend URL the download was created from (the dedup/lookup key)
  localPath: string;     // raw filesystem path
  localFileUrl: string;  // Swift URL.absoluteString, properly percent-encoded
  siblingUrl?: string;   // only on mixed_original: the compressed backend URL it upgrades
  sizeBytes: number;     // always 0 in practice, see gotchas
  kind: "mixed" | "mixed_original" | "vocal" | "instrumental" | "artwork";
  downloadedAt: number;
};
```

IDB `songs` store (key `songId`): `{ songId, song: Song, storedAt, lyrics?: Lyrics | null }` where `lyrics === null` means "fetched, backend has none, do not retry" and `lyrics === undefined` means "never fetched, retry on next reconnect".

### 6.3 Download flow (`DownloadManager.download(song, opts?)`)

1. Refuse when not on native. Ensure state is restored from IDB (also re-registers all local file mappings and attaches plugin event listeners).
2. **WiFi gate**: if `wifiOnly` setting is on and the network status is connected-but-not-wifi, throw (`"Sem WiFi - download adiado."`). Deliberately does NOT queue for later: a background URLSession with `isDiscretionary = false` would still run on cellular, so refusing the enqueue is the only real gate. If the probe fails, allow the download.
3. Persist song metadata to IDB `songs` immediately so the Downloads page can render title/artist/artwork before any bytes arrive.
4. Fire-and-forget lyrics fetch (`Lyrics.forSong`), stored onto the song record; errors swallowed.
5. Enqueue `mixed` = `FsNode.dataUrl(compressed_audio_fs_node_id || audio_fs_node_id)` with auth headers.
6. If `audio_fs_node_id` exists and differs from the compressed id, enqueue `mixed_original` from the original node, passing `siblingUrl` = the compressed backend URL (so the upgrade map can be keyed by the URL the player actually emits).
7. Enqueue `artwork` (compressed-first policy, matching playback).
8. If `includeStems` (per-call option or setting; setting defaults ON): enqueue `vocal` and `instrumental` when the fs node ids exist.

`enqueueOne` dedups: it no-ops when the current status for that `(songId, kind)` is already `done` or `downloading`. Every file goes through `BackgroundDownloader.enqueue({ url, songId, headers, mode: "background", filename: "<songId>_<kind>.bin" })`, which returns `{ taskId }`; the manager records the task in a `taskIndex` and sets status `downloading` with progress 0.

Progress/completion/error arrive as plugin events keyed by `taskId`:

- `downloadProgress { taskId, songId, progress (0..1), bytesWritten, bytesTotal }` -> update status.
- `downloadComplete { taskId, songId, filename, path, url }` (`url` = percent-encoded `file://` URL) -> write `StoredDownload` to IDB, register the local mapping (see 6.4), set status `done`.
- `downloadError { taskId, songId, error, cancelled? }` -> `cancelled` resets to `idle`, otherwise `error`.

Removal (`remove(songId)`): for every stored kind of the song, `BackgroundDownloader.deleteFile({ filename })`, delete the IDB row, drop the status and the registry entries, then delete the IDB song record.

Storage accounting: `BackgroundDownloader.storageUsage()` walks the download directory natively and returns `{ bytes, files }`.

### 6.4 Playback integration (auto-upgrade ladder)

`native-audio-shim.ts` replaces `window.Audio`; on `src = backendUrl` it builds a candidate list:

1. `audioOriginalRegistry.get(backendUrl)` - local `file://` of the lossless original (keyed by the COMPRESSED backend URL, because that is what MusicProvider emits),
2. `downloadIndex.get(backendUrl)` - local `file://` of the compressed copy,
3. the backend URL itself (network).

It tries each in order; the first one the native engine (`AVAudioFile`) accepts wins. This is how FLAC/WAV masters get used when the OS can decode them and silently fall back when not. Stems loading applies `resolveLocalIfDownloaded` per stem URL the same way.

Artwork gets two registrations per download: a webview-servable URL (`Capacitor.convertFileSrc(localPath)`) for in-app `<Image>` and the raw `file://` URL for the native lock-screen artwork loader. In RN you will likely need only one local URI.

### 6.5 Repair, retry, and collection sync

`DownloadStatusProvider` wires connectivity handling:

- On every network reconnect (Capacitor `Network.networkStatusChange` with `connected: true`): `retryFailures()` (re-issues `download()` for every song with an errored kind) and `verifyAndRepair()`.
- `verifyAndRepair()` also runs once at boot when already online. It iterates every IDB song and re-enqueues whatever is missing: mixed, mixed_original, artwork, stems (if the setting is on), and lyrics (only when `lyrics === undefined`). Dedup in `enqueueOne` makes it idempotent. This is what rounds out libraries downloaded before newer piece types shipped.

Offline collections (`offline-playlists.ts`):

- Persisted as a JSON string-array of collection ids under Capacitor Preferences key `music-ios.offline-playlists` (NSUserDefaults; survives JS-bundle reinstalls, not app deletion).
- `setPlaylistOffline(id, on, songs)`: on-enable adds the id and sequentially awaits `download()` for each song (dedup makes re-toggling resume missing songs); on-disable removes the id and calls `remove()` per song.
- `useOfflineCollectionSync(collectionId, songs)`: whenever a collection screen refetches and the collection is marked offline, auto-download any song not yet downloaded. This is the "sync follows updates" behavior.

Settings (`download-settings.ts`, Preferences key `music-ios.download-settings`):

```ts
type DownloadSettings = {
  wifiOnly: boolean;          // default false
  includeStems: boolean;      // default true (stems enable offline vocal separation; ~2x storage)
  maxStorageBytes: number;    // default 0 = unlimited; NOTE: defined but not enforced anywhere yet
  showOnlyDownloaded: boolean; // default false; feeds the context flag
};
```

### 6.6 The native side: BackgroundDownloader Swift plugin

`apps/music-ios/ios/App/App/plugins/BackgroundDownloader/BackgroundDownloader.swift`:

- Two `URLSession`s: a background one (`URLSessionConfiguration.background(withIdentifier: "pt.omelhorsite.music.bg-downloader")`, `isDiscretionary = false`, `sessionSendsLaunchEvents = true`, `allowsCellularAccess = true`) and a plain foreground `.default` one. `enqueue`'s `mode` param picks the session; the JS side always passes `"background"` today, but the plugin was built for both foreground and background downloads (the plan recorded in memory: "both fg+bg downloads").
- API surface (from the `.m` registration): `enqueue`, `cancel(taskId)`, `list()` (pending tasks with `state` in `running|suspended|canceling|completed|unknown`), `deleteFile(filename)`, `resolveLocalUrl(filename)` -> `{ path, url }` or nulls, `storageUsage()`.
- Files land in `Application Support/music-downloads/<filename>`; the delegate moves the temp file there on completion, overwriting any previous file, then emits `downloadComplete` with both `path` and `absoluteString` URL.
- Progress comes from `didWriteData` (fraction of `totalBytesExpectedToWrite`, 0 when the server sends no length).
- `didCompleteWithError` distinguishes user cancellation (`NSURLErrorCancelled`) via the `cancelled` flag.
- `urlSessionDidFinishEvents` calls the app delegate's stored `backgroundCompletionHandler` so iOS releases the background runtime, and `load()` touches the lazy background session at plugin init so downloads that finished while the app was dead are picked up on next launch.
- Caveat of the old design: `taskIndex` (taskId -> songId/kind/filename) lives in memory on BOTH the Swift and JS sides. A download completing after a full app restart reaches the Swift delegate but finds no record, so the event is dropped; the JS `verifyAndRepair` pass on next launch is what actually heals this. In RN, prefer a persisted task map (e.g. `expo-background-task` / `react-native-background-downloader` style APIs with re-attachment).
- `add-native-plugins.rb` is only Xcode project plumbing (idempotently registers the plugin sources with the App target); nothing to port, it just tells you the plugins are plain local sources, not pods.

### 6.7 Downloads screen

`DownloadsPage.tsx` renders: a header with count, `storageUsage()` bytes, and an offline pill (from `useOnlineStatus`, Capacitor Network with a `navigator.onLine` web fallback); an "A transferir" section listing in-flight `mixed` tasks with percentages; and the downloaded list (artwork via the offline-aware `Image`, tap to set the whole downloaded list as the play queue, trash button calls `DownloadManager.remove`). Empty state instructs: song menu -> Download, or the playlist Download button for bulk. UI copy is European Portuguese.

---

## 7. Porting checklist for RN/Expo

1. Persist the bearer token at login (the backend also returns it for cookie-web; native must store it, e.g. SecureStore).
2. Fetch `Song` objects; enqueue file downloads against `https://backend.omelhorsite.pt/fs_nodes/<id>/data?token=<token>` (redirect-following HTTP), or resolve `.../data_url` first and download the presigned URL within its 6-hour window.
3. Reproduce the `(songId, kind)` keyed state machine, the IDB stores (SQLite/MMKV/expo-file-system metadata JSON are all fine substitutes), and the three registries.
4. Implement the context contract from section 4 over your store; mount it above the music screens; the shared component behaviors (badges, sync toggle, only-downloaded filter, song menu items) are the product spec.
5. Reimplement wifiOnly gate at enqueue time, retry-on-reconnect, verify-and-repair on reconnect and boot, offline collection set + auto-sync on refetch.
6. Keep the compressed-first + original-upgrade ladder in the player (on Android, ExoPlayer decodes FLAC natively, so the ladder mostly matters on iOS).
7. Store lyrics with the tri-state null/undefined semantics so "no lyrics exists" is not re-fetched forever.

---

## 8. Gotchas (things that bit or will bite)

- `GET /fs_nodes/:id/data` 302-redirects to MinIO. Browser-context media/fetch cannot authenticate across that hop; native HTTP stacks can. If your download library mishandles redirects or forwards the `Authorization` header to the presigned S3 URL (some S3 implementations reject requests carrying both header auth and query signature), use the `/data_url` two-step instead.
- Presigned storage URLs expire after 6 hours. Never persist a resolved URL; persist fs node ids and re-resolve. A paused-for-a-day background download of a presigned URL will 403 on resume.
- Anonymous or wrong-user requests to `/fs_nodes/:id/data` return **404**, not 401. A silent token loss looks like "file vanished".
- `sizeBytes` in the stored record is always 0: the Swift completion event carries no byte count and nothing backfills it. The storage counter comes from a native directory walk. Either fix the event payload in your port or keep the directory-walk approach.
- The wifiOnly setting is enforced only at enqueue time (background sessions ignore it once running); `maxStorageBytes` exists in settings but is enforced nowhere. If you promise a cap, implement it.
- The old attempt names every file `<songId>_<kind>.bin`. Some Android players/media scanners care about extensions; also exclude the download directory from cloud backup (iOS: `isExcludedFromBackup`; Android: `no_backup`).
- Type drift in the old code: `db.ts`'s `kind` union and `downloadKey` lack `"mixed_original"` even though `downloads.ts` uses it; the runtime works (keys are plain strings) but do not copy the types blindly.
- Progress events fire per chunk for every parallel task; the provider fans out one coarse notification to all subscribers. Throttle re-renders (the web contract's single-version-counter approach is the cheap known-good design).
- Song ids are numbers in the API but ALWAYS strings in download keys/records (`String(song.id)` everywhere). Pick one representation at your storage boundary or you will get `1 !== "1"` cache misses.
- Jam songs (`jam_song: true`) have no fs node ids, only short-lived presigned URLs; exclude them from download UI.
