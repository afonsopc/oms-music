import { describe, expect, test } from "bun:test";
import { dismissDecision } from "../dismissMath";

describe("dismissDecision", () => {
  test("longe chega", () => expect(dismissDecision(141, 0)).toBe(true));
  test("perto e devagar não fecha", () => expect(dismissDecision(80, 200)).toBe(false));
  test("puxão rápido fecha", () => expect(dismissDecision(40, 1200)).toBe(true));
  test("um toque não fecha, mesmo com ruído de velocidade", () => expect(dismissDecision(3, 5000)).toBe(false));
  test("para cima nunca fecha", () => expect(dismissDecision(-300, -3000)).toBe(false));
});
