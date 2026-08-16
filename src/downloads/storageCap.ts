/**
 * Storage cap (FR-94, SPEC AC: "exceeding the cap blocks new enqueues with an
 * explanation"). A quota aplicada é a do armazenamento de música da conta
 * (GET /music/storage - o mesmo endpoint que a overview já lia só para
 * mostrar): quando o total LOCAL já a excede, um download novo é recusado com
 * aviso, exactamente como o gate de WiFi recusa em vez de enfileirar às
 * escondidas (FR-88).
 *
 * A quota fica em memória com TTL e é refrescada em fundo: o enfileiramento
 * corre dentro de loops de colecção e nunca pode pagar um round-trip de rede
 * por música (regras do relatório de freeze 2026-08-14). Sem leitura ainda
 * (arranque, offline) a resposta é "não sei" e o download passa - recusar
 * porque a REDE falhou seria castigar o utilizador pelo nosso azar, e o
 * servidor continua a ser a autoridade real da quota.
 */
import { getMusicStorage } from "@/api/endpoints/musicStorage";

export class StorageCapError extends Error {
  readonly i18nKey = "native.downloads.storageCapRefused";
  constructor() {
    super("Music storage limit reached - download refused.");
    this.name = "StorageCapError";
  }
}

export const isStorageCapError = (e: unknown): e is StorageCapError =>
  e instanceof StorageCapError;

/** Uma quota não muda ao minuto; 5 min chegam para o gate dizer a verdade. */
const TTL_MS = 5 * 60 * 1000;

let limitBytes: number | null = null;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;

/** A última quota conhecida (null = ainda nenhuma leitura bem-sucedida). */
export const storageCapLimitBytes = (): number | null => limitBytes;

/** Refresca a quota quando o TTL passou. Nunca rejeita; falhas mantêm o
 *  último valor conhecido, que continua a ser melhor do que nenhum. */
export const refreshStorageCap = (): Promise<void> => {
  if (inFlight) return inFlight;
  if (limitBytes != null && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  inFlight = getMusicStorage()
    .then((storage) => {
      limitBytes = storage.limit_bytes;
      fetchedAt = Date.now();
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};

/**
 * O gate de enfileiramento: lança StorageCapError quando o total local já
 * excede a quota conhecida. Dispara o refresh em fundo para a PRÓXIMA
 * decisão; a actual responde com o valor que há - a mesma postura do
 * wifiGate, que responde com o NetInfo que há e permite quando não sabe.
 */
export const assertUnderStorageCap = (localBytes: number): void => {
  void refreshStorageCap();
  if (limitBytes != null && limitBytes > 0 && localBytes >= limitBytes) {
    throw new StorageCapError();
  }
};

/** Higiene de testes: repõe o estado do módulo. */
export const resetStorageCapForTests = (): void => {
  limitBytes = null;
  fetchedAt = 0;
  inFlight = null;
};
