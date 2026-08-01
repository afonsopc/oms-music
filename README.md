# oms-music

The omelhorsite music app for iOS and Android: a native rebuild of the `/music` area of
omelhorsite.pt against the SAME production backend (`https://backend.omelhorsite.pt`).
Zero backend changes: every endpoint, param shape and quirk this app talks to already ships
today, and the web client keeps working untouched.

What it does: your library (songs, playlists, artists, albums, liked), search including
external sources and imports, a full player (queue, lyrics with translation and sync,
playback modes with vocal separation), offline downloads, listening together (jams,
friends listening, music profiles), remote playback across your own devices, and the
settings/import surfaces (files, URL, Spotify sync, artist import).

Stack: Expo SDK 57 (RN 0.86, React 19, New Architecture), expo-router, expo-audio,
expo-sqlite, expo-file-system, TanStack Query, zustand, hand-rolled ActionCable client.
TypeScript strict. Package manager: bun.

---

## Setup

```bash
bun install
```

A **development build is required**. Expo Go cannot host this app: background audio,
lock-screen controls, SecureStore, SQLite and the `omsmusic://` scheme all need native
code.

```bash
bunx expo run:ios        # builds and installs the dev client on a simulator or device
bunx expo run:android    # same for an emulator or a connected device
```

Both commands prebuild the native projects on first run. After that, `bun start` is enough
for day-to-day work (the dev client picks up the Metro bundle).

Point the app at a local backend by editing `API_BASE_URL` in `src/api/client.ts`
(the dev backend is `http://localhost:1143`). Note that Chrome/loopback flows do not work
across ports in this environment, so authenticated dev testing happens on the device
build.

### Checks

```bash
bun x tsc --noEmit   # TypeScript, strict, must be clean
bun run lint         # eslint (expo config)
bun test             # 300+ unit and property tests, no device needed
bun scripts/smoke.ts # optional: live API smoke, needs OMS_EMAIL / OMS_PASSWORD
```

`bun test` also runs the repo gates in `src/boot/__tests__/gates.test.ts`: no em-dash
character anywhere, and every subsystem `register.ts` reachable from `boot/wireup.ts`. The
i18n catalogs are gated separately for key-tree equality across en/pt/lv.

Device checklists (the parts no unit test can cover) live in `e2e/`, including a scripted
deep-link pass: `bun e2e/deeplinks.ts ios`.

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
```

Subsystems never import each other directly. They meet at the seams in `src/contracts`
(local files, offline fallback, transport, playback interceptor, song menu), each with an
inert default, and every real implementation is installed by `src/boot/wireup.ts` at boot.
In development the boot logs one `[boot] ok ...` line per seam, so a missing registration
is visible immediately.

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
| `LOCKSCREEN-PATCH.md` | the native change needed for lock-screen next/previous |

---

## Deferred in v1 (DESIGN.md section 16)

Everything in SPEC.md ships except these, each with its follow-up path:

1. **Custom blend (FR-69)**: expo-audio cannot sample-sync two players, so the blend
   sliders are hidden and an adopted `custom` mode plays the plain mix; the wire values are
   stored and republished untouched. Follow-up: a native stem-mixer module behind
   `player/sources.ts`.
2. **3-band EQ (FR-70)**: no EQ path in expo-audio; the panel is hidden, the bands persist
   and round-trip. Same native module follow-up.
3. **Passkeys (FR-13)**: blocked on associated domains for omelhorsite.pt; the contract
   stub with the verbatim-payload rule stays in `auth/oauth.ts`.
4. **Google OAuth (FR-12)**: GitHub and Spotify ship through the WebView interception
   flow; Google refuses embedded WebViews, so its button is hidden until the web callback
   page bounces back into the app.
5. **Verified https deep links (FR-20)**: `omsmusic://` on both platforms plus an
   unverified Android intent filter; iOS needs an AASA file that does not exist yet. The
   parser already handles full web URLs.
6. **Storage cap (FR-94)**: not enforced, and no cap UI is shown, per SPEC.
7. **Downloads across process termination**: persisted savables plus boot re-attach and
   verify-and-repair heal the next launch instead.
8. **Lock-screen next/previous**: the vendored expo-audio never enables those remote
   commands and surfaces no JS remote-command events. `player/lockScreen.ts#routeRemoteCommand`
   is wired and inert; `docs/LOCKSCREEN-PATCH.md` documents the exact native diff and the
   two ways to deliver it.

---

## Release

`app.json` carries the identity (`pt.omelhorsite.music`, `omsmusic://` scheme, icons and
splash generated from the site's music logo, the Android https intent filter). Bump
`version` plus `ios.buildNumber` and `android.versionCode` per store submission. Store
metadata is written in PT-PT and EN.
