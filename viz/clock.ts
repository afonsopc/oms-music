/**
 * O relógio da letra: a posição que se ouve, a cada frame, a partir das
 * leituras do leitor (4 Hz no aparelho, 1 Hz a comandar outro). Partilhado
 * pela letra, pelo karaoke e pelo motor do visualizador.
 *
 *  - Uma leitura só conta quando a posição (ou o play, a velocidade, a
 *    música) muda: uma notificação da vista por outra razão (volume, fila)
 *    não pode recomeçar a extrapolação com a posição antiga, senão a letra
 *    recuava até 250 ms a cada mexida.
 *  - Entre leituras extrapola com a hora do aparelho, com tecto
 *    (MAX_EXTRAPOLATION_S): se as leituras param com a música a "tocar", a
 *    letra pára em vez de correr à frente da voz.
 *  - Uma leitura que discorda pouco da extrapolação (jitter do tique, < 250
 *    ms) não salta: a diferença desfaz-se em SLEW_S, sem palavras a
 *    piscar. Um seek ou um engasgo (mais do que isso) salta logo.
 *  - `delayMs` é o atraso da letra deste aparelho (definições): positivo
 *    atrasa a letra (colunas Bluetooth que o sistema não declara).
 *
 * Puro, sem DOM nem React: testado em bun.
 */

export const MAX_EXTRAPOLATION_S = 1.5;
export const SNAP_S = 0.25;
export const SLEW_S = 0.4;

export interface ClockReading {
  /** Segundos lidos do leitor. */
  position: number;
  playing: boolean;
  rate?: number;
  duration?: number;
  /** Muda de música: salta sempre. */
  key?: string;
}

export class LyricClock {
  private position = 0;
  private at = 0;
  private playing = false;
  private rate = 1;
  private duration = 0;
  private key: string | undefined;
  /** Diferença por desfazer (extrapolado - lido) e quando começou. */
  private bias = 0;
  private biasAt = 0;
  delayMs = 0;

  constructor(private readonly maxExtrapolationS = MAX_EXTRAPOLATION_S) {}

  /** Uma leitura do leitor no instante `now` (ms, a mesma hora do `at`). */
  read(r: ClockReading, now: number): void {
    const rate = r.rate || 1;
    const duration = r.duration ?? this.duration;
    const same =
      this.at > 0 && r.key === this.key && r.playing === this.playing && rate === this.rate && r.position === this.position;
    if (same) return;
    const continuous = this.at > 0 && r.key === this.key && r.playing && this.playing && rate === this.rate;
    const predicted = continuous ? this.raw(now) : r.position;
    const err = predicted - r.position;
    this.bias = continuous && Math.abs(err) < SNAP_S ? err : 0;
    this.biasAt = now;
    this.position = r.position;
    this.at = now;
    this.playing = r.playing;
    this.rate = rate;
    this.duration = duration;
    this.key = r.key;
  }

  /** A posição sem a calibração (s). */
  raw(now: number): number {
    if (!this.playing) return this.position;
    const elapsed = Math.min(Math.max((now - this.at) / 1000, 0), this.maxExtrapolationS);
    const left = this.bias === 0 ? 0 : this.bias * Math.max(0, 1 - (now - this.biasAt) / 1000 / SLEW_S);
    const t = this.position + elapsed * this.rate + left;
    return this.duration > 0 ? Math.min(t, this.duration) : t;
  }

  /** O instante da letra que se ouve agora (s). */
  now(now: number): number {
    return this.raw(now) - this.delayMs / 1000;
  }

  get isPlaying(): boolean {
    return this.playing;
  }
}
