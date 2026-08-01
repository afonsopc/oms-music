# Authentication and account plumbing (omelhorsite backend)

Audience: engineers building a native React Native (Expo) music app for iOS/Android that talks to the existing production Rails backend with zero backend changes.

Base URL (production): `https://backend.omelhorsite.pt`
Dev backend: `http://localhost:1143`
WebSocket (ActionCable): `wss://backend.omelhorsite.pt/cable`

Everything below was read from the actual code:

- Frontend: `frontend/services/BackendService.ts`, `frontend/services/AccountService.ts`, `frontend/services/PasskeyService.ts`, `frontend/services/IdentityService.ts`, `frontend/services/CableService.ts`, `frontend/lib/request.ts`, `frontend/components/account/authentication/*`
- Backend: `backend/app/controllers/sessions_controller.rb`, `users_controller.rb`, `identities_controller.rb`, `webauthn_credentials_controller.rb`, `service_usages_controller.rb`, `app/controllers/concerns/{authentication,session_cookie,captcha_gate,crud_actions,response_helpers}.rb`, `app/models/session.rb`, `app/models/email_verification.rb`, `app/channels/application_cable/connection.rb`, `config/initializers/{rack_attack,cors,omniauth,00_urls}.rb`

---

## 1. The auth model in one paragraph

A login creates a `Session` row whose `token` is a random UUID (`SecureRandom.uuid`). That token IS the credential. The backend accepts it three ways, in this candidate order (`Session.candidate_tokens`):

1. `Authorization` header (`Bearer <token>` or `Bearer:<token>`)
2. `?token=<token>` query/body param
3. httpOnly cookie named `oms_session` (web browsers only)

The server tries each candidate until one resolves to a live Session row (`Session.resolve_from_request`), so a stale header does not permanently shadow a valid cookie on normal API requests. There is no JWT, no refresh token, no expiry on the token itself: the session lives until the row is deleted (logout or revocation). The cookie is set with a 1 year expiry, but the token in the body never expires on its own.

**For the native app: use bearer-token mode only.** This is exactly what the existing Capacitor iOS shell does (see `isCookieAuth()` in `BackendService.ts`: cookie auth is enabled only when the page is served same-site with `omelhorsite.pt`; `capacitor://localhost` and dev both fall back to storing the raw token and sending `Authorization: Bearer <token>` on every request). The httpOnly cookie is a web-browser-only mechanism; you can ignore it entirely, but be aware every session-minting endpoint also sets it (harmless to a native HTTP client, though see Gotcha about cookie jars in section 12).

## 2. Password login

```
POST /sessions
Content-Type: application/json
Body: { "email": "user@example.com", "password": "secret" }
```

- Success: `201 Created`. Response body is the Session rendered with the `:token` view:

```json
{
  "id": "<session-uuid>",
  "created_at": "2026-...",
  "updated_at": "2026-...",
  "ip_address": "1.2.3.4",
  "user_agent": "...",
  "name": "<parsed from User-Agent>",
  "description": "<parsed from User-Agent>",
  "device_type": "mobile",
  "last_used_at": "2026-...",
  "user_id": "<user-uuid>",
  "user": { ...full user object, see section 8... },
  "token": "<THE CREDENTIAL - a UUID>"
}
```

- Failure: `401` with a JSON string body `"Invalid email address or password."` (also used when the email does not exist).
- Email is normalized server-side (`strip.downcase`), passwords via `has_secure_password` / `User.authenticate_by` (timing-safe).
- Deactivated accounts cannot create sessions (validation on Session create fails).
- Dev only: in `Rails.env.development?` the password literal `"dev"` logs into any account.
- No captcha on login. Rack::Attack throttle: 10 POSTs to `/sessions` per IP per minute.
- The response also carries a `Set-Cookie: oms_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/` (host-only on backend.omelhorsite.pt, 1 year). Native clients should ignore it.

The SPA stores the returned `token` in `localStorage` under key `token` (native/dev mode), then reloads the page. Native equivalent: store the token in SecureStore/Keychain and attach it as `Authorization: Bearer <token>` on every request.

## 3. Signup (email OTP flow)

