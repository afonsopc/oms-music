/**
 * O proxy de erros à volta do `@omelhorsite/sdk` (DESIGN.md secção 5).
 *
 * A app decide o que uma falha significa com `isApiError` em dezenas de
 * sítios, e esse guard é `instanceof ApiError`. Um `OmsApiError` passaria por
 * ele sem parar e chegaria a um `catch` que espera `.status`. Em vez de
 * ensinar uma segunda forma de erro a cada sítio, traduz-se AQUI, uma vez, na
 * fronteira: cada método do SDK é embrulhado num Proxy que converte o que
 * rejeita em `ApiError` e, num 401 autenticado ou num 404 de `/media/*`,
 * avisa o guard (`setAuthFailureHandler`) exactamente como o cliente antigo.
 *
 * Puro de propósito: não importa react-native nem auth, para o bun test o
 * carregar. `api/oms.ts` é quem constrói os clientes e lhes aplica isto.
 */
import { OmsApiError, OmsTimeoutError } from "@omelhorsite/sdk";
import { ApiError } from "@/domain/api";
import { parseErrorMessage, parseRetryAfter } from "./errors";

/**
 * Hook de falha de autenticação: qualquer 401 de um pedido autenticado (e
 * qualquer 404 em /media enquanto nos julgamos autenticados - as rotas de
 * media respondem 404, nunca 401, para a existência não vazar) avisa o guard,
 * que faz UMA sondagem single-flight a /sessions/mine. Registado por
 * auth/guard.ts; nenhum chamador repete o pedido por conta própria.
 */
export type AuthFailureCause = "401" | "fs404";
type AuthFailureHandler = (cause: AuthFailureCause) => void;
let authFailureHandler: AuthFailureHandler = () => {};
export const setAuthFailureHandler = (handler: AuthFailureHandler): void => {
  authFailureHandler = handler;
};

/**
 * Lançado pelo fornecedor de token do cliente autenticado quando não há
 * token: um pedido sem credencial nunca chega à rede (tokens inválidos ou
 * ausentes contam para o bucket anónimo de 120/min/IP). O SDK embrulha-o em
 * OmsError -> OmsNetworkError; o proxy reconhece-o pela cadeia de `cause` e
 * devolve o mesmo `ApiError(0, "Not authenticated")` de sempre.
 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

const causeChainHas = (error: unknown, predicate: (e: unknown) => boolean): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    if (predicate(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/** O caminho de um URL absoluto, sem depender de `new URL()` (RN é frugal). */
const pathOf = (url: string | undefined): string => {
  if (!url) return "";
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url);
  return match ? (match[1] ?? "/") : url;
};

/**
 * Converte o que o SDK lança no `ApiError` da app. Tudo o que não é do SDK
 * (um `OmsNetworkError`, um TypeError de validação) segue intacto: a política
 * de retry e o fallback offline já sabem ler um erro de transporte.
 */
export const toApiError = (error: unknown): unknown => {
  if (error instanceof ApiError) return error;
  if (error instanceof OmsApiError) {
    const status = error.status;
    const message = parseErrorMessage(error.body, `Request failed (${status})`);
    const retryAfter =
      status === 429
        ? parseRetryAfter(error.body, error.headers["retry-after"] ?? null)
        : undefined;
    return new ApiError(status, message, { retryAfter, body: error.body });
  }
  // Um timeout ou um abort nunca chegou a resposta: status 0, como o cliente
  // antigo dava a um pedido sem credencial e como o site faz com o SDK.
  if (error instanceof OmsTimeoutError) return new ApiError(0, error.message);
  if (causeChainHas(error, (e) => e instanceof NotAuthenticatedError)) {
    return new ApiError(0, "Not authenticated");
  }
  return error;
};

export interface TranslateOptions {
  /**
   * Avisa o guard nos 401 e nos 404 de /media. Verdadeiro no cliente
   * autenticado; falso no cliente público (login, signup), onde um 401 é a
   * resposta normal a uma password errada e não uma sessão morta.
   */
  notifyAuthFailure: boolean;
}

interface PaginatedLike {
  items: unknown[];
  next(): Promise<PaginatedLike | null>;
}

const isThenable = (value: unknown): value is Promise<unknown> =>
  !!value && typeof (value as { then?: unknown }).then === "function";

const isPaginated = (value: unknown): value is PaginatedLike =>
  !!value &&
  typeof value === "object" &&
  Array.isArray((value as PaginatedLike).items) &&
  typeof (value as PaginatedLike).next === "function";

/**
 * Embrulha um `Oms` (ou qualquer objecto do SDK) de modo a que cada método
 * rejeite com `ApiError`. Os namespaces aninhados são embrulhados no acesso
 * e memoizados; um `Paginated` devolvido vê o seu `next()` embrulhado também,
 * para que `collect()` nunca deixe escapar um `OmsApiError` da segunda página.
 */
export const translateErrors = <T extends object>(target: T, options: TranslateOptions): T => {
  const proxied = new WeakMap<object, unknown>();

  const rethrow = (error: unknown): never => {
    const translated = toApiError(error);
    if (options.notifyAuthFailure && translated instanceof ApiError) {
      if (translated.status === 401) authFailureHandler("401");
      if (
        translated.status === 404 &&
        error instanceof OmsApiError &&
        pathOf(error.url).startsWith("/media/")
      ) {
        authFailureHandler("fs404");
      }
    }
    throw translated;
  };

  const wrapPaginated = (page: PaginatedLike): PaginatedLike => ({
    ...page,
    next: () =>
      page
        .next()
        .then((following) => (following ? wrapPaginated(following) : null))
        .catch(rethrow),
  });

  const wrapResult = (value: unknown): unknown => (isPaginated(value) ? wrapPaginated(value) : value);

  const wrap = <O extends object>(obj: O): O => {
    const cached = proxied.get(obj);
    if (cached) return cached as O;
    const proxy = new Proxy(obj, {
      get(inner, prop) {
        const value = Reflect.get(inner, prop, inner);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            let result: unknown;
            try {
              result = value.apply(inner, args);
            } catch (error) {
              return rethrow(error);
            }
            return isThenable(result) ? result.then(wrapResult, rethrow) : result;
          };
        }
        if (value && typeof value === "object" && !Array.isArray(value)) return wrap(value);
        return value;
      },
    });
    proxied.set(obj, proxy);
    return proxy;
  };

  return wrap(target);
};
