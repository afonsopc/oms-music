/**
 * Politica de retry das queries (bug da Home vazia, dono 2026-08-17), num
 * modulo proprio SEM react-native para o bun test a poder importar - o
 * queryClient arrasta NetInfo/AppState e nao passa pelo parser do bun.
 *
 * A regra: retry so por TEMPO, nunca por RESPOSTA. Um erro de transporte
 * (fetch que rebenta, DNS, radio do iOS ainda a acordar) e tempo, e tempo
 * tenta-se outra vez; um 4xx e uma RESPOSTA do servidor e repetir a pergunta
 * nao muda a resposta. 5xx fica no meio: uma tentativa extra apanha um
 * deploy ou um proxy a piscar. O 429 nunca ganha retry - o parking do
 * queryClient re-atira o erro guardado ANTES de haver rede, e 429 < 500 nao
 * passa o predicado de qualquer forma.
 *
 * Status 0 e "nao houve resposta": o proxy do SDK da-o a um timeout, e o
 * cliente autenticado da-o a um pedido que nem saiu por falta de token. Um
 * timeout e tempo, logo repete-se como qualquer erro de transporte; o pedido
 * sem token falha no local e sem rede, por isso repeti-lo nao custa nada.
 */
import { isApiError } from "@/domain/api";

export const QUERY_RETRY_LIMIT = 2;

export const shouldRetryQuery = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= QUERY_RETRY_LIMIT) return false;
  if (isApiError(error)) return error.status >= 500 || error.status === 0;
  return true;
};
