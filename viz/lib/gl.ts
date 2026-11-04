/** WebGL mínimo: um triângulo que cobre o ecrã, programas (com cache), texturas e framebuffers para o retorno. */

export const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

export const compile = (gl: WebGL2RenderingContext, frag: string): WebGLProgram => {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  return prog;
};

export const fullscreenTriangle = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return vao;
};

export const textureFrom = (gl: WebGL2RenderingContext, src: TexImageSource | null): WebGLTexture => {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 40, 255]));
  return tex;
};

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export const target = (gl: WebGL2RenderingContext, w: number, h: number): Target => {
  const tex = textureFrom(gl, null);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
};

export const hexToVec = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Programas compilados guardados por fonte (os últimos 16), para voltar a
 * uma cena sem a pausa da compilação. `prewarmProgram` manda compilar sem
 * esperar (com KHR_parallel_shader_compile o driver fá-lo noutro fio); o
 * estado só se lê quando a cena entra. As cenas não apagam programas que
 * vêm daqui.
 */
const cache = new WeakMap<WebGL2RenderingContext, Map<string, { prog: WebGLProgram; checked: boolean }>>();
const startProgram = (gl: WebGL2RenderingContext, frag: string): WebGLProgram => {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  return prog;
};
const verify = (gl: WebGL2RenderingContext, prog: WebGLProgram) => {
  if (gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  const logs = gl.getAttachedShaders(prog)?.map((sh) => gl.getShaderInfoLog(sh)).filter(Boolean).join("\n");
  throw new Error(logs || gl.getProgramInfoLog(prog) || "shader");
};
const entryFor = (gl: WebGL2RenderingContext, frag: string) => {
  let m = cache.get(gl);
  if (!m) { m = new Map(); cache.set(gl, m); }
  let e = m.get(frag);
  if (e) {
    m.delete(frag);
    m.set(frag, e);
    return e;
  }
  gl.getExtension("KHR_parallel_shader_compile");
  e = { prog: startProgram(gl, frag), checked: false };
  m.set(frag, e);
  if (m.size > 16) {
    const [oldest, old] = m.entries().next().value!;
    m.delete(oldest);
    gl.deleteProgram(old.prog);
  }
  return e;
};
export const prewarmProgram = (gl: WebGL2RenderingContext, frag: string) => { entryFor(gl, frag); };
export const cachedProgram = (gl: WebGL2RenderingContext, frag: string): WebGLProgram => {
  const e = entryFor(gl, frag);
  if (!e.checked) {
    try {
      verify(gl, e.prog);
    } catch (err) {
      cache.get(gl)?.delete(frag);
      gl.deleteProgram(e.prog);
      throw err;
    }
    e.checked = true;
  }
  return e.prog;
};

/** As localizações dos uniformes de um programa, procuradas uma vez. */
export const uniforms = <K extends string>(gl: WebGL2RenderingContext, prog: WebGLProgram, names: readonly K[]): Record<K, WebGLUniformLocation | null> => {
  const out = {} as Record<K, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
};

export const deleteTarget = (gl: WebGL2RenderingContext, t: Target) => {
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
};

const tris = new WeakMap<WebGL2RenderingContext, WebGLVertexArrayObject>();
/** O triângulo de ecrã inteiro, um por contexto, partilhado por todas as cenas. */
export const sharedTriangle = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  let v = tris.get(gl);
  if (!v) { v = fullscreenTriangle(gl); tris.set(gl, v); }
  return v;
};
