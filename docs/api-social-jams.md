# Social music and jams (shared listening sessions) - API and realtime spec

Audience: an engineer building a React Native (Expo) client against the EXISTING
production backend at `https://backend.omelhorsite.pt`, with zero backend changes.
Everything below was read from the actual code:

- Frontend: `frontend/services/SocialMusicService.ts`, `frontend/services/CableService.ts`,
  `frontend/components/music/JamProvider.tsx`, `JamBar.tsx`, `JamDialog.tsx`, `JamPanel.tsx`,
  `FriendActivityPanel.tsx`, `FriendListeningProvider.tsx`, `FriendsListeningStrip.tsx`,
  `frontend/components/profile/ProfileMusicSection.tsx`, `frontend/lib/queries/social-music.ts`
- Backend: `backend/app/controllers/jams_controller.rb`, `backend/app/controllers/users_controller.rb`,
  `backend/app/channels/jam_channel.rb`, `friend_listening_channel.rb`, `playback_channel.rb`,
  `notifications_channel.rb`, `application_cable/connection.rb`,
  `backend/app/services/jams/{serializer,proposal_allowlist}.rb`,
  `backend/app/services/listening.rb`, `listening/snapshot.rb`,
  `backend/app/services/music_profiles/builder.rb`, `backend/app/services/media_urls.rb`,
  `backend/app/models/jam.rb`, `playback_device.rb`

## 1. Big picture

Three social surfaces sit on top of the personal music player:

1. **Friends listening feed** - realtime "what are my friends playing" presence,
   delivered over ActionCable channel `FriendListeningChannel`.
2. **Jams** - shared listening sessions. One HOST plays music with their normal
   player; the server fans the host's playback state and 1 Hz position ticks out
   to every member over `JamChannel`. Members do NOT get a queue of their own;
   they follow along by streaming the host's audio via presigned URLs. Members
   can propose songs (from their own library) into the host's queue and vote to
   skip. Control-plane operations (create/join/leave/rules/propose/skip-vote)
   are plain REST under `/jams`.
3. **Music profiles** - the music card on a public profile (now playing, top
   artists, top songs, recent, 30-day play count), REST endpoint
   `GET /users/:id/music_profile`, gated by friendship + a privacy flag.

The HOST side of a jam additionally depends on `PlaybackChannel` (the general
remote-playback/device channel): the server injects proposals and skip commands
into the host's active device through it, and the host's own `state_changed` and
`position_tick` publishes are what the server relays to the jam. A member client
never touches `PlaybackChannel` for jam purposes.

There is a fourth, minor surface: jam invites arrive as ordinary notifications
(`kind: "jam_invite"`) over the notifications system.

## 2. Transport, auth, response conventions

### REST

- Base URL: `https://backend.omelhorsite.pt` (no `/api` prefix; routes are
  top-level, e.g. `GET https://backend.omelhorsite.pt/jams`).
- Auth: bearer token. The web app stores the session token and sends it as
  `Authorization: Bearer <token>` (native Capacitor builds do exactly this;
  same-site web uses an httpOnly cookie instead, which is irrelevant for RN).
  For media/img GETs built as raw URLs the token can also ride as a `?token=`
  query param.
- Responses are the RAW JSON shapes shown below. There is no `{data: ...}`
  envelope: the Rails helpers (`ok!`, `created!`, `not_found!` etc., defined in
  `concerns/response_helpers.rb`) render the given JSON directly with the named
  status. Error bodies are usually a bare JSON string, e.g. a 404 from
  `/jams/999/join` has body `"Jam not found"`.
- Statuses used by this feature: 200, 201 (jam create), 400 (`bad_request!`),
  401 (`unauthorized!`, also unauthenticated), 404 (`not_found!`).
- All endpoints in this document except `GET /users/:id/picture` REQUIRE
  authentication (401 otherwise). `music_profile` is authenticated too: it is
  not in `UsersController`'s `allow_unauthenticated_access` list.

