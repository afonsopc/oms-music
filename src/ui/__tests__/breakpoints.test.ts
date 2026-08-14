/**
 * The one breakpoints module (plano-uma-so-app 4.2). Two invariants under
 * test: the plan's tokens are exactly the documented values (a drive-by
 * "tidy" of 765 to 768 would silently reshuffle every desktop table), and
 * the frozen mobile ladders still produce the exact columns the shipped
 * mobile UI produces - the sacred below-900px freeze, expressed as numbers.
 */
import { describe, expect, it } from "bun:test";
import {
  BREAKPOINTS,
  collectionGridColumns,
  heroMinHeight,
  heroTitleType,
  isDesktopShellWidth,
  isRightPanelWidth,
  mainBucket,
  MOBILE_SONG_TABLE_DURATION_WIDTH,
  MOBILE_SONG_TABLE_WIDE,
  songTableColumnGate,
  songTableDurationWidth,
  topTileGridColumns,
} from "../breakpoints";

describe("BREAKPOINTS tokens", () => {
  it("carries the plan's exact values", () => {
    expect(BREAKPOINTS.shellDesktop).toBe(900);
    expect(BREAKPOINTS.rightPanel).toBe(1200);
    expect(BREAKPOINTS.mainMd).toBe(600);
    expect(BREAKPOINTS.mainLg).toBe(765);
    expect(BREAKPOINTS.mainXl).toBe(1116);
    expect(BREAKPOINTS.contentMax).toBe(1600);
  });

  it("gates the shells at the window tokens, inclusive at the edge", () => {
    expect(isDesktopShellWidth(899)).toBe(false);
    expect(isDesktopShellWidth(900)).toBe(true);
    expect(isRightPanelWidth(1199)).toBe(false);
    expect(isRightPanelWidth(1200)).toBe(true);
  });
});

describe("mainBucket", () => {
  it("maps container widths to the sm/md/lg/xl staircase", () => {
    expect(mainBucket(599)).toBe("sm");
    expect(mainBucket(600)).toBe("md");
    expect(mainBucket(764)).toBe("md");
    expect(mainBucket(765)).toBe("lg");
    expect(mainBucket(1115)).toBe("lg");
    expect(mainBucket(1116)).toBe("xl");
  });
});

describe("frozen mobile grid ladders", () => {
  it("topTileGridColumns keeps the shipped phone/tablet columns", () => {
    expect(topTileGridColumns(375)).toBe(2);
    expect(topTileGridColumns(1023)).toBe(2);
    expect(topTileGridColumns(1024)).toBe(3);
    expect(topTileGridColumns(1279)).toBe(3);
    expect(topTileGridColumns(1280)).toBe(4);
  });

  it("collectionGridColumns keeps the shipped roster/discography columns", () => {
    expect(collectionGridColumns(375)).toBe(2);
    expect(collectionGridColumns(519)).toBe(2);
    expect(collectionGridColumns(520)).toBe(3);
    expect(collectionGridColumns(767)).toBe(3);
    expect(collectionGridColumns(768)).toBe(4);
    expect(collectionGridColumns(1023)).toBe(4);
    expect(collectionGridColumns(1024)).toBe(5);
  });
});

describe("songTableColumnGate", () => {
  it("mobile shell: album and addedAt drop together at the frozen 768", () => {
    expect(MOBILE_SONG_TABLE_WIDE).toBe(768);
    expect(songTableColumnGate(767, false)).toEqual({ album: false, addedAt: false });
    expect(songTableColumnGate(768, false)).toEqual({ album: true, addedAt: true });
  });

  it("desktop shell: the finer mainMd/mainLg staircase applies", () => {
    expect(songTableColumnGate(599, true)).toEqual({ album: false, addedAt: false });
    expect(songTableColumnGate(600, true)).toEqual({ album: true, addedAt: false });
    expect(songTableColumnGate(764, true)).toEqual({ album: true, addedAt: false });
    expect(songTableColumnGate(765, true)).toEqual({ album: true, addedAt: true });
  });

  it("a mid-size desktop pane shows MORE than the same mobile width, never less", () => {
    // 700px of pane: desktop earns the album column the mobile collapse
    // point still denies - the whole reason the staircase exists.
    expect(songTableColumnGate(700, true).album).toBe(true);
    expect(songTableColumnGate(700, false).album).toBe(false);
  });
});

describe("songTableDurationWidth", () => {
  it("mobile keeps the shipped 44px at every width - the frozen shell", () => {
    expect(MOBILE_SONG_TABLE_DURATION_WIDTH).toBe(44);
    for (const width of [320, 768, 1440, 2560]) {
      expect(songTableDurationWidth(width, false)).toBe(44);
    }
  });

  it("desktop: fixed 120px until mainXl frees the column to flex", () => {
    expect(songTableDurationWidth(599, true)).toBe(120);
    expect(songTableDurationWidth(1115, true)).toBe(120);
    expect(songTableDurationWidth(1116, true)).toBeNull();
  });
});

describe("heroMinHeight (desktop only)", () => {
  it("depends on the container width, clamped at both ends", () => {
    // Narrow pane: the floor binds.
    expect(heroMinHeight(600, false)).toBe(260);
    expect(heroMinHeight(600, true)).toBe(300);
    // Mid pane: proportional.
    expect(heroMinHeight(1100, false)).toBe(308);
    expect(heroMinHeight(1100, true)).toBe(374);
    // Huge pane: the CAP binds - the whole point (a 1440p window must not
    // produce a ~500px band of nothing like height * 0.36 did).
    expect(heroMinHeight(2560, false)).toBe(360);
    expect(heroMinHeight(2560, true)).toBe(440);
  });

  it("never shrinks as the pane grows", () => {
    let previous = 0;
    for (let width = 400; width <= 2600; width += 50) {
      const value = heroMinHeight(width, false);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("heroTitleType (desktop only)", () => {
  it("walks the plan's 96/72/32 ramp by main bucket", () => {
    expect(heroTitleType(599, 10).fontSize).toBe(32);
    expect(heroTitleType(600, 10).fontSize).toBe(72);
    expect(heroTitleType(765, 10).fontSize).toBe(96);
    expect(heroTitleType(1200, 10).fontSize).toBe(96);
  });

  it("long titles step down one rung instead of wrapping at display size", () => {
    const long = "a".repeat(25).length;
    expect(heroTitleType(1200, long).fontSize).toBe(72);
    expect(heroTitleType(700, long).fontSize).toBe(32);
    expect(heroTitleType(500, long).fontSize).toBe(32);
  });

  it("line height rides 4px above the size", () => {
    for (const width of [500, 700, 1200]) {
      const { fontSize, lineHeight } = heroTitleType(width, 10);
      expect(lineHeight).toBe(fontSize + 4);
    }
  });
});
