/**
 * 3D mínimo para Canvas 2D e WebGL: vectores em arrays, matrizes 4x4 em
 * Float32Array (coluna a coluna, como o WebGL). As funções escrevem em `out`
 * para não alocar no frame.
 */
export type Vec3 = [number, number, number] | Float32Array;
export type Mat4 = Float32Array;

export const mat4 = (): Mat4 => identity(new Float32Array(16));
export const identity = (o: Mat4) => { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; };

export const perspective = (o: Mat4, fovy: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o.fill(0);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
};

export const lookAt = (o: Mat4, eye: ArrayLike<number>, at: ArrayLike<number>, up: ArrayLike<number> = [0, 1, 0]) => {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
};

/** o = a * b */
export const multiply = (o: Mat4, a: Mat4, b: Mat4) => {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
};

/** Rotação em torno de X/Y/Z (radianos), escrita de raiz em `o`. */
export const rotationXYZ = (o: Mat4, ax: number, ay: number, az: number) => {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  o[0] = cy * cz; o[1] = cy * sz; o[2] = -sy; o[3] = 0;
  o[4] = sx * sy * cz - cx * sz; o[5] = sx * sy * sz + cx * cz; o[6] = sx * cy; o[7] = 0;
  o[8] = cx * sy * cz + sx * sz; o[9] = cx * sy * sz - sx * cz; o[10] = cx * cy; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
};

/** Rodar um ponto (x, y, z) em Y e depois em X, para o Canvas 2D; escreve em `out`. */
export const rotateYX = (out: number[] | Float32Array, x: number, y: number, z: number, ay: number, ax: number) => {
  const X = x * Math.cos(ay) - z * Math.sin(ay);
  let Z = x * Math.sin(ay) + z * Math.cos(ay);
  const Y = y * Math.cos(ax) - Z * Math.sin(ax);
  Z = y * Math.sin(ax) + Z * Math.cos(ax);
  out[0] = X; out[1] = Y; out[2] = Z;
  return out;
};

/**
 * Projecção em perspectiva simples para o Canvas 2D: câmara em z = -dist a
 * olhar para a origem; escreve [sx, sy, escala] em `out` (escala <= 0: atrás da câmara).
 */
export const project = (out: number[] | Float32Array, x: number, y: number, z: number, w: number, h: number, dist = 3.5, fov = 0.5) => {
  const k = dist / (dist + z);
  const f = Math.min(w, h) * fov;
  out[0] = w / 2 + x * k * f;
  out[1] = h / 2 + y * k * f;
  out[2] = dist + z > 0 ? k : 0;
  return out;
};
