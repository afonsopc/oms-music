import { describe, expect, it } from "bun:test";
import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  flatten,
  ON_DARK,
  onColor,
  parseColor,
  preferredOn,
  withAlpha,
} from "../contrast";
import { heroAccentVariants, songAccentVariants } from "../accentMath";
import { playerGradient } from "../gradients";
import {
  navigationColorsFor,
  resolveScheme,
  statusInkFor,
  type StatusInk,
  type ThemeMode,
} from "../scheme";
import {
  darkTokens,
  EMERALD_BADGE,
  lightTokens,
  LIKED_ACCENT,
  LIKED_GRADIENT,
  MIX_KIND_GRADIENTS,
  MUSIC_ACCENT,
  RADIO_KIND_GRADIENTS,
  SPOTLIGHT_GRADIENT,
  tokensFor,
  type ResolvedScheme,
} from "../tokens";

const SCHEMES: readonly ResolvedScheme[] = ["light", "dark"];

describe("resolveScheme", () => {
  it("lets an explicit mode override the device", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });

  it("follows the device in system mode, in BOTH directions", () => {
    // The regression: flipping the device theme while the app is open has to
    // move the resolved scheme, not just the first read at boot.
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
  });

  it("treats an absent or unspecified system scheme as light", () => {
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", undefined)).toBe("light");
    // react-native's ColorSchemeName includes "unspecified".
    expect(resolveScheme("system", "unspecified")).toBe("light");
  });

  it("is total over every mode / device pair", () => {
    const modes: readonly ThemeMode[] = ["light", "dark", "system"];
    for (const mode of modes) {
      for (const system of ["light", "dark", "unspecified", null, undefined] as const) {
        expect(SCHEMES).toContain(resolveScheme(mode, system));
      }
    }
  });
});

describe("tokensFor", () => {
  it("resolves each scheme to its own palette", () => {
    expect(tokensFor("light")).toBe(lightTokens);
    expect(tokensFor("dark")).toBe(darkTokens);
  });

  it("gives the two schemes opposite polarity", () => {
    // Light backgrounds want dark ink and vice versa. If this ever flips, the
    // "light page in dark mode" bug is back.
    expect(onColor(lightTokens.background)).not.toBe(ON_DARK);
    expect(onColor(darkTokens.background)).toBe(ON_DARK);
  });
});

describe("navigationColorsFor", () => {
  it("takes its background from the scheme's tokens", () => {
    // react-navigation paints every screen container that does not set its own
    // contentStyle with theme.colors.background. Leaving it on the library
    // default (rgb(242, 242, 242), always light) is what put dark-palette text
    // on a light card.
    for (const scheme of SCHEMES) {
      const colors = navigationColorsFor(scheme);
      expect(colors.background).toBe(tokensFor(scheme).background);
      expect(colors.card).toBe(tokensFor(scheme).card);
      expect(colors.text).toBe(tokensFor(scheme).foreground);
    }
  });

  it("never leaves a scheme on the other scheme's background", () => {
    expect(navigationColorsFor("dark").background).not.toBe(
      navigationColorsFor("light").background,
    );
    expect(contrastRatio("rgb(242, 242, 242)", navigationColorsFor("dark").background))
      .toBeGreaterThan(AA_NORMAL);
  });
});

