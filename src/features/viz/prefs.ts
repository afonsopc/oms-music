/**
 * As preferências do visualizador (guardadas no aparelho): aleatório ou
 * pelo estilo da música, as favoritas (saem a dobrar) e as banidas (nunca).
 */
import { create } from "zustand";
import { kvGetJson, kvSetJson } from "@/db/kv";
import type { SceneName, SceneSelection } from "../../../viz/protocol";

const KEY = "oms-music.viz.prefs";

export type LyricsMode = "always" | "sometimes" | "never";

export interface VizPrefs {
  selection: SceneSelection;
  /** A letra por cima das cenas: sempre, às vezes (refrões, depois de uma queda, de tantas em tantas linhas) ou nunca. */
  lyrics: LyricsMode;
  favorites: SceneName[];
  banned: SceneName[];
}

const initial = (): VizPrefs => {
  const stored = kvGetJson<Partial<VizPrefs>>(KEY);
  return {
    selection: stored?.selection === "random" ? "random" : "style",
    lyrics: stored?.lyrics === "always" || stored?.lyrics === "never" ? stored.lyrics : "sometimes",
    favorites: Array.isArray(stored?.favorites) ? stored.favorites : [],
    banned: Array.isArray(stored?.banned) ? stored.banned : [],
  };
};

export const useVizPrefs = create<VizPrefs>(initial);

const save = (next: Partial<VizPrefs>) => {
  useVizPrefs.setState(next);
  kvSetJson(KEY, useVizPrefs.getState());
};

export const setVizSelection = (selection: SceneSelection) => save({ selection });

export const cycleLyricsMode = () => {
  const order: LyricsMode[] = ["sometimes", "always", "never"];
  const cur = useVizPrefs.getState().lyrics;
  save({ lyrics: order[(order.indexOf(cur) + 1) % order.length] });
};

/** Três estados por cena: normal -> favorita -> banida -> normal. */
export const cycleScenePref = (scene: SceneName) => {
  const { favorites, banned } = useVizPrefs.getState();
  if (favorites.includes(scene)) save({ favorites: favorites.filter((s) => s !== scene), banned: [...banned, scene] });
  else if (banned.includes(scene)) save({ banned: banned.filter((s) => s !== scene) });
  else save({ favorites: [...favorites, scene] });
};