Two-step, 6-digit email code (`EmailVerification`, `CODE_LENGTH = 6`, digits only, expires in 15 minutes, max 5 verification attempts per code, one live code per email+reason):

```
POST /users/create_start   Body: { "email": "..." }
  -> 200, body: "Verification code sent to your email."
  -> 409 "Email already registered." if taken

POST /users/create_end     Body: { "email": "...", "code": "123456", "name": "...", "password": "..." }
  -> 201 with the created user (extended view)
  -> 404 "Invalid Verification" on bad/expired code
```

`create_end` does NOT create a session. The SPA immediately calls `POST /sessions` with the same email+password afterwards (see `AccountCreationTab.tsx`). Reproduce that.

- The `handle` is auto-generated from the name server-side on create.
- Frontend validation constants (mirror them): name 1..50 chars, handle 1..15, password min 1, code exactly 6.
- Rack::Attack: the four `*_start` endpoints share 4/min and 20/hour per IP; the four `*_end` endpoints share 10/min per IP.

## 4. Password reset, email change, account deletion

All use the same 6-digit email-code machinery:

```
POST /users/reset_password_start  { email }                              (no auth; always 200, anti-enumeration)
POST /users/reset_password_end    { email, code, password }              (no auth)

POST /users/update_email_start    { email: <new email> }                 (auth required; sends codes to BOTH old and new address)
POST /users/update_email_end      { email, prev_email_code, new_email_code }  (auth required)

POST /users/destroy_start         {}                                     (auth required; code goes to account email)
POST /users/destroy_end           { code }                               (auth required; deletes the account)
```

## 5. Passkeys (WebAuthn)

Fully supported, optional. The web uses `@simplewebauthn/browser`; a native app would need a platform passkey module, the HTTP contract is:

```
POST /webauthn_credentials/authentication_options   (no auth)
  -> 200 { "handle": "<uuid, an opaque challenge handle>", "options": { ...WebAuthn PublicKeyCredentialRequestOptions... } }

POST /webauthn_credentials/authentication           (no auth)
  Body: { "credential": <assertion JSON from the authenticator>, "handle": "<handle from options>" }
  -> 201 Session :token view (same shape as POST /sessions) + Set-Cookie
  -> 401 on expired challenge (2 min TTL), unknown passkey, deactivated account, or verify failure

POST /webauthn_credentials/registration_options     (auth required) -> creation options
POST /webauthn_credentials/registration             (auth required) Body: { credential, nickname } -> 201 passkey
GET  /webauthn_credentials                          (auth required) -> list of { id, nickname, last_used_at, created_at }
DELETE /webauthn_credentials/:id                    (auth required)
```

Notes:

- The registration/authentication bodies must carry the raw WebAuthn JSON untouched. The SPA deliberately bypasses its normal request wrapper here because that wrapper rewrites `null` to `"\b"` (see section 11) and would corrupt the payload. Do the same: send these bodies verbatim.
- The WebAuthn RP is configured in `config/initializers/webauthn.rb` for the omelhorsite.pt origin; iOS/Android passkey support would need associated-domains/asset-links on that domain, which do not exist today. Treat passkeys as out of scope for v1 of the native app; password + OAuth cover login.
- Throttle: 20/min per IP on `/webauthn_credentials/authentication*`.

## 6. OAuth (Google, GitHub, Spotify)

Provider ids: `google_oauth2`, `github`, `spotify` (see `IDENTITY_PROVIDERS` in `IdentityService.ts`).

Flow as the web does it:

1. Browser navigates (full page GET, not XHR) to `https://backend.omelhorsite.pt/auth/<provider>?mode=signin` (modes: `signin`, `signup`, `link`). OmniAuth allows GET. The `mode` is stashed in the Rails cookie session.
2. Provider round trip happens on the backend host.
3. Callback (`GET /auth/<provider>/callback`) ends with a redirect to the frontend, hardcoded to `https://omelhorsite.pt/account/oauth/callback?ticket=<short-lived signed ticket>` on success or `...?error=<code>` on failure. Error codes seen in code: `account_exists`, `account_not_found`, `unauthorized`, `conflict`, `internal`, `spotify_not_allowlisted`, `oauth_state` (client-side), `oauth_failed` (client-side).
4. The frontend exchanges the ticket:

```
POST /sessions/adopt   (no auth)
Body: { "ticket": "<ticket>" }
  -> 201 { "token": "<session token>" }  (+ Set-Cookie)
  -> 401 "Invalid or expired ticket."
```

Ticket TTL is 2 minutes (`Session#signed_id(purpose: :oauth)`); it is a signed id, not single-use server-side (the web enforces single-use client-side via a sessionStorage nonce).

Native implication: the callback redirect target is hardcoded to `https://omelhorsite.pt/account/oauth/callback` (`Rails.configuration.frontend_url`), NOT configurable per client. To do OAuth natively you must open the `/auth/<provider>?mode=signin` URL in a browser view (Expo `WebBrowser`/ASWebAuthenticationSession/Custom Tab), watch for the navigation to `omelhorsite.pt/account/oauth/callback`, extract `ticket` (or `error`) from the query string, close the browser, and POST the ticket to `/sessions/adopt`. There is no custom-scheme redirect and you cannot add one without backend changes.

Account linking while signed in: `GET /auth/link/<provider>?token=<session token>` (native passes the raw token; web mints a ticket first via `GET /sessions/oauth_ticket` -> `{ ticket }`). Spotify linking is refused server-side unless the account has `allowed_to_use_spotify`.

Linked-identity management:

```
GET    /identities        -> [ { id, provider, email, name, avatar_url, created_at, updated_at } ]
DELETE /identities/:id
```

## 7. Attaching auth to requests (what the shared wrapper does)

`frontend/lib/request.ts` + `BackendService.backend()` is the single wrapper used by MusicService and everything else. What it does, and what the native app must reproduce:

- Header: `Authorization: Bearer <token>` on every request when a token is stored. IMPORTANT: the server-side header parse is `header["Bearer:".length..]`, i.e. it blindly strips the first 7 characters. `Bearer <token>` and `Bearer:<token>` both work; a bare token without prefix does NOT (its first 7 chars get eaten). Always send the `Bearer ` prefix.
- GET requests put payloads in the query string, everything else as a JSON body (`Content-Type: application/json`). List endpoints take axios-style bracket params: `?search[title]=x&exact_search[artist]=y&modifiers[page]=1:50&modifiers[order]=created_at:desc`, arrays as `search[id][]=a&search[id][]=b`.
- Null convention: the wrapper rewrites every `null` in outgoing params/bodies to the string `"\b"` (a literal backspace character, `transformNulls`). The backend converts `"\b"` back to SQL NULL. To clear a nullable field (e.g. set an album to null) you MUST send `"\b"`; JSON `null` keys can get dropped by Rails' param handling. FormData bodies are exempt.
- Media/streaming URLs (audio, artwork, downloads) cannot carry headers when handed to a player or `<img>`. The SPA builds them with `getAuthenticatedBackendUrl(route)`, which appends `?token=<token>` to the URL. The backend accepts `params[:token]` as a first-class credential, so the native audio player should load e.g. `https://backend.omelhorsite.pt/fs_nodes/<id>/data?token=<token>`. That endpoint 302-redirects to a presigned MinIO/storage URL; alternatively `GET /fs_nodes/<id>/data_url?token=<token>` returns `{ "url": "<presigned URL valid 6 hours>" }` as JSON so you can hand the storage URL straight to the player (this is what the web does for media elements).
- CSRF: none. The API is `ActionController::API`; `protect_from_forgery` is never enabled, there is no CSRF token header to send. CSRF defense for browsers is purely SameSite=Lax on the cookie; bearer clients are unaffected.
- CORS: irrelevant to native HTTP clients. For the record: credentialed CORS is allowed only for the named browser origins; everything else gets the wildcard, credential-less block (`config/initializers/cors.rb`).
- 401 handling in the SPA: `Session.mine` failing marks the client logged out. Reproduce: on a 401 from `/sessions/mine`, drop the stored token and show login.

## 8. Current user and profile endpoints

Bootstrapping the signed-in state (what `useMyAccountQuery` does):

```
GET /sessions/mine     (auth required)
  -> 200 Session extended view: { id, created_at, updated_at, ip_address, user_agent,
       name, description, device_type, last_used_at, user_id, user: { ...user... } }
  -> 401 "Session required to access this resource." when the credential is bad/absent
```