### ActionCable (WebSocket)

- URL: `wss://backend.omelhorsite.pt/cable?token=<session token>`.
  `ApplicationCable::Connection` accepts the token from the `?token=` query
  param, the `Authorization` header, or the session cookie
  (`Session.token_from_request`). The web client uses the query param; do the
  same in RN.
- The web frontend does NOT use `@rails/actioncable`; it speaks the raw
  ActionCable v1 JSON protocol over a native WebSocket (`CableService.ts`).
  Either approach works. Protocol recap:
  - Server sends: `{"type":"welcome"}`, `{"type":"ping","message":<epoch>}`,
    `{"type":"confirm_subscription","identifier":...}`,
    `{"type":"reject_subscription","identifier":...}`, `{"type":"disconnect"}`,
    and stream payloads as `{"identifier":"<json string>","message":{...}}`.
  - Client sends: `{"command":"subscribe"|"unsubscribe"|"message","identifier":"<json string>","data":"<json string>"}`.
  - `identifier` is a JSON-ENCODED STRING, e.g.
    `"{\"channel\":\"JamChannel\",\"id\":42}"`. Key order matters for matching
    replies to your own subscription map (the server echoes your exact string).
  - Client actions ride `command: "message"` with
    `data: JSON.stringify({action: "<name>", ...args})`.
- Anonymous cable connections are ALLOWED at the connection level; identity
  checks happen per channel (`reject` on nil user). A rejected subscription
  yields `reject_subscription`, not a socket close.
- The web client resubscribes everything after `welcome` on reconnect, with
  exponential backoff 1s doubling to a 30s cap. Reproduce that.

## 3. Data shapes (exact field names)

These are the TypeScript types from `SocialMusicService.ts`; they match the Ruby
serializers one to one.

```ts
// A song as shown to someone who does NOT own it (friends feed, profiles).
// Built by Listening::Snapshot.song_hash.
type ListeningSong = {
  id: string;              // Song id (stringly numeric)
  title: string;
  album: string | null;
  duration: number;        // seconds
  owner_id: string;        // user id of the song owner
  artist_names: string;    // comma-joined display string
  artwork_url: string | null; // PRESIGNED URL (see section 9)
};

// Jam playback adds the audio stream.
type JamSong = ListeningSong & { audio_url: string | null }; // presigned

type FriendListening = {
  user: { id: string; handle: string; name: string };
  song: ListeningSong | null;  // null when nothing played or sharing off
  paused: boolean;
  online: boolean;             // any playback device seen in last 75s
  jam_id: number | null;       // active jam this user is a member of
  updated_at: string | null;   // ISO timestamp of the playback state row
};

type JamMemberInfo = {
  id: string;        // user id
  handle: string;
  name: string;
  is_host: boolean;
  joined_at: string; // ISO
};

type JamQueueMode = "everyone" | "host";          // who may propose songs
type JamSkipMode  = "majority" | "host" | "anyone"; // how a skip passes

type Jam = {
  id: number;                 // numeric, unlike user/song ids
  host_id: string;
  queue_mode: JamQueueMode;   // default "everyone"
  skip_mode: JamSkipMode;     // default "majority"
  created_at: string;
  ended_at: string | null;    // null while active
  members: JamMemberInfo[];   // ordered by join time
};

type JamUpcomingEntry = {
  id: string;
  title: string;
  duration: number;
  artist_names: string;
  artwork_url: string | null;
  // null when the host owns the song; set when it is a member's proposal
  proposer: { id: string; handle: string; name: string } | null;
};

// The slice of the host's playback state a member follows.
type JamState = {
  song: JamSong | null;
  position: number;            // seconds into the song
  paused: boolean;
  upcoming?: JamUpcomingEntry[]; // next up in the host queue, max 10
  server_time: number;         // epoch millis at serialization time
};

type JamsIndex = { current: Jam | null; joinable: Jam[] };

type MusicProfileArtist = {
  id: number;
  name: string;
  slug: string;
  picture: string | null;         // Deezer-sourced sizes
  picture_medium: string | null;
  picture_big: string | null;
  picture_xl: string | null;
  external_image_url: string | null;
  image_url: string | null;       // presigned user-uploaded image, preferred
  play_count: number;
};

type MusicProfile = {
  visible: boolean;               // false => nothing else is present
  now_playing?: FriendListening;  // same shape as a feed row
  top_artists?: MusicProfileArtist[];             // max 8, 30-day window
  top_songs?: (ListeningSong & { play_count: number })[];      // max 10
  recent?: (ListeningSong & { last_played_at: string })[];     // max 10
  plays_30d?: number;
};
```

