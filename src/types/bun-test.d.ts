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

  /**
   * The assertion set, generic over what a matcher hands back: `void` for the
   * direct form, `Promise<void>` behind `.rejects` / `.resolves`, which settle
   * the subject first and therefore must be awaited.
   */
  export interface MatchersOf<Result> {
    toBe(expected: unknown): Result;
    toEqual(expected: unknown): Result;
    toStrictEqual(expected: unknown): Result;
    toContain(expected: unknown): Result;
    toBeNull(): Result;
    toBeUndefined(): Result;
    toBeTruthy(): Result;
    toBeFalsy(): Result;
    toBeInstanceOf(expected: unknown): Result;
    toBeGreaterThan(expected: number): Result;
    toBeGreaterThanOrEqual(expected: number): Result;
    toBeLessThan(expected: number): Result;
    toBeLessThanOrEqual(expected: number): Result;
    toBeCloseTo(expected: number, digits?: number): Result;
    toThrow(expected?: unknown): Result;
    toHaveLength(expected: number): Result;
    not: MatchersOf<Result>;
  }

  export interface Matchers extends MatchersOf<void> {
    /** Awaits a rejection, then asserts on the reason. */
    rejects: MatchersOf<Promise<void>>;
    /** Awaits a resolution, then asserts on the value. */
    resolves: MatchersOf<Promise<void>>;
  }

  export function expect(value: unknown): Matchers;
}
