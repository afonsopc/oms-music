/** Ruído em JS (para Canvas/DOM; nos shaders use-se o do GLSL_HEAD). Sem alocar. */
const P = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
export const hash2 = (x: number, y: number) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
/** Perlin 2D em [-1, 1]. */
export const noise2 = (x: number, y: number) => {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const a = P[X] + Y, b = P[X + 1] + Y;
  const l1 = grad2(P[a], x, y) + u * (grad2(P[b], x - 1, y) - grad2(P[a], x, y));
  const l2 = grad2(P[a + 1], x, y - 1) + u * (grad2(P[b + 1], x - 1, y - 1) - grad2(P[a + 1], x, y - 1));
  return (l1 + v * (l2 - l1)) * 0.7071;
};
const grad3 = (h: number, x: number, y: number, z: number) => {
  const k = h & 15, u = k < 8 ? x : y, v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) ? -u : u) + ((k & 2) ? -v : v);
};
/** Perlin 3D em ~[-1, 1] (o terceiro eixo costuma ser o tempo). */
export const noise3 = (x: number, y: number, z: number) => {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const L = (a: number, b: number, t: number) => a + t * (b - a);
  return L(
    L(L(grad3(P[AA], x, y, z), grad3(P[BA], x - 1, y, z), u), L(grad3(P[AB], x, y - 1, z), grad3(P[BB], x - 1, y - 1, z), u), v),
    L(L(grad3(P[AA + 1], x, y, z - 1), grad3(P[BA + 1], x - 1, y, z - 1), u), L(grad3(P[AB + 1], x, y - 1, z - 1), grad3(P[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
};
/** Ruído fractal (soma de oitavas) 2D, ~[-1, 1]. */
export const fbm2 = (x: number, y: number, oct = 4) => {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return v;
};
