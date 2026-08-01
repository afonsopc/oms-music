/**
 * Repo-wide CI gates (WORKPLAN WP12.2). Two rules that are cheap to break in
 * review and cheap to catch here:
 *
 *  1. the em-dash character appears nowhere (code, strings, comments, docs);
 *  2. every subsystem `register.ts` is reachable from `boot/wireup.ts`, so a
 *     package that ships a registrar nobody imports fails the build instead of
 *     silently leaving a seam inert on device.
 *
 * The i18n key-tree gate lives with the catalogs (i18n/__tests__/keyTree).
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const EM_DASH = "\u{2014}";

const SCANNED_DIRS = ["src", "e2e", "docs", "scripts", "store"];
const SCANNED_FILES = ["README.md", "app.json", "package.json", "eas.json"];
const TEXT_EXTENSIONS = [".ts", ".tsx", ".js", ".json", ".md"];

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (TEXT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
};

const allTextFiles = (): string[] => {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) {
    const full = join(REPO_ROOT, dir);
    if (existsSync(full)) files.push(...walk(full));
  }
  for (const file of SCANNED_FILES) {
    const full = join(REPO_ROOT, file);
    if (existsSync(full)) files.push(full);
  }
  return files;
};

// ---------------------------------------------------------------------------
// Import graph from boot/wireup.ts
// ---------------------------------------------------------------------------

const IMPORT_RE = /(?:from\s+|import\s+)"([^"]+)"/g;
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".json", "/index.ts", "/index.tsx"];

const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(REPO_ROOT, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // node_modules
  }
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      // Directories answer existsSync too; only accept a real file path.
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
};

const reachableFromWireup = (): Set<string> => {
  const entry = join(REPO_ROOT, "src/boot/wireup.ts");
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const source = readFileSync(file, "utf8");
    IMPORT_RE.lastIndex = 0;
    let match = IMPORT_RE.exec(source);
    while (match !== null) {
      const target = resolveSpecifier(file, match[1]);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
      match = IMPORT_RE.exec(source);
    }
  }
  return seen;
};

describe("repo gates", () => {
  it("contain no em-dash character anywhere", () => {
    const offenders = allTextFiles()
      .filter((file) => readFileSync(file, "utf8").includes(EM_DASH))
      .map((file) => relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("wire every subsystem register.ts into boot/wireup.ts", () => {
    const registrars = walk(join(REPO_ROOT, "src")).filter((file) =>
      file.endsWith("/register.ts"),
    );
    expect(registrars.length).toBeGreaterThan(0);
    const reachable = reachableFromWireup();
    const orphans = registrars
      .filter((file) => !reachable.has(file))
      .map((file) => relative(REPO_ROOT, file));
    expect(orphans).toEqual([]);
  });
});
