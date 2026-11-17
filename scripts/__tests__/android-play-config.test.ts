import { afterEach, describe, expect, it } from "bun:test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../../app.config") as () => {
  expo: { extra?: { distribution?: string }; android?: { blockedPermissions?: string[] } };
};

const KEY = "OMS_ANDROID_DISTRIBUTION";
afterEach(() => {
  delete process.env[KEY];
});

describe("build da Google Play (STORE=play, docs/android.md)", () => {
  it("o APK do site fica igual: sem extra.distribution nem permissões bloqueadas", () => {
    delete process.env[KEY];
    const { expo } = appConfig();
    expect(expo.extra?.distribution).toBeUndefined();
    expect(expo.android?.blockedPermissions).toBeUndefined();
  });

  it("com OMS_ANDROID_DISTRIBUTION=play: distribution play e nada que instale APKs", () => {
    process.env[KEY] = "play";
    const { expo } = appConfig();
    expect(expo.extra?.distribution).toBe("play");
    expect(expo.android?.blockedPermissions).toContain("android.permission.REQUEST_INSTALL_PACKAGES");
    expect(expo.android?.blockedPermissions).toContain("android.permission.RECORD_AUDIO");
    expect(expo.android?.blockedPermissions).not.toContain("android.permission.INTERNET");
  });
});
