import { describe, expect, test } from "bun:test";
import { tabPressPopTarget } from "../tabPress";

const tabs = (index: number, homeDepth: number, searchDepth = 0) => ({
  index,
  routes: [
    { key: "home-k", state: { key: "home-stack", index: homeDepth } },
    { key: "search-k", state: { key: "search-stack", index: searchDepth } },
    { key: "library-k" },
  ],
});

describe("tabPressPopTarget", () => {
  test("Android: Início com as Definições abertas volta à raiz", () =>
    expect(tabPressPopTarget(tabs(0, 2), "home-k", "android")).toBe("home-stack"));
  test("iOS: o toque repetido fica para o sistema", () =>
    expect(tabPressPopTarget(tabs(0, 2), "home-k", "ios")).toBeNull());
  test("na raiz não há nada a tirar", () =>
    expect(tabPressPopTarget(tabs(0, 0), "home-k", "android")).toBeNull());
  test("mudar de tab mostra a raiz da outra, nos dois sistemas", () => {
    expect(tabPressPopTarget(tabs(0, 0, 1), "search-k", "android")).toBe("search-stack");
    expect(tabPressPopTarget(tabs(0, 0, 1), "search-k", "ios")).toBe("search-stack");
  });
  test("tab nunca aberta (sem stack) não faz nada", () =>
    expect(tabPressPopTarget(tabs(0, 1), "library-k", "android")).toBeNull());
  test("chave desconhecida não faz nada", () =>
    expect(tabPressPopTarget(tabs(0, 1), "x", "android")).toBeNull());
});
