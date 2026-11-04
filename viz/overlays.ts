/**
 * O que aparece POR CIMA das cenas (ronda 2, pedido do dono): a letra em
 * momentos, a capa em momentos e o cartão do título no início de cada
 * música. Tudo DOM com transformações e animações na GPU (Web Animations);
 * nada por frame além de mudar opacidades e escalas.
 *
 * A letra segue as secções: com "às vezes" aparece nos refrões, nas quedas e
 * nos 10 s depois de um momento grande, e de 4 em 4 linhas no resto; com
 * "sempre", sempre. Cada palavra salta no seu tempo; as longas (> 0,6 s)
 * ficam maiores e a brilhar. O estilo vem do `meta.lyrics` da cena: 3D extrudido nas de
 * protector de ecrã, falhada nas de glitch, ASCII nas de terminal, néon nas
 * de synthwave, tinta nas calmas.
 */
import { WORD_LEAD_S } from "./lib/scene";
import type { LyricsMode, VizLyricLine, VizSection, VizSong } from "./protocol";

export type LyricStyle = "extrude" | "glitch" | "ascii" | "neon" | "ink" | "none";

const CSS = `
.vz-lyr{position:fixed;left:6vw;right:6vw;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none;z-index:5;display:flex;flex-wrap:wrap;justify-content:center;gap:.25em .4em;transition:opacity .45s ease}
.vz-w{display:inline-block;margin:0 .14em;opacity:0;transform:scale(.6) translateY(.3em);transition:opacity .12s ease-out,transform .22s cubic-bezier(.2,1.6,.4,1);will-change:transform,opacity;position:relative}
.vz-w.on{opacity:1;transform:none}
.vz-w.long.on{transform:scale(1.18)}
.vz-extrude{font-family:OMSWide,system-ui,sans-serif;font-size:min(7vw,72px);color:#fff;perspective:600px}
.vz-extrude .vz-w{text-shadow:1px 1px 0 #444,2px 2px 0 #3a3a3a,3px 3px 0 #303030,4px 4px 0 #262626,5px 5px 0 #1c1c1c,6px 6px 0 #111,8px 10px 18px rgba(0,0,0,.6)}
.vz-extrude .vz-w.on{animation:vzSpin 1.2s cubic-bezier(.2,.8,.2,1)}
@keyframes vzSpin{0%{transform:rotateY(-80deg) scale(.7)}100%{transform:rotateY(0) scale(1)}}
.vz-glitch{font:900 min(7.5vw,80px)/1 system-ui,sans-serif;color:#fff;text-transform:uppercase;letter-spacing:-.02em}
.vz-glitch .vz-w.on{text-shadow:-3px 0 #ff1f5a,3px 0 #22e5ff;animation:vzJit .18s steps(2) 3}
@keyframes vzJit{0%{transform:translate(2px,-1px) skewX(6deg)}50%{transform:translate(-3px,1px) skewX(-8deg)}100%{transform:none}}
.vz-ascii{font:700 min(5.5vw,56px)/1.1 ui-monospace,Menlo,monospace;color:#7dffb0;text-shadow:0 0 8px #3dff8a}
.vz-ascii .vz-w::before{content:""}
.vz-neon{font:800 italic min(7vw,76px)/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 6px #fff,0 0 18px var(--neon),0 0 42px var(--neon),0 0 80px var(--neon)}
.vz-ink{font:600 min(6vw,62px)/1.15 system-ui,sans-serif;color:rgba(255,255,255,.95);text-shadow:0 2px 30px rgba(0,0,0,.6)}
.vz-ink .vz-w{filter:blur(6px);transition:opacity .5s ease,filter .7s ease,transform .7s ease}
.vz-ink .vz-w.on{filter:blur(0)}
.vz-chorus{transform:translateY(-50%) scale(1.18)}
.vz-extrude .vz-long,.vz-ink .vz-long,.vz-neon .vz-long{color:var(--hot,#fff)}
.vz-card{position:fixed;left:6vw;bottom:14vh;pointer-events:none;z-index:6;color:#fff;transition:opacity .8s ease,transform .8s ease}
.vz-card b{display:block;font-family:OMSWide,system-ui,sans-serif;font-size:min(6vw,64px);line-height:1;text-shadow:3px 3px 0 #000,6px 6px 0 rgba(0,0,0,.4)}
.vz-card span{display:inline-block;margin-top:.6em;font:600 min(2.4vw,22px)/1 system-ui,sans-serif;background:#fff;color:#000;padding:.3em .6em}
.vz-art{position:fixed;left:50%;top:50%;width:min(46vmin,420px);height:min(46vmin,420px);margin:calc(min(46vmin,420px)/-2) 0 0 calc(min(46vmin,420px)/-2);pointer-events:none;z-index:4;perspective:900px}
.vz-art > div{position:absolute;inset:0;background-size:cover;background-position:center;box-shadow:0 30px 80px rgba(0,0,0,.6);border-radius:6px}
`;

