/**
 * WP1 acceptance smoke (bun, no React Native imports). Run:
 *
 *   OMS_EMAIL=... OMS_PASSWORD=... bun scripts/smoke.ts
 *
 * Optional: OMS_API_URL (default https://backend.omelhorsite.pt).
 * Checks: login -> GET /sessions/mine -> GET /songs?modifiers[page]=1:5 ->
 * exact_search[album]="\b" returns only null-album songs -> a garbage token
 * 401s once (no retry loop by construction; the app parks via the guard).
 */
// The SDK's encoder writes the bracket DSL and the "\b" null sentinel itself.
import { encodeQuery, type QueryParams } from "@omelhorsite/sdk";

const BASE = process.env.OMS_API_URL ?? "https://backend.omelhorsite.pt";
const EMAIL = process.env.OMS_EMAIL;
const PASSWORD = process.env.OMS_PASSWORD;

const fail = (message: string): never => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
  throw new Error(message);
};

const get = async (path: string, params: QueryParams, token: string) => {
  const query = encodeQuery(params);
  const response = await fetch(`${BASE}${path}?${query}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "oms-music-smoke/1.0" },
  });
  return response;
};

const main = async () => {
  if (!EMAIL || !PASSWORD) {
    fail("Set OMS_EMAIL and OMS_PASSWORD to run the smoke.");
    return;
  }

  // 1. Login
  const loginResponse = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "oms-music-smoke/1.0" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (loginResponse.status !== 201) fail(`login: expected 201, got ${loginResponse.status}`);
  const session = (await loginResponse.json()) as { token: string; user_id: string };
  console.log("ok: login");

  // 2. /sessions/mine
  const mine = await fetch(`${BASE}/sessions/mine`, {
    headers: { Authorization: `Bearer ${session.token}`, "User-Agent": "oms-music-smoke/1.0" },
  });
  if (mine.status !== 200) fail(`sessions/mine: expected 200, got ${mine.status}`);
  console.log("ok: sessions/mine");

  // 3. Songs page 1:5
  const songsResponse = await get("/songs", { modifiers: { page: "1:5" } }, session.token);
  if (songsResponse.status !== 200) fail(`songs: expected 200, got ${songsResponse.status}`);
  const songs = (await songsResponse.json()) as { id: number; album: string | null }[];
  if (!Array.isArray(songs) || songs.length > 5) fail("songs: bad page shape");
  console.log(`ok: songs page (${songs.length} rows)`);

  // 4. Null-album sentinel
  const nullAlbumResponse = await get(
    "/songs",
    { exact_search: { album: null }, modifiers: { page: "1:100" } },
    session.token,
  );
  if (nullAlbumResponse.status !== 200) {
    fail(`null-album: expected 200, got ${nullAlbumResponse.status}`);
  }
  const nullAlbum = (await nullAlbumResponse.json()) as { album: string | null }[];
  const offenders = nullAlbum.filter((s) => s.album !== null);
  if (offenders.length > 0) fail(`null-album: ${offenders.length} rows with a non-null album`);
  console.log(`ok: exact_search[album]="\\b" (${nullAlbum.length} null-album rows)`);

  // 5. Garbage token 401s (single probe; the app-side guard parks on this)
  const garbage = await fetch(`${BASE}/sessions/mine`, {
    headers: { Authorization: "Bearer garbage-token", "User-Agent": "oms-music-smoke/1.0" },
  });
  if (garbage.status !== 401) fail(`garbage token: expected 401, got ${garbage.status}`);
  console.log("ok: garbage token 401");

  // 6. Logout (kills the smoke session)
  await fetch(`${BASE}/sessions/current`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.token}`, "User-Agent": "oms-music-smoke/1.0" },
  });
  console.log("ok: logout. Smoke green.");
};

void main();