The SPA then fetches the full account by id:

```
GET /users/:id         (auth required)
```

User JSON shape (Blueprinter; base fields always present, conditional fields only when the viewer qualifies):

```json
{
  "id": "uuid",
  "created_at": "...", "updated_at": "...",
  "handle": "afonso", "name": "Afonso", "bio": null,
  "country_code": "PT",
  "email_is_public": false, "gender_is_public": false,
  "library_public": false, "library_name": null, "library_description": null,

  "group": "administrator" | "default",          // only self or admin viewer
  "email": "...",                                 // only if email_is_public, self, or admin
  "gender": "male" | "female" | "not_specified", // only if gender_is_public, self, or admin
  "allowed_to_use_spotify": true,                 // only self or admin
  "share_listening": true,                        // only self or admin
  "last_seen_at": "...", "sessions_count": 3, "deactivated_at": null   // admin-only
}
```

Other account endpoints:

```
GET  /account                          (auth) legacy compat: current user extended view
GET  /account/usage                    (auth) usage dashboard: storage/music/tickets/messages/short_links counters
PATCH /users/:id                       (auth, self or admin) multipart/form-data; fields: name, handle,
                                       country_code, email_is_public, gender_is_public, gender, bio,
                                       library_public, library_name, library_description, share_listening,
                                       picture (image file; server re-encodes to webp, 1024px)
GET  /users/:id/picture                (NO auth) avatar; 302 redirect to storage URL; 404 if user or picture missing.
                                       Avatar URL for the app: https://backend.omelhorsite.pt/users/<id>/picture
GET  /users/by_handle/:handle          (NO auth) public profile view
GET  /users/:id/profile                (NO auth) public profile (accepts id or handle); profile view adds
                                       followers_count, following_count, is_following, member_since
GET  /users/search?q=<term>            (NO auth) >=2 chars, max 8 rows of { id, handle, name }; throttled 30/min/IP
POST /users/:id/follow                 (auth)
DELETE /users/:id/follow               (auth)
GET  /users/:id/music_profile          (auth-aware) owner always; friends only when share_listening; otherwise 200 { "visible": false }
```

Note there is no dedicated "avatar URL" field on the user JSON; clients construct `/users/<id>/picture` themselves (`Account.pictureUrl`). It is unauthenticated, so no token needed - safe for `<Image>` components and lock-screen artwork.

## 9. Session management (devices screen)

```
GET    /sessions                       (auth) own sessions (admins see all); standard list filters
PATCH  /sessions/:id                   (auth, own or admin) body: { name?, description?, device_type? }
DELETE /sessions/:id                   (auth) LOGOUT - see gotcha below
```

- `device_type` enum (server parses it from User-Agent at login; users can rename): `tablet, console, fridge, teapot, toaster, air_conditioner, car, blender, vacuum_cleaner, washing_machine, lawn_mower, microwave, hair_dryer, electric_toothbrush, desktop, laptop, television, mobile, space_ship, time_machine, hoverboard, teleporter, magic_carpet, unicorn, flying_broom, submarine, hot_air_balloon, keychain, alarm_clock, radio, record_player, other`.
- Session name/description are auto-derived from the login request's User-Agent. Send a meaningful User-Agent from the native app (e.g. `OMelhorSiteMusic/1.0 (iPhone; iOS 19)`) so the devices screen shows something sensible. Limits: name 1..50, description 1..255.
- GOTCHA: `SessionsController#destroy` ignores `:id` entirely - it always destroys `Current.session` (the session that authenticated the request) and clears the cookie, returning 204. So `DELETE /sessions/<anything>` = "log ME out". The web's own "revoke other device" button is subject to this same behavior. For native logout: call `DELETE /sessions/current` (any id) with the token, then wipe local storage; treat failures as non-fatal and wipe anyway (the SPA does).
- Every session create fires a Discord "Login" alert, and returning after >1h inactivity fires an "Active" alert. Expected noise; not client-facing.

## 10. ActionCable (WebSocket) auth

Connection: `wss://backend.omelhorsite.pt/cable?token=<session token>`

