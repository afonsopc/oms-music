/**
 * Which cable a channel rides. The music channels (player, jams, friends
 * listening) use the music app's own `/music/cable`, so realtime keeps
 * working while the omelhorsite (Rails) is down; the omelhorsite's `/cable`
 * keeps its own channels (notifications, jobs). Same protocol, same
 * credential. Kept free of imports so it can be tested on its own.
 */
export const MUSIC_CABLE_PATH = "/music/cable";
export const SHARED_CABLE_PATH = "/cable";

export const MUSIC_CHANNELS: ReadonlySet<string> = new Set([
  "PlaybackChannel",
  "JamChannel",
  "FriendListeningChannel",
]);

export const cablePathFor = (channelParams: Record<string, unknown>): string =>
  MUSIC_CHANNELS.has(String(channelParams.channel)) ? MUSIC_CABLE_PATH : SHARED_CABLE_PATH;

// "" is the cookie-auth credential (auth/token.ts#cableCredential): the
// same-site handshake carries the httpOnly session cookie by itself, so no
// ?token= is sent at all - the server tries param, header, then cookie.
export const cableUrl = (apiBaseUrl: string, path: string, token: string): string => {
  const ws = apiBaseUrl.replace(/^http/, "ws");
  if (!token) return `${ws}${path}`;
  return `${ws}${path}?token=${encodeURIComponent(token)}`;
};
