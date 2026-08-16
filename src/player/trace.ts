/**
 * Trace de reprodução (bug do "skipzito" pós-interrupção, dono 2026-08-17):
 * um anel dos últimos eventos do motor - intenções, seeks COM O AUTOR de
 * cada um, flips de estado, vigilantes e recuperações - que o dono copia
 * das definições e cola num issue. Existe porque a única maneira de
 * distinguir "vigilante a dar nudges a um player saudável" de "escada de
 * recuperação em loop" e de "duas fontes a corrigir-se" é ver a sequência
 * real no dispositivo real; nenhuma delas se reproduz nesta máquina.
 *
 * Sempre ligado de propósito: umas centenas de strings curtas em memória
 * custam nada, e o bug nunca acontece quando há um profiler pendurado.
 */

export interface PlaybackTraceEntry {
  at: number;
  tag: string;
  detail: string;
}

const LIMIT = 400;

let ring: PlaybackTraceEntry[] = [];

const compact = (detail: Record<string, unknown>): string =>
  Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === "number" ? Number(v.toFixed?.(2) ?? v) : String(v)}`)
    .join(" ");

export const tracePlayback = (tag: string, detail: Record<string, unknown> = {}): void => {
  ring.push({ at: Date.now(), tag, detail: compact(detail) });
  if (ring.length > LIMIT) ring = ring.slice(ring.length - LIMIT);
};

export const playbackTraceEntries = (): readonly PlaybackTraceEntry[] => ring;

/** Uma linha por evento, hora ISO curta, pronto a colar. */
export const playbackTraceText = (): string =>
  ring
    .map((e) => {
      const iso = new Date(e.at).toISOString().slice(11, 23);
      return `${iso} ${e.tag}${e.detail ? ` ${e.detail}` : ""}`;
    })
    .join("\n");

export const clearPlaybackTrace = (): void => {
  ring = [];
};
