/**
 * Loop de secção A-B: a aritmética pura (abLoop.ts) e o comportamento do
 * motor - saltar de B para A, limpar ao trocar de faixa, o ended com o loop
 * armado - com o FakeAudioPlayer, no idioma de engine.test.ts.
 */
import { describe, expect, it } from "bun:test";
import { setPlaybackInterceptor } from "@/contracts/playbackInterceptor";
import type { Song } from "@/domain/song";
import {
  abLoopActive,
  abLoopJumpTarget,
  emptyAbLoop,
  markA,
  markB,
  MIN_AB_GAP_S,
} from "../abLoop";
import { PlayerEngineImpl } from "../engine";
import { setPlayerToastHandler } from "../recovery";
import { playerStore, resetPlayerStore } from "../store";
import { flush, makeEngineDeps, makeSong } from "./fakes";

setPlayerToastHandler(() => {});

describe("abLoop puro", () => {
  it("markA/markB fazem clamp a [0, duração]", () => {
    expect(markA(emptyAbLoop(), -5, 200).a).toBe(0);
    expect(markA(emptyAbLoop(), 999, 200).a).toBe(200);
    expect(markB(emptyAbLoop(), -5, 200).b).toBe(0);
    expect(markB(emptyAbLoop(), 999, 200).b).toBe(200);
    // Duração desconhecida (0): só o chão do zero se aplica.
    expect(markA(emptyAbLoop(), 999, 0).a).toBe(999);
  });

  it("um B sem folga à frente de A é recusado (estado intacto)", () => {
    const withA = markA(emptyAbLoop(), 10, 200);
    const rejected = markB(withA, 10 + MIN_AB_GAP_S / 2, 200);
    expect(rejected).toBe(withA);
    // Um B antes de A também é recusado.
    expect(markB(withA, 5, 200)).toBe(withA);
    // Com a folga mínima cumprida, entra.
    expect(markB(withA, 10 + MIN_AB_GAP_S, 200).b).toBe(10 + MIN_AB_GAP_S);
  });

  it("marcar A em cima (ou à frente) de um B existente invalida o B", () => {
    const armed = markB(markA(emptyAbLoop(), 10, 200), 20, 200);
    expect(abLoopActive(armed)).toBe(true);
    const remarked = markA(armed, 25, 200);
    expect(remarked.a).toBe(25);
    expect(remarked.b).toBeNull();
    // Recuar o A mantém o B: o intervalo continua válido.
    expect(markA(armed, 5, 200)).toEqual({ a: 5, b: 20 });
  });

  it("abLoopJumpTarget só dispara armado e a partir de B", () => {
    expect(abLoopJumpTarget(emptyAbLoop(), 50)).toBeNull();
    expect(abLoopJumpTarget(markA(emptyAbLoop(), 10, 200), 50)).toBeNull();
    const armed = markB(markA(emptyAbLoop(), 10, 200), 20, 200);
    expect(abLoopJumpTarget(armed, 5)).toBeNull(); // antes de A toca normal
    expect(abLoopJumpTarget(armed, 19.9)).toBeNull();
    expect(abLoopJumpTarget(armed, 20)).toBe(10);
    expect(abLoopJumpTarget(armed, 25)).toBe(10);
  });
});

const setup = () => {
  resetPlayerStore();
  setPlaybackInterceptor(null);
  const ctx = makeEngineDeps();
  const engine = new PlayerEngineImpl(ctx.deps);
  return { engine, ...ctx };
};

const urlFor = (ctx: ReturnType<typeof setup>, song: Song): void => {
  ctx.resolver.control.urls.set(`compressed-${song.id}`, `http://cdn/${song.id}`);
};

describe("abLoop no motor", () => {
  it("captura A/B do relógio do player e volta a A ao chegar a B", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.player.currentTime = 10;
    ctx.engine.setAbLoopPoint("a");
    ctx.player.currentTime = 24;
    ctx.engine.setAbLoopPoint("b");
    expect(playerStore.getState().abLoopA).toBe(10);
    expect(playerStore.getState().abLoopB).toBe(24);

    ctx.player.currentTime = 23.9;
    ctx.player.tick(0.25); // cruza B (24.15)
    await flush();
    expect(ctx.player.seekLog).toContain(10);
    expect(ctx.player.currentTime).toBe(10);
    // De volta dentro da secção, nenhum salto extra.
    const seeks = ctx.player.seekLog.length;
    ctx.player.tick(0.25);
    await flush();
    expect(ctx.player.seekLog.length).toBe(seeks);
    ctx.engine.dispose();
  });

  it("trocar de música limpa o loop", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 10;
    ctx.engine.setAbLoopPoint("a");
    ctx.player.currentTime = 20;
    ctx.engine.setAbLoopPoint("b");

    ctx.engine.setQueueIndex(1);
    await flush();
    expect(playerStore.getState().abLoopA).toBeNull();
    expect(playerStore.getState().abLoopB).toBeNull();
    ctx.engine.dispose();
  });

  it("o ended com o loop armado volta a A em vez de avançar a fila", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 10;
    ctx.engine.setAbLoopPoint("a");
    ctx.player.currentTime = 199;
    ctx.engine.setAbLoopPoint("b"); // B mesmo à beira do fim

    ctx.player.currentTime = 200;
    ctx.player.emitEnded();
    await flush();
    expect(playerStore.getState().queueIndex).toBe(0); // não avançou
    expect(ctx.player.seekLog).toContain(10);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("virar controlador (stopAndClearSource) limpa o loop", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 10;
    ctx.engine.setAbLoopPoint("a");
    ctx.player.currentTime = 20;
    ctx.engine.setAbLoopPoint("b");

    ctx.engine.stopAndClearSource();
    expect(playerStore.getState().abLoopA).toBeNull();
    expect(playerStore.getState().abLoopB).toBeNull();
    ctx.engine.dispose();
  });
});
