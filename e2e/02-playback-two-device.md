# 02 - Playback and the two-device matrix

Two dev builds signed into the SAME account (one iOS, one Android). Call them A and B.
This is the DESIGN 17 definition of done for every playback-touching package.

## Single device (A)

- [ ] Play a song from a playlist: the queue is the whole list at the tapped index.
- [ ] Background the app and lock the screen: audio continues past 10 minutes, artwork,
      title, artist and album show on the lock screen.
- [ ] Lock-screen play / pause / scrub work and the in-app UI agrees when reopened.
- [ ] Lock-screen next/previous are ABSENT (expected in v1, see docs/LOCKSCREEN-PATCH.md).
- [ ] Loop cycle None -> All -> One; repeat-one restarts the same song every cycle.
- [ ] Shuffle on/off never changes the audible song.
- [ ] Previous within 3 s of the start goes to the previous song, later it restarts.
- [ ] Rate 0.5 to 1.5 changes speed WITH pitch shift (no pitch correction, FR-64).
- [ ] Sleep timer stops playback at the chosen mark.
- [ ] Volume slider affects local audio only.
- [ ] Rapid-skip soak: press next every ~300 ms for 5 minutes. No stale track ever plays,
      no double audio, no crash, memory stable.
- [ ] Scrubbing does NOT create play_events; 30 s of real listening does (verify on the
      profile plays or with the proxy in checklist 05).
- [ ] A song whose presigned URL has expired recovers in place; a genuinely broken song
      shows the throttled "unavailable" notice at most once every 3 s and skips.
- [ ] Mode switch Original -> Instrumental -> Vocals keeps the position and play state;
      a song without stems falls back to the plain mix with the cog note.

## Roles and transfer (A + B)

- [ ] With A playing, B shows the emerald "Playing on A" strip and mirrors position within
      about 1 second.
- [ ] B's transport buttons drive A; A remains the only audible device at all times.
- [ ] B's cast sheet lists A (online) and offline recents (disabled); "Play here" moves
      audio to B mid-song, resuming within the same second of audio.
- [ ] Right after a transfer, B publishes nothing until its first audible status (no
      snapshot flap on A).
- [ ] If the target device refuses to start audio, the sheet shows the "needs a tap" hint.
- [ ] Toggle airplane mode on A for 5 seconds: local audio never pauses, A re-establishes
      activeness after reconnect (reconnect steal) and B follows.
- [ ] Lock-screen play/pause on B while it is a controller drives A (transport decorator).
- [ ] Kill B: A keeps playing and the device disappears from the picker within a heartbeat
      or two.

## Queue (FR-72/73)

- [ ] The queue screen renders VISIBLE order (shuffled order when shuffle is on).
- [ ] Tapping the current row toggles play/pause; another row jumps to it.
- [ ] Remove is disabled on the active row; removing any other row never changes the
      audible song.
- [ ] Long-press drag reorder: the audible song stays the same and the new order is what
      plays next.
