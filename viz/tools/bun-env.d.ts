/**
 * Os tipos mínimos do Bun e do node que as ferramentas do /viz/ usam
 * (viz/tools/*.ts e os testes). O projecto não instala bun-types nem
 * @types/node de propósito (ver src/types/node-shims.d.ts); isto completa
 * esses shims só com o que é preciso aqui.
 */
interface ImportMeta {
  /** Bun: a pasta do ficheiro. */
  dir: string;
  /** Bun: este ficheiro é o ponto de entrada. */
  main: boolean;
}

declare namespace Bun {
  interface BunFile extends Blob {
    readonly size: number;
  }
  interface Server {
    readonly port: number;
    stop(force?: boolean): void;
  }
  interface BuildOutput {
    success: boolean;
    logs: unknown[];
    outputs: { kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode"; size: number; path: string }[];
  }
}
// eslint-disable-next-line @typescript-eslint/no-redeclare -- o namespace e o valor do Bun, como no bun-types
declare const Bun: {
  file(path: string): Bun.BunFile;
  serve(o: { port?: number; fetch(req: Request): Response | Promise<Response> }): Bun.Server;
  build(o: {
    entrypoints: string[];
    outdir?: string;
    target?: "browser" | "bun" | "node";
    format?: "esm" | "iife" | "cjs";
    splitting?: boolean;
    minify?: boolean;
    sourcemap?: "none" | "linked" | "inline" | "external";
    naming?: { entry?: string; chunk?: string; asset?: string };
  }): Promise<Bun.BuildOutput>;
};

declare module "bun" {
  export class Glob {
    constructor(pattern: string);
    scanSync(o: { cwd: string }): IterableIterator<string>;
  }
}

declare module "bun:test" {
  export namespace describe {
    function skipIf(cond: boolean): (label: string, fn: () => void) => void;
  }
}

declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function copyFileSync(from: string, to: string): void;
  export function renameSync(from: string, to: string): void;
  export function watch(path: string, options: { recursive?: boolean }, listener: (event: string, filename: string | null) => void): { close(): void };
}

declare module "node:path" {
  export function basename(path: string, ext?: string): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}
