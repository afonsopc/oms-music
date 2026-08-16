/**
 * O predicado de retry das queries (bug da Home vazia, dono 2026-08-17).
 * A linha que ele tem de guardar: erro de TRANSPORTE tenta outra vez, erro
 * de RESPOSTA nao - repetir a pergunta nao muda a resposta de um 4xx, e o
 * 429 em particular tem o parking proprio que nunca deve ganhar um retry.
 */
import { describe, expect, test } from "bun:test";
import { QUERY_RETRY_LIMIT, shouldRetryQuery } from "../retryPolicy";
import { ApiError } from "@/domain/api";

describe("shouldRetryQuery", () => {
  test("erros de transporte (sem resposta) tentam ate ao limite", () => {
    const err = new TypeError("Network request failed");
    expect(shouldRetryQuery(0, err)).toBe(true);
    expect(shouldRetryQuery(QUERY_RETRY_LIMIT - 1, err)).toBe(true);
    expect(shouldRetryQuery(QUERY_RETRY_LIMIT, err)).toBe(false);
  });

  test("um 4xx e uma resposta: nunca se repete a pergunta", () => {
    for (const status of [400, 401, 404, 422, 429]) {
      expect(shouldRetryQuery(0, new ApiError(status, "resposta"))).toBe(false);
    }
  });

  test("um 5xx merece uma segunda tentativa", () => {
    expect(shouldRetryQuery(0, new ApiError(500, "blip"))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError(503, "deploy"))).toBe(true);
    expect(shouldRetryQuery(QUERY_RETRY_LIMIT, new ApiError(503, "deploy"))).toBe(false);
  });

  test("o 304 do keep-previous nunca gira em loop", () => {
    // guardedQueryFn re-atira o 304 quando nao ha dados anteriores; um retry
    // aqui seria pedir o mesmo 304 outra vez.
    expect(shouldRetryQuery(0, new ApiError(304, "not modified"))).toBe(false);
  });
});