Artist image pick order used by the web client
(`musicProfileArtistImage`): `image_url` then `picture_big` then `picture_xl`
then `picture_medium` then `picture` then `external_image_url`.

## 4. REST endpoints

### 4.1 Jams

All under `/jams`, all authenticated. Routes (from `config/routes.rb`):
`resources :jams, only: [:index, :create, :update, :destroy]` plus member POSTs
`join`, `leave`, `invite`, `propose`, `skip_vote`.

#### GET /jams
Returns `JamsIndex`: the caller's active jam (if any) plus jams they may join.
`joinable` = active jams containing at least one ACCEPTED FRIEND of the caller,
excluding the caller's current jam. That condition is exactly the join
authorization, so the list never shows a jam that would then refuse the join.
The web client polls this only when opening the jam dialog (staleTime 10s) and
once on app load to rediscover an in-progress jam after a refresh.

```json
{ "current": null, "joinable": [ { "id": 42, "host_id": "u_abc", "queue_mode": "everyone", "skip_mode": "majority", "created_at": "...", "ended_at": null, "members": [ { "id": "u_abc", "handle": "afonso", "name": "Afonso", "is_host": true, "joined_at": "..." } ] } ] }
```

#### POST /jams
No body. Creates a jam hosted by the caller and adds the caller as first member.
Side effects: silently leaves (or ends, if hosting) any jam the caller was in;
broadcasts a `listening_update` for the caller (their feed row gains `jam_id`).
Response: 201, body = `Jam`.

After creating, the web HOST client immediately claims the active playback
device (`claim_active` with `mode: "steal"` on `PlaybackChannel`) because every
jam relay rides the host's playback publishes; a host with no active device is
a silent jam and proposals/skips 400 with "The host is not playing right now".
An RN host must do the same.

#### POST /jams/:id/join
No body. Authorization: caller must be an accepted friend of at least one
current member (not necessarily the host). Already-a-member is a no-op success.
Side effects: leaves the caller's previous jam first (ending it if they hosted),
broadcasts `members_changed` on the jam stream and a `listening_update` for the
caller. Response: 200, body = `Jam`.
Errors: 404 `"Jam not found"` (also for ended jams), 401
`"Only friends of a jam member can join"`.

#### POST /jams/:id/leave
No body. Caller must be a member (else 404). If the caller is the HOST this ENDS
the jam for everyone (there is NO host handoff, see section 6). Otherwise the
membership row is deleted, `members_changed` is broadcast, and the caller's feed
row updates. Response: 200, empty (null) body.

#### DELETE /jams/:id
Host only (401 `"Only the host can end a jam"`). Ends the jam: sets `ended_at`,
broadcasts `{"type":"ended"}` on the jam stream, and re-broadcasts every
member's friends-feed row so their jam badges drop. Response: 200 null body.
(The web UI's "End jam" button actually calls `leave`, which has the same
effect for a host; `DELETE` exists and works.)