describe("token text pairs on their real backgrounds", () => {
  it("keeps body text at AA in both schemes", () => {
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      const pairs: readonly (readonly [string, string, string, number])[] = [
        ["foreground on background", t.foreground, t.background, AA_NORMAL],
        ["cardForeground on card", t.cardForeground, t.card, AA_NORMAL],
        ["popoverForeground on popover", t.popoverForeground, t.popover, AA_NORMAL],
        ["primaryForeground on primary", t.primaryForeground, t.primary, AA_NORMAL],
        ["secondaryForeground on secondary", t.secondaryForeground, t.secondary, AA_NORMAL],
        ["accentForeground on accent", t.accentForeground, t.accent, AA_NORMAL],
        // The song row's artists line, and every meta/caption in the kit.
        ["mutedForeground on background", t.mutedForeground, t.background, AA_NORMAL],
        ["mutedForeground on card", t.mutedForeground, t.card, AA_NORMAL],
        // The two pairs the ported palette does NOT clear at AA, pinned at the
        // non-text bar rather than silently skipped. Both come straight from
        // the web globals.css (tokens.ts ports it verbatim), both fail only in
        // the light scheme, and both are chip/button fills rather than reading
        // surfaces: light `destructive` is red-500 (white on it is ~3.6:1),
        // and `mutedForeground` on `muted` is ~3.9:1 - shadcn's own pairing is
        // no better. Pinned here to catch them getting WORSE; moving them is a
        // palette decision, not a bug fix.
        ["mutedForeground on muted", t.mutedForeground, t.muted, AA_LARGE],
        ["destructiveForeground on destructive", t.destructiveForeground, t.destructive, AA_LARGE],
      ];
      for (const [label, fg, bg, minimum] of pairs) {
        const ratio = contrastRatio(fg, bg);
        expect(`${scheme} ${label}: ${ratio.toFixed(2)}`).toBe(
          `${scheme} ${label}: ${Math.max(ratio, minimum).toFixed(2)}`,
        );
      }
    }
  });

  it("makes the status ink readable as BODY TEXT on the page", () => {
    // These three carry error copy at 11-13px, not only glyphs, so the bar is
    // the body-text one on every page-like surface (background, card, popover
    // are one value each in both palettes).
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      const ink = statusInkFor(scheme);
      for (const surface of [t.background, t.card, t.popover]) {
        for (const [label, color] of Object.entries(ink)) {
          const ratio = contrastRatio(color, surface);
          expect(`${scheme} ${label}: ${ratio >= AA_NORMAL}`).toBe(`${scheme} ${label}: true`);
        }
      }
    }
  });

  it("keeps the page ink usable on the other fill surfaces", () => {
    // Chips and rows sit on `secondary`; anything that clears AA on the page
    // has to stay above the non-text bar there too.
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      for (const color of Object.values(statusInkFor(scheme))) {
        expect(contrastRatio(color, t.secondary)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
  });

  it("resolves a second set for the muted track", () => {
    // The progress bar draws its fill on `muted`, where the page ink for
    // `destructive` reaches only ~2.85:1 in dark. The muted set fixes that
    // WITHOUT dragging every other surface darker.
    expect(
      contrastRatio(statusInkFor("dark").destructive, darkTokens.muted),
    ).toBeLessThan(AA_LARGE);
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      for (const color of Object.values(statusInkFor(scheme, "muted"))) {
        expect(contrastRatio(color, t.muted)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
    // "page" is the default, and the two sets are resolved independently.
    expect(statusInkFor("dark")).toEqual(statusInkFor("dark", "page"));
  });

  it("guards the three fill-token-as-ink regressions", () => {
    // Each raw token, used directly as ink, is below the bar on the surface
    // the app actually draws it on; each ink variant clears it.
    const regressions: readonly (readonly [string, string, ResolvedScheme, keyof StatusInk])[] = [
      // Dark `destructive` is a button background: ~2:1 on the page.
      [darkTokens.destructive, darkTokens.background, "dark", "destructive"],
      // Light `destructive` is red-500: 3.76:1, under AA for body copy.
      [lightTokens.destructive, lightTokens.background, "light", "destructive"],
      // The Spotify-sync emerald-500 marker: ~2.5:1 on the light page.
      [EMERALD_BADGE, lightTokens.background, "light", "sync"],
    ];
    for (const [raw, surface, scheme, key] of regressions) {
      expect(contrastRatio(raw, surface)).toBeLessThan(AA_NORMAL);
      expect(contrastRatio(statusInkFor(scheme)[key], surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it("leaves a status color alone when it already reads", () => {
    // ensureContrast must be a nudge, not a repaint: light `success` already
    // clears the bar on white, so it comes back untouched - and so does the
    // emerald marker on the dark page, where it was never the problem.
    expect(statusInkFor("light").success).toBe(lightTokens.success);
    expect(statusInkFor("dark").sync).toBe(EMERALD_BADGE);
  });

  it("keeps the ink recognisably the color it started as", () => {
    // The nudge mixes toward white or black, so the hue survives: the sync
    // ink stays greener than it is red or blue, whatever the scheme.
    for (const scheme of SCHEMES) {
      const sync = parseColor(statusInkFor(scheme).sync);
      expect(sync).not.toBeNull();
      expect(sync!.g).toBeGreaterThan(sync!.r);
      expect(sync!.g).toBeGreaterThan(sync!.b);
      const destructive = parseColor(statusInkFor(scheme).destructive);
      expect(destructive).not.toBeNull();
      expect(destructive!.r).toBeGreaterThan(destructive!.g);
      expect(destructive!.r).toBeGreaterThan(destructive!.b);
    }
  });

  it("makes the song-row TITLE dominate its artists line", () => {
    // The reported inversion: pale titles over darker artist names. Whatever
    // the palette, the title token must out-contrast the secondary one.
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      const title = contrastRatio(t.foreground, t.background);
      const artists = contrastRatio(t.mutedForeground, t.background);
      expect(title).toBeGreaterThan(artists);
      // ...and the "current row" title must not quietly drop below a plain one.
      expect(contrastRatio(t.primary, t.background)).toBeGreaterThan(artists);
    }
  });

  it("keeps the translucent washes readable under text", () => {
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      // A pressed / highlighted song row is a foreground wash over the page
      // background, so the wash has to be flattened onto the REAL base before
      // it can be measured - not onto white.
      const highlighted = flatten(withAlpha(t.foreground, 0.12), t.background);
      const pressed = flatten(withAlpha(t.foreground, 0.05), t.background);
      for (const surface of [highlighted, pressed]) {
        expect(contrastRatio(t.foreground, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrastRatio(t.mutedForeground, surface)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
  });
});

describe("identity colors carry a readable ink in both schemes", () => {
  const identitySurfaces: readonly (readonly [string, string])[] = [
    ["music section accent", MUSIC_ACCENT],
    ["liked gradient mid", LIKED_GRADIENT[1]],
    ["spotlight gradient mid", SPOTLIGHT_GRADIENT[1]],
    ...Object.entries(MIX_KIND_GRADIENTS).map(
      ([kind, g]) => [`mix ${kind}`, g.colors[1]] as const,
    ),
    ...Object.entries(RADIO_KIND_GRADIENTS).map(
      ([kind, g]) => [`radio ${kind}`, g.colors[1]] as const,
    ),
  ];

  // This used to assert white ink everywhere, which held only while the
  // identity colors were deep purples. The brand is orange (#ff7a00): white on
  // it is about 2.6:1, so demanding white would be demanding an unreadable
  // label. What must hold is that the ink CLEARS the bar, whichever side of
  // the surface it lands on.
  it("keeps a readable display ink on every identity gradient", () => {
    for (const [label, surface] of identitySurfaces) {
      const ink = preferredOn(surface, ON_DARK, AA_LARGE);
      expect(`${label}: ${contrastRatio(ink, surface) >= AA_LARGE}`).toBe(`${label}: true`);
    }
  });

  it("resolves the same ink whichever scheme is active", () => {
    // Identity surfaces do not change with the theme, so neither may their
    // ink: a token-derived text color here is exactly the bug being fixed.
    for (const [, surface] of identitySurfaces) {
      expect(contrastRatio(onColor(surface), surface)).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });
});

describe("text over artwork-derived gradients", () => {
  // The hero metadata line sits on the hero accent, which is whatever the
  // artwork averages to. Sweeping the whole grey axis covers the worst cases
  // (a black cover in light mode, a white cover in dark mode) plus the mid
  // tones where no ink can win by much.
  const samples: string[] = [];
  for (let v = 0; v <= 255; v += 15) {
    samples.push(`#${v.toString(16).padStart(2, "0").repeat(3)}`);
  }
  samples.push("#7e22ce", "#ea580c", "#0d9488", "#fde68a", "#1a1a2e");

  it("gives the hero ink the best available contrast on any accent", () => {
    for (const scheme of SCHEMES) {
      for (const average of samples) {
        const accent = heroAccentVariants(average)[scheme];
        const ink = onColor(accent);
        expect(contrastRatio(ink, accent)).toBeGreaterThanOrEqual(AA_LARGE);
        // Never worse than the alternative: this is the choice the Hero makes.
        const alternative = ink === ON_DARK ? "#09090b" : ON_DARK;
        expect(contrastRatio(ink, accent)).toBeGreaterThanOrEqual(
          contrastRatio(alternative, accent),
        );
      }
    }
  });

  it("holds up for the player gradient accents too", () => {
    for (const scheme of SCHEMES) {
      for (const average of samples) {
        const accent = songAccentVariants(average)[scheme];
        expect(contrastRatio(onColor(accent), accent)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
  });

  it("keeps the TOKEN text readable on the real player backdrop", () => {
    // The now-playing screen does not paint the raw accent: it paints the
    // accent mixed toward the scheme's extreme (gradients.ts), and then draws
    // the plain token text on it. That mix is what has to be measured - it is
    // the surface the title and the time labels actually sit on.
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      for (const average of samples) {
        const accent = songAccentVariants(average)[scheme];
        for (const stop of playerGradient(accent, scheme)) {
          expect(contrastRatio(t.foreground, stop)).toBeGreaterThanOrEqual(AA_NORMAL);
          expect(contrastRatio(t.mutedForeground, stop)).toBeGreaterThanOrEqual(AA_LARGE);
        }
      }
    }
  });

  it("keeps the hero meta ink readable while the accent is still on top", () => {
    // The non-artist hero fades its accent to transparent over the page and
    // the text block sits low in that fade; 0.6 is a generous bound on how
    // much accent is left under it. The fixed identity accents (liked, the
    // music section) ride the same gradient, so they are swept too.
    const accentsFor = (scheme: ResolvedScheme): string[] => [
      ...samples.map((average) => heroAccentVariants(average)[scheme]),
      LIKED_ACCENT,
      MUSIC_ACCENT,
    ];
    let worstMuted = Number.POSITIVE_INFINITY;
    for (const scheme of SCHEMES) {
      const t = tokensFor(scheme);
      // The two alphas ui/Hero.tsx bakes into its kind label and meta line.
      const kindInk = withAlpha(t.foreground, 0.88);
      const metaInk = withAlpha(t.foreground, 0.92);
      for (const accent of accentsFor(scheme)) {
        for (const alpha of [0.3, 0.45, 0.6]) {
          const surface = flatten(withAlpha(accent, alpha), t.background);
          expect(contrastRatio(t.foreground, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
          expect(contrastRatio(kindInk, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
          expect(contrastRatio(metaInk, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
          worstMuted = Math.min(worstMuted, contrastRatio(t.mutedForeground, surface));
        }
      }
    }
    // And the reason the Hero derives its meta ink from `foreground` instead
    // of reaching for `mutedForeground`: on the accent, muted disappears.
    expect(worstMuted).toBeLessThan(AA_LARGE);
  });
});
