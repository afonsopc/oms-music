/**
 * Uma música de mentira para a galeria e os testes: 96 s a 128 BPM com
 * intro, verso, subida, queda, quebra, refrão (que volta), alta e fim; um
 * bombo em cada batida, tarola nas 2 e 4, chimbal nos oitavos, e a
 * energia a seguir as secções. Sempre igual (sem aleatórios). Vem no mesmo
 * formato que o backend manda (base64), para passar pelo `decode` a sério.
 * E uma capa de teste desenhada (sem ficheiros nem rede).
 */
import type { VizAnalysis, VizSection } from "../protocol";

const SECTIONS: [number, VizSection["type"], number, number, boolean][] = [
  [0, "intro", 0.25, 0, false],
  [7.5, "verse", 0.45, 1, false],
  [22.5, "build", 0.65, 2, false],
  [30, "drop", 0.95, 3, true],
  [45, "breakdown", 0.3, 4, false],
  [52.5, "chorus", 0.85, 5, true],
  [67.5, "verse", 0.5, 1, false],
  [75, "chorus", 0.9, 5, true],
  [82.5, "high", 1, 6, true],
  [90, "outro", 0.2, 7, false],
];
export const CANNED_DURATION = 96;
export const CANNED_BPM = 128;

const b64 = (a: Uint8Array) => {
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
};

/** A intensidade da secção em t (s). */
const secAt = (t: number) => {
  let k = SECTIONS[0];
  for (const s of SECTIONS) if (s[0] <= t) k = s;
  return k;
};

export const cannedAnalysis = (): VizAnalysis => {
  const fps = 25, n = CANNED_DURATION * fps, period = 60 / CANNED_BPM;
  const env = new Uint8Array(n), bands = [0, 1, 2, 3].map(() => new Uint8Array(n));
  const beats: number[] = [], onsets: number[] = [];
  for (let b = 0; b * period < CANNED_DURATION; b++) {
    const t = b * period;
    beats.push(Math.round(t * 1000));
    const [, type] = secAt(t);
    if (type !== "intro" && type !== "breakdown" && type !== "outro") onsets.push(Math.round(t * 1000));
    if (b % 4 === 3 && type === "build") onsets.push(Math.round((t + period / 2) * 1000));
  }
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const [, type, inten] = secAt(t);
    const ph = (t / period) % 1, beatN = Math.floor(t / period);
    const quiet = type === "intro" || type === "breakdown" || type === "outro";
    const kick = quiet ? 0 : Math.exp(-ph * 7);
    const snare = !quiet && beatN % 2 === 1 ? Math.exp(-ph * 9) : 0;
    const hat = Math.exp(-((t / (period / 2)) % 1) * 12);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
    const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    bands[0][i] = c(0.15 + 0.55 * inten * (0.35 + kick));
    bands[1][i] = c(0.2 + 0.45 * inten * (0.5 + 0.5 * snare + 0.2 * swell));
    bands[2][i] = c(0.25 + 0.4 * inten * (0.6 + 0.4 * swell + 0.3 * snare));
    bands[3][i] = c(0.1 + 0.5 * inten * (0.3 + 0.7 * hat));
    env[i] = c(0.12 + 0.75 * inten * (0.7 + 0.3 * kick));
  }
  return {
    v: 2, fps, duration: CANNED_DURATION * 1000, bpm: CANNED_BPM,
    beats, onsets, env: b64(env), bands: bands.map(b64),
    sections: SECTIONS.map(([t, type, intensity, group, big]) => ({ t: t * 1000, type, intensity, group, big })),
  };
};

/** Linhas de letra de teste (com palavras), para ver os estilos de letra por cima das cenas. */
export const cannedLyrics = () => {
  const lines = ["luz no fundo do rio", "a cidade a dormir", "ninguém sabe o caminho", "e eu fico por aqui"];
  const out: { t: number; end: number; text: string; words: [number, number, string][] }[] = [];
  for (let k = 0; k * 3.75 < CANNED_DURATION - 4; k++) {
    const t = 4 + k * 3.75, text = lines[k % lines.length], ws = text.split(" ");
    out.push({ t, end: t + 3.4, text, words: ws.map((w, i) => [t + i * 0.45, t + i * 0.45 + 0.4, w] as [number, number, string]) });
  }
  return out;
};

/** A capa de teste: formas fortes e três cores claras (para se ver onde a capa entra). */
export const testArtwork = (size = 512): string => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "#ff5a36");
  g.addColorStop(0.55, "#c2185b");
  g.addColorStop(1, "#2a1b6e");
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  x.fillStyle = "#ffd54a";
  x.beginPath();
  x.arc(size * 0.66, size * 0.34, size * 0.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#14d3c2";
  for (let i = 0; i < 6; i++) x.fillRect(0, size * (0.62 + i * 0.06), size, size * 0.025);
  x.fillStyle = "#fff";
  x.font = `bold ${size * 0.16}px system-ui, sans-serif`;
  x.fillText("OMS", size * 0.07, size * 0.22);
  return c.toDataURL("image/png");
};