let styleAdded = false;
const addStyle = () => {
  if (styleAdded) return;
  styleAdded = true;
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
};

const repeated = (lines: VizLyricLine[]): Set<string> => {
  const count = new Map<string, number>();
  for (const l of lines) {
    const k = l.text.trim().toLowerCase();
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k));
};

/**
 * As palavras da linha com o tempo de cada uma (s da música), ou null quando
 * a linha não as tem (as cenas estimam pelo tamanho). Numa linha `whole` (o
 * alinhador não confia) todas acendem no início da linha.
 */
export const lineWordTimes = (line: VizLyricLine | null): [number, number, string][] | null => {
  if (!line) return null;
  if (line.words && line.words.length && !line.whole) return line.words;
  if (line.whole) return line.text.split(/\s+/).filter(Boolean).map((w): [number, number, string] => [line.t, line.end, w]);
  return null;
};

export class Overlays {
  private lines: VizLyricLine[] | null = null;
  private songId = "";
  private chorusText = new Set<string>();
  private lineEl: HTMLDivElement | null = null;
  private lineIndex = -1;
  private wordEls: { el: HTMLSpanElement; t: number }[] = [];
  private card: HTMLDivElement | null = null;
  private lastBigAt = -99;
  private cardUntil = 0;

  constructor() {
    addStyle();
  }

  setLyrics(songId: string, lines: VizLyricLine[] | null) {
    this.songId = songId;
    this.lines = lines && lines.length ? lines : null;
    this.chorusText = this.lines ? repeated(this.lines) : new Set();
    this.clearLine();
  }

  /** O cartão do título, no início da música, a sair sozinho. */
  titleCard(song: VizSong | null) {
    this.card?.remove();
    if (!song) return;
    const c = document.createElement("div");
    c.className = "vz-card";
    const b = document.createElement("b");
    b.textContent = song.title;
    const s = document.createElement("span");
    s.textContent = song.artist;
    c.append(b, s);
    c.style.opacity = "0";
    c.style.transform = "translateX(-40px)";
    document.body.appendChild(c);
    requestAnimationFrame(() => {
      c.style.opacity = "1";
      c.style.transform = "none";
    });
    setTimeout(() => {
      c.style.opacity = "0";
      c.style.transform = "translateX(40px)";
      setTimeout(() => c.remove(), 900);
    }, 4800);
    this.card = c;
    this.cardUntil = performance.now() + 5200;
  }

  /** Um momento grande (queda, refrão): a letra fica à vista 10 s, e a capa entra. */
  bigMoment(t: number, cover: HTMLImageElement | null, intensity: number) {
    this.lastBigAt = t;
    if (cover && Math.random() < 0.75) this.artMoment(cover, intensity);
  }

  minorMoment(cover: HTMLImageElement | null) {
    if (cover && Math.random() < 0.25) this.artMoment(cover, 0.4);
  }