#### PATCH /jams/:id
Host only (401 `"Only the host can change the rules"`). Body: any subset of
`{ "queue_mode": "everyone"|"host", "skip_mode": "majority"|"host"|"anyone" }`.
Invalid values: 400 with the validation message. Broadcasts
`{"type":"jam_updated","jam":Jam}` on the jam stream. Response: 200, body =
updated `Jam`.

#### POST /jams/:id/invite
Body: `{ "user_id": "<target user id>" }`. Caller must be a member; target must
be an accepted friend of the CALLER (400 `"You can only invite your friends"`),
and not already in the jam (400 `"Already in the jam"`). Creates a notification
for the target: `kind: "jam_invite"`, context
`{ jam_id, host_id, host_handle, inviter_id, inviter_handle }`. Delivered
realtime over the per-user `NotificationsChannel` like any notification. There
is NO accept-by-notification API: the invitee just opens the music area, where
the jam shows up in `GET /jams` `joinable` (invites do not extend join
authorization; the friend-of-a-member rule already covers the inviter).
Response: 200 null body.

#### POST /jams/:id/propose
Body: `{ "song_id": <number> }`. A member offers ONE OF THEIR OWN songs as an
upcoming pick.
Preconditions, in order:
- caller is a member (404),
- `queue_mode == "everyone"` OR caller is the host (400
  `"The host picks the music in this jam"`),
- the song exists AND belongs to the CALLER (404 `"Song not found"`; you cannot
  propose the host's or a third user's song),
- the host has an active playback device (400
  `"The host is not playing right now"`).

What happens: the song id is recorded in the jam's proposal allowlist
(Rails cache, key `jam:proposals:<jam_id>`, TTL 24h, last 500 ids), then a
server-built `jam_add_song` command is broadcast on the HOST's
`playback:user:<host_id>` stream carrying a fully presigned song payload
(`Jams::Serializer.proposal_song_hash`: song fields + `artists` array +
`artist_names` + presigned `artwork_url` + `audio_url` + `jam_song: true` +
`jam_proposer: {id, handle, name}`). The host's ACTIVE device appends it to its
queue right after the current song, behind any earlier pending proposals (FIFO),
then republishes state, which relays to the jam. Simultaneously
`{"type":"song_proposed","song":{id,title,artist_names},"proposer":{id,handle,name}}`
is broadcast on the jam stream (the web client shows a toast).
Response: 200 null body.

Note `jam_add_song` is deliberately NOT in `PlaybackChannel`'s client command
vocabulary: only the server can inject it, so clients cannot forge proposals.

#### POST /jams/:id/skip_vote
No body. Vote to skip the current song.
- `skip_mode == "host"`: non-host callers get 400
  `"Only the host can skip in this jam"`. (The web UI hides the button; the
  host just presses next in their own player.)
- Host has no active device or no current song: 400 `"Nothing is playing"`.
- Votes are a user-id set in Rails cache under `jam:skip:<jam_id>:<song_id>`,
  expiry 15 minutes. Keyed per song, so a track change implicitly resets the
  tally (no reset message is sent; see gotchas).
- Threshold `needed`: `1` for `"anyone"`, `floor(member_count / 2) + 1` for
  `"majority"`. A vote FROM THE HOST always skips immediately regardless of
  mode or count.
- When the threshold is met: the vote key is deleted, a server-built `next`
  command is broadcast to the host's active device on `playback:user:<host_id>`
  and `{"type":"skipped"}` goes out on the jam stream.
- Otherwise `{"type":"skip_votes","song_id":"...","count":n,"needed":m}` goes
  out on the jam stream.

Response: 200 `{"skipped": boolean, "count": number, "needed": number}`.
Voting twice is idempotent (set union).

### 4.2 Music profile

#### GET /users/:id/music_profile
`:id` accepts a user id OR a handle (handle is lowercased server-side). The web
client calls it with whatever it has: `users/<idOrHandle>/music_profile`.

