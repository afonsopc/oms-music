/**
 * The gate truth table. Seven inputs, one AND: every row here is a way the
 * user can tell us to stop, and every one of them must actually stop us.
 */
import { describe, expect, it } from "bun:test";
import { prefetchAllowed, type PrefetchGates } from "../gates";

const ALLOWED: PrefetchGates = {
  manualOffline: false,
  online: true,
  wifiOnly: true,
  onWifi: true,
  metered: false,
  sessionBudgetExhausted: false,
  explicitInFlight: 0,
  predictiveEnabled: true,
};

describe("prefetchAllowed", () => {
  it("allows the happy path", () => {
    expect(prefetchAllowed(ALLOWED)).toBe(true);
  });

  const blockers: [string, Partial<PrefetchGates>][] = [
    ["the setting is off", { predictiveEnabled: false }],
    ["there is no network", { online: false }],
    ["GO OFFLINE is on", { manualOffline: true }],
    ["wifiOnly is on and we are not on wifi", { wifiOnly: true, onWifi: false }],
    ["the connection is metered", { metered: true }],
    ["the session waste ceiling is reached", { sessionBudgetExhausted: true }],
    ["an explicit download is in flight", { explicitInFlight: 1 }],
  ];

  for (const [why, patch] of blockers) {
    it(`refuses when ${why}`, () => {
      expect(prefetchAllowed({ ...ALLOWED, ...patch })).toBe(false);
    });
  }

  it("allows off-wifi only when neither wifi switch is on", () => {
    expect(prefetchAllowed({ ...ALLOWED, wifiOnly: false, onWifi: false })).toBe(true);
  });

  it("counts explicit transfers, not just their presence", () => {
    expect(prefetchAllowed({ ...ALLOWED, explicitInFlight: 250 })).toBe(false);
    expect(prefetchAllowed({ ...ALLOWED, explicitInFlight: 0 })).toBe(true);
  });
});
