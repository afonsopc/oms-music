/**
 * A escada de fontes na costura stem/cache (handoff 2026-08-17, candidato 2):
 * num modo de stem sem o ficheiro do stem em disco, o mixed local entra na
 * escada como recurso - ANTES da rede offline (a música "em cache" nunca vai
 * à rede), DEPOIS dela online (o streaming do stem continua a ser o modo).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { setLocalFileIndex, type LocalFileIndex } from "@/contracts/localSource";
import { setOfflineNowProvider } from "@/contracts/offlineFallback";
import type { DownloadKind } from "@/domain/downloads";
import { resolveSources, stemModeResidentLocally } from "../sources";
import { makeSong } from "./fakes";

const inertIndex: LocalFileIndex = { get: () => null, getArtworkByNodeId: () => null };

const indexWith = (byKind: Partial<Record<DownloadKind, string>>): LocalFileIndex => ({
  get: (_songKey, kind) => byKind[kind] ?? null,
  getArtworkByNodeId: () => null,
});

const separated = () =>
  makeSong(1, { vocals_media_id: "vocals-1", instrumental_media_id: "instr-1" });

afterEach(() => {
  setLocalFileIndex(inertIndex);
  setOfflineNowProvider(() => false);
});

describe("resolveSources stem/cache seam", () => {
  it("online, stem not resident: streams the stem first, cached mixed as fallback", () => {
    setLocalFileIndex(indexWith({ mixed: "file:///mixed-1" }));
    const { wantedNodeId, candidates } = resolveSources(separated(), "instrumental");
    expect(wantedNodeId).toBe("instr-1");
    expect(candidates).toEqual([
      { kind: "network", nodeId: "instr-1" },
      { kind: "local", uri: "file:///mixed-1" },
    ]);
  });

  it("offline, stem not resident: the cached mixed wins over the doomed stream", () => {
    setLocalFileIndex(indexWith({ mixed: "file:///mixed-1" }));
    setOfflineNowProvider(() => true);
    const { candidates } = resolveSources(separated(), "vocals");
    expect(candidates[0]).toEqual({ kind: "local", uri: "file:///mixed-1" });
    expect(candidates[1]).toEqual({ kind: "network", nodeId: "vocals-1" });
  });

  it("stem resident: the local stem leads and no mixed fallback is appended", () => {
    setLocalFileIndex(indexWith({ instrumental: "file:///instr-1", mixed: "file:///mixed-1" }));
    const { candidates } = resolveSources(separated(), "instrumental");
    expect(candidates).toEqual([
      { kind: "local", uri: "file:///instr-1" },
      { kind: "network", nodeId: "instr-1" },
    ]);
  });

  it("original mode keeps its exact pre-seam ladder", () => {
    setLocalFileIndex(indexWith({ mixed: "file:///mixed-1" }));
    const { candidates } = resolveSources(separated(), "original");
    expect(candidates).toEqual([
      { kind: "local", uri: "file:///mixed-1" },
      { kind: "network", nodeId: "compressed-1" },
    ]);
  });
});

describe("stemModeResidentLocally", () => {
  it("answers false for a stem mode whose file is not on disk, true once it is", () => {
    setLocalFileIndex(indexWith({ mixed: "file:///mixed-1" }));
    expect(stemModeResidentLocally(separated(), "instrumental")).toBe(false);
    setLocalFileIndex(indexWith({ instrumental: "file:///instr-1" }));
    expect(stemModeResidentLocally(separated(), "instrumental")).toBe(true);
  });

  it("answers true for modes that do not play a stem file", () => {
    expect(stemModeResidentLocally(separated(), "original")).toBe(true);
    expect(stemModeResidentLocally(separated(), "custom")).toBe(true);
  });
});
