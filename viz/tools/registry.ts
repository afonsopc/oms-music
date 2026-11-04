/**
 * Gera viz/scenes/_registry.ts a partir dos ficheiros viz/scenes/<pacote>/<id>.ts.
 * Ninguém edita listas de cenas: basta criar o ficheiro. O índice não vai
 * para o git (cada um gera o seu); corre sozinho no `bun test`, no
 * `bun run viz:build` e no build da web.
 *
 *   bun viz/tools/registry.ts           # gerar
 *   bun viz/tools/registry.ts --check   # só validar (sai com erro se algo estiver mal)
 *
 * Ficheiros começados por "_" num pacote são ajudantes do pacote, não cenas.
 */
import { Glob } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { metaErrors, type SceneMeta, type SceneModule } from "../lib/scene";

const SCENES = join(import.meta.dir, "..", "scenes");
const OUT = join(SCENES, "_registry.ts");
const PACK_RE = /^[a-z][a-z0-9-]{1,31}$/;

export interface Found { pack: string; id: string; file: string; meta: SceneMeta }

export const scan = async (): Promise<{ found: Found[]; errors: string[] }> => {
  const files = [...new Glob("*/*.ts").scanSync({ cwd: SCENES })].filter((f) => !basename(f).startsWith("_") && !f.endsWith(".test.ts")).sort();
  const found: Found[] = [];
  const errors: string[] = [];
  const ids = new Map<string, string>();
  for (const rel of files) {
    const pack = dirname(rel), id = basename(rel, ".ts");
    if (!PACK_RE.test(pack)) { errors.push(`${rel}: nome de pacote inválido "${pack}"`); continue; }
    let mod: { default?: SceneModule };
    try {
      mod = await import(join(SCENES, rel));
    } catch (e) {
      errors.push(`${rel}: não importa sem browser (${(e as Error).message}); nada de DOM/WebGL fora do create()/init()`);
      continue;
    }
    const m = mod.default;
    if (!m || typeof m.create !== "function" || !m.meta) { errors.push(`${rel}: falta "export default" de uma cena (shaderScene/canvasScene/domScene/defineScene)`); continue; }
    for (const e of metaErrors(m.meta, id)) errors.push(`${rel}: ${e}`);
    const prev = ids.get(m.meta.id);
    if (prev) errors.push(`${rel}: o id "${m.meta.id}" já existe em ${prev}`);
    ids.set(m.meta.id, rel);
    found.push({ pack, id, file: rel, meta: m.meta });
  }
  return { found, errors };
};

export const render = (found: Found[]) => {
  const rows = found.map((f) => {
    const { layer, ...rest } = f.meta;
    return `  { pack: ${JSON.stringify(f.pack)}, meta: ${JSON.stringify({ ...rest, layer })}, load: () => import("./${f.pack}/${f.id}") },`;
  });
  return `// GERADO por viz/tools/registry.ts a partir de viz/scenes/<pacote>/<id>.ts. Não editar, não vai para o git.
import type { RegistryEntry } from "../lib/scene";

export const SCENES: RegistryEntry[] = [
${rows.join("\n")}
];
`;
};

export const generate = async ({ check = false, quiet = false } = {}) => {
  const { found, errors } = await scan();
  if (errors.length) {
    console.error(`viz: ${errors.length} problema(s) nas cenas:\n  ${errors.join("\n  ")}`);
    if (check || !quiet) process.exitCode = 1;
    if (check) return false;
  }
  if (!check) {
    const src = render(found);
    if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== src) writeFileSync(OUT, src);
    if (!quiet) console.log(`viz: ${found.length} cenas em ${new Set(found.map((f) => f.pack)).size} pacotes -> ${relative(process.cwd(), OUT)}`);
  }
  return errors.length === 0;
};

if (import.meta.main) await generate({ check: process.argv.includes("--check") });
