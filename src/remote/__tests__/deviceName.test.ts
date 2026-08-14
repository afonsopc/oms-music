/**
 * Device label derivation (remote/deviceName.ts): the registry rows must
 * read like a person names the device - model on native, browser + OS in
 * PT-PT on web - never the old "Apple iOS 18.7" soup.
 */
import { describe, expect, test } from "bun:test";
import {
  browserFromUserAgent,
  deviceRegistrationLabel,
  osPlacePt,
} from "../deviceName";

const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_UBUNTU =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

describe("browserFromUserAgent", () => {
  test("Chrome carries Safari/ in its UA and must still be Chrome", () => {
    expect(browserFromUserAgent(CHROME_LINUX)).toBe("Chrome");
  });

  test("Edge carries Chrome/ in its UA and must still be Edge", () => {
    expect(browserFromUserAgent(EDGE_WINDOWS)).toBe("Edge");
  });

  test("plain Safari and Firefox resolve", () => {
    expect(browserFromUserAgent(SAFARI_MAC)).toBe("Safari");
    expect(browserFromUserAgent(FIREFOX_UBUNTU)).toBe("Firefox");
  });

  test("a UA with no known browser token gives null", () => {
    expect(browserFromUserAgent("curl/8.6.0")).toBeNull();
  });
});

describe("osPlacePt", () => {
  test("iPhone/iPad in the UA beat the generic OS name", () => {
    expect(osPlacePt("iOS", SAFARI_IPHONE)).toBe("num iPhone");
    expect(osPlacePt("iOS", SAFARI_IPHONE.replace(/iPhone/g, "iPad"))).toBe("num iPad");
  });

  test("desktop families map to their PT-PT place", () => {
    expect(osPlacePt("Linux", CHROME_LINUX)).toBe("em Linux");
    expect(osPlacePt("Ubuntu", FIREFOX_UBUNTU)).toBe("em Linux");
    expect(osPlacePt("Mac OS", SAFARI_MAC)).toBe("num Mac");
    expect(osPlacePt("Windows", EDGE_WINDOWS)).toBe("no Windows");
    expect(osPlacePt("Chromium OS", "")).toBe("num Chromebook");
    expect(osPlacePt("Android", "")).toBe("em Android");
  });

  test("unknown or missing OS gives null", () => {
    expect(osPlacePt(null, "")).toBeNull();
    expect(osPlacePt("BeOS", "")).toBeNull();
  });
});

describe("deviceRegistrationLabel", () => {
  test("web: browser + OS in PT-PT (the owner's examples)", () => {
    expect(
      deviceRegistrationLabel({ web: true, osName: "Linux", userAgent: CHROME_LINUX }),
    ).toBe("Chrome em Linux");
    expect(
      deviceRegistrationLabel({ web: true, osName: "Mac OS", userAgent: SAFARI_MAC }),
    ).toBe("Safari num Mac");
  });

  test("web: browser alone when the OS is unknown", () => {
    expect(
      deviceRegistrationLabel({ web: true, osName: null, userAgent: FIREFOX_UBUNTU }),
    ).toBe("Firefox");
  });

  test("web: OS name, then the app name, when nothing parses", () => {
    expect(
      deviceRegistrationLabel({ web: true, osName: "BeOS", userAgent: "curl/8.6.0" }),
    ).toBe("BeOS");
    expect(deviceRegistrationLabel({ web: true, userAgent: "" })).toBe("oms-music");
  });

  test("native: the model wins over everything else", () => {
    expect(
      deviceRegistrationLabel({
        web: false,
        modelName: "iPhone 15",
        deviceName: "iPhone",
        osName: "iOS",
      }),
    ).toBe("iPhone 15");
  });

  test("native: deviceName then osName back the model up", () => {
    expect(
      deviceRegistrationLabel({ web: false, deviceName: "Pixel de Afonso", osName: "Android" }),
    ).toBe("Pixel de Afonso");
    expect(deviceRegistrationLabel({ web: false, osName: "Android" })).toBe("Android");
    expect(deviceRegistrationLabel({ web: false })).toBe("oms-music");
  });
});
