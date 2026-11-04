/**
 * Reagir à música sem complicar. O `Signal` já traz impulsos (beat, onset,
 * drop) e níveis (energy, bass...). Estes ajudantes transformam-nos em
 * acontecimentos ("bateu agora") e envolventes com o ataque e a queda que a
 * cena quer. Uma instância por cena, criada no `create()`.
 */
import type { Signal } from "./scene";

/** Verdadeiro uma vez por batida (quando `beatPos` passa um inteiro). `every` = de quantas em quantas. */
export class BeatEdge {
  private last = -1;
  constructor(private every = 1) {}
  hit(s: Signal): boolean {
    const n = Math.floor(s.beatPos / this.every);
    if (n === this.last) return false;
    const first = this.last < 0;
    this.last = n;
    return !first;
  }
  reset() { this.last = -1; }
}

/** Verdadeiro uma vez por compasso (4 batidas); `every` compassos. */
export class BarEdge extends BeatEdge {
  constructor(every = 1) { super(every * 4); }
}

/** Verdadeiro uma vez quando a secção muda; `big` diz se a nova é queda/refrão. */
export class SectionEdge {
  private last = -2;
  big = false;
  hit(s: Signal): boolean {
    if (s.sectionIndex === this.last) return false;
    const first = this.last === -2;
    this.last = s.sectionIndex;
    this.big = s.drop > 0.5;
    return !first;
  }
}

/** Verdadeiro quando `x` sobe acima de `on` (e só volta a disparar depois de descer abaixo de `off`). */
export class Trigger {
  private armed = true;
  constructor(private on = 0.8, private off = 0.4) {}
  hit(x: number): boolean {
    if (this.armed && x >= this.on) { this.armed = false; return true; }
    if (!this.armed && x <= this.off) this.armed = true;
    return false;
  }
}

/** Envolvente: sobe em `attack` s, desce em `release` s. `kick()` salta para 1. */
export class Envelope {
  v = 0;
  constructor(private attack = 0.01, private release = 0.3) {}
  step(target: number, dt: number): number {
    const tau = target > this.v ? this.attack : this.release;
    this.v += (target - this.v) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
    return this.v;
  }
  kick(x = 1) { this.v = Math.max(this.v, x); }
}

/** Fase dentro da batida (0..1) e dentro do compasso (0..1). */
export const beatPhase = (s: Signal) => s.beatPos - Math.floor(s.beatPos);
export const barPhase = (s: Signal) => s.bar - Math.floor(s.bar);
/** Um pulso afiado no início de cada batida: 1 -> 0, `sharp` maior = mais curto. */
export const pulse = (s: Signal, sharp = 6) => Math.exp(-beatPhase(s) * sharp);
/** Uma secção "forte" (queda, refrão, alta). */
export const isPeak = (s: Signal) => s.section === "drop" || s.section === "chorus" || s.section === "high";
/** Uma secção "calma" (intro, quebra, fim). */
export const isCalm = (s: Signal) => s.section === "intro" || s.section === "breakdown" || s.section === "outro";
/** O "peso" do momento, 0..1: mistura a energia, os graves e a intensidade da secção. */
export const weight = (s: Signal) => Math.min(1, 0.45 * s.energy + 0.3 * s.bass + 0.25 * s.sectionIntensity + 0.3 * s.drop);
