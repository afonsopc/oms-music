/**
 * Web fork of the average-color extraction (Metro picks .web.ts; plano "uma
 * so app", F1). The native path asks expo-image for a [1,1] blurhash whose
 * DC component is the image's sRGB average - but the web implementation of
 * generateBlurhashAsync always throws, which used to collapse every gradient
 * (Now Playing backdrop, collection Heros, artist scrims) into the fixed
 * fallback: the most visible piece of the design, off in silence.
 *
 * Same contract by browser means: decode the artwork, draw it into a small
 * canvas and average the pixels. drawImage's downsampling does most of the
 * averaging; the loop folds the remaining 32x32, alpha-weighted so
 * transparent padding does not drag the accent toward black.
 *
 * Cross-origin artwork must load with `crossOrigin = "anonymous"` - a
 * tainted canvas throws on getImageData. When storage answers without CORS
 * headers the load (or the read) fails, the throw lands in resolveAccent's
 * catch, and the fixed fallback pair renders: exactly the behavior the whole
 * web build had before this fork, image by image instead of always.
 */
import { rgbToHex } from "./accentMath";

const SAMPLE_EDGE = 32;

const loadImage = (uri: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the artwork"));
    image.src = uri;
  });

/**
 * O /media/:id/data só responde com sessão e redirecciona para o MinIO: um
 * pedido anónimo (crossOrigin) dá 404 na web com cookie, e a capa nunca
 * chegava ao canvas (tons sempre neutros). Pede-se o URL assinado
 * (/media/:id/data_url, com a sessão) e lê-se esse, que tem CORS aberto.
 */
const signedUrl = async (uri: string): Promise<string> => {
  const m = uri.match(/^(.*\/media\/[^/?]+)\/data(\?.*)?$/);
  if (!m) return uri;
  try {
    const res = await fetch(`${m[1]}/data_url${m[2] ?? ""}`, { credentials: "include" });
    if (!res.ok) return uri;
    const body = (await res.json()) as { url?: string };
    return body.url || uri;
  } catch {
    return uri;
  }
};

export const extractAverageHex = async (imageUri: string): Promise<string> => {
  const image = await loadImage(await signedUrl(imageUri));
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_EDGE;
  canvas.height = SAMPLE_EDGE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2d canvas context");
  context.drawImage(image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);

  const { data } = context.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    r += data[i] * alpha;
    g += data[i + 1] * alpha;
    b += data[i + 2] * alpha;
    weight += alpha;
  }
  if (weight === 0) throw new Error("Fully transparent artwork");
  return rgbToHex(r / weight, g / weight, b / weight);
};
