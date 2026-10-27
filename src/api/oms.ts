/**
 * O único cliente HTTP da app: o `@omelhorsite/sdk` (DESIGN.md secção 5).
 *
 * Duas instâncias, ambas memoizadas e embrulhadas pelo proxy de erros de
 * `./omsProxy`:
 *
 *  - `oms()` é o cliente AUTENTICADO. Numa origem cookie
 *    (music.omelhorsite.pt, ver auth/authMode.ts) pede ao browser que junte
 *    o cookie httpOnly (`sessionCookie: true`) e nunca manda Bearer; em todo
 *    o lado o token guardado ride como Bearer, lido do espelho síncrono em
 *    auth/token.ts a cada pedido. Sem token e fora de uma origem cookie o
 *    pedido nem sai (tokens ausentes contam para o bucket anónimo).
 *  - `omsPublic()` é o cliente ANÓNIMO para os endpoints que o cliente antigo
 *    chamava com `auth: false` (login, signup, reset, adopt, passkeys,
 *    pesquisa de utilizadores). Nunca manda Bearer e um 401 seu não acorda o
 *    guard - é a resposta normal a uma password errada.
 *
 * A decisão cookie/Bearer é feita em tempo de chamada, como antes: mudar de
 * modo reconstrói as duas instâncias.
 */
import { Oms, file as sdkFile, type FetchLike, type FileInput, type NativeFile } from "@omelhorsite/sdk";
import { isCookieAuth } from "@/auth/authMode";
import { getToken } from "@/auth/token";
import { buildUserAgent } from "@/auth/userAgent";
import { NotAuthenticatedError, translateErrors } from "./omsProxy";

export { setAuthFailureHandler } from "./omsProxy";

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? "https://backend.omelhorsite.pt";

/** O mesmo tecto do cliente antigo; os métodos lentos do SDK (imports,
 *  letras, separação) trazem os seus próprios prazos por chamada. */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * `cache: "no-store"` em todos os pedidos, como o cliente antigo: a app não
 * manda validadores e não quer que a stack nativa lhe devolva um 304 vazio
 * (DESIGN 5.6). O fetch injectado é a forma que o SDK dá de o fazer.
 */
const noStoreFetch: FetchLike = (url, init) => fetch(url, { ...init, cache: "no-store" });

const commonOptions = () => ({
  baseUrl: API_BASE_URL,
  fetch: noStoreFetch,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  // Sem retries no transporte: a react-query já repete erros de transporte e
  // 5xx (api/retryPolicy.ts) e o 429 tem o parking próprio (queries/common),
  // que nunca deve ser adiado por uma espera escondida no SDK.
  retry: false as const,
  clientName: buildUserAgent(),
  // O servidor lê o User-Agent no POST /sessions para baptizar o dispositivo
  // no ecrã de sessões; os browsers ignoram este header, o nativo honra-o.
  headers: { "User-Agent": buildUserAgent() },
});

let cookieMode: boolean | null = null;
let authedClient: Oms | null = null;
let publicClient: Oms | null = null;

const syncMode = (): boolean => {
  const cookie = isCookieAuth();
  if (cookieMode !== cookie) {
    cookieMode = cookie;
    authedClient = null;
    publicClient = null;
  }
  return cookie;
};

/** O cliente autenticado. Memoizado; construir não faz I/O. */
export const oms = (): Oms => {
  const cookie = syncMode();
  if (authedClient) return authedClient;
  const client = cookie
    ? new Oms({ ...commonOptions(), sessionCookie: true })
    : new Oms({
        ...commonOptions(),
        tokens: {
          getToken: () => {
            const token = getToken();
            if (!token) throw new NotAuthenticatedError();
            return token;
          },
        },
      });
  authedClient = translateErrors(client, { notifyAuthFailure: true });
  return authedClient;
};

/**
 * O cliente anónimo. Numa origem cookie continua a mandar credenciais: o
 * Set-Cookie de /sessions e de /sessions/adopt só é processado pelo browser
 * numa resposta credenciada.
 */
export const omsPublic = (): Oms => {
  const cookie = syncMode();
  if (publicClient) return publicClient;
  const client = cookie
    ? new Oms({ ...commonOptions(), sessionCookie: true })
    : new Oms(commonOptions());
  publicClient = translateErrors(client, { notifyAuthFailure: false });
  return publicClient;
};

/** O que os pickers da app devolvem: `{ uri, name, type }` no nativo, um
 *  `File` do browser alargado com `uri` na web (settings/pickers.web.ts). */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

/**
 * Converte um ficheiro escolhido no que o SDK aceita num multipart.
 *
 * Na web o objecto é um `File` real: vai como bytes (`file(blob, name)`),
 * cortado com `slice` para largar os expandos `uri`/`relativePath` - com
 * eles o SDK tomava-o por um descritor nativo e recusava-o. No React Native
 * é o descritor `{ uri, name, type }` e segue verbatim: é o que o `FormData`
 * do RN sabe transmitir a partir do disco (um Blob aí carrega o ficheiro
 * inteiro para memória e no Android chega truncado - ver `NativeFile` no SDK).
 */
export const toFileInput = (picked: PickedFile): FileInput | NativeFile => {
  if (typeof Blob !== "undefined" && picked instanceof Blob) {
    const blob = picked as Blob;
    return sdkFile(blob.slice(0, blob.size, blob.type), picked.name, {
      contentType: picked.type || undefined,
      size: blob.size,
    });
  }
  return {
    uri: picked.uri,
    name: picked.name,
    type: picked.type || undefined,
    ...(picked.size === undefined ? {} : { size: picked.size }),
  };
};