- `ApplicationCable::Connection#connect` resolves the session via `Session.token_from_request`, which takes the FIRST candidate in order (Authorization header, `token` param, cookie) WITHOUT the try-each-until-live fallback used by HTTP requests. The SPA passes `?token=` in the URL because browsers cannot set headers on WebSockets; a native client can use either the query param or an `Authorization: Bearer` header on the handshake, but do not send a stale header alongside a good query param (the header wins).
- Anonymous connections are ACCEPTED (used for anonymous tool job watching); channels that need identity reject nil users at subscribe time (`reject_subscription`). So a successful WS handshake does not prove the token was valid - watch for subscription rejections.
- `config.action_cable.disable_request_forgery_protection = true` in production: no Origin header check, so native clients connect freely.
- Protocol: plain ActionCable v1 JSON over a raw WebSocket (the SPA implements it by hand in `CableService.ts`, no client library). Messages:
  - Server -> client: `{ "type": "welcome" | "ping" | "confirm_subscription" | "reject_subscription" | "disconnect" }` or `{ "identifier": "<json string>", "message": <payload> }`
  - Client -> server: `{ "command": "subscribe" | "unsubscribe" | "message", "identifier": "<JSON string like '{\"channel\":\"PlaybackChannel\"}'>", "data": "<JSON string with {action, ...}>" }`
  - Wait for `welcome` before subscribing; resubscribe everything after reconnect; exponential backoff 1s..30s.
- `/cable` is exempt from the Rack::Attack general ceilings.

## 11. Response conventions and errors

- Success helpers render the payload directly as the JSON body (`ok!`, `created!` = 201, `no_content!` = 204). Some bodies are bare JSON strings (e.g. `"Verification code sent to your email."`), not objects - parse defensively.
- Error responses: status code + JSON body that is usually a plain string message, sometimes an array of validation messages. There is no uniform `{ error: ... }` envelope EXCEPT rate limiting (below).
- List endpoints (`index`) support `search`, `exact_search`, `modifiers` (`order`, `page` as `"<n>:<size>"`, `random`), `extra_options`. Unknown filter keys are rejected with 400 ("Unknown search filter: ..."), they are never silently ignored.
- Index responses use HTTP caching: `stale?(resources)` means you may get `304 Not Modified` with an empty body when sending `If-None-Match`. Make sure your HTTP client either handles conditional GETs transparently or does not send stale validators.
- Un-paginated index requests are force-paginated server-side to a bounded default page size; always drive `modifiers[page]` explicitly (`"1:100"` etc., songs cap at 500 per page).

## 12. Rate limiting (Rack::Attack) - what the app will actually hit

Throttled responses are `429` with body `{ "error": "rate_limited", "retry_after": <seconds> }` and a `Retry-After` header. Honor it: pause exactly that long, do not retry-storm. Every 429 also fires a Discord security alert on the server, so a client bug that hammers the API pages the owner.

Relevant buckets:

