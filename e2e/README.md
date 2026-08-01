# e2e - device checklists (WP12)

There is no automated UI runner in v1. Everything that can be tested without a device is a
bun test (`bun test`, 300+ cases: queueOps property tests, slim-merge, LRC, sentinel and
bracket encoding, rankByMatch, deep links, offline library, ICU, key trees). What is left
needs real hardware, so it lives here as scripted checklists that one operator can run
top to bottom on a dev build.

Prerequisites for every pass:

```bash
bun install
bunx expo run:ios      # or: bunx expo run:android
```

Expo Go cannot host this app (expo-audio background modes, secure store, SQLite, the
custom scheme), so a dev build is mandatory.

| File | Covers | Devices |
| --- | --- | --- |
| `01-boot-and-shell.md` | boot seams, 28 screens, MiniPlayer padding, artwork, i18n | 1 |
| `02-playback-two-device.md` | DESIGN 17 matrix, transfer, reconnect, rapid-skip soak | 2 |
| `03-downloads-offline.md` | downloads, repair, airplane mode, WiFi gate | 1 |
| `04-jam-and-social.md` | jam host + follower, proposals, votes, friends strip | 2 |
| `05-rate-limits-and-performance.md` | poll cadences, retry storms, mount cost | 1 + proxy |
| `deeplinks.ts` | the whole FR-20 matrix, scripted | 1 |

Record each run by copying the checklist into the release notes with the boxes ticked and
the build number, per WORKPLAN WP12 acceptance ("both device matrices recorded green").
