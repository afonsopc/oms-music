/**
 * O que a app manda ao motor (/viz/): monta as mensagens a partir da
 * reprodução, sem passar pelo React (subscribePlaybackView), para os 4 Hz da
 * posição nunca redesenharem nada.
 */
import type { Song } from "@/domain/song";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { getPlaybackView, subscribePlaybackView } from "@/remote/mirror";
import { artworkSourceUri } from "@/ui";
import type { ToViz, VizSong } from "../../../viz/protocol";

export const vizSong = (song: Song | null): VizSong | null =>
  song
    ? {
        id: String(song.id),
        title: song.title,
        artist: formatArtists(song),
        artworkUrl: artworkSourceUri(songArtworkSource(song)),
      }
    : null;

/**
 * A posição com a hora em que foi medida. A vista da reprodução só muda a
 * posição nos tiques do motor (4 Hz), por isso a hora certa é a do momento
 * em que o valor MUDOU, não a de agora: guardada aqui por quem segue.
 */
let measured = { song: "", pos: 0, at: 0 };

export const noteTick = (): void => {
  const v = getPlaybackView();
  const song = String(v.song?.id ?? "");
  if (song !== measured.song || v.position !== measured.pos) measured = { song, pos: v.position, at: Date.now() };
};

/** A posição agora, estimada a partir do último tique (para os pulsos na app). */
export const estimatedPosition = (): number => {
  const v = getPlaybackView();
  noteTick();
  return measured.pos + (v.playing ? (Date.now() - measured.at) / 1000 : 0);
};

export const stateMessage = (): ToViz => {
  const v = getPlaybackView();
  noteTick();
  return { type: "state", song: vizSong(v.song), playing: v.playing, position: measured.pos, at: measured.at };
};

/**
 * Manda o estado quando muda a música ou o play/pausa, e de 5 em 5 s para
 * acertar o relógio (o motor interpola entre medições).
 */
export const followPlayback = (send: (msg: ToViz) => void): (() => void) => {
  let lastKey = "";
  let lastSent = 0;
  const push = (force = false) => {
    const v = getPlaybackView();
    const key = `${v.song?.id ?? ""}|${v.playing}`;
    const now = Date.now();
    if (force || key !== lastKey || now - lastSent > 5000) {
      lastKey = key;
      lastSent = now;
      send(stateMessage());
    }
  };
  push(true);
  const unsub = subscribePlaybackView(() => {
    noteTick();
    push();
  });
  const id = setInterval(() => push(), 5000);
  return () => {
    unsub();
    clearInterval(id);
  };
};

/** As três cores da capa para o motor (escura, clara e a mistura). */
export const paletteFrom = (variants: { light: string; dark: string } | null): [string, string, string] =>
  variants ? [variants.dark, variants.light, mixHex(variants.dark, variants.light)] : ["#3b3f7a", "#c2577a", "#3fa391"];

const mixHex = (a: string, b: string): string => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.replace("#", "").padEnd(6, "0").slice(i - 1, i + 1), 16));
  const [x, y] = [p(a), p(b)];
  const m = x.map((v, i) => Math.round(v * 0.35 + y[i] * 0.65));
  // roda o tom para a terceira cor não ser só a meio caminho
  return `#${[m[2], m[0], m[1]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
