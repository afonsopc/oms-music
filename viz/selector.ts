/**
 * Que cena vem a seguir. "random": um baralho de todas (as favoritas contam
 * a dobrar, as banidas não entram), sem repetir a que acabou de passar.
 * "style": o mesmo, só com a família da música, decidida pelos géneros
 * (song.tags) e, sem eles, pelo andamento e pela energia média da análise.
 */
import { FULL_SCENES, SCENE_FAMILIES, type SceneFamily, type SceneName, type SceneSelection, type VizSong } from "./protocol";
import type { Decoded } from "./signal";

const CHAOS = /hardstyle|hyperpop|digicore|breakcore|glitch|metal|punk|hardcore|dubstep|drum ?(and|&|n) ?bass|dnb|gabber|phonk|nightcore|hardtek|frenchcore|jumpstyle|rawstyle|speedcore|noise/;
const CALM = /fado|acoustic|acústic|folk|jazz|classical|clássic|ambient|lo-?fi|piano|bossa|soul|singer-songwriter|chill|ballad|balada|orchestr|instrumental/;
const ELECTRONIC = /electro|house|techno|trance|synth|edm|disco|dance|future|eurobeat|idm|garage|club|electronic|eletr|electr/;

export const meanEnergy = (d: Decoded | null): number => {
  if (!d || d.env.length === 0) return 0.5;
  let s = 0;
  for (let i = 0; i < d.env.length; i++) s += d.env[i];
  return s / d.env.length / 255;
};

export const familyFor = (song: VizSong | null, d: Decoded | null): SceneFamily => {
  const tags = (song?.tags ?? []).join(" ").toLowerCase();
  if (CHAOS.test(tags)) return "chaos";
  if (CALM.test(tags)) return "calm";
  if (ELECTRONIC.test(tags)) return "electronic";
  const bpm = song?.bpm ?? d?.bpm ?? 120;
  const energy = meanEnergy(d);
  if ((bpm >= 150 && energy > 0.55) || energy > 0.78) return "chaos";
  if (bpm < 100 && energy < 0.6) return "calm";
  if (energy > 0.6) return "electronic";
  return "retro";
};

export class ScenePicker {
  private bag: SceneName[] = [];
  private bagKey = "";
  private last: SceneName | null = null;

  next(selection: SceneSelection, family: SceneFamily, favorites: SceneName[], banned: SceneName[]): SceneName {
    const base = selection === "style" ? SCENE_FAMILIES[family] : FULL_SCENES;
    let pool = base.filter((s) => !banned.includes(s));
    if (pool.length === 0) pool = FULL_SCENES.filter((s) => !banned.includes(s));
    if (pool.length === 0) pool = FULL_SCENES;
    const key = `${selection}|${family}|${favorites.join()}|${banned.join()}`;
    if (key !== this.bagKey || this.bag.length === 0) {
      this.bagKey = key;
      this.bag = [...pool, ...pool.filter((s) => favorites.includes(s))];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    let i = this.bag.findIndex((s) => s !== this.last);
    if (i < 0) i = 0;
    const pick = this.bag.splice(i, 1)[0];
    this.last = pick;
    return pick;
  }

  /** Uma escolha feita à mão (setas) também conta como a última. */
  saw(scene: SceneName): void {
    this.last = scene;
  }
}
