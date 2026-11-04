/**
 * Um sistema de partículas em arrays tipados (sem objectos por partícula,
 * sem alocar no frame). Posição, velocidade, vida e um valor livre por
 * partícula; `emit` reutiliza as mortas.
 *
 *   const ps = new Particles(2000);
 *   if (edge.hit(s)) for (let i = 0; i < 80; i++) ps.emit(x, y, vx, vy, 1.5);
 *   ps.step(dt, 0, 300);               // gravidade
 *   ps.forEach((x, y, life, k) => ctx.fillRect(x, y, 2, 2));
 */
export class Particles {
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  /** Vida que falta (s) e a vida inicial; `data`: livre (cor, tamanho...). */
  readonly life: Float32Array; readonly max: Float32Array; readonly data: Float32Array;
  private next = 0;
  alive = 0;
  constructor(readonly capacity: number) {
    const n = capacity;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.data = new Float32Array(n);
  }
  emit(x: number, y: number, vx: number, vy: number, life: number, data = 0, z = 0, vz = 0): number {
    const n = this.capacity;
    let i = this.next;
    for (let k = 0; k < n; k++) {
      if (this.life[i] <= 0) break;
      i = (i + 1) % n;
    }
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.data[i] = data;
    this.next = (i + 1) % n;
    return i;
  }
  /** Avançar: aceleração (ax, ay, az) e atrito (0 = nenhum, por segundo). */
  step(dt: number, ax = 0, ay = 0, drag = 0, az = 0) {
    const k = drag > 0 ? Math.exp(-drag * dt) : 1;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vx[i] = (this.vx[i] + ax * dt) * k;
      this.vy[i] = (this.vy[i] + ay * dt) * k;
      this.vz[i] = (this.vz[i] + az * dt) * k;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      if (this.life[i] > 0) alive++;
    }
    this.alive = alive;
  }
  /** Para cada viva: (x, y, fracção de vida que falta 0..1, índice). */
  forEach(fn: (x: number, y: number, k: number, i: number) => void) {
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) fn(this.x[i], this.y[i], this.life[i] / this.max[i], i);
  }
  clear() { this.life.fill(0); this.alive = 0; }
}
