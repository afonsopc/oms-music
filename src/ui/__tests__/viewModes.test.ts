/**
 * View-mode vocabulary guards (plan 4.3/4.5): persisted mode strings come
 * back from kv unvalidated, so the guards are the only thing between an
 * old build's enum spelling and a crash-shaped surprise on first render.
 */
import { describe, expect, it } from "bun:test";
import {
  COLLECTION_VIEW_MODES,
  DEFAULT_COLLECTION_VIEW_MODE,
  DEFAULT_LIBRARY_VIEW_MODE,
  isCollectionViewMode,
  isLibraryViewMode,
  LIBRARY_VIEW_MODES,
} from "../viewModes";

describe("collection view modes", () => {
  it("a collection is a list or a compact list, never a grid", () => {
    expect([...COLLECTION_VIEW_MODES]).toEqual(["list", "compact"]);
    expect(isCollectionViewMode("list")).toBe(true);
    expect(isCollectionViewMode("compact")).toBe(true);
    expect(isCollectionViewMode("grid")).toBe(false);
    expect(isCollectionViewMode(null)).toBe(false);
  });

  it("defaults to the full list", () => {
    expect(DEFAULT_COLLECTION_VIEW_MODE).toBe("list");
  });
});

describe("library view modes", () => {
  it("the library additionally earns the grid", () => {
    expect([...LIBRARY_VIEW_MODES]).toEqual(["list", "compact", "grid"]);
    expect(isLibraryViewMode("grid")).toBe(true);
    expect(isLibraryViewMode("tiles")).toBe(false);
    expect(isLibraryViewMode(undefined)).toBe(false);
  });

  it("defaults to the full list", () => {
    expect(DEFAULT_LIBRARY_VIEW_MODE).toBe("list");
  });
});
