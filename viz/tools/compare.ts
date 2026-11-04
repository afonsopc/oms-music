/**
 * Compara dois builds do /viz/ cena a cena (o de antes e o de agora), com o
 * relógio do browser parado e o Math.random semeado: as duas páginas vêem
 * os mesmos frames, por isso as capturas devem ser iguais. Serviu para
 * provar que a mudança para um ficheiro por cena não mexeu no aspecto.
 *
 *   bun viz/tools/compare.ts <dir-antes> <dir-agora> [ids...]
 *
 * Algumas cenas mudam a cada frame com o relógio (grão, faíscas, cortes
 * da Colagem) e dão diferenças mesmo entre o mesmo build e ele próprio;
 * para essas, comparar com `antes antes` dá a medida do ruído.
 *
 * Os dirs são builds (viz.js + index.html + omswide.ttf). Escreve em
 * viz/.shots/compare/ as capturas e um report.json.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cannedAnalysis } from "../lib/canned";

const [beforeDir, afterDir, ...ids] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("uso: bun viz/tools/compare.ts <dir-antes> <dir-agora> [ids...]");
  process.exit(2);
}
const OUT = resolve(import.meta.dir, "..", ".shots", "compare");
mkdirSync(OUT, { recursive: true });
const IDS = ids.length ? ids : ["milk", "text3d", "chrome", "tunnel", "kaleido", "pipes", "mystify", "starfield", "scope", "plasma", "desktop", "synthwave", "liquid", "voxel", "galaxy", "vhs", "datamosh", "ink", "film", "matrix", "vector", "pixel8", "collage", "aurora"];

const serve = (dir: string) => Bun.serve({ port: 0, fetch: (req) => { const p = new URL(req.url).pathname; const f = Bun.file(join(dir, p === "/" ? "index.html" : p)); return f.size ? new Response(f) : new Response("404", { status: 404 }); } });
const sb = serve(resolve(beforeDir)), sa = serve(resolve(afterDir));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--mute-audio"] });
const analysis = cannedAnalysis();
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

const shoot = async (base: string, id: string, file: string) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    let s = 12345;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
  });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
  await page.goto(base);
  await page.waitForFunction(() => typeof (window as any).__viz === "function");
  // a capa de teste: o mesmo desenho nas duas
  const art = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, "#ff5a36"); g.addColorStop(1, "#2a1b6e");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); x.fillStyle = "#ffd54a"; x.beginPath(); x.arc(170, 90, 50, 0, 7); x.fill();
    return c.toDataURL();
  });
  await page.evaluate(([a, art, id, t0]) => {
    const v = (window as any).__viz;
    v({ type: "analysis", songId: "c", data: a });
    v({ type: "palette", colors: ["#ff5a36", "#c2185b", "#14d3c2"] });
    v({ type: "state", song: { id: "c", title: "Canção de Teste", artist: "OMS", artworkUrl: art, tags: [], bpm: 128 }, playing: true, position: 10, at: t0 + 1000 });
    // a aurora é o fundo do leitor: compara-se no modo de fundo
    v(id === "aurora" ? { type: "config", mode: "background" } : { type: "config", mode: "full", scene: id, lyrics: "never", cycleOnTrack: false });
  }, [analysis, art, id, T0] as const);
  await new Promise((r) => setTimeout(r, 900)); // tempo real: carregar a cena e a capa; o relógio da página está parado
  await page.clock.runFor(1500);
  await page.screenshot({ path: file });
  await ctx.close();
};

const diff = async (a: string, b: string) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const ra = Buffer.from(new Uint8Array(await Bun.file(a).arrayBuffer())).toString("base64"), rb = Buffer.from(new Uint8Array(await Bun.file(b).arrayBuffer())).toString("base64");
  const r = await page.evaluate(async ([ra, rb]) => {
    const load = async (s: string) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
    const [ia, ib] = await Promise.all([load(ra), load(rb)]);
    const px = (i: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d")!; x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = px(ia), db = px(ib);
    let sum = 0, off = 0;
    for (let k = 0; k < da.length; k += 4) {
      const d = Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
      sum += d; if (d > 24) off++;
    }
    return { mean: sum / (da.length / 4) / 3, offPct: (100 * off) / (da.length / 4) };
  }, [ra, rb] as const);
  await ctx.close();
  return r;
};

const rows: { id: string; mean: number; offPct: number }[] = [];
for (const id of IDS) {
  const a = join(OUT, `${id}-antes.png`), b = join(OUT, `${id}-agora.png`);
  await shoot(`http://localhost:${sb.port}/`, id, a);
  await shoot(`http://localhost:${sa.port}/`, id, b);
  const d = await diff(a, b);
  rows.push({ id, mean: Math.round(d.mean * 1000) / 1000, offPct: Math.round(d.offPct * 1000) / 1000 });
  console.log(`${d.offPct < 0.5 ? "igual " : "DIFERE"} ${id.padEnd(12)} diferença média ${d.mean.toFixed(3)} · ${d.offPct.toFixed(3)} % dos píxeis`);
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(rows, null, 2));
await browser.close();
sb.stop(true); sa.stop(true);
