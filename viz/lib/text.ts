/**
 * Texto: partir em linhas, caber numa largura e passar texto para uma
 * textura WebGL. As fontes à mão: "OMSWide" (a do logótipo, carregada pelo
 * motor), system-ui, ui-monospace.
 */
export const WIDE = "OMSWide, system-ui, sans-serif";
export const MONO = "ui-monospace, Menlo, monospace";

/** Partir `text` em linhas que cabem em `maxW` com a fonte já posta em `ctx.font`. */
export const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
};

/** O maior tamanho (px) até `max` com que `text` cabe numa linha de `maxW`. */
export const fitSize = (ctx: CanvasRenderingContext2D, text: string, maxW: number, font: (px: number) => string, max = 200, min = 8) => {
  ctx.font = font(100);
  const w = ctx.measureText(text).width || 1;
  return Math.max(min, Math.min(max, Math.floor((100 * maxW) / w)));
};

/**
 * Um canvas com texto, para usar como textura (ou drawImage). Guarde o
 * resultado e só o refaça quando o texto muda (não por frame).
 */
export const textCanvas = (text: string, opts: { font?: string; size?: number; color?: string; pad?: number; canvas?: HTMLCanvasElement } = {}) => {
  const size = opts.size ?? 128, pad = opts.pad ?? size * 0.2;
  const c = opts.canvas ?? document.createElement("canvas");
  const x = c.getContext("2d")!;
  const font = `${size}px ${opts.font ?? WIDE}`;
  x.font = font;
  const w = Math.ceil(x.measureText(text).width + pad * 2);
  c.width = Math.max(2, w);
  c.height = Math.ceil(size * 1.3 + pad * 2);
  x.font = font;
  x.textBaseline = "middle";
  x.fillStyle = opts.color ?? "#fff";
  x.fillText(text, pad, c.height / 2);
  return c;
};

/** Enviar um canvas para uma textura (cria-a na primeira vez). */
export const uploadTexture = (gl: WebGL2RenderingContext, src: TexImageSource, tex: WebGLTexture | null = null) => {
  const t = tex ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return t;
};

/** Escapar texto para pôr em innerHTML (títulos e letras vêm dos utilizadores). */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
