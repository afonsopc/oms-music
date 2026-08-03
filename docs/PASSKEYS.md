# Passkeys

The app signs in with passkeys against the backend's existing WebAuthn implementation. No
server feature had to be built: the gem, the `webauthn_credentials` table, `users.webauthn_id`
and the four endpoints already shipped. What is missing is platform configuration, and until
it lands the passkey button reports a specific "domain not configured" error rather than
failing vaguely.

## What is implemented

- Sign in with a passkey from the login screen. The ceremony is discoverable credential
  (empty `allowCredentials`), so there is no email step: the OS shows the passkeys it holds
  for omelhorsite.pt.
- Register, list, rename and delete passkeys under Settings.
- All three sign-in methods (password, OAuth, passkey) converge on one session funnel, so
  token storage, cable reconnection, cache reset and navigation are identical.
- Errors are classified rather than generic: cancellation is silent, and no-credentials, an
  unsupported OS, a missing domain association and each of the ceremony's 401s get their own
  translated message.

Base64url handling is explicit and unit tested: the server decodes both `id` and `rawId` and
demands identical bytes, so a platform that pads one and not the other would 401 with no
useful message.

## What must happen before it works in production

### 1. Publish the two domain association files

They already exist in the website repo at `frontend/public/.well-known/`:

- `apple-app-site-association` (no extension, must be `application/json`; the content type
  is pinned in `public/_headers` and mirrored in `nginx/default.conf`)
- `assetlinks.json`

Deploy the site, then verify against the real domain:

    curl -sI https://omelhorsite.pt/.well-known/apple-app-site-association | grep -i content-type
    curl -s  https://omelhorsite.pt/.well-known/apple-app-site-association | python3 -m json.tool
    curl -s  https://omelhorsite.pt/.well-known/assetlinks.json | python3 -m json.tool

Neither may redirect, and both must be plain HTTPS 200.

The static export does preserve the dot-prefixed directory: a full `bun run build` in
`frontend/` on 2026-08-03 produced `out/.well-known/` with both files intact. What is still
unproven until a real deploy is whether the host honours the `_headers` content-type rule for
an extensionless file, which is what the first curl above checks.

### 2. Confirm the Apple Developer Program membership

`ios.associatedDomains` in `app.json` requests the `com.apple.developer.associated-domains`
entitlement, which is available only to a PAID Apple Developer Program membership. A free
personal team cannot sign a device build that asks for it.

Team ID `6FYT6632J8` (read from the Apple Development certificate on the build machine) has a
development certificate but no distribution certificate and no provisioning profile, so the
membership tier could not be determined from this machine. Check at developer.apple.com, or
by trying to add the Associated Domains capability to App ID `pt.omelhorsite.music`.

Simulator builds do not need a profile, so the app compiles and runs regardless; only device
builds and real passkey use are affected.

### 3. Decide the Android signing key, then fill assetlinks.json

`sha256_cert_fingerprints` is deliberately EMPTY, which keeps Android passkeys off. That is
the safe state.

Do not put the Android debug fingerprint there. The Expo/Android debug keystore is a publicly
known key that ships with the template, so pairing it with
`delegate_permission/common.get_login_creds` would let any app built with the same package
name and that public key request this domain's passkeys.

Pick one:

- **Google Play App Signing (recommended).** Google holds the app signing key, so the upload
  key can be rotated later without breaking passkeys. Take the **app signing certificate**
  SHA-256 from Play Console > Release > Setup > App signing.
- **Self-managed release keystore.** Create it once, back it up somewhere you cannot lose it
  (losing it means never being able to update the app under the same identity), and read the
  fingerprint with `keytool -list -v -keystore <release>.jks`. This repo does not contain a
  release keystore: creating one is the owner's call, not the build's.

### 4. Allow the Android origin on the backend

This is a change to a live authentication trust boundary, so it is written here rather than
applied. iOS does NOT need it: Apple sends `https://omelhorsite.pt`, which is already allowed.

Android's Credential Manager sends the origin as `android:apk-key-hash:<base64url sha256>`,
and webauthn 3.4.3 compares origins literally, so every Android assertion 401s until that
origin is allowed in `backend/config/initializers/webauthn.rb` alongside the existing
`https://omelhorsite.pt`.

Derive the hash from the fingerprint chosen in step 3 (the same key that goes in
assetlinks.json):

    echo "AA:BB:CC:..." | tr -d ':' | xxd -r -p | openssl base64 | tr '+/' '-_' | tr -d '='

Then add `android:apk-key-hash:<that value>` to `allowed_origins`. Keep the list explicit:
one entry per signing key you intend to trust, and remove any key you stop using.

Verify afterwards by signing in with a passkey from an Android release build. A 401 with the
origin in the Rails log is the symptom of this step being missing or wrong.

## Verifying on device

1. iOS: install a device build, open Settings > Passwords and confirm the passkey saved for
   omelhorsite.pt is offered inside the app. `ERR_NOT_CONFIGURED` means the AASA file is not
   reachable, is redirected, or has the wrong content type.
2. Android: install a release-signed build. "No credentials available" with a correct
   assetlinks.json usually means the fingerprint does not match the key that signed the
   installed APK.
3. Both: registering and then signing in on the same device is the shortest end-to-end check.

## Known platform limitation

On iOS, "no passkey on this device" and "user dismissed the sheet" are the same
`ASAuthorizationController` error (1001), so the app stays silent in both cases rather than
accusing the user of an error they did not make. Android distinguishes them and shows the
no-credentials message.
