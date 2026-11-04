/**
 * Minimal typings for the node APIs used by the bun-side tooling (the boot
 * gate tests and the e2e device scripts). Same reason as bun-test.d.ts: this
 * project installs no @types package it does not strictly need, and
 * @types/node is only present transitively.
 */
declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { stdio?: "inherit" | "pipe" | "ignore" },
  ): Buffer | string;
}

declare module "node:fs" {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
}

/** scripts/asc.ts (base64url do JWT e do .p8). */
declare const Buffer: {
  from(data: string | Uint8Array, encoding?: "utf8" | "base64"): Uint8Array<ArrayBuffer> & {
    toString(encoding?: "base64url" | "base64" | "utf8"): string;
  };
};

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
