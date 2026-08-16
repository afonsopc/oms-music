/**
 * Puro (bun-testável): as contas do Rewind que a API ainda não faz por nós.
 * O endpoint devolve contagens e cada Song traz a duração em segundos, por
 * isso "quanto tempo deste às tuas top" e "que fatia foi para a número um"
 * são pura aritmética do cliente - nada de campos inventados.
 */

export interface PlayTally {
  play_count: number;
  /** Duração da faixa em segundos; ausente ou inválida conta zero. */
  duration: number | null | undefined;
}

/** Segundos totais: contagem x duração, somados sobre as faixas dadas. */
export const totalListenSeconds = (rows: readonly PlayTally[]): number =>
  rows.reduce(
    (acc, row) =>
      acc + row.play_count * (row.duration && row.duration > 0 ? row.duration : 0),
    0,
  );

/** O número que o cartão mostra: minutos inteiros, arredondados. */
export const totalListenMinutes = (rows: readonly PlayTally[]): number =>
  Math.round(totalListenSeconds(rows) / 60);

/**
 * Percentagem (0..100, inteira) das reproduções que foram para a PRIMEIRA
 * entrada do top. Sem reproduções não há fidelidade a medir: 0.
 */
export const loyaltyPercent = (counts: readonly number[]): number => {
  const total = counts.reduce((acc, n) => acc + n, 0);
  if (total <= 0) return 0;
  return Math.round((100 * (counts[0] ?? 0)) / total);
};
