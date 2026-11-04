import type { StyleProp, ViewStyle } from "react-native";
import type { FromViz, LyricsMode, SceneName, SceneSelection, VizFx } from "../../../viz/protocol";

export interface VizFrameProps {
  mode: "background" | "full";
  scene?: SceneName;
  chaos?: boolean;
  fx?: Partial<VizFx>;
  paused?: boolean;
  /** A letra por cima: sempre, às vezes, nunca. */
  lyrics?: LyricsMode;
  selection?: SceneSelection;
  favorites?: SceneName[];
  banned?: SceneName[];
  cycleOnTrack?: boolean;
  /** Um pedido de cena seguinte/anterior (muda o número para mandar). */
  stepToken?: { n: number; dir: 1 | -1 };
  onMessage?: (msg: FromViz) => void;
  style?: StyleProp<ViewStyle>;
}
