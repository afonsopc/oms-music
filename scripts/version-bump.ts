// bun run version:bump patch|minor|major
//
// A versão da OMS Music (SemVer) vive no "version" do package.json: o
// app.config.js dá-a ao iOS, ao Android e à web, e o desktop (Tauri) leva a
// mesma. Isto sobe-a e acerta as cópias que as ferramentas lêem sozinhas
// (app.json, desktop/package.json, tauri.conf.json, Cargo.toml e Cargo.lock),
// dá nome à secção "Por lançar" do CHANGELOG.md, faz o commit só desses
// ficheiros e a tag music-vX.Y.Z. A tag vX.Y.Z continua a ser a da release do
// desktop (desktop/scripts/release-macos.sh), que o actualizador usa.
// Pára se algum desses ficheiros tem alterações por commitar (de outro agente).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Corre no bun; os tipos do tsc deste repo são os do React Native (sem Bun nem
// child_process), daí o require com o tipo à mão.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync } = require("node:child_process") as {
  execFileSync: (file: string, args: string[], options: { cwd: string; encoding: "utf8" }) => string;
};
const ROOT = decodeURIComponent(new URL("..", import.meta.url).pathname);
const TAG_PREFIX = "music-v";

const kind = process.argv[2];
if (kind !== "patch" && kind !== "minor" && kind !== "major") {
  console.error("uso: bun run version:bump patch|minor|major");
  process.exit(1);
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const write = (path: string, text: string) => writeFileSync(join(ROOT, path), text);

const FILES = [
  "package.json",
  "app.json",
  "desktop/package.json",
  "desktop/src-tauri/tauri.conf.json",
  "desktop/src-tauri/Cargo.toml",
  "desktop/src-tauri/Cargo.lock",
  "CHANGELOG.md",
];
const dirty = git("status", "--porcelain", "--", ...FILES);
if (dirty) {
  console.error(`há alterações por commitar nestes ficheiros; commita-as ou espera:\n${dirty}`);
  process.exit(1);
}

const current = JSON.parse(read("package.json")).version as string;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!m) throw new Error(`versão estranha no package.json: ${current}`);
let [major, minor, patch] = m.slice(1).map(Number);
if (kind === "major") [major, minor, patch] = [major + 1, 0, 0];
if (kind === "minor") [minor, patch] = [minor + 1, 0];
if (kind === "patch") patch += 1;
const next = `${major}.${minor}.${patch}`;
const tag = `${TAG_PREFIX}${next}`;
if (git("tag", "-l", tag)) throw new Error(`a tag ${tag} já existe`);

const replaceOnce = (path: string, pattern: RegExp, value: string) => {
  const text = read(path);
  if (!pattern.test(text)) throw new Error(`não encontrei a versão em ${path}`);
  write(path, text.replace(pattern, value));
};
for (const path of ["package.json", "desktop/package.json", "desktop/src-tauri/tauri.conf.json"]) {
  replaceOnce(path, /"version": "[^"]*"/, `"version": "${next}"`);
}
replaceOnce("app.json", /("expo": \{[^]*?"version": )"[^"]*"/, `$1"${next}"`);
replaceOnce("desktop/src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${next}"`);
replaceOnce(
  "desktop/src-tauri/Cargo.lock",
  /(name = "oms-music-desktop"\nversion = )"[^"]*"/,
  `$1"${next}"`,
);

const today = new Date().toISOString().slice(0, 10);
const header = `## ${next} (${today})`;
const log = read("CHANGELOG.md");
write(
  "CHANGELOG.md",
  log.includes("## Por lançar")
    ? log.replace("## Por lançar", `## Por lançar\n\n${header}`)
    : log.replace(/\n## /, `\n## Por lançar\n\n${header}\n\n## `),
);

git("add", "--", ...FILES);
git("commit", "-m", `OMS Music ${next}`, "--", ...FILES);
git("tag", "-a", tag, "-m", `OMS Music ${next}`);
console.log(`${current} -> ${next}, commit ${git("rev-parse", "--short", "HEAD")}, tag ${tag}`);
console.log(`falta: git push da branch e da tag ${tag}; o desktop sai com bun run release (em desktop/), que faz a v${next}`);
