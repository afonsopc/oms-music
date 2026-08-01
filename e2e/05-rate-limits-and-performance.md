# 05 - Rate limits, retry discipline, performance

One device plus an HTTP proxy that counts requests (Charles, Proxyman or mitmproxy) with
the proxy CA trusted by the dev build.

## Poll cadences (WORKPLAN WP12.5)

Measure over 60 seconds with the relevant screen open:

- [ ] Separation status: about 20 requests per minute per polled song (3 s), and ZERO once
      the projection reaches "no job, no stems" or a terminal state.
- [ ] URL / file / Spotify import progress: about 40 per minute (1.5 s) while running,
      zero after a terminal state (including the deduped terminal case).
- [ ] Lyrics sync job: JobChannel first, with the 10 s poll only as a fallback; a 404 while
      waiting keeps waiting instead of failing.
- [ ] Spotify sync status: 1.5 s only while a run is active.
- [ ] Cable heartbeat: one per 20 s while subscribed, plus one request_snapshot and one
      heartbeat per foreground.
- [ ] Active publisher: at most ~5 publishes per second while dragging a slider
      (200 ms debounce) and 1 tick per second otherwise.

## Caps and refusals

- [ ] Lyrics translation of an already-translated line never refetches (staleTime
      Infinity); a 429 shows the limit inline and NEVER auto-retries.
- [ ] Lyrics sync respects the 10 per hour cap: the button disables with a spinner and the
      11th attempt shows the server message.
- [ ] A 429 anywhere parks queries for the retry_after window instead of hammering.
- [ ] A 401 triggers exactly ONE `/sessions/mine` probe (single flight), then either
      resumes or logs out; the proxy shows no retry storm.
- [ ] URL import errors (Spotify refusal, SSRF refusal, 502 text, 60/h) all render their
      specific message.

## Performance

- [ ] Home mount: count the requests. Expect one per visible rail plus the liked ids set,
      and no artwork request for off-screen rows.
- [ ] Library with 500 artists: mounting does not fire 500 artwork requests (windowing).
- [ ] Now Playing open for 2 minutes: the position label updates at most 4 times per second
      and the rest of the screen does not re-render with it (React DevTools profiler or a
      render counter in dev).
- [ ] Lyrics synced view: active-line state changes only when the index changes, not per
      frame; leaving the screen stops the frame loop.
- [ ] Accent cache: switching between two songs back and forth extracts colors once per
      song (LRU 100, both theme variants).
- [ ] Scrolling a 500-row song table stays smooth (windowed 40 rows + incremental).
