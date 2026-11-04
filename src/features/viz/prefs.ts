/**
 * As preferências do visualizador (guardadas no aparelho): aleatório ou
 * pelo estilo da música, as favoritas (saem a dobrar) e as banidas (nunca).
 */
import { create } from "zustand";
import { kvGetJson, kvSetJson } from "@/db/kv";
import type { SceneName, SceneSelection } from "../../../viz/protocol";

const KEY = "oms-music.viz.prefs";

export interface VizPrefs {
  selection: SceneSelection;
  favorites: SceneName[];
  banned: SceneName[];
}

const initial = (): VizPrefs => {
  const stored = kvGetJson<Partial<VizPrefs>>(KEY);
  return {
    selection: stored?.selection === "random" ? "random" : "style",
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

/** Três estados por cena: normal -> favorita -> banida -> normal. */
export const cycleScenePref = (scene: SceneName) => {
  const { favorites, banned } = useVizPrefs.getState();
  if (favorites.includes(scene)) save({ favorites: favorites.filter((s) => s !== scene), banned: [...banned, scene] });
  else if (banned.includes(scene)) save({ banned: banned.filter((s) => s !== scene) });
  else save({ favorites: [...favorites, scene] });
};