Authorization (in the controller): visible to the profile OWNER, and to
ACCEPTED FRIENDS when the owner's `share_listening` flag is on. Everyone else,
including any signed-in stranger, gets `200 {"visible": false}` (deliberately
not a 401/403: the client just renders nothing, so a private profile is
indistinguishable from an empty one). Unknown user: 404 `"User not found."`.
Unauthenticated: 401.

Visible response = `MusicProfile` with `visible: true` (shape in section 3).
Constants from `MusicProfiles::Builder`: 30-day window for tops and
`plays_30d`, 8 top artists, 10 top songs, 10 recent (the web profile card
renders only the first 5 top songs). `now_playing` is a full `FriendListening`
snapshot of the owner (its `song` is also nilled when `share_listening` is off,
which only matters for the owner-viewing-own-profile case).

### 4.3 Supporting endpoints the social UI uses

- `GET /users/:id/picture` - avatar image (unauthenticated OK). The web client
  builds `Account.pictureUrl(userId)` for every member/friend row.
- `GET /relationships` - the caller's relationships; the jam panel filters
  `kind == "friend" && status == "accepted"` rows and takes the OTHER side of
  each (`requester`/`accepter`) to build the invite list.
- `PATCH /users/:id` accepts `share_listening` (boolean) among the profile
  update params - that is the privacy toggle for both the friends feed song
  visibility and the music profile.
- Notifications list/read endpoints (generic) deliver `jam_invite` items; the
  RN app can render them like the web does (link into the music area).

## 5. ActionCable channels

### 5.1 JamChannel (jam realtime, both host and members)

Subscribe identifier: `{"channel":"JamChannel","id":<jam id (number)>}`.

Subscription authorization: the jam must exist AND be active (`ended_at` null)
AND the caller must be a member; otherwise `reject_subscription`. The web
client treats a rejection as "jam is gone" and clears all local jam state.
So: call `POST /jams/:id/join` FIRST, then subscribe.

On successful subscribe the server immediately `transmit`s a snapshot (only to
you, not the stream):

```json
{ "type": "snapshot", "jam": Jam, "state": JamState }
```

The snapshot `state.position` comes from the persisted host playback row, which
is written at most every 5 seconds (`POSITION_PERSIST_INTERVAL`), so it can be
up to ~5s stale; the host's 1 Hz ticks correct it within a second.

There are NO client-to-server actions on JamChannel. It is receive-only; every
mutation goes through REST (section 4.1). Server-to-client message types:

| type | payload | when |
|---|---|---|
| `snapshot` | `{jam: Jam, state: JamState}` | transmit on subscribe |
| `state_changed` | `{state: JamState}` | host's song/pause changed, or host's queue changed (proposals landing, reorders) - the relay fires from the host's `state_changed` publish on PlaybackChannel |
| `position_tick` | `{position: number, paused: boolean, song_id: string\|null, server_time: epochMs}` | every host position tick, nominally 1 Hz. NO song payload; correlate via `song_id` |
| `members_changed` | `{jam: Jam}` | someone joined or left |
| `jam_updated` | `{jam: Jam}` | host changed the rules |
| `song_proposed` | `{song: {id, title, artist_names}, proposer: {id, handle, name}}` | a proposal was accepted by the REST endpoint (informational toast; the actual queue update arrives via the next `state_changed`) |
| `skip_votes` | `{song_id, count, needed}` | a vote landed but did not pass |
| `skipped` | `{}` | a skip fired (vote passed or host voted) |
| `ended` | `{}` | the jam ended (host left, DELETE, or host started a new jam) |

Everyone in the jam receives every message (single stream `jam:<id>`); the HOST
client ignores `state_changed`/`position_tick` audio-wise (it is the source)
but still consumes `members_changed`, `jam_updated`, `skip_votes`, `skipped`,
`song_proposed`, `ended`.

### 5.2 FriendListeningChannel (friends feed)

Subscribe identifier: `{"channel":"FriendListeningChannel"}` (no params).
Rejected when unauthenticated.

