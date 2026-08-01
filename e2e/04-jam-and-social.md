# 04 - Jams, friends, profile

Two devices on DIFFERENT accounts that are accepted friends. Host = H, member = M.

## Jam lifecycle (FR-113..118)

- [ ] H starts a jam from the player; H becomes the active playback device.
- [ ] M sees the jam as joinable (from the invite notification or `GET /jams` refresh) and
      joins; the JamBar REPLACES M's MiniPlayer pill.
- [ ] M hears H's audio within about 2.5 s of H's position; a hard seek on H pulls M back
      into sync rather than drifting.
- [ ] H pauses: M pauses. H resumes: M resumes from the extrapolated position.
- [ ] M's volume control affects M only.
- [ ] With queue_mode "everyone", M pressing play on a song in M's library PROPOSES it:
      nothing plays on M, and the song lands in H's queue right after the current song
      (FIFO with the proposer's attribution visible on the row).
- [ ] Skip votes follow the jam's skip_mode; a passed vote advances H and the tally resets
      silently on the track change.
- [ ] Rules PATCH from the host (queue_mode, skip_mode) reaches M immediately.
- [ ] M starting local playback (not a proposal) auto-leaves the jam after the ~1.5 s grace
      and the pill returns.
- [ ] H ending the jam clears M's jam state and the JamBar disappears.
- [ ] Jam guards: a jam-injected song NEVER appears in downloads, never records a
      play_event, never offers "Separate vocals" and is never persisted in the queue
      snapshot after a relaunch.

## Friends and profile (FR-119/120)

- [ ] With H playing, M's Home strip shows H within about 1 second, live rows first.
- [ ] A friend with share_listening off shows presence without the song.
- [ ] The Friends page (4th pager page of the player) shows the same rows.
- [ ] Opening a friend's music profile shows now playing, top artists, top songs, recent
      and 30-day plays.
- [ ] A private profile (`visible: false`) renders the private state and is
      indistinguishable from an empty one.
- [ ] Backgrounding and returning re-subscribes the friends channel (rows refresh, no
      duplicate rows).
