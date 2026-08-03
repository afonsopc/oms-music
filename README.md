# oms-music

The omelhorsite music app for iOS and Android.

This is a full native rebuild of the `/music` area of omelhorsite.pt, running against the
SAME production backend (`https://backend.omelhorsite.pt`) with **zero backend changes**.
Every endpoint, parameter shape and quirk this app talks to already ships today, and the
web client keeps working untouched. It is not a wrapper, a WebView or a PWA: the screens,
the player, the queue, the download manager and the realtime layer are all reimplemented in
TypeScript on React Native.

Scope is the 126 functional requirements in `docs/SPEC.md`: your library (songs, playlists,
artists, albums, liked), search including external sources and imports, the full player
(queue, lyrics with translation and sync, playback modes with vocal separation), offline
downloads, listening together (jams, friends listening, music profiles), remote playback
across your own devices, and the settings and import surfaces (files, URL, Spotify sync,
artist import). 28 screens, three languages (en, pt in European Portuguese, lv).

---

## Stack, and why

| Piece | Choice |
| --- | --- |
| Runtime | Expo SDK 57 (`expo@~57.0.9`), React Native 0.86.2, React 19.2, New Architecture + Hermes |
| Routing | expo-router v7, typed routes on |
| Audio | **expo-audio** with `enableBackgroundPlayback` |
| Storage | expo-sqlite (library, downloads, offline metadata), expo-secure-store (tokens) |
| Files | expo-file-system task API (`createDownloadTask`, savables, background sessions on iOS) |
| Data | TanStack Query v5 + zustand |
| Realtime | a hand-rolled ActionCable client (`src/cable`) against the Rails cable |
| Native glue | `modules/oms-native`, a local Expo module (see "native gaps" below) |
| Language | TypeScript strict. Package manager: bun. |

**Why expo-audio and not react-native-track-player.** RNTP is the obvious default for a
music app, and both of its lines were rejected on purpose (`docs/STACK.md`):

