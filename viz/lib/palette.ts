/**
 * As cores. O motor dá a cada cena as três cores da capa (env.colors em
 * hex, env.colorVecs em 0..1, já a deslizar entre músicas). Estes
 * ajudantes misturam-nas, fazem gradientes e, se preciso, tiram cores de
 * uma imagem (a galeria usa-o com a capa de teste).
 */
export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const h2 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
export const rgbToHex = (c: RGB) => `#${h2(c[0])}${h2(c[1])}${h2(c[2])}`;
/** `rgba(...)` para o Canvas 2D a partir de um vector 0..1. */
export const css = (c: readonly number[], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** Mistura em `out` (sem alocar). */
export const mixInto = (out: number[], a: readonly number[], b: readonly number[], k: number) => {
  out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
};

/** A paleta cíclica das três cores, como o `pal()` do GLSL: t em [0, 1) -> cor em `out`. */
export const palInto = (out: number[], cols: readonly (readonly number[])[], t: number) => {
  t -= Math.floor(t);
  if (t < 1 / 3) return mixInto(out, cols[0], cols[1], t * 3);
  if (t < 2 / 3) return mixInto(out, cols[1], cols[2], (t - 1 / 3) * 3);
  return mixInto(out, cols[2], cols[0], (t - 2 / 3) * 3);
};

export const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** HSL (0..1) -> RGB. */
export const hsl = (h: number, s: number, l: number): RGB => {
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
};

/**
 * Três cores dominantes de uma imagem (quantização simples em 4x4x4 cubos,
 * preferindo as saturadas). Corre uma vez por capa, não por frame.
 */
export const paletteFromImage = (img: CanvasImageSource): [string, string, string] => {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const k = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    const bin = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const w = 1 + sat / 64;
    bin.n += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
    bins.set(k, bin);
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((v) => rgbToHex([v.r / v.n / 255, v.g / v.n / 255, v.b / v.n / 255]));
  while (top.length < 3) top.push(top[0] ?? "#888888");
  return top as [string, string, string];
};