| Rule | Limit | Keyed by |
|---|---|---|
| general/authed (all endpoints not listed below) | 600/min | full `Authorization` header value, only when it resolves to a LIVE session |
| general/anon | 120/min | IP |
| external proxy paths `/lyrics*`, `/artists/*`, `/artist_metadata/*`, `/music_radios/*` | 60/min | Authorization header (IP if anon) |
| POST /sessions (login) | 10/min | IP |
| POST /users/*_end (code verify) | 10/min | IP |
| POST /users/*_start (code send) | 4/min AND 20/hour | IP |
| POST /webauthn_credentials/authentication* | 20/min | IP |
| GET /users/search | 30/min | IP |
| expensive tools (vocal_separations, transcriptions, tools_downloader/preview, playlist_imports/preview, ...) | 20/min | token or IP |

Exempt from the general ceilings: `/cable`, `/up`, `/rails/active_storage/*`, `/fs_nodes/:id/data`, `/fs_nodes/:id/zip`, `/books/:id/file`. Media streaming therefore never eats your request budget, but `/fs_nodes/:id/data_url` DOES count (it is a normal JSON call).

Two consequences for the native app:

1. A request with an invalid/stale token is counted in the ANON 120/min IP bucket, not the authed 600/min bucket. A logged-out app polling aggressively can rate-limit the whole device IP (a NAT'd office/venue included).
2. The authed bucket key is the literal header string. Keep the header format stable (`Bearer <token>`); do not rotate junk tokens (that path was closed - unresolved tokens fall to the IP bucket).

## 13. Service access control - who may use music

- There is NO per-user music allowlist and no entitlement/subscription check. Every music endpoint (songs, playlists, liked_songs, play_events, jams, mixes, radios, lyrics, artists, imports...) simply requires an authenticated session: the default `before_action :require_authentication` applies unless a controller opts out. Any registered account can use the music feature.
- Data isolation is per-user via `viewable_by` scopes (`Song.viewable_by(user) = where(user:)` etc.): each user only ever sees their own library. There is no shared catalog.
- The ONE gated music-adjacent feature is Spotify sync/import: `User.allowed_to_use_spotify` (boolean, settable only by admins via `PATCH /users/:id`). The server refuses Spotify OAuth linking without it, and the SPA hides Spotify UI when the own-account field is false. Gate the native Spotify UI on `allowed_to_use_spotify` from the account payload.
- Anonymous users can technically reach a handful of public endpoints (profiles, user search, `fs_nodes/:id/data` for publicly granted nodes) but nothing musical of value; the app should treat "no session" as "must log in".
- `POST /service_usages { service_id: "music" }` and `GET /service_usages/top?limit=3` are NOT access control - just a visit counter powering the "recently used services" UI. Optional to reproduce; `service_id` must be in the server's allowlist or it 400s.
- Turnstile captcha (`cf_turnstile_token` param) only guards ANONYMOUS use of tool endpoints (feedbacks, chests, transcriptions, upscales, background removals, vocal separations, form submissions). Authenticated callers always skip it, and login/signup do not use it at all, so the native app never needs Turnstile.

## 14. Recommended native implementation checklist

1. Login screen: email+password -> `POST /sessions` -> store `data.token` in SecureStore. Optional OAuth via in-app browser + callback interception + `POST /sessions/adopt`.
2. Signup: `create_start` -> 6-digit code entry -> `create_end` -> `POST /sessions`.
3. On launch: if token exists, `GET /sessions/mine`; 401 => clear token, show login. Then `GET /users/<user_id>` for the account.
4. HTTP layer: always `Authorization: Bearer <token>`; JSON bodies; bracket-style query params for list filters; `"\b"` for explicit nulls; handle 401 (logout), 429 (`retry_after`), 304.
5. Media: append `?token=` to `/fs_nodes/:id/data` style URLs, or resolve `/fs_nodes/:id/data_url` and hand the presigned URL (6h validity) to the player. Avatar images need no token.
6. Cable: `wss://backend.omelhorsite.pt/cable?token=...`, hand-rolled ActionCable v1 protocol as in `CableService.ts`.
7. Logout: `DELETE /sessions/<any id>` then wipe the token locally.
8. Send a meaningful User-Agent on login so the session appears with a sane device name; the user can rename it via `PATCH /sessions/:id`.

## 15. Gotchas recap

- `Authorization` parsing strips exactly 7 chars: `Bearer <token>` works, a bare token does not.
- `DELETE /sessions/:id` ignores the id: it always kills the CALLING session.
- Session tokens never expire; only deletion revokes them. Do not build refresh logic.
- The OAuth callback always redirects to `https://omelhorsite.pt/account/oauth/callback`; native OAuth must intercept that URL in a browser view. Tickets die after 2 minutes.
- WebAuthn ceremony payloads must not pass through any null-rewriting request wrapper.
- `"\b"` (backspace string) is the wire representation of null in params/bodies.
- Cable handshake auth takes the FIRST credential (header beats query param), and anonymous connections are accepted - watch for `reject_subscription` instead of connection failure.
- Invalid-token requests count against the per-IP anonymous rate bucket (120/min); a stale-token retry loop can 429 the user's whole network.
- If your HTTP stack has an automatic cookie jar it will capture `oms_session` from login and send it on every request; that is redundant but harmless since header and cookie carry the same token. Safer to disable the jar so a token rotation never leaves a stale cookie behind.
- `create_end` does not log you in; follow with `POST /sessions`.
- Some success bodies are bare JSON strings, not objects.
- List endpoints 400 on unknown filter keys and force pagination when `modifiers[page]` is absent.
