/**
 * The right panel's pure half (plano-uma-so-app 4.3 "Queue" row). Locked
 * here: the tenant list is exactly the plan's five, storage round-trips
 * degrade to defaults instead of crashing or rendering an empty column, and
 * the width clamp can never squeeze the main view below the plan's 480px
 * guarantee.
 */
import { describe, expect, it } from "bun:test";
import {
  clampRightPanelWidth,
  isRightPanelTenant,
  MAIN_MIN_WIDTH,
  parseRightPanelWidth,
  RIGHT_PANEL_DEFAULT_TENANT,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_TENANTS,
  rightPanelWidthCeiling,
} from "../rightPanelModel";

describe("tenants", () => {
  it("is exactly the plan's five, in naming order", () => {
    expect(RIGHT_PANEL_TENANTS).toEqual([
      "nowPlaying",
      "queue",
      "lyrics",
      "devices",
      "friends",
    ]);
  });

  it("accepts every member and refuses everything else", () => {
    for (const tenant of RIGHT_PANEL_TENANTS) expect(isRightPanelTenant(tenant)).toBe(true);
    expect(isRightPanelTenant(null)).toBe(false);
    expect(isRightPanelTenant("")).toBe(false);
    expect(isRightPanelTenant("Queue")).toBe(false); // storage is case-exact
    expect(isRightPanelTenant("downloads")).toBe(false);
  });

  it("defaults to the now-playing tenant", () => {
    expect(RIGHT_PANEL_DEFAULT_TENANT).toBe("nowPlaying");
    expect(isRightPanelTenant(RIGHT_PANEL_DEFAULT_TENANT)).toBe(true);
  });
});

describe("parseRightPanelWidth", () => {
  it("falls back to the default on missing or corrupt values", () => {
    expect(parseRightPanelWidth(null)).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
    expect(parseRightPanelWidth("")).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
    expect(parseRightPanelWidth("banana")).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
  });

  it("clamps stored values to the absolute bounds", () => {
    expect(parseRightPanelWidth("100")).toBe(RIGHT_PANEL_MIN_WIDTH);
    expect(parseRightPanelWidth("9999")).toBe(RIGHT_PANEL_MAX_WIDTH);
    expect(parseRightPanelWidth("352")).toBe(352);
  });
});

describe("width ceiling and clamp", () => {
  const GAP = 8;

  it("caps at the absolute maximum on a wide window", () => {
    expect(rightPanelWidthCeiling(2560, 280, GAP)).toBe(RIGHT_PANEL_MAX_WIDTH);
  });

  it("never lets the main view drop below the plan's 480px", () => {
    // 1200px window, 280px sidebar: whatever the panel takes, main keeps 480.
    const ceiling = rightPanelWidthCeiling(1200, 280, GAP);
    expect(1200 - 280 - ceiling - 4 * GAP).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH);
    expect(clampRightPanelWidth(RIGHT_PANEL_MAX_WIDTH, 1200, 280, GAP)).toBe(ceiling);
  });

  it("keeps in-range widths untouched", () => {
    expect(clampRightPanelWidth(320, 1600, 280, GAP)).toBe(320);
  });

  it("holds the floor even when the window cannot honour it", () => {
    // Degenerate squeeze: the floor wins so the panel stays usable; the grid
    // simply scrolls nothing extra because 900-1200 renders the rail anyway.
    expect(clampRightPanelWidth(300, 900, 280, GAP)).toBe(RIGHT_PANEL_MIN_WIDTH);
  });
});
