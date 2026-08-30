/**
 * O proxy de erros e a fronteira entre o SDK e os 30 e tal `isApiError` da
 * app: tudo o que o SDK rejeita tem de sair daqui como `ApiError`, com o
 * status, a mensagem, o retry_after e o corpo que os ecras ja sabem ler, e o
 * guard tem de ser avisado num 401 autenticado e num 404 de /media.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Oms, OmsApiError, OmsTimeoutError, collect } from "@omelhorsite/sdk";
import { ApiError, isApiError } from "@/domain/api";
import {
  NotAuthenticatedError,
  setAuthFailureHandler,
  toApiError,
  translateErrors,
} from "../omsProxy";

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Um Oms sobre um fetch falso, sem retries (como api/oms.ts o constroi). */
const client = (
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
  options: { token?: () => string } = {},
): Oms =>
  new Oms({
    baseUrl: "https://api.test",
    fetch: async (url, init) => respond(url, init),
    retry: false,
    ...(options.token ? { tokens: { getToken: options.token } } : {}),
  });

afterEach(() => {
  setAuthFailureHandler(() => {});
});

describe("toApiError", () => {
  test("um OmsApiError vira ApiError com status, mensagem nua e corpo", () => {
    const error = toApiError(
      new OmsApiError("Not found", { status: 404, body: "Song not found", headers: {} }),
    );
    expect(isApiError(error)).toBe(true);
    const api = error as ApiError;
    expect(api.status).toBe(404);
    expect(api.message).toBe("Song not found");
    expect(api.body).toBe("Song not found");
    expect(api.retryAfter).toBeUndefined();
  });

  test("um 429 traz o retry_after do corpo, senao do header, em segundos", () => {
    const fromBody = toApiError(
      new OmsApiError("Rate limited", {
        status: 429,
        body: { error: "rate_limited", retry_after: 37 },
        headers: { "retry-after": "60" },
      }),
    ) as ApiError;
    expect(fromBody.retryAfter).toBe(37);
    expect(fromBody.message).toBe("rate_limited");

    const fromHeader = toApiError(
      new OmsApiError("Rate limited", { status: 429, body: "slow down", headers: { "retry-after": "12" } }),
    ) as ApiError;
    expect(fromHeader.retryAfter).toBe(12);
  });

  test("um array de mensagens de validacao junta-se por linhas", () => {
    const error = toApiError(
      new OmsApiError("Bad", { status: 422, body: ["Name can't be blank", "Too short"], headers: {} }),
    ) as ApiError;
    expect(error.message).toBe("Name can't be blank\nToo short");
  });

  test("um timeout do SDK e status 0 (nao houve resposta)", () => {
    const error = toApiError(new OmsTimeoutError("Request timed out after 20000ms", { timeoutMs: 20000 }));
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).status).toBe(0);
  });

  test("um pedido sem token, recusado localmente, e o ApiError(0) de sempre", () => {
    const wrapped = new Error("Network request failed: Not authenticated", {
      cause: new Error("Not authenticated", { cause: new NotAuthenticatedError() }),
    });
    const error = toApiError(wrapped) as ApiError;
    expect(error.status).toBe(0);
    expect(error.message).toBe("Not authenticated");
  });

  test("um erro que nao e do SDK segue intacto", () => {
    const network = new TypeError("Network request failed");
    expect(toApiError(network)).toBe(network);
    const own = new ApiError(418, "teapot");
    expect(toApiError(own)).toBe(own);
  });
});

describe("translateErrors", () => {
  test("um metodo aninhado rejeita com ApiError", async () => {
    const oms = translateErrors(
      client(() => json(404, "Song not found")),
      { notifyAuthFailure: true },
    );
    let caught: unknown;
    try {
      await oms.music.songs.get(1);
    } catch (error) {
      caught = error;
    }
    expect(isApiError(caught)).toBe(true);
    expect((caught as ApiError).status).toBe(404);
  });

  test("um 401 autenticado avisa o guard; um 401 publico nao", async () => {
    const causes: string[] = [];
    setAuthFailureHandler((cause) => causes.push(cause));

    const authed = translateErrors(client(() => json(401, "Unauthorized")), { notifyAuthFailure: true });
    await authed.sessions.current().catch(() => undefined);
    expect(causes).toEqual(["401"]);

    const anon = translateErrors(client(() => json(401, "Invalid email address or password.")), {
      notifyAuthFailure: false,
    });
    await anon.sessions.signIn({ email: "a@b.c", password: "x" }).catch(() => undefined);
    expect(causes).toEqual(["401"]);
  });

  test("um 404 em /media/* avisa o guard como fs404; um 404 noutro sitio nao", async () => {
    const causes: string[] = [];
    setAuthFailureHandler((cause) => causes.push(cause));
    const oms = translateErrors(client(() => json(404, "Not found")), { notifyAuthFailure: true });
    await oms.media.dataUrl("123").catch(() => undefined);
    await oms.music.songs.get(1).catch(() => undefined);
    expect(causes).toEqual(["fs404"]);
  });

  test("a segunda pagina de um Paginated tambem sai como ApiError", async () => {
    let calls = 0;
    const oms = translateErrors(
      client(() => {
        calls += 1;
        // Primeira pagina cheia (hasMore), segunda rebenta.
        if (calls === 1) return json(200, [{ id: 1 }, { id: 2 }]);
        return json(500, "boom");
      }),
      { notifyAuthFailure: true },
    );
    const first = await oms.music.playlists.list({ pageSize: 2 });
    let caught: unknown;
    try {
      await collect(first, 10);
    } catch (error) {
      caught = error;
    }
    expect(isApiError(caught)).toBe(true);
    expect((caught as ApiError).status).toBe(500);
  });

  test("um resultado normal passa como esta e os helpers sincronos nao sao tocados", async () => {
    const oms = translateErrors(client(() => json(200, { id: "abc", handle: "afonso" })), {
      notifyAuthFailure: true,
    });
    const me = await oms.account.me();
    expect(me.handle).toBe("afonso");
    expect(oms.media.url("7")).toBe("https://api.test/media/7/data");
  });

  test("sem token o cliente autenticado nem chega a rede", async () => {
    let reached = false;
    const oms = translateErrors(
      client(
        () => {
          reached = true;
          return json(200, []);
        },
        {
          token: () => {
            throw new NotAuthenticatedError();
          },
        },
      ),
      { notifyAuthFailure: true },
    );
    let caught: unknown;
    try {
      await oms.music.songs.likedIds();
    } catch (error) {
      caught = error;
    }
    expect(reached).toBe(false);
    expect(isApiError(caught)).toBe(true);
    expect((caught as ApiError).status).toBe(0);
  });
});
