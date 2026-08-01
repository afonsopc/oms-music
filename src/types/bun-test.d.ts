/**
 * Minimal typings for bun's test runner (the project deliberately has no
 * bun-types dependency; installs need explicit approval). Only the API the
 * WP1 tests use is declared.
 */
declare module "bun:test" {
  export type TestFn = () => void | Promise<void>;

  export function describe(label: string, fn: () => void): void;
  export function it(label: string, fn: TestFn): void;
  export function test(label: string, fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;

  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toThrow(expected?: unknown): void;
    toHaveLength(expected: number): void;
    not: Matchers;
  }

  export function expect(value: unknown): Matchers;
}
