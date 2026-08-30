# Stack brief (researched 2026-08-01, versions verified against npm)

Target: Expo SDK 57 (expo@57.0.9, RN 0.86.2, React 19.2, New Architecture + Hermes default). Install SDK packages with `bunx expo install <pkg>`. Development build (prebuild/dev client) required; Expo Go is NOT sufficient (passkeys, mmkv, background audio).

## Player decision
- react-native-track-player v4: FROZEN, build breakage on recent SDKs (Kotlin onBind, issue #2472). Do not use.
- @rntp/player v5: rewrite, excellent, but commercially licensed (free non-commercial only; EUR 99/month commercial). Keep only as escape hatch.
- CHOSEN: expo-audio@57.0.3 with plugin config `["expo-audio", { "enableBackgroundPlayback": true }]`.
  - Lock screen / notification Now Playing with artwork on BOTH platforms via `player.setActiveForLockScreen(active, metadata)`.
  - Android gotcha: MUST call setActiveForLockScreen or background audio stops after ~3 minutes.
  - `AudioPlaylist` class + `useAudioPlaylist` hook: gapless, add/insert/remove/skipTo/next/previous.
  - `AudioSource.headers` supports auth headers on remote URLs.
  - Shuffle/repeat NOT built in: implement by ordering the playlist in JS.
  - No caching/casting built in. Control Center AirPlay works anyway (AVPlayer-backed).

## Downloads
- expo-file-system@57.0.1 task API: `File.createDownloadTask()` with onProgress, pause()/resumeAsync(), savable()/DownloadTask.fromSavable() persistence, AbortSignal, custom headers. iOS `sessionType: 'background'` continues while suspended (not across termination).
- If downloads must survive process death: @kesha-antonov/react-native-background-downloader@4.5.9 (maintained fork). Optional, add only if needed.
- Practice: JS queue (N concurrent) over createDownloadTask, persist savables in SQLite, resume on relaunch.

## Storage
- expo-sqlite@57.0.1 for library/downloads metadata (+ drizzle-orm optional, has useLiveQuery). Built-in kv facade `expo-sqlite/kv-store`.
- expo-secure-store@57.0.1 for tokens.
- react-native-mmkv@4.3.2 optional fast KV.

## Realtime (Rails ActionCable)
- @rails/actioncable works in RN but needs `global.addEventListener = () => {}` and `global.removeEventListener = () => {}` stubs (rails/rails#35674).
- Alternative zero-polyfill: @kesha-antonov/react-native-action-cable@2.0.0.
- RN WebSocket accepts custom headers (browsers cannot): auth token can go in a header on the cable connection.

## Auth
- Passkeys: react-native-passkeys@0.4.1 (Expo module; iOS ASAuthorization 15+, Android Credential Manager). Requires: ios.associatedDomains `webcredentials:omelhorsite.pt` + AASA file; Android assetlinks.json with SHA-256 fingerprint and `delegate_permission/common.get_login_creds`.
- Audio/download auth: AudioSource.headers and file-system headers both work; short-lived signed URLs are the most player-agnostic option if backend already supports them.

## Data/state
- @tanstack/react-query@5.101.4 (wire onlineManager to @react-native-community/netinfo@12.0.1, focusManager to AppState).
- zustand@5.0.14.
- expo-router@57.0.9 (v7 feature line, native tabs available).

## Recommended install list
Core: expo-audio, expo-file-system, expo-sqlite, expo-secure-store, @tanstack/react-query, zustand, @react-native-community/netinfo, @kesha-antonov/react-native-action-cable, react-native-passkeys (only if the web login uses passkeys).
Optional: react-native-mmkv, @kesha-antonov/react-native-background-downloader, drizzle-orm.

## API client
- @omelhorsite/sdk@0.5.1: o cliente HTTP oficial da API (o site usa o mesmo). `new Oms({ tokens })` no nativo, `new Oms({ sessionCookie: true })` na origem cookie; `fetch` injectável, `Paginated<T>` + `collect()`, `file()`/`NativeFile` para multipart (o descritor `{ uri, name, type }` do RN vai verbatim). Sem `ReadableStream` em RN: nunca `downloadStream`.
- Por cima do SDK, nesta app: `api/oms.ts` (construção memoizada, `toFileInput`), `api/omsProxy.ts` (OmsApiError/OmsTimeoutError -> `ApiError`, aviso ao guard nos 401 e nos 404 de /media), `auth/guard.ts` (sondagem single-flight a /sessions/mine), `api/mediaUrl.ts` (URLs de media com token). Ver DESIGN.md secção 5.
