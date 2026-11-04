/**
 * Corre todas as cenas (ou algumas) num Chromium sem janela com a música e a
 * capa de teste: uma captura e um vídeo curto por cena, o tempo de cada
 * frame, e se se monta/desenha/desfaz sem erros. Escreve em viz/.shots/
 * (fora do git) o report.json e uma folha index.html com tudo.
 *
 *   bun run viz:shots                         # todas, com vídeo
 *   bun run viz:shots -- --pack=retro         # só um pacote
 *   bun run viz:shots -- --only=plasma,milk   # só estas
 *   bun run viz:shots -- --no-video --frames=240 --size=1920x1080
 *
 * O teste (viz/__tests__/render.test.ts, `bun run viz:test`) usa o mesmo.
 * Usa o Google Chrome instalado (GPU a sério); sem ele, o Chromium do
 * Playwright em cache (~/Library/Caches/ms-playwright).
 */
import { chromium, type Browser } from "playwright-core";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildViz } from "./build";
import type { RunResult } from "../dev/harness";

const ROOT = resolve(import.meta.dir, "..", "..");

/**
 * Orçamento por frame (ms) no aparelho de referência (o Mac M3 onde correm
 * os agentes, 1280x720), por custo: a mediana de lotes de 12 frames com uma
 * espera pela GPU no fim de cada lote (no WebGL conta a GPU; no 2D e no DOM
 * conta o processador, e a GPU entra no intervalo entre frames). Um
 * telemóvel médio é ~10x mais lento: custo 1 tem de caber nele a 60 fps,
 * custo 3 só em computadores. As 23 cenas de origem ficam todas abaixo de
 * 1,4 ms.
 */
export const BUDGET_MS: Record<number, number> = { 1: 2.5, 2: 6, 3: 12 };
/** E em todas: a correr no rAF, o intervalo médio entre frames não passa disto (50 fps; 16,7 é 60). */
export const INTERVAL_MS = 20;

export interface ShotOptions {
  only?: string[];
  pack?: string;
  video?: boolean;
  frames?: number;
  width?: number;
  height?: number;
  out?: string;
  log?: (s: string) => void;
}

export interface SceneReport extends RunResult {
  pack: string;
  name: string;
  cost: number;
  layer: string;
  budgetMs: number;
  overBudget: boolean;
  png?: string;
  webm?: string;
}

const serve = (dir: string) =>
  Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      const f = Bun.file(join(dir, p.endsWith("/") ? `${p}index.html` : p));
      return f.size ? new Response(f) : new Response("404", { status: 404 });
    },
  });

const launch = async (): Promise<Browser> => {
  const args = ["--enable-precise-memory-info", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=user-gesture-required", "--mute-audio"];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
    const dir = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop() : undefined;
    const exe = dir ? join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing") : undefined;
    return await chromium.launch({ headless: true, args, executablePath: exe && existsSync(exe) ? exe : undefined });
  }
};