  /** A capa a entrar: voo com volta 3D, estilhaço em ladrilhos, píxeis, ou caleidoscópio. */
  artMoment(cover: HTMLImageElement, intensity: number) {
    const host = document.createElement("div");
    host.className = "vz-art";
    document.body.appendChild(host);
    const url = `url("${cover.src}")`;
    const kind = ["fly", "shatter", "pixel", "kaleido"][Math.floor(Math.random() * 4)];
    const done = () => setTimeout(() => host.remove(), 3400);
    if (kind === "fly" || kind === "pixel") {
      const d = document.createElement("div");
      d.style.backgroundImage = url;
      if (kind === "pixel") d.style.imageRendering = "pixelated";
      host.appendChild(d);
      d.animate(
        kind === "fly"
          ? [
              { transform: "translateZ(-1600px) rotateY(-540deg) rotateX(30deg)", opacity: 0 },
              { transform: "translateZ(0) rotateY(0) rotateX(0)", opacity: 1, offset: 0.45 },
              { transform: "translateZ(0) rotateY(12deg)", opacity: 1, offset: 0.8 },
              { transform: "translateZ(600px) rotateY(90deg)", opacity: 0 },
            ]
          : [
              { transform: "scale(.2)", filter: "blur(0) contrast(2)", opacity: 0 },
              { transform: "scale(1)", opacity: 1, offset: 0.2 },
              { transform: "scale(1.05)", opacity: 1, offset: 0.8 },
              { transform: "scale(1.6)", opacity: 0 },
            ],
        { duration: 3000 + 600 * intensity, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
    } else if (kind === "shatter") {
      const n = 4;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const d = document.createElement("div");
          Object.assign(d.style, {
            inset: "auto",
            left: `${(x / n) * 100}%`,
            top: `${(y / n) * 100}%`,
            width: `${100 / n}%`,
            height: `${100 / n}%`,
            backgroundImage: url,
            backgroundSize: `${n * 100}% ${n * 100}%`,
            backgroundPosition: `${(x / (n - 1)) * 100}% ${(y / (n - 1)) * 100}%`,
            borderRadius: "0",
            boxShadow: "none",
          });
          host.appendChild(d);
          const dx = (x - 1.5) * 260 * (0.6 + Math.random()), dy = (y - 1.5) * 260 * (0.6 + Math.random());
          d.animate(
            [
              { transform: "none", opacity: 0 },
              { transform: "none", opacity: 1, offset: 0.15 },
              { transform: "none", opacity: 1, offset: 0.45 },
              { transform: `translate(${dx}px,${dy}px) rotate(${(Math.random() - 0.5) * 220}deg) scale(.6)`, opacity: 0 },
            ],
            { duration: 2600, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" },
          );
        }
    } else {
      for (let k = 0; k < 6; k++) {
        const d = document.createElement("div");
        d.style.backgroundImage = url;
        d.style.clipPath = "polygon(50% 50%, 100% 20%, 100% 80%)";
        host.appendChild(d);
        d.animate(
          [
            { transform: `rotate(${k * 60}deg) scale(.3)`, opacity: 0 },
            { transform: `rotate(${k * 60 + 60}deg) scale(1.4)`, opacity: 0.95, offset: 0.4 },
            { transform: `rotate(${k * 60 + 180}deg) scale(2.2)`, opacity: 0 },
          ],
          { duration: 3200, easing: "ease-in-out", fill: "forwards" },
        );
      }
    }
    done();
  }

  private clearLine() {
    if (this.lineEl) {
      const el = this.lineEl;
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 500);
    }
    this.lineEl = null;
    this.lineIndex = -1;
    this.wordEls = [];
  }

  /** Por frame: só mostra a linha certa e acende as palavras no seu tempo. */
  frame(t: number, mode: LyricsMode, style: LyricStyle, section: VizSection | null, neon: string, songId: string | undefined) {
    if (!this.lines || mode === "never" || style === "none" || songId !== this.songId || performance.now() < this.cardUntil) {
      if (this.lineEl) this.clearLine();
      return;
    }
    let idx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].t <= t) idx = i;
      else break;
    }
    const line = idx >= 0 ? this.lines[idx] : null;
    const live = line && t <= line.end + 0.4 && line.text.trim() !== "";
    const chorus = !!line && this.chorusText.has(line.text.trim().toLowerCase());
    const moment =
      mode === "always" ||
      chorus ||
      (section && (section.type === "chorus" || section.type === "drop" || section.type === "high")) ||
      t - this.lastBigAt < 10 ||
      idx % 4 === 0;
    if (!live || !moment) {
      if (this.lineEl) this.clearLine();
      return;
    }
    if (idx !== this.lineIndex) {
      this.clearLine();
      this.lineIndex = idx;
      const el = document.createElement("div");
      el.className = `vz-lyr vz-${style}${chorus ? " vz-chorus" : ""}`;
      el.style.setProperty("--neon", neon);
      el.style.setProperty("--hot", neon);
      const words = line.words && line.words.length
        ? line.words
        : line.text.split(/\s+/).filter(Boolean).map((w, i, all): [number, number, string] => {
            if (line.whole) return [line.t, line.end, w];
            const span = Math.max(0.3, line.end - line.t);
            const a = line.t + (span * 0.8 * i) / all.length;
            return [a, a + (span * 0.8) / all.length, w];
          });
      for (const [a, b, w] of words) {
        const s = document.createElement("span");
        s.className = `vz-w${b - a > 0.6 ? " long vz-long" : ""}`;
        s.textContent = style === "ascii" ? w.toUpperCase() : w;
        el.appendChild(s);
        this.wordEls.push({ el: s, t: a });
      }
      document.body.appendChild(el);
      this.lineEl = el;
    }
    for (const w of this.wordEls) if (t >= w.t - WORD_LEAD_S && !w.el.classList.contains("on")) w.el.classList.add("on");
  }

  /** A linha que está a tocar (com as palavras), para cenas que a desenham elas próprias. */
  current(t: number): VizLyricLine | null {
    if (!this.lines) return null;
    let best: VizLyricLine | null = null;
    for (const l of this.lines) {
      if (l.t <= t && t <= l.end + 0.3) best = l;
      if (l.t > t) break;
    }
    return best;
  }

  /** O texto da linha que está a tocar (Colagem, tipografia). */
  currentLine(t: number): string {
    return this.current(t)?.text ?? "";
  }

  clearAll() {
    this.clearLine();
    this.card?.remove();
  }
}