On subscribe the server streams from `listening:user:<friend id>` for every
accepted friend WHO HAS `share_listening` ON, and transmits a snapshot:

```json
{ "type": "snapshot", "friends": [ FriendListening, ... ] }
```

Updates then arrive as a full row replace:

```json
{ "type": "listening_update", "user": {...}, "song": {...}|null, "paused": false, "online": true, "jam_id": 42, "updated_at": "..." }
```

(`FriendListening` fields merged with `type` at the top level, NOT nested.)
Client behavior (web): replace the row matching `user.id`, else append. Sort:
live rows first (`online && !paused && song`), then by `updated_at` desc.

Updates fire on song/pause transitions and on jam membership changes
(create/join/leave/end all call `Listening.broadcast`), NEVER on position ticks -
the feed has no positions. Note the double privacy layer: the channel only
streams friends with sharing on, and `Listening::Snapshot` additionally nils
`song` when sharing is off; `online`, `paused`, `jam_id`, `updated_at` stay
visible in the snapshot shape regardless (a jam is an explicit social act).

Friend list changes (new friendship, sharing toggled) take effect only on the
next subscribe - the web provider resubscribes on reconnect and that is deemed
enough. An RN app should resubscribe on foreground if it wants fresher rosters.

There are no client-to-server actions on this channel either.

### 5.3 PlaybackChannel (host-side jam duties and presence)

Full playback sync is out of scope here, but a jam HOST (and anyone who wants
to appear "online" in the friends feed) must run it. Subscribe identifier:
`{"channel":"PlaybackChannel","device_id":"<per-install uuid>","device_label":"<name>","predecessor":<optional previous uuid>}`.
`device_id` is a bare client-generated token matching `/\A[A-Za-z0-9-]{8,64}\z/`;
the server composes the real device identity as `<session_id>:<uuid>`.

Jam-relevant behavior:

- **Presence**: subscribing with a `device_id` upserts a `PlaybackDevice` row;
  `online` in the friends feed means such a row was seen within 75 seconds
  (`ONLINE_TTL`). Keep it alive with the `heartbeat` action (the web client
  performs `{"action":"heartbeat"}` periodically); rows die on unsubscribe.
- **Host relays**: when the ACTIVE device publishes `state_changed` and the
  song/pause or queue changed, and when it publishes `position_tick`, the
  server relays to the host's active jam stream (sections above). The host
  device must therefore be the ACTIVE device (`claim_active` with
  `{"mode":"steal"}` right after creating the jam).
- **Server-injected commands to the host**: `jam_add_song` (proposal payload
  in `args.song`, insert FIFO after current song, behind earlier proposals) and
  `next` (skip passed). They arrive as
  `{"type":"command","command":"jam_add_song"|"next","args":{...},"target_device_id":"...","target_session_id":...,"from_device_id":null,"from_session_id":null}`
  on the host's own playback stream; only the targeted active device executes.
- **Foreign song guard**: the host's playback state may reference songs the
  host does not own ONLY while they are in the proposal allowlist of the jam
  the host currently hosts; anything else is silently stripped from
  `song_id`/`queue` on publish (`sanitize_song_refs`) and never presigned.

## 6. Jam lifecycle summary

- **Create**: `POST /jams` (201). Caller becomes host + first member. Any
  previous jam of the caller is left/ended first ("one jam at a time" is
  enforced server-side on both create and join). Host client then steals the
  active device and just plays music normally.
- **Join**: from the joinable list (`GET /jams`) or a friend-feed row's
  `jam_id`. `POST /jams/:id/join`, then subscribe `JamChannel` with the jam id,
  then follow the snapshot. Membership requires being a friend of any member.
- **Leave (member)**: `POST /jams/:id/leave`; others get `members_changed`.
  The web client also auto-leaves when the member starts local playback
  (listening to your own music while following makes no sense).
