/**
 * Constrói o /viz/ para `out` (por omissão public/viz/): gera o índice das
 * cenas, junta o motor em viz.js (módulo ES) e cada cena no seu pedaço
 * (c/<id>-<hash>.js), que só se carrega quando a cena entra.
 *
 *   bun viz/tools/build.ts [out] [--dev]   # --dev: sem minificar, com sourcemaps
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "./registry";

const ROOT = resolve(import.meta.dir, "..", "..");
export const buildViz = async (out = join(ROOT, "public", "viz"), dev = false) => {
  if (!(await generate({ quiet: true }))) throw new Error("viz: há cenas com problemas (ver acima)");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const res = await Bun.build({
    entrypoints: [join(ROOT, "viz", "main.ts")],
    outdir: out,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !dev,
    sourcemap: dev ? "linked" : "none",
    naming: { entry: "viz.js", chunk: "c/[name]-[hash].js", asset: "a/[name]-[hash].[ext]" },
  });
  if (!res.success) {
    for (const l of res.logs) console.error(l);
    throw new Error("viz: o build falhou");
  }
  copyFileSync(join(ROOT, "viz", "index.html"), join(out, "index.html"));
  copyFileSync(join(ROOT, "assets", "fonts", "OMSWide-Regular.ttf"), join(out, "omswide.ttf"));
  const entry = res.outputs.find((o) => o.kind === "entry-point");
  const chunks = res.outputs.filter((o) => o.kind === "chunk");
  return { out, entryKb: Math.round((entry?.size ?? 0) / 102.4) / 10, chunks: chunks.length, chunksKb: Math.round(chunks.reduce((a, o) => a + o.size, 0) / 102.4) / 10 };
};

if (import.meta.main) {
  const args: string[] = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const r = await buildViz(dir ? resolve(dir) : undefined, args.includes("--dev"));
  console.log(`viz: ${r.out} · viz.js ${r.entryKb} KB · ${r.chunks} pedaços (${r.chunksKb} KB)`);
}