export const runScenes = async (o: ShotOptions = {}): Promise<{ reports: SceneReport[]; renderer: string; out: string }> => {
  const log = o.log ?? ((s: string) => console.log(s));
  const out = o.out ?? join(ROOT, "viz", ".shots");
  const width = o.width ?? 1280, height = o.height ?? 720;
  const build = join(tmpdir(), `oms-viz-shots-${process.pid}`);
  await buildViz(build, true);
  const server = serve(build);
  const base = `http://localhost:${server.port}/`;
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // nada sai para a rede (nem som, nem a API): só o servidor local
  await ctx.route("**/*", (r) => (r.request().url().startsWith(base) || r.request().url().startsWith("data:") ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${base}?test`);
  await page.waitForFunction(() => document.documentElement.dataset.vizTest === "ready", null, { timeout: 20000 });
  const renderer = await page.evaluate(() => (window as any).__vizTest.renderer() as string);
  let list = (await page.evaluate(() => (window as any).__vizTest.scenes())) as { id: string; pack: string; name: string; cost: number; layer: string }[];
  if (o.pack) list = list.filter((s) => s.pack === o.pack);
  if (o.only?.length) list = list.filter((s) => o.only!.includes(s.id));
  log(`viz: ${list.length} cenas · ${width}x${height} · ${renderer}`);
  const reports: SceneReport[] = [];
  for (const s of list) {
    const r = (await page.evaluate(([id, frames]) => (window as any).__vizTest.run(id, { frames }), [s.id, o.frames ?? 120] as const)) as RunResult;
    const png = join(out, `${s.id}.png`);
    await page.screenshot({ path: png });
    r.leftovers = (await page.evaluate(() => (window as any).__vizTest.dispose())) as string[];
    if (r.leftovers.length) r.ok = false;
    const budgetMs = BUDGET_MS[s.cost] ?? 6;
    const rep: SceneReport = { ...r, pack: s.pack, name: s.name, cost: s.cost, layer: s.layer, budgetMs, overBudget: r.avgMs > budgetMs || r.intervalMs > INTERVAL_MS, png: `${s.id}.png` };
    reports.push(rep);
    log(`${r.ok && !rep.overBudget ? "ok " : "MAL"} ${s.pack}/${s.id.padEnd(16)} ${String(r.avgMs).padStart(6)} ms (p95 ${r.p95Ms}, orçamento ${budgetMs}) · ${r.intervalMs} ms entre frames${r.heapKbPerFrame ? ` · ${r.heapKbPerFrame} KB/frame` : ""}${r.errors.length ? `\n    ${r.errors.join("\n    ")}` : ""}${r.leftovers.length ? `\n    ${r.leftovers.join("\n    ")}` : ""}`);
  }
  await ctx.close();

  if (o.video !== false) {
    const vdir = join(build, "videos");
    for (const rep of reports) {
      const vctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1, recordVideo: { dir: vdir, size: { width: 640, height: 360 } } });
      await vctx.route("**/*", (r) => (r.request().url().startsWith(base) || r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      const vp = await vctx.newPage();
      await vp.goto(`${base}?test`);
      await vp.waitForFunction(() => document.documentElement.dataset.vizTest === "ready", null, { timeout: 20000 });
      await vp.evaluate((id) => (window as any).__vizTest.live(id, 27), rep.id);
      await vp.waitForTimeout(5000);
      const video = vp.video();
      await vctx.close();
      if (video) {
        const dst = join(out, `${rep.id}.webm`);
        rmSync(dst, { force: true });
        renameSync(await video.path(), dst);
        rep.webm = `${rep.id}.webm`;
      }
    }
    log(`viz: vídeos em ${out}`);
  }
  await browser.close();
  server.stop(true);
  rmSync(build, { recursive: true, force: true });

  writeFileSync(join(out, "report.json"), JSON.stringify({ at: new Date().toISOString(), renderer, width, height, budgetMs: BUDGET_MS, intervalMs: INTERVAL_MS, scenes: reports }, null, 2));
  writeFileSync(join(out, "index.html"), sheet(reports, renderer));
  return { reports, renderer, out };
};

const sheet = (reports: SceneReport[], renderer: string) => `<!doctype html><meta charset="utf-8"><title>Cenas do /viz/</title>
<style>body{background:#111;color:#eee;font:13px system-ui;margin:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
figure{margin:0;background:#1b1b1b;border-radius:8px;overflow:hidden}img,video{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#000}
figcaption{padding:8px 10px}.bad{color:#ff7a7a}</style>
<h1>${reports.length} cenas</h1><p>${renderer}</p><div class="g">
${reports.map((r) => `<figure><img src="${r.png}" onmouseover="this.nextElementSibling&&(this.style.display='none',this.nextElementSibling.style.display='block',this.nextElementSibling.play())">${r.webm ? `<video src="${r.webm}" muted loop style="display:none"></video>` : ""}
<figcaption><b>${r.name}</b> · ${r.pack}/${r.id} · ${r.layer} · custo ${r.cost}<br><span class="${r.overBudget ? "bad" : ""}">${r.avgMs} ms (p95 ${r.p95Ms}; orçamento ${r.budgetMs}) · ${r.intervalMs} ms entre frames</span>${r.ok ? "" : ` <span class="bad">FALHOU: ${[...r.errors, ...r.leftovers].join("; ").replace(/</g, "&lt;")}</span>`}</figcaption></figure>`).join("\n")}
</div>`;

if (import.meta.main) {
  const argv: string[] = process.argv;
  const arg = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const size = arg("size")?.split("x").map(Number);
  const { reports, out } = await runScenes({
    only: arg("only")?.split(","),
    pack: arg("pack"),
    video: !process.argv.includes("--no-video"),
    frames: arg("frames") ? Number(arg("frames")) : undefined,
    width: size?.[0],
    height: size?.[1],
  });
  const bad = reports.filter((r) => !r.ok || r.overBudget);
  console.log(`\nviz: ${reports.length - bad.length}/${reports.length} bem · folha: ${join(out, "index.html")}`);
  if (bad.length) process.exit(1);
}