- **End**: host calls `leave` or `DELETE /jams/:id`, or host creates/joins
  another jam. Everyone gets `{"type":"ended"}` and the jam row gets
  `ended_at`. **There is NO host handoff**: the host leaving always ends the
  jam for everyone. Ended jams 404 on every member route and reject channel
  subscriptions.
- **Rules**: `PATCH /jams/:id` by host; `jam_updated` fans out. `queue_mode`
  gates proposals; `skip_mode` gates skip votes.
- **Kick**: does not exist.

## 7. Member (follower) playback - what the web client does

An RN client should reproduce this logic (`JamProvider.tsx`):

- Followers play the host's audio on a DEDICATED player fed by
  `JamState.song.audio_url` (presigned). The user's normal queue/player stays
  untouched and silent.
- Track identity is `song.id`, NOT the URL: presigned URLs are cached
  backend-side but a signature rollover must not count as a track change and
  trigger a rebuffer.
- On a new song: set source, seek to `state.position` once the media is ready
  (the web queues a `pendingSeek` applied on `loadedmetadata`; seeking before
  metadata is dropped by some players and mid-song joins would start at 0).
- On `position_tick`: if `paused`, pause. Else ensure playing and compare local
  position to `msg.position`; if drift exceeds 2.5 s (`MAX_DRIFT`), seek to the
  tick position. Below that, let it ride (constant seeking stutters).
- **Local pause**: a follower may pause locally without affecting the jam
  (there is no REST/cable call for it). On resume, re-sync by extrapolating
  the last tick: `tick.position + (now - tick.receivedAt)` seconds, then play.
  When the HOST pauses, followers hard-pause and the local pause toggle is
  disabled.
- Skip-vote tally display resets locally whenever the state's song id changes
  (the server resets the counter silently, keyed per song).
- Volume is purely local.
- While following with `queue_mode == "everyone"`, the web intercepts "play"
  on any library song and turns it into `POST /jams/:id/propose` instead of
  local playback (except entries already flagged `jam_song`). Starting REAL
  local playback while following triggers an auto-leave (with a ~1.5s grace
  after joining to let the join itself settle).
- On app start, call `GET /jams` and, if `current` is set, resume following
  (re-subscribe to `JamChannel`).
- Autoplay policies: the web plays a 0-sample silent WAV inside the join tap to
  unlock the audio element before the snapshot arrives over the socket. Native
  audio APIs will not need this trick, but browser-based RN webviews would.

