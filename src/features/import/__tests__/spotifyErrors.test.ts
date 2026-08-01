import { describe, expect, it } from "bun:test";
import { classifySpotifyError, SPOTIFY_ISSUE_KEYS } from "../spotifyErrors";

const apiError = (status: number, body: string) => ({ status, body, message: body });

describe("Spotify error classification (FR-104)", () => {
  it("maps the connect refusal", () => {
    const issue = classifySpotifyError(apiError(400, "Connect Spotify first."));
    expect(issue?.kind).toBe("connect");
  });

  it("maps the relink refusal", () => {
    const issue = classifySpotifyError(apiError(400, "Spotify connection needs to be relinked."));
    expect(issue?.kind).toBe("relink");
  });

  it("maps the upstream error text", () => {
    const issue = classifySpotifyError(apiError(502, "Spotify upstream error: 503"));
    expect(issue?.kind).toBe("upstream");
    expect(issue?.raw).toBe("Spotify upstream error: 503");
  });

  it("treats gateway, offline and timeout failures as retryable upstream issues", () => {
    expect(classifySpotifyError(apiError(503, "bad gateway"))?.kind).toBe("upstream");
    expect(classifySpotifyError(apiError(504, ""))?.kind).toBe("upstream");
    expect(classifySpotifyError(apiError(0, "Network error"))?.kind).toBe("upstream");
    expect(classifySpotifyError({ status: 200, message: "request timed out" })?.kind).toBe(
      "upstream",
    );
  });

  it("leaves everything else to the generic error copy", () => {
    expect(classifySpotifyError(apiError(400, "Album not found"))).toBeNull();
    expect(classifySpotifyError(null)).toBeNull();
    expect(classifySpotifyError("boom")).toBeNull();
  });

  it("every kind has a title and description key", () => {
    for (const kind of ["connect", "relink", "upstream"] as const) {
      expect(SPOTIFY_ISSUE_KEYS[kind].title.length).toBeGreaterThan(0);
      expect(SPOTIFY_ISSUE_KEYS[kind].description.length).toBeGreaterThan(0);
    }
  });
});
