/** O anel de trace: limite, formato de uma linha, e limpeza. */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearPlaybackTrace,
  playbackTraceEntries,
  playbackTraceText,
  tracePlayback,
} from "../trace";

beforeEach(() => clearPlaybackTrace());

describe("tracePlayback", () => {
  test("guarda tag e detalhe compacto", () => {
    tracePlayback("seek.user", { to: 12.3456, playing: true });
    const [entry] = playbackTraceEntries();
    expect(entry.tag).toBe("seek.user");
    expect(entry.detail).toBe("to=12.35 playing=true");
    expect(playbackTraceText()).toContain("seek.user to=12.35 playing=true");
  });

  test("o anel nunca cresce alem do limite", () => {
    for (let i = 0; i < 1000; i++) tracePlayback("tick", { i });
    expect(playbackTraceEntries().length).toBeLessThanOrEqual(400);
    expect(playbackTraceEntries().at(-1)?.detail).toBe("i=999");
  });

  test("limpar esvazia mesmo", () => {
    tracePlayback("x");
    clearPlaybackTrace();
    expect(playbackTraceEntries().length).toBe(0);
    expect(playbackTraceText()).toBe("");
  });
});
