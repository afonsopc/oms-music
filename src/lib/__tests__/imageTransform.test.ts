import { describe, expect, it } from "bun:test";
import {
  centeredSquareRect,
  encodePlan,
  jpegName,
  JPEG_QUALITIES,
  MIN_ENCODE_EDGE,
  scaleToFit,
} from "../imageTransform";

describe("centeredSquareRect", () => {
  it("centers on the shorter side for a landscape image", () => {
    expect(centeredSquareRect(4000, 3000)).toEqual({
      originX: 500,
      originY: 0,
      width: 3000,
      height: 3000,
    });
  });

  it("centers on the shorter side for a portrait image", () => {
    expect(centeredSquareRect(3024, 4032)).toEqual({
      originX: 0,
      originY: 504,
      width: 3024,
      height: 3024,
    });
  });

  it("returns null when the image is already square", () => {
    expect(centeredSquareRect(1000, 1000)).toBeNull();
  });

  it("floors odd leftovers so the rect stays inside the image", () => {
    const rect = centeredSquareRect(101, 100);
    expect(rect).toEqual({ originX: 0, originY: 0, width: 100, height: 100 });
    expect(rect!.originX + rect!.width <= 101).toBe(true);
  });

  it("rejects unusable dimensions", () => {
    expect(centeredSquareRect(0, 500)).toBeNull();
    expect(centeredSquareRect(-10, 10)).toBeNull();
    expect(centeredSquareRect(Number.NaN, 10)).toBeNull();
  });
});

describe("scaleToFit", () => {
  it("returns null when the image already fits", () => {
    expect(scaleToFit(800, 800, 1200)).toBeNull();
    expect(scaleToFit(1200, 900, 1200)).toBeNull();
  });

  it("scales the longest side down to the ceiling", () => {
    expect(scaleToFit(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(scaleToFit(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
  });

  it("keeps squares square", () => {
    expect(scaleToFit(3024, 3024, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it("never collapses a very thin image to zero", () => {
    expect(scaleToFit(10000, 3, 1200)).toEqual({ width: 1200, height: 1 });
  });

  it("rejects unusable inputs", () => {
    expect(scaleToFit(100, 100, 0)).toBeNull();
    expect(scaleToFit(0, 100, 500)).toBeNull();
  });
});

describe("encodePlan", () => {
  it("walks strictly smaller edges, best quality first", () => {
    const plan = encodePlan(1200);
    expect(plan.map((stage) => stage.edge)).toEqual([1200, 800, 480]);
    for (const stage of plan) {
      expect(stage.qualities).toEqual([...JPEG_QUALITIES]);
      expect(stage.qualities[0]).toBeGreaterThan(stage.qualities[stage.qualities.length - 1]!);
    }
  });

  it("collapses duplicate edges once the floor is reached", () => {
    const plan = encodePlan(MIN_ENCODE_EDGE);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.edge).toBe(MIN_ENCODE_EDGE);
  });

  it("never plans an edge below the floor", () => {
    for (const stage of encodePlan(400)) {
      expect(stage.edge >= MIN_ENCODE_EDGE).toBe(true);
    }
  });

  it("falls back to the floor for nonsense ceilings", () => {
    expect(encodePlan(0)).toEqual([{ edge: MIN_ENCODE_EDGE, qualities: [...JPEG_QUALITIES] }]);
    expect(encodePlan(Number.NaN)).toEqual([
      { edge: MIN_ENCODE_EDGE, qualities: [...JPEG_QUALITIES] },
    ]);
  });
});

describe("jpegName", () => {
  it("swaps the extension for .jpg", () => {
    expect(jpegName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegName("cover.png")).toBe("cover.jpg");
  });

  it("appends .jpg when there is no extension", () => {
    expect(jpegName("cover")).toBe("cover.jpg");
  });

  it("drops directory parts from content:// style names", () => {
    expect(jpegName("DCIM/Camera/shot.png")).toBe("shot.jpg");
    expect(jpegName("C:\\pics\\shot.png")).toBe("shot.jpg");
  });

  it("falls back when the name is empty or all extension", () => {
    expect(jpegName("")).toBe("artwork.jpg");
    expect(jpegName("   ")).toBe("artwork.jpg");
    expect(jpegName(".png")).toBe("artwork.jpg");
    expect(jpegName("", "cover.jpg")).toBe("cover.jpg");
  });
});
