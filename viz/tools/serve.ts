/**
 * A galeria em casa: constrói o /viz/ (sem minificar), serve-o e volta a
 * construir quando um ficheiro de viz/ muda. Recarregar a página para ver.
 *
 *   bun run viz:gallery              # http://localhost:5179/?gallery
 *   bun run viz:gallery -- 5200      # outra porta
 */
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildViz } from "./build";

const VIZ = resolve(import.meta.dir, "..");
const out = join(tmpdir(), "oms-viz-gallery");
const port = Number(process.argv[2] ?? 5179);
let building: Promise<unknown> = buildViz(out, true);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(VIZ, { recursive: true }, (_e, f) => {
  if (!f || f.includes("_registry") || f.startsWith(".shots")) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    building = buildViz(out, true).then(() => console.log(`viz: reconstruído (${f})`)).catch((e) => console.error(String(e)));
  }, 150);
});
Bun.serve({
  port,
  async fetch(req) {
    await building.catch(() => {});
    const p = new URL(req.url).pathname;
    const f = Bun.file(join(out, p === "/" ? "index.html" : p));
    return f.size ? new Response(f) : new Response("404", { status: 404 });
  },
});
console.log(`viz: galeria em http://localhost:${port}/?gallery  (testes: /?test)`);
