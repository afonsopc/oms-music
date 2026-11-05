import { describe, expect, it } from "bun:test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { iosBuildNumber, iosBuildNumberProblem } = require("../ios-build-number") as {
  iosBuildNumber: (d?: Date) => string;
  iosBuildNumberProblem: (b: unknown) => string | null;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../../app.config") as () => { expo: { ios?: { buildNumber?: string } } };

describe("build number do iOS (o Google Cast lê-o com 6 dígitos por parte)", () => {
  it("AAMMDD.HHMM sem zeros à esquerda", () => {
    expect(iosBuildNumber(new Date(2026, 10, 5, 8, 12))).toBe("261105.812");
    expect(iosBuildNumber(new Date(2026, 10, 5, 0, 5))).toBe("261105.5");
    expect(iosBuildNumber(new Date(2027, 0, 1, 23, 59))).toBe("270101.2359");
  });

  it("sobe com o tempo (a Apple compara parte a parte)", () => {
    const a = iosBuildNumber(new Date(2026, 10, 5, 23, 59)).split(".").map(Number);
    const b = iosBuildNumber(new Date(2026, 10, 6, 0, 0)).split(".").map(Number);
    expect(b[0]).toBeGreaterThan(a[0]);
  });

  it("o que se gera serve sempre", () => {
    expect(iosBuildNumberProblem(iosBuildNumber())).toBeNull();
    expect(iosBuildNumberProblem("2")).toBeNull();
  });

  it("recusa o antigo AAAAMMDDHHMM (o que fazia a 2.1.0 e a 2.1.1 abortar)", () => {
    expect(iosBuildNumberProblem("202611050730")).toContain("Google Cast");
    expect(iosBuildNumberProblem("1.2.3.4")).not.toBeNull();
    expect(iosBuildNumberProblem("")).not.toBeNull();
  });

  it("o app.config.js pára o prebuild com um build que aborta", () => {
    const old = process.env.OMS_IOS_BUILD_NUMBER;
    try {
      process.env.OMS_IOS_BUILD_NUMBER = "202611050730";
      expect(() => appConfig()).toThrow("Google Cast");
      process.env.OMS_IOS_BUILD_NUMBER = "261105.812";
      expect(appConfig().expo.ios?.buildNumber).toBe("261105.812");
    } finally {
      if (old === undefined) delete process.env.OMS_IOS_BUILD_NUMBER;
      else process.env.OMS_IOS_BUILD_NUMBER = old;
    }
  });
});
