/**
 * Icon data URIs must be base64 (WP4 acceptance): Android routes every
 * `data:` uri through Glide, and both data-url loaders in play there decode
 * the post-comma section with `Base64.decode`. A percent-encoded payload
 * throws "bad base-64" and the icon renders as nothing.
 */
import { describe, expect, it } from "bun:test";
import { iconUri, progressRingUri, ringStep, toBase64 } from "../iconSvg";

/** base64 -> the original string, going through the raw bytes. */
const fromBase64 = (b64: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe("toBase64", () => {
  it("matches the platform encoder, padding cases included", () => {
    for (const sample of ["", "a", "ab", "abc", "abcd", '<svg fill="none"/>']) {
      expect(toBase64(sample)).toBe(btoa(sample));
    }
  });

  it("encodes multi-byte characters as utf-8", () => {
    expect(fromBase64(toBase64("cancao maca"))).toBe("cancao maca");
    expect(fromBase64(toBase64("canção maçã"))).toBe("canção maçã");
  });
});

describe("iconUri", () => {
  it("emits a base64 svg data uri, never a percent-encoded one", () => {
    const uri = iconUri("play", "#ff0000");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(uri.includes("%")).toBe(false);
    expect(uri.includes("<")).toBe(false);
  });

  it("round-trips to the svg with the color baked in", () => {
    const svg = fromBase64(iconUri("heart", "#00ff00", true).split(",")[1]!);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.includes('fill="#00ff00"')).toBe(true);
    expect(svg.includes('stroke="#00ff00"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("caches per (name, color, filled)", () => {
    expect(iconUri("cast", "#123456")).toBe(iconUri("cast", "#123456"));
    expect(iconUri("cast", "#123456")).not.toBe(iconUri("cast", "#654321"));
    expect(iconUri("heart", "#123456", true)).not.toBe(iconUri("heart", "#123456", false));
  });
});

describe("progressRingUri (download ring)", () => {
  const svgOf = (uri: string): string => fromBase64(uri.slice(uri.indexOf(",") + 1));

  it("quantizes progress to 5% steps and clamps junk", () => {
    expect(ringStep(0)).toBe(0);
    expect(ringStep(-1)).toBe(0);
    expect(ringStep(Number.NaN)).toBe(0);
    expect(ringStep(0.51)).toBe(10);
    expect(ringStep(0.99)).toBe(20);
    expect(ringStep(1.5)).toBe(20);
  });

  it("is a base64 data URI, cached per step and colour", () => {
    const a = progressRingUri(0.5, "#171717");
    expect(a.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(progressRingUri(0.51, "#171717")).toBe(a);
    expect(progressRingUri(0.75, "#171717")).not.toBe(a);
    expect(progressRingUri(0.5, "#fafafa")).not.toBe(a);
  });

  it("draws a faint track plus an arc, a full circle at 100%", () => {
    const half = svgOf(progressRingUri(0.5, "#171717"));
    expect(half).toContain('stroke-opacity="0.25"');
    expect(half).toContain("<path");
    // Half way round from 12 o'clock ends at 6 o'clock.
    expect(half).toContain("12.00 21.00");
    const full = svgOf(progressRingUri(1, "#171717"));
    expect(full).not.toContain("<path");
    expect(full.match(/<circle/g)?.length).toBe(2);
    // Started with no bytes yet still shows a stub, not an empty ring.
    expect(svgOf(progressRingUri(0, "#171717"))).toContain("<path");
  });
});