Host-side extras the web client applies to `jam_song` entries (proposals in the
host queue): stream via `audio_url`/`artwork_url` (the host cannot resolve the
proposer's fs nodes), show `jam_proposer` attribution, never record play
events for them, never persist them across sessions, exclude them from vocal
separation features.

## 8. Music profile and privacy model

- Privacy pivot: `users.share_listening` (boolean, default TRUE), toggled via
  `PATCH /users/:id`.
- "Friends" everywhere in this doc = accepted relationships of kind "friend"
  (`relationships` table with `kind: "friend", status: "accepted"`; the
  association is symmetric).
- What `share_listening` gates:
  - the song in your friends-feed row (row still exists with `song: null`),
  - inclusion of your stream in your friends' `FriendListeningChannel`
    subscriptions,
  - visibility of your `music_profile` to friends.
- What it does NOT hide: your `online` flag, `paused` flag, `jam_id`, and
  `updated_at` in snapshots that still include you, and your jam membership in
  `GET /jams` responses (a jam is treated as an explicit social act).
- The profile owner always sees their own music profile.
- The client contract for `visible: false` is "render nothing", so a private
  profile looks identical to an empty one.

## 9. Presigned media URLs (why and how long)

All cross-user media in these payloads (`artwork_url`, `audio_url`,
`image_url`) are presigned storage URLs minted by `MediaUrls.for_node`:
the normal `fs_nodes` data route only serves nodes the caller can view, and a
viewer never owns a friend's files, so the social layer signs URLs itself
AFTER authorizing (friendship, jam membership).

- Validity: 6 hours. Cached server-side for 5 hours, so any URL you receive
  has at least ~1 hour of life, and the SAME URL string is reused across
  broadcasts within the cache window (deliberate: followers must not treat
  every pause/resume broadcast as a new source).
- Consequence: do not cache these URLs long-term client-side; refetch state
  (or resubscribe for a fresh snapshot) if playback of a stored URL 403s.
- `MediaUrls.for_node` can return null on presign failure; every `*_url` field
  is nullable.

## 10. Copy-paste endpoint list

```
GET    /jams                      -> JamsIndex (current + joinable)
POST   /jams                      -> 201 Jam (create; caller becomes host)
PATCH  /jams/:id                  -> Jam (host only; queue_mode/skip_mode)
DELETE /jams/:id                  -> end jam (host only)
POST   /jams/:id/join             -> Jam
POST   /jams/:id/leave            -> 200 (host leaving ends the jam)
POST   /jams/:id/invite           -> 200 (body {user_id}; sends jam_invite notification)
POST   /jams/:id/propose          -> 200 (body {song_id}; member's OWN song)
POST   /jams/:id/skip_vote        -> {skipped, count, needed}
GET    /users/:idOrHandle/music_profile -> MusicProfile ({visible:false} when not allowed)
GET    /users/:id/picture         -> avatar image (public)
GET    /relationships             -> relationship rows (filter friend+accepted for invite list)
PATCH  /users/:id                 -> includes share_listening privacy toggle

WS     wss://backend.omelhorsite.pt/cable?token=<token>
         subscribe {"channel":"JamChannel","id":<number>}         (receive-only)
         subscribe {"channel":"FriendListeningChannel"}           (receive-only)
         subscribe {"channel":"PlaybackChannel","device_id":...}  (host duties + presence)
```

## 11. Gotchas for a reimplementation

1. **Jam ids are numbers; user and song ids are strings.** Mixed-type bugs are
   easy here (e.g. `FriendListening.jam_id` is a number matched against
   `Jam.id`).
2. **JamChannel has zero client actions.** Everything is REST; the channel only
   pushes. Do not try to `perform` on it.
3. **Join before subscribing.** The channel rejects non-members; the REST join
   must complete first. Similarly a rejection mid-jam means you were ejected by
   an end - clear state, do not retry-loop.
4. **No host handoff.** Host leaves = jam over, `ended` for everyone. Also
   creating or joining a jam silently exits (or ends) your previous one.
5. **Proposals are for YOUR OWN songs only**, and only land while the host has
   an active playing device. The proposal's queue placement happens on the
   HOST'S CLIENT (via the injected `jam_add_song` command), not in the
   database - a host client that ignores the command breaks proposals. An RN
   host must implement `jam_add_song` + `next` command handling and the FIFO
   insert-after-current rule.
6. **Skip tallies reset silently on track change** (votes are keyed per
   song id in a 15-minute cache). Reset your local counter whenever the state's
   song id changes; no message will tell you.
7. **Presigned URLs rotate.** Compare songs by id, never by URL; expect URLs to
   die after ~6 h; treat every `*_url` as nullable.
8. **Snapshot position can be ~5 s stale** (persist interval); trust the 1 Hz
   ticks and only hard-seek beyond a ~2.5 s drift.
9. **`FriendListeningChannel` rosters are subscribe-time.** New friends or
   privacy flips do not appear until you resubscribe.
10. **`online` presence requires PlaybackChannel.** A client that never
    subscribes with a `device_id` (plus heartbeats) will show its user as
    offline in friends' feeds even while playing. TTL is 75 s.
11. **`{visible:false}` is a 200**, not an error, for music profiles; and the
    lookup accepts handle or id (handles lowercased).
12. **Response bodies are unwrapped**, and error bodies are often bare JSON
    strings; do not assume an `{error: ...}` object.
