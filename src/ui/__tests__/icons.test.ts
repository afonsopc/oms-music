/**
 * Icon data URIs must be base64 (WP4 acceptance): Android routes every
 * `data:` uri through Glide, and both data-url loaders in play there decode
 * the post-comma section with `Base64.decode`. A percent-encoded payload
 * throws "bad base-64" and the icon renders as nothing.
 */
import { describe, expect, it } from "bun:test";
import { iconUri, toBase64 } from "../iconSvg";

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