- **react-native-track-player v4** is frozen and does not build cleanly against recent SDK
  and Kotlin versions (the `onBind` breakage, upstream issue #2472). Adopting it means
  owning a fork on day one.
- **`@rntp/player` v5**, the maintained rewrite, is genuinely excellent, and it is
  **commercially licensed**: free for non-commercial use only, EUR 99/month for a
  commercial app. This ships to the App Store and Play Store under omelhorsite, so a
  recurring runtime license for the audio layer was not something to sign up for. It stays
  documented as the escape hatch behind the engine interface if expo-audio ever runs out of
  road.
- **expo-audio** is MIT, ships and versions with the SDK, and covers what this app needs:
  lock-screen and notification Now Playing with artwork on both platforms
  (`setActiveForLockScreen`), an `AudioPlaylist` for gapless transitions, and
  `AudioSource.headers` so authenticated stream URLs work without a signed-URL detour.

What that choice costs, and how the repo pays for it: shuffle and repeat are not built in,
so the queue is ordered in JS (`src/player/queueOps.ts`); there is no EQ and no
sample-accurate two-player sync (see "Deferred"); and expo-audio surfaces no remote-command
events to JS at all, which is why lock-screen next/previous needed a local native module.

---

## Running it

### Toolchain prerequisites

Verified on macOS 27 with Xcode 26.6 on 2026-08-01, and every one of these was a real
blocker until installed:

- **iOS platform SDK.** Xcode ships without it. `xcodebuild -downloadPlatform iOS`, or
  Xcode > Settings > Components. Without it `xcodebuild` reports zero eligible destinations
  even when simulators exist.
- **Android SDK.** `brew install --cask android-commandlinetools`, then
  `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, `sdkmanager --licenses`
  and `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`. Gradle
  fetches the NDK and CMake itself on first build.
- **JDK 21, not newer.** `brew install openjdk@21` and build with
  `JAVA_HOME=/opt/homebrew/opt/openjdk@21`. On JDK 26 the Android Gradle Plugin dies in
  `JdkImageTransform` (`jlink` fails on `core-for-system-modules.jar`), which reads as an
  unrelated dependency-resolution error.

### Build

```bash
bun install
bunx expo prebuild        # generates ios/ and android/ (both gitignored)
bunx expo run:ios         # builds and installs on a simulator or device
bunx expo run:android     # emulator or a connected device
```

`run:ios` / `run:android` prebuild on first use, so the explicit `prebuild` is only needed
when you want to regenerate the native projects (after changing `app.json`, a config plugin
or `modules/oms-native`). Once a dev build is installed, `bun start` is enough for
day-to-day work; the dev client picks up the Metro bundle.

**Expo Go cannot host this app.** Expo Go is a fixed prebuilt binary, and this app needs
native code that is not in it: expo-audio's background audio mode and lock-screen session,
the local `oms-native` module, SecureStore's keychain entitlement, SQLite, the `omsmusic://`
scheme, the Android https intent filters, and the backup-rules config plugin. A development
build (or an EAS `development` / `development-device` profile from `eas.json`) is mandatory.

Backend selection is an env var, not a code edit:

```bash
EXPO_PUBLIC_API_URL=http://localhost:1143 bun start
```

It defaults to `https://backend.omelhorsite.pt` (`src/api/client.ts`). Chrome blocks
loopback requests across ports on the dev machine, so authenticated flows are exercised on
the device build rather than in a browser.

### Checks

```bash
bun x tsc --noEmit    # TypeScript, strict, must be clean
bun run lint          # eslint (expo config)
bun test              # 360+ unit and property tests, no device needed
bun scripts/smoke.ts  # optional: live API smoke, needs OMS_EMAIL / OMS_PASSWORD
bun e2e/deeplinks.ts ios   # scripted deep-link matrix against a running dev build
```

`bun test` also runs the repo gates in `src/boot/__tests__/gates.test.ts`: no em-dash
character anywhere, and every subsystem `register.ts` reachable from `boot/wireup.ts`. The
i18n catalogs are gated separately for key-tree equality across en/pt/lv.

Everything that needs real hardware lives in `e2e/` as operator checklists: boot and shell,
the two-device playback matrix, downloads and offline, jam and social, rate limits.

---

## How the app is put together

```
src/
  app/          expo-router tree; every route file is a one-line wrapper
  features/     screen bodies, one folder per domain
  ui/           shared visual kit (artwork, rows, hero, sheets, dialogs)
  api/          HTTP client, typed endpoints, react-query hooks, query keys
  domain/       frozen types and pure helpers (ids, format, artwork, rank)
  contracts/    registration seams with inert defaults (see below)
  player/       the engine: queue ops, transitions, sources, recovery, lock screen
  downloads/    download manager, offline library, repair
  cable/ remote/ jam/ social/   realtime: presence, remote playback, jams, friends
  lyrics/ separation/           LRC parsing, translation, stem separation service
  auth/ db/ i18n/ theme/ lib/   session, SQLite, catalogs, tokens, pure helpers
  boot/         wireup.ts: the single composition root, imported by app/_layout.tsx
modules/
  oms-native/   local Expo module: lock-screen next/previous, backup exclusion
```

Subsystems never import each other directly. They meet at the seams in `src/contracts`
(local files, offline fallback, transport, playback interceptor, song menu, separation),
each with an inert default, and every real implementation is installed by
`src/boot/wireup.ts` at boot. In development the boot logs one `[boot] ok ...` line per
seam, so a missing registration is visible immediately.

---

## docs/

The specification the implementation was built against. Read in this order:

| Doc | What it is |
| --- | --- |
| `SPEC.md` | the 126 functional requirements with acceptance criteria |
| `DESIGN.md` | the authoritative architecture: layout, types, contracts, frozen decisions |
| `WORKPLAN.md` | the twelve work packages, ownership and acceptance |
| `API.md` | the backend wire contract (the general half) |
| `api-music.md`, `api-social-jams.md`, `backend-models.md` | endpoint and model detail |
| `auth-account.md` | sessions, OAuth, passkeys, account fields |
| `playback-core.md`, `design-playback.md` | player behavior, ported from the web |
| `screens-content.md`, `design-product.md` | screen-by-screen behavior |
| `downloads-offline.md` | download and offline rules |
| `lyrics-settings-misc.md` | lyrics, settings, imports |
| `shell-nav-theme.md` | navigation, theming, i18n |
| `design-shipping.md` | the shipping proposal that fed DESIGN.md |
| `STACK.md` | dependency research and the player decision |
| `LOCKSCREEN-PATCH.md` | the expo-audio native diff for lock-screen track commands |

`store/listing.md` holds the App Store and Play listing copy (EN and PT-PT).

---

## Deferred in v1

Everything in `SPEC.md` ships except the items in `DESIGN.md` section 16. Current status:

1. **Custom blend (FR-69).** SHIPPED on 2026-08-03. `modules/oms-native` mixes the two stems:
   two `AVAudioPlayerNode`s scheduled at the same sample time on iOS, two `MediaCodec`
   decoders feeding one `AudioTrack` on Android, so the stems share a clock rather than
   promising to. The muted expo-audio player stays loaded as the clock and lock-screen owner,
   exactly as the web keeps a muted `<audio>` element. Both stems must be on disk first, same
   as the web. The old behavior (plain mix, wire values untouched) survives as the fallback
   when no mixer is in the build, the stems are not resident yet, or the mixer reports a
   failure.
2. **3-band EQ (FR-70).** SHIPPED on 2026-08-03, inside that mixer, with per-band bypass so a
   flat EQ costs nothing.
3. **Passkeys (FR-13).** SHIPPED on 2026-08-03 against the WebAuthn the backend already had.
   Still needs configuration outside this repo before it works in production: publish the two
   `.well-known` files (written into the website repo), confirm the Apple Developer Program
   membership, and choose the Android signing key. `docs/PASSKEYS.md` has the steps.
4. **Google OAuth (FR-12).** GitHub and Spotify ship through the WebView interception flow;
   Google refuses embedded WebViews, so its button is hidden. Follow-up is a web-side
   callback bounce into `omsmusic://oauth`; the `/sessions/adopt` plumbing already ships.
5. **Verified https deep links (FR-20).** `omsmusic://` on both platforms plus an unverified
   Android intent filter (disambiguation dialog). iOS cannot claim https links without an
   AASA file. The parser already handles full web URLs.
6. **Storage cap (FR-94).** Not enforced, and no cap UI is shown, per SPEC.
7. **Downloads across process termination.** iOS background sessions survive suspension, not
   a kill; Android downloads pause with the process. Persisted savables plus boot re-attach
   and verify-and-repair heal the next launch instead.
8. **Lock-screen next/previous (FR-63).** Closed on iOS, still open on Android. See below.

---

## Native gaps that remain

- **Android lock-screen next/previous.** expo-audio's `AudioMediaSessionCallback` strips
  `COMMAND_SEEK_TO_NEXT` / `COMMAND_SEEK_TO_PREVIOUS` from the only MediaSession the app
  has, so they cannot be added additively the way they can on iOS. On iOS,
  `modules/oms-native` registers its own targets on the process-wide
  `MPRemoteCommandCenter` (which expo-audio never touches) and forwards them to
  `player/lockScreen.ts#routeRemoteCommand`; on Android that module is a documented no-op.
  `docs/LOCKSCREEN-PATCH.md` has the exact diff inside expo-audio that would close the
  Android side and the two ways to deliver it. Nothing in `node_modules/` is patched today.
- **Stem blend drift is unmeasured.** The mixer cannot drift internally (one clock per
  platform by construction), but the scrub bar reads the muted reference player while the
  ears hear the mixer, and the two are only realigned on transport events. A ten-minute
  listen on real hardware is the check that has not been done.
- **The `.well-known` files are written but not published.** They live in the website repo at
  `frontend/public/.well-known/`, and a real build proved the static export keeps them.
  Until the site is deployed, passkeys (FR-13) and verified universal links (FR-20) stay
  blocked. `assetlinks.json` deliberately carries an EMPTY fingerprint list: the Android
  debug key is public, so listing it with `get_login_creds` would hand this domain's passkeys
  to any app wearing the same package name.
- **No download service that survives process death.** The fallback is named and unused:
  `@kesha-antonov/react-native-background-downloader` behind `downloads/tasks.ts`, to be
  added only if field data shows real losses.
- **No Google Cast.** AirPlay works for free because expo-audio is AVPlayer-backed on iOS;
  there is no Cast SDK on Android. Remote playback between the user's own devices is this
  app's own ActionCable protocol, not a casting stack.
- **No CarPlay, Android Auto, widgets or Watch app.** Not attempted in v1; each needs its
  own native target on top of the generated projects.

---

## Identity and release

`app.json` carries the identity: `pt.omelhorsite.music` on both stores, the `omsmusic://`
scheme, the Android https intent filters, and the art.

The art in `assets/images/` is generated from the site's own music mark,
`frontend/assets/musicLogo.svg` in the omelhorsite repo: the gold bell on the `#660090`
purple that is baked into the mark itself. (That is the logo's own purple, not a theme
token; the in-app music section accent is a separate `#4B1E6D`, see
`docs/shell-nav-theme.md`.)

| File | Use |
| --- | --- |
| `icon.png` | 1024x1024 opaque; the light and default iOS icon, the store icon, Android legacy and web |
| `icon-dark.png` | iOS 18 dark appearance, transparent plate |
| `icon-tinted.png` | iOS 18 tinted appearance, opaque greyscale on black |
| `android-icon-foreground.png` | adaptive foreground, scaled so no pixel leaves the 66% mask circle |
| `android-icon-background.png` | flat `#660090` plate |
| `android-icon-monochrome.png` | themed-icon layer; the mark's dark stroke is knocked out so the bands and the clapper still read once the launcher tints it |
| `splash-icon.png` | splash mark, transparent; `expo-splash-screen` paints the `#660090` plate |
| `favicon.png` | web export |

The SVG is the source of truth: regenerate the PNGs from it rather than editing them by
hand. `rsvg-convert` is not needed; `qlmanage -t -s 2048 -o . musicLogo.svg` rasterises it
faithfully on macOS, and because Quick Look always flattens onto an opaque plate, the
transparent variants come from rendering the mark twice, once over white and once over
black, and recovering alpha as `a = 1 - (white - black)`.

Bump `version` plus `ios.buildNumber` and `android.versionCode` per store submission.
`ios/` and `android/` are generated and gitignored, so a release always starts from a clean
`bunx expo prebuild`.
