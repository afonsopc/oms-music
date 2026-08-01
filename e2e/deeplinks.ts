/**
 * Scripted FR-20 deep-link pass (WP12 acceptance). Fires every URL of the
 * matrix at a booted simulator/emulator or a connected device and prints the
 * screen each one must land on, so the operator only has to watch.
 *
 *   bun e2e/deeplinks.ts            # print the matrix, open nothing
 *   bun e2e/deeplinks.ts ios        # xcrun simctl openurl booted <url>
 *   bun e2e/deeplinks.ts android    # adb shell am start -a VIEW -d <url>
 *   bun e2e/deeplinks.ts ios 4      # 4 s between links (default 3)
 *
 * The parser itself is unit-tested (src/lib/__tests__/deepLinks.test.ts);
 * this script exercises the OS registration and the router navigation that
 * unit tests cannot reach. iOS only accepts the custom scheme (no AASA, see
 * DESIGN 16.5), so https rows are Android-only there.
 */
import { execFileSync } from "node:child_process";
import { parseDeepLink } from "../src/lib/deepLinks";

interface Case {
  /** What the operator must see after the link opens. */
  expect: string;
  /** omsmusic:// form; always available on both platforms. */
  scheme: string;
  /** Web form; Android intent filter only (unverified https). */
  https?: string;
}

const CASES: Case[] = [
  { expect: "Home (Discover)", scheme: "omsmusic://discover", https: "https://omelhorsite.pt/pt/music/discover" },
  { expect: "Liked songs, purple hero", scheme: "omsmusic://liked", https: "https://omelhorsite.pt/en/music/liked" },
  { expect: "Artists hub", scheme: "omsmusic://artists", https: "https://omelhorsite.pt/lv/music/artists" },
  { expect: "Playlists list", scheme: "omsmusic://playlists", https: "https://omelhorsite.pt/music/playlists" },
  { expect: "Search with the query prefilled", scheme: "omsmusic://search?query=carlos" },
  { expect: "Playlist detail id=1", scheme: "omsmusic://playlist?id=1", https: "https://omelhorsite.pt/pt/music/playlist?id=1" },
  { expect: "Playlists list (bad id falls back)", scheme: "omsmusic://playlist?id=abc" },
  { expect: "Artist screen, slug form", scheme: "omsmusic://artist/carlos-paiao", https: "https://omelhorsite.pt/pt/music/artist/carlos-paiao" },
  { expect: "Artist screen, URL-encoded name", scheme: "omsmusic://artist/Carlos%20Paiao" },
  { expect: "Artists hub (literal null artist)", scheme: "omsmusic://artist/null" },
  { expect: "Album via the /artist/<a>/<al> form", scheme: "omsmusic://artist/carlos-paiao/Play%20Back", https: "https://omelhorsite.pt/pt/music/artist/carlos-paiao/Play%20Back" },
  { expect: "Album via the /album/<a>/<al> form", scheme: "omsmusic://album/carlos-paiao/Play%20Back", https: "https://omelhorsite.pt/en/music/album/carlos-paiao/Play%20Back" },
  { expect: "Unknown album: ONLY null-album songs", scheme: "omsmusic://album/carlos-paiao/null" },
  { expect: "Album with the highlighted song scrolled into view", scheme: "omsmusic://album/carlos-paiao/Play%20Back#Cinderela" },
  { expect: "Mix detail (slug contains a colon)", scheme: "omsmusic://mix?slug=top_artist%3A123" },
  { expect: "Artist radio", scheme: "omsmusic://radio/artist?artist=carlos-paiao" },
  { expect: "Song radio", scheme: "omsmusic://radio/song?id=1" },
  { expect: "Home (radio without params)", scheme: "omsmusic://radio/song" },
  { expect: "Settings > Import", scheme: "omsmusic://settings" },
  { expect: "Settings > Songs", scheme: "omsmusic://settings/songs", https: "https://omelhorsite.pt/pt/music/settings/songs" },
  { expect: "Settings > Downloads", scheme: "omsmusic://settings/downloads" },
];

const open = (platform: "ios" | "android", url: string): void => {
  if (platform === "ios") {
    execFileSync("xcrun", ["simctl", "openurl", "booted", url], { stdio: "inherit" });
    return;
  }
  execFileSync(
    "adb",
    ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url],
    { stdio: "inherit" },
  );
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const platform = process.argv[2];
  const delayMs = Number(process.argv[3] ?? 3) * 1000;
  const run = platform === "ios" || platform === "android";

  for (const testCase of CASES) {
    const urls = [testCase.scheme];
    // The https form only reaches the app through the Android intent filter.
    if (testCase.https && platform === "android") urls.push(testCase.https);

    for (const url of urls) {
      const parsed = parseDeepLink(url);
      console.log(`\n${url}`);
      console.log(`  parser -> ${JSON.stringify(parsed)}`);
      console.log(`  expect -> ${testCase.expect}`);
      if (!run) continue;
      open(platform, url);
      await sleep(delayMs);
    }
  }

  if (!run) {
    console.log(
      "\nNothing was opened. Pass 'ios' or 'android' with a booted device to run the pass.",
    );
  }
};

void main();
