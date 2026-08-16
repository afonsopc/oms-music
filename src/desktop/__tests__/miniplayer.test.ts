/**
 * A deteccao da janela do mini-player e o interruptor do boot inteiro
 * (_layout, wireup e bridge decidem por ela), e ja falhou uma vez: o shell
 * construido percent-encoda o `?` do WebviewUrl::App e o query param nunca
 * chegava ao JS, o que deixou a janela presa num "Unmatched Route" sem botao
 * de fechar (dono, 2026-08-17). Estes testes fixam as TRES fontes: o global
 * injectado pelo Rust, o label da janela nos internals do Tauri, e o query
 * historico do dev server.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isMiniplayerWindow } from "../miniplayer";

type MutableGlobal = {
  __OMS_MINIPLAYER__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  location?: unknown;
};

const g = globalThis as MutableGlobal;
const originalLocation = g.location;

afterEach(() => {
  delete g.__OMS_MINIPLAYER__;
  delete g.__TAURI_INTERNALS__;
  g.location = originalLocation;
});

describe("isMiniplayerWindow", () => {
  test("sem fonte nenhuma, nao somos o mini-player", () => {
    g.location = undefined;
    expect(isMiniplayerWindow()).toBe(false);
  });

  test("o global injectado pelo Rust decide sozinho, sem URL nenhum", () => {
    g.location = undefined;
    g.__OMS_MINIPLAYER__ = true;
    expect(isMiniplayerWindow()).toBe(true);
  });

  test("o global so vale como boolean true, nunca como truthy qualquer", () => {
    g.location = undefined;
    g.__OMS_MINIPLAYER__ = "true";
    expect(isMiniplayerWindow()).toBe(false);
  });

  test("o label da janela nos internals do Tauri e rede para shells antigos", () => {
    g.location = undefined;
    g.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: "miniplayer" } } };
    expect(isMiniplayerWindow()).toBe(true);
  });

  test("a janela principal nunca passa pelo label", () => {
    g.location = undefined;
    g.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: "main" } } };
    expect(isMiniplayerWindow()).toBe(false);
  });

  test("internals mal formados nao atiram nem enganam", () => {
    g.location = undefined;
    g.__TAURI_INTERNALS__ = { metadata: null };
    expect(isMiniplayerWindow()).toBe(false);
  });

  test("o query param do dev server continua a valer", () => {
    g.location = { search: "?miniplayer=1" };
    expect(isMiniplayerWindow()).toBe(true);
    g.location = { search: "" };
    expect(isMiniplayerWindow()).toBe(false);
  });

  test("o URL real do shell (query encodada no path) nao vale como fonte", () => {
    // O que a janela via: o `?` percent-encodado para dentro do path.
    g.location = { pathname: "/index.html%3Fminiplayer=1", search: "" };
    expect(isMiniplayerWindow()).toBe(false);
  });
});
